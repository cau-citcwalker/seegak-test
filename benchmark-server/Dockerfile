FROM python:3.12-slim

WORKDIR /app

# Install system deps for grpc/numpy
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-build per-gene visualization cache for all h5ad files at image build
# time. Each gene becomes a tiny subsampled + quantized sparse file that the
# runtime endpoint streams directly to the client — no h5py, no slicing.
RUN python build_viz_cache.py || echo "No h5ad files to pre-build"

EXPOSE 5001 50051

CMD ["python", "main.py", "--port", "5001", "--host", "0.0.0.0"]
