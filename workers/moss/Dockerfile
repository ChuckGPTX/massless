FROM pytorch/pytorch:2.9.0-cuda12.8-cudnn9-runtime
WORKDIR /app
COPY workers/moss/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY workers/moss/handler.py /app/handler.py
ENV PYTHONUNBUFFERED=1 HF_HOME=/runpod-volume/huggingface
CMD ["python", "-u", "/app/handler.py"]
