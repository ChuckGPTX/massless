"""Runpod MOSS worker. Model code and weights are pinned; no user-provided code or URLs."""
import base64,io,os,time
import runpod
MODEL_ID='OpenMOSS-Team/MOSS-Image-SFT'
REVISION='f972bd4b4b9e3852133cc5da954d87bc32cd8fb9'
pipe=None

def handler(job):
    global pipe
    value=job.get('input',{})
    if value.get('model','moss-image-sft')!='moss-image-sft': raise ValueError('Unsupported model')
    prompt=value.get('prompt','')
    width=value.get('width',1024);height=value.get('height',1024);seed=value.get('seed',42)
    if not isinstance(prompt,str) or not 1<=len(prompt)<=12000:raise ValueError('Invalid prompt')
    if not all(type(x) is int and 256<=x<=1536 and x%16==0 for x in [width,height]) or width*height>1572864:raise ValueError('Invalid dimensions')
    if type(seed) is not int or not 0<=seed<=2147483647:raise ValueError('Invalid seed')
    import torch
    from diffusers import DiffusionPipeline
    if pipe is None:
        pipe=DiffusionPipeline.from_pretrained(MODEL_ID,revision=REVISION,custom_pipeline='pipeline_moss_image',custom_revision=REVISION,trust_remote_code=True,torch_dtype={'default':torch.bfloat16,'vae':torch.float32})
        pipe.scheduler=type(pipe.scheduler).from_config(pipe.scheduler.config)
        pipe.enable_model_cpu_offload()
        if hasattr(pipe.vae, "enable_tiling"): pipe.vae.enable_tiling()
    start=time.monotonic()
    with torch.inference_mode():
        image=pipe(prompt,height=height,width=width,num_inference_steps=50,guidance_scale=3.0,uncond_skip_layers=[22],generator=torch.Generator('cpu').manual_seed(seed)).images[0]
    buf=io.BytesIO();image.convert('RGB').save(buf,format='JPEG',quality=92)
    return {'image':'data:image/jpeg;base64,'+base64.b64encode(buf.getvalue()).decode(),'model':MODEL_ID,'revision':REVISION,'seed':seed,'seconds':round(time.monotonic()-start,3)}

if __name__=='__main__':runpod.serverless.start({'handler':handler})
