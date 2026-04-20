# Seegak Benchmark Server

FastAPI 서버 — UMAP scatter 데이터를 SQLite에서 서빙합니다.

## 빠른 시작

```bash
cd benchmark-server
pip install -r requirements.txt

# 합성 데이터 100만개로 초기화 후 서버 실행
python main.py

# 또는 실제 h5ad 파일 사용
python main.py --h5ad /path/to/your/data.h5ad

# 포인트 수 지정 (기본 1M)
python main.py --populate 500000
```

서버 주소: http://127.0.0.1:8787

## API

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/info` | 총 셀 수, 클러스터 목록 |
| `GET /api/scatter.json?n=100000` | JSON scatter 데이터 |

## h5ad 지원

실제 h5ad 사용 시 추가 패키지 필요:

```bash
pip install anndata h5py
python main.py --h5ad data.h5ad
```

h5ad 파일에서 자동으로 감지:
- `.obsm['X_umap']` / `X_scVI` / `X_pca` → 좌표
- `.obs['leiden']` / `louvain` / `cell_type` → 클러스터

## 벤치마크 페이지

```bash
# 프론트엔드 dev server
cd ../  # seegak-test 루트
pnpm dev

# 브라우저에서
http://localhost:5173/benchmark.html
```
