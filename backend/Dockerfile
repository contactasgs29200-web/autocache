FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

ENV MODEL_CACHE_DIR=/app/models
RUN mkdir -p /app/models

# Pre-download license plate model at build time so the container starts instantly.
# Uses MODEL_URL build arg if provided; silently skips if the URL fails or is an
# LFS pointer — the app falls back to yolov8n.pt at runtime in that case.
ARG MODEL_URL=""
RUN if [ -n "$MODEL_URL" ]; then \
      python -c " \
import urllib.request, sys; \
from pathlib import Path; \
dest = Path('/app/models/best.pt'); \
urllib.request.urlretrieve('$MODEL_URL', str(dest)); \
data = dest.read_bytes()[:40]; \
if data.startswith(b'version https://git-lfs'): \
    dest.unlink(); sys.exit('LFS pointer — skipping'); \
print(f'Model downloaded ({dest.stat().st_size//1024} KB)') \
" 2>&1 || echo "Build-time download failed — model will be fetched at runtime"; \
    fi

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
