# ScatterChart

WebGL2 기반 고성능 산점도 차트. UMAP/tSNE 클러스터링 시각화에 적합합니다.

## Props

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `data` | `ScatterData` | - | 차트 데이터 |
| `pointSize` | `number` | `5` | 점 크기 (px) |
| `opacity` | `number` | `0.9` | 점 투명도 (0~1) |
| `colorScale` | `ColorScale` | `VIRIDIS` | `values` 사용 시 색상 스케일 |
| `autoFit` | `boolean` | `true` | 데이터 범위에 맞춰 자동 줌 |
| `style` | `CSSProperties` | - | 컨테이너 스타일 |
| `className` | `string` | - | 컨테이너 CSS 클래스 |

## ScatterData

```typescript
interface ScatterData {
  x: Float32Array;       // X 좌표
  y: Float32Array;       // Y 좌표
  values?: Float32Array;  // 연속값 (0~1, colorScale로 매핑)
  colors?: string[];      // 점별 색상 (hex, values보다 우선)
  labels?: string[];      // 점별 라벨 (툴팁용)
}
```

## 예시: 카테고리별 색상

```tsx
import { ScatterChart } from '@seegak/react';

function UMAPPlot() {
  const data = {
    x: new Float32Array([...umapX]),
    y: new Float32Array([...umapY]),
    colors: cellTypes.map(type => clusterColorMap[type]),
    labels: cellTypes,
  };

  return (
    <div style={{ width: 800, height: 600 }}>
      <ScatterChart
        data={data}
        pointSize={3}
        opacity={0.85}
        autoFit
      />
    </div>
  );
}
```

## 예시: 연속값 색상 스케일

```tsx
import { ScatterChart, PLASMA } from '@seegak/react';

function ExpressionPlot() {
  // values는 0~1 범위로 정규화 필요
  const maxExpr = Math.max(...rawExpression);
  const normalized = new Float32Array(rawExpression.map(v => v / maxExpr));

  const data = {
    x: new Float32Array(umapX),
    y: new Float32Array(umapY),
    values: normalized,
  };

  return (
    <div style={{ width: 800, height: 600 }}>
      <ScatterChart data={data} colorScale={PLASMA} pointSize={4} />
    </div>
  );
}
```

## Ref API

`ref`를 통해 차트 인스턴스에 접근할 수 있습니다.

```tsx
import { useRef } from 'react';
import { ScatterChart } from '@seegak/react';
import type { ScatterChartHandle } from '@seegak/react';

function InteractiveScatter() {
  const chartRef = useRef<ScatterChartHandle>(null);

  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pointIndex = chartRef.current?.hitTest(x, y);
    if (pointIndex !== null && pointIndex !== undefined) {
      console.log(`Clicked point index: ${pointIndex}`);
    }
  };

  return (
    <div style={{ width: 800, height: 600 }} onClick={handleClick}>
      <ScatterChart ref={chartRef} data={data} />
    </div>
  );
}
```
