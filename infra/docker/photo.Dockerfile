# KrishiLoop photo worker (BioCLIP 2 vision tower, ONNX Runtime on CPU). Its build context is a small folder made by
# infra/azure/deploy.ps1: services/vision/{backbone,worker}.py plus the exported model (about 1.2 GB) in
# models/krishilens. It keeps nothing: an image comes in, a feature vector goes out, and only the API may call it.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN pip install fastapi==0.162.0 "uvicorn[standard]==0.54.0" numpy==2.5.4 onnxruntime==1.31.1 pillow==13.0.0
COPY services ./services
COPY models/krishilens ./models/krishilens
ENV KRISHILENS_DIR=/app/models/krishilens
EXPOSE 8001
CMD ["uvicorn", "services.vision.worker:app", "--host", "0.0.0.0", "--port", "8001"]
