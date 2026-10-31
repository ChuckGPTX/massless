"""Convert the official Real-ESRGAN general x4v3 weights to the ONNX file the Edit page runs.

    python3 tools/convert_realesrgan.py realesr-general-x4v3.pth public/models/realesr-general-x4v3.onnx

Source: https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth
(BSD-3-Clause, Copyright (c) 2021 Xintao Wang; SHA-256 8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292).

No PyTorch needed: the checkpoint is a zip of raw tensor storages plus a pickle that names them, so a
restricted unpickler reads the shapes and this script rebuilds SRVGGNetCompact (num_feat 64, num_conv 32,
PReLU, x4 pixel shuffle, plus a nearest-neighbour upsample of the input) with the onnx helper API.
Needs: pip install onnx numpy. Input "input" float32 [1,3,H,W] RGB in 0..1; output "output" [1,3,4H,4W].
"""
import hashlib
import pickle
import sys
import zipfile

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

EXPECTED = '8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292'
DTYPES = {'FloatStorage': np.float32, 'HalfStorage': np.float16}


class Storage:
    def __init__(self, kind):
        self.kind = kind


def rebuild_tensor(storage, offset, size, stride, *_):
    return ('tensor', storage, offset, tuple(size), tuple(stride))


class Loader(pickle.Unpickler):
    """Only the handful of globals a plain state dict needs; anything else is refused."""

    def __init__(self, f, zf, prefix):
        super().__init__(f)
        self.zf = zf
        self.prefix = prefix

    def find_class(self, module, name):
        if module == 'collections' and name == 'OrderedDict':
            import collections
            return collections.OrderedDict
        if module == 'torch._utils' and name == '_rebuild_tensor_v2':
            return rebuild_tensor
        if module == 'torch' and name in DTYPES:
            return Storage(name)
        raise pickle.UnpicklingError(f'refusing {module}.{name}')

    def persistent_load(self, pid):
        _, kind, key, _location, _numel = pid
        raw = self.zf.read(f'{self.prefix}/data/{key}')
        return np.frombuffer(raw, dtype=DTYPES[kind.kind])


def load_state(path):
    zf = zipfile.ZipFile(path)
    pkl = next(n for n in zf.namelist() if n.endswith('data.pkl'))
    prefix = pkl.rsplit('/', 1)[0]
    import io
    obj = Loader(io.BytesIO(zf.read(pkl)), zf, prefix).load()
    state = obj.get('params', obj.get('params_ema', obj))
    out = {}
    for k, (_, buf, offset, size, stride) in state.items():
        n = int(np.prod(size)) if size else 1
        a = np.lib.stride_tricks.as_strided(buf[offset:], shape=size, strides=[s * buf.itemsize for s in stride]) if size else buf[offset:offset + 1]
        out[k] = np.ascontiguousarray(a, dtype=np.float32).reshape(size)
        assert out[k].size == n
    return out


def build(state):
    convs = sorted({int(k.split('.')[1]) for k in state if k.endswith('.weight') and state[k].ndim == 4})
    prelus = sorted({int(k.split('.')[1]) for k in state if k.endswith('.weight') and state[k].ndim == 1})
    assert len(convs) == 34 and len(prelus) == 33, (len(convs), len(prelus))
    nodes, inits = [], []
    x = 'input'
    for i in range(convs[-1] + 1):
        if i in convs:
            w, b = f'body.{i}.weight', f'body.{i}.bias'
            inits += [numpy_helper.from_array(state[w], w), numpy_helper.from_array(state[b], b)]
            nodes.append(helper.make_node('Conv', [x, w, b], [f'c{i}'], kernel_shape=[3, 3], pads=[1, 1, 1, 1]))
            x = f'c{i}'
        elif i in prelus:
            s = f'body.{i}.weight'
            inits.append(numpy_helper.from_array(state[s].reshape(-1, 1, 1), s))
            nodes.append(helper.make_node('PRelu', [x, s], [f'p{i}']))
            x = f'p{i}'
    nodes.append(helper.make_node('DepthToSpace', [x], ['shuffled'], blocksize=4, mode='CRD'))
    inits.append(numpy_helper.from_array(np.array([1, 1, 4, 4], dtype=np.float32), 'scales'))
    nodes.append(helper.make_node('Resize', ['input', '', 'scales'], ['base'], mode='nearest',
                                  coordinate_transformation_mode='asymmetric', nearest_mode='floor'))
    nodes.append(helper.make_node('Add', ['shuffled', 'base'], ['output']))
    graph = helper.make_graph(
        nodes, 'realesr-general-x4v3',
        [helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, 3, 'height', 'width'])],
        [helper.make_tensor_value_info('output', TensorProto.FLOAT, [1, 3, 'height4', 'width4'])],
        inits)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid('', 17)], producer_name='massless')
    model.ir_version = 8
    model.doc_string = 'Real-ESRGAN general x4v3 (BSD-3-Clause, Copyright (c) 2021 Xintao Wang). Converted by tools/convert_realesrgan.py.'
    onnx.checker.check_model(model)
    return model


if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    digest = hashlib.sha256(open(src, 'rb').read()).hexdigest()
    if digest != EXPECTED:
        sys.exit(f'unexpected checkpoint: {digest}')
    onnx.save(build(load_state(src)), dst)
    print(dst, hashlib.sha256(open(dst, 'rb').read()).hexdigest())
