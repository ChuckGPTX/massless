// A very small WebGL2 kit for the preset engines: one offscreen canvas per engine, shader programs,
// textures from canvases or images, a full-screen quad and dynamic triangle meshes.

export function createGL(w = 16, h = 16) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const gl = c.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: true, alpha: true });
  if (!gl) throw new Error('This effect needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.');
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const kit = {
    canvas: c, gl,
    size(W, H) { if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } gl.viewport(0, 0, W, H); },
    clear(r = 0, g = 0, b = 0, a = 0) { gl.clearColor(r, g, b, a); gl.clear(gl.COLOR_BUFFER_BIT); },
    program(vs, fs) {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
      const loc = {};
      const u = (name) => (name in loc ? loc[name] : (loc[name] = gl.getUniformLocation(p, name)));
      return {
        p,
        use() { gl.useProgram(p); return this; },
        f(name, ...v) { const l = u(name); if (l) gl[`uniform${v.length}f`](l, ...v); return this; },
        i(name, v) { const l = u(name); if (l) gl.uniform1i(l, v); return this; },
        m4(name, m) { const l = u(name); if (l) gl.uniformMatrix4fv(l, false, m); return this; },
        attrib: (name) => gl.getAttribLocation(p, name),
      };
    },
    texture(src, { repeat = false, mips = true } = {}) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (mips) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    },
    bind(tex, unit = 0) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); },
    /** Draw the full-screen quad with program `prog` (attribute `a_pos`). */
    quad(prog) {
      const a = prog.attrib('a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    /** A grid mesh of (n+1)^2 vertices with uv; positions are rewritten each frame through update(). */
    grid(n) {
      const verts = (n + 1) * (n + 1);
      const uv = new Float32Array(verts * 2), pos = new Float32Array(verts * 3), shade = new Float32Array(verts);
      for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) { const i = y * (n + 1) + x; uv[i * 2] = x / n; uv[i * 2 + 1] = y / n; shade[i] = 1; }
      const idx = new Uint32Array(n * n * 6);
      let k = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const a = y * (n + 1) + x, b = a + 1, c2 = a + n + 1, d = c2 + 1;
        idx.set([a, c2, b, b, c2, d], k); k += 6;
      }
      const bufs = { uv: gl.createBuffer(), pos: gl.createBuffer(), shade: gl.createBuffer(), idx: gl.createBuffer() };
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      return {
        n, uv, pos, shade,
        draw(prog) {
          gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
          const ap = prog.attrib('a_pos'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, bufs.uv);
          const au = prog.attrib('a_uv'); if (au >= 0) { gl.enableVertexAttribArray(au); gl.vertexAttribPointer(au, 2, gl.FLOAT, false, 0, 0); }
          gl.bindBuffer(gl.ARRAY_BUFFER, bufs.shade); gl.bufferData(gl.ARRAY_BUFFER, shade, gl.DYNAMIC_DRAW);
          const as = prog.attrib('a_shade'); if (as >= 0) { gl.enableVertexAttribArray(as); gl.vertexAttribPointer(as, 1, gl.FLOAT, false, 0, 0); }
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.idx);
          gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
        },
      };
    },
  };
  return kit;
}

export const QUAD_VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; v_uv.y = 1.0 - v_uv.y; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

/** Shared GLSL: hash noise, fbm and cover-fit sampling. */
export const GLSL_LIB = `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;
