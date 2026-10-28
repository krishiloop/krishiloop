# KrishiLoop API (plans, receipts, verifier, recall, photo cases, replay). Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t krishiloop-api .
# /app/data must be a persistent volume: it holds the signed credentials and status lists, which must outlive restarts.
# The photo model runs in its own container (photo.Dockerfile); this image carries only its small files (meta, labels,
# text embeddings, file hash) in /app/models/krishilens, placed in the build context by infra/azure/deploy.ps1.
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY services ./services
COPY rules ./rules
COPY contracts ./contracts
COPY corpus/manifest.yaml ./corpus/manifest.yaml
COPY corpus/text ./corpus/text
COPY ml/vision/artifacts/area_trust_replay.json ./ml/vision/artifacts/area_trust_replay.json
COPY infra/docker/build-context/krishilens-small ./models/krishilens
ENV KRISHILENS_DIR=/app/models/krishilens
EXPOSE 8000
CMD ["uvicorn", "services.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
