# seegak-test

[Seegak](https://github.com/cau-citcwalker/seegak) 라이브러리의 **개발/검증 환경**이자 데모 페이지 + 벤치마크 서버입니다. 여기서 Seegak의 기능을 직접 써보면서 버그를 잡고 개선점을 찾습니다.

---

## 디렉토리 구조 전제

Seegak의 React 패키지가 **상대 경로**(`file:../seegak/packages/...`)로 연결되어 있어서, **반드시 `seegak`과 `seegak-test`를 같은 상위 디렉토리 아래에 나란히 clone해야 합니다.**

```
my-workspace/
├── seegak/            ← 라이브러리 본체 (cau-citcwalker/seegak)
└── seegak-test/       ← 이 레포 (cau-citcwalker/seegak-test)
```

`package.json`의 의존성은 이렇게 되어 있습니다:

```json
"@seegak/react":        "file:../seegak/packages/react",
"@seegak/bio-charts":   "file:../seegak/packages/bio-charts",
"@seegak/3d":           "file:../seegak/packages/3d",
...
```

옆에 `seegak` 폴더가 없으면 `pnpm install` 단계에서 실패합니다.

---

## 셋업

### 1. 두 레포 clone

```bash
# 임의의 워크스페이스 디렉토리로 이동
cd ~/projects    # (또는 원하는 곳)

git clone https://github.com/cau-citcwalker/seegak.git
git clone https://github.com/cau-citcwalker/seegak-test.git
```

### 2. Seegak 패키지 빌드 (한 번)

`seegak-test`는 `seegak`의 **빌드된 결과물**(`dist/`)을 참조하므로, 먼저 라이브러리를 빌드해야 합니다.

```bash
cd seegak
pnpm install
pnpm -r build    # 모든 패키지 빌드
cd ..
```

### 3. seegak-test 실행

```bash
cd seegak-test
pnpm install
pnpm dev        # Vite 개발 서버 (http://localhost:5173)
```

브라우저에서 `http://localhost:5173` 열면 데모 페이지가 뜹니다.

### 4. (선택) 벤치마크 서버 실행

실제 h5ad 데이터셋(GTEx 등)을 쓰려면 Python 백엔드가 필요합니다.

```bash
cd seegak-test/benchmark-server
pip install -r requirements.txt

# h5ad 파일을 h5ad/ 디렉토리에 배치 (직접 준비 — 레포에 포함되지 않음)
# 예: h5ad/GTEx_8_tissues_snRNAseq_atlas_071421.public_obs.h5ad

# 3D UMAP + per-gene 캐시 미리 계산 (5-15분 소요)
python build_viz_cache.py

# 서버 기동
python main.py --port 5001
```

또는 Docker로 한 번에:

```bash
cd seegak-test
docker compose up -d
```

---

## 개발 워크플로우

### Seegak 라이브러리 수정 시

1. `seegak/packages/<pkg>/src/`에서 코드 수정
2. 해당 패키지 리빌드: `cd seegak && pnpm --filter @seegak/<pkg> build`
3. `seegak-test`의 Vite 개발 서버가 자동 감지 → 핫 리로드

> 전체 리빌드가 필요하면 `pnpm -r build`

### seegak-test 데모 수정 시

`src/` 수정 → Vite 핫 리로드로 즉시 반영

### 벤치마크 서버 수정 시

`benchmark-server/main.py` 수정 → `python main.py`로 재기동 (또는 uvicorn `--reload` 모드)

---

## 주요 디렉토리

| 경로 | 역할 |
|---|---|
| `src/` | 데모 페이지 React 소스 |
| `src/App.tsx` | 메인 탭/레이아웃 (main / genomics / 3d / gating) |
| `src/pages/BenchmarkPage.tsx` | 프로토콜 벤치마크 UI (JSON/MessagePack/Zarr 등 속도 비교) |
| `src/dataset-loader.ts` | 서버에서 scatter/gene expression 로드 |
| `src/mock-data.ts` | 데모용 가짜 데이터 생성 |
| `benchmark-server/main.py` | FastAPI 서버 (다중 프로토콜 scatter 엔드포인트 + `/api/expression`) |
| `benchmark-server/build_viz_cache.py` | 오프라인: h5ad → 3D UMAP 계산 + SQLite DB + per-gene 캐시 |
| `benchmark-server/h5ad/` | 원본 h5ad 데이터셋 (gitignore됨, 직접 배치) |
| `benchmark-server/viz_cache/` | 빌드 산출물 (gitignore됨) |
| `docs/` | Seegak 차트 API 문서 (seegak 레포와 부분 중복) |

---

## 문서

- [Seegak 본체 문서](https://github.com/cau-citcwalker/seegak/tree/main/docs)
- [시작하기](docs/getting-started.md)
- [ScatterChart](docs/scatter-chart.md)
- [FeaturePlotChart](docs/feature-plot-chart.md)
- [BoxPlotChart](docs/box-plot-chart.md)
- [BarChart](docs/bar-chart.md)
- [PieChart](docs/pie-chart.md)
- [HumanBodyMap](docs/human-body-map.md)
- [색상 스케일](docs/color-scales.md)

---

## 자주 발생하는 문제

### `pnpm install`이 `Cannot read properties of null (reading 'package')` 에러로 실패

→ 상위 디렉토리에 `seegak` 레포가 없거나, 경로 이름이 다릅니다. `../seegak`에서 해당 패키지 `package.json`이 읽혀야 합니다.

### 차트가 텅 비거나 WebGL 에러

→ `seegak` 패키지를 빌드하지 않았거나 오래된 빌드입니다. `cd ../seegak && pnpm -r build` 후 재시도.

### `/api/expression`이 503 반환

→ `build_viz_cache.py`를 실행하지 않았습니다. 먼저 캐시를 빌드하세요.

### Docker로 실행 시 백엔드가 재시작 루프

→ `docker compose logs backend`로 트레이스 확인. 대부분 h5ad 파일 누락 또는 Python 의존성 문제.

---

## 라이선스

내부 연구/개발용.
