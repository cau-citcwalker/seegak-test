# 시작하기

## 설치

```bash
npm install @seegak/react
```

`@seegak/react`를 설치하면 `@seegak/core`, `@seegak/bio-charts`, `@seegak/human-body-map`이 함께 설치됩니다.

### 요구 사항

- React 18 이상
- WebGL2를 지원하는 브라우저 (Chrome, Firefox, Edge, Safari 15+)

## 기본 사용법

```tsx
import { ScatterChart } from '@seegak/react';

function MyChart() {
  const data = {
    x: new Float32Array([1, 2, 3, 4, 5]),
    y: new Float32Array([2, 4, 1, 5, 3]),
    colors: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00'],
  };

  return (
    <div style={{ width: 600, height: 400 }}>
      <ScatterChart data={data} pointSize={8} autoFit />
    </div>
  );
}
```

## 중요: 컨테이너 크기 지정

모든 차트 컴포넌트는 부모 컨테이너의 100%를 채웁니다.
**반드시 부모 요소에 명시적인 너비/높이를 지정**해야 합니다.

```tsx
// OK - 명시적 크기
<div style={{ width: 600, height: 400 }}>
  <ScatterChart data={data} />
</div>

// OK - CSS grid/flex에서 크기가 결정되는 경우
<div style={{ display: 'grid', gridTemplateColumns: '1fr', height: 500 }}>
  <ScatterChart data={data} />
</div>

// NG - 크기가 0이 되어 차트가 보이지 않음
<div>
  <ScatterChart data={data} />
</div>
```

> **Tip**: `overflow: hidden`을 컨테이너에 설정하면 ResizeObserver 피드백 루프를 방지할 수 있습니다.

## 데이터 형식

Seegak의 차트는 **Float32Array**를 사용합니다.
일반 배열도 전달할 수 있지만, 대량 데이터에서는 Float32Array가 메모리와 성능 면에서 유리합니다.

```tsx
// 일반 배열 → Float32Array 변환
const rawX = [1.0, 2.5, 3.2, 4.8];
const x = new Float32Array(rawX);

// API 응답에서 직접 생성
const response = await fetch('/api/umap-data');
const json = await response.json();
const data = {
  x: new Float32Array(json.x),
  y: new Float32Array(json.y),
  colors: json.cellTypes.map((t: string) => colorMap[t]),
};
```

## 패키지 구조

```
@seegak/react          ← React 컴포넌트 (이것만 import하면 됨)
  ├── @seegak/bio-charts   ← 차트 로직 (ScatterChart, BoxPlot 등)
  ├── @seegak/human-body-map ← 인체 맵
  └── @seegak/core         ← WebGL2 렌더링 엔진
```

대부분의 경우 `@seegak/react`에서 모든 것을 import할 수 있습니다:

```tsx
import {
  ScatterChart,
  FeaturePlotChart,
  BoxPlotChart,
  BarChart,
  PieChart,
  HumanBodyMap,
  VIRIDIS, PLASMA, INFERNO,  // 내장 색상 스케일
} from '@seegak/react';

import type {
  ScatterData,
  FeaturePlotData,
  BoxPlotData,
  BarChartData,
  PieChartData,
  ColorScale,
} from '@seegak/react';
```

커스텀 색상 스케일 등 core 유틸리티가 필요한 경우:

```tsx
import type { ColorScale, Vec4 } from '@seegak/core';
```
