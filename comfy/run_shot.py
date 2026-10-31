"""Render a Chucksi hero frame with open weights through the Comfy SDK.

The same rig vocabulary as the web app (public/data/rig.json) compiles the prompt, and the
workflow (public/comfy/massless_shot_flux_schnell.api.json) runs FLUX.1 [schnell], an
Apache-2.0 open-weight model. No partner nodes, no paid APIs.

Local, free (your GPU):
    pip install comfy-sdk comfy-api-proxy
    # put flux1-schnell-fp8.safetensors in ComfyUI/models/checkpoints and start ComfyUI
    comfy-api-proxy                      # serves Comfy API v2 on 127.0.0.1:8189
    export COMFY_BASE_URL=http://127.0.0.1:8189
    python comfy/run_shot.py "a lighthouse keeper on a spiral stair" --camera 16mm --lens vintage --focal 24 --aspect 185

Comfy Cloud or a Comfy API deployment works too: set COMFY_BASE_URL and COMFY_API_KEY.
"""
import argparse
import json
import os
import random
from pathlib import Path

from comfy_sdk import Comfy

ROOT = Path(__file__).resolve().parent.parent
RIG = json.loads((ROOT / "public" / "data" / "rig.json").read_text())
WORKFLOW = ROOT / "public" / "comfy" / "massless_shot_flux_schnell.api.json"


def pick(group, key):
    for item in RIG[group]:
        if group == "focal" and item["mm"] == int(key):
            return item
        if group == "aperture" and item["f"] == str(key):
            return item
        if item.get("id") == key:
            return item
    raise SystemExit(f"Unknown {group}: {key}. Options: {[i.get('id') or i.get('mm') or i.get('f') for i in RIG[group]]}")


def compile_prompt(subject, a):
    parts = [
        subject.rstrip(". "),
        pick("genre", a.genre)["prompt"],
        pick("shot", a.shot)["prompt"],
        pick("angle", a.angle)["prompt"],
        pick("camera", a.camera)["prompt"],
        pick("lens", a.lens)["prompt"],
        pick("focal", a.focal)["prompt"],
        pick("aperture", a.aperture)["prompt"],
        pick("light", a.light)["prompt"],
        pick("stock", a.stock)["prompt"],
        pick("palette", a.palette)["prompt"],
        "cinematic film still, high detail, no text",
    ]
    return ", ".join(x for x in parts if x)


def main():
    p = argparse.ArgumentParser(description="Render a Chucksi shot with open weights via the Comfy SDK")
    p.add_argument("subject")
    p.add_argument("--camera", default="35mm")
    p.add_argument("--lens", default="anamorphic")
    p.add_argument("--focal", default="50")
    p.add_argument("--aperture", default="1.4")
    p.add_argument("--shot", default="ms")
    p.add_argument("--angle", default="eye")
    p.add_argument("--light", default="golden")
    p.add_argument("--stock", default="negative")
    p.add_argument("--genre", default="none")
    p.add_argument("--palette", default="natural")
    p.add_argument("--aspect", default="239")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--out", default="out")
    a = p.parse_args()

    aspect = pick("aspect", a.aspect)
    prompt = compile_prompt(a.subject, a)
    print("Prompt:", prompt)

    key = os.environ.get("COMFY_API_KEY")
    client = Comfy(api_key=key) if key else Comfy()

    wf = client.workflows.from_file(str(WORKFLOW))
    wf.set_input("6", "text", prompt)
    wf.set_input("5", "width", aspect["w"] // 16 * 16)
    wf.set_input("5", "height", aspect["h"] // 16 * 16)
    wf.set_input("3", "seed", a.seed if a.seed is not None else random.randint(0, 2**31 - 1))

    job = client.run(wf)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for output in job.get_outputs("9"):
        path = out / output.name
        output.to_file(str(path))
        print("Saved", path)
    print("Load it in Chucksi with 'Use my own still' to add camera moves.")


if __name__ == "__main__":
    main()
