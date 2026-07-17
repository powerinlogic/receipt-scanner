# Receipt Scanner — Render deployment image.
# Docker (rather than Render's native Python runtime) because the classifier
# needs the tesseract OCR binary, which can't be apt-installed on the native
# runtime. pillow-heif ships bundled libheif in its wheel, so no extra libs.

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render injects $PORT. One worker on purpose: the Drive-polling thread and
# SQLite both want a single process; threads handle request concurrency.
CMD gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120
