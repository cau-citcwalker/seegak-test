# FeaturePlotChart

유전자 발현량을 UMAP/tSNE 좌표 위에 색상 그라데이션으로 오버레이하는 차트입니다.
ScatterChart와 유사하지만, expression 값을 내부적으로 min/max 정규화하여 색상 스케일에 매핑합니다.

## Props

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `data` | `FeaturePlotData` | - | 차트 데이터 |
| `pointSize` | `number` | `5` | 점 크기 (px) |
| `opacity` | `number` | `0.9` | 점 투명도 (0~1) |
| `colorScale` | `ColorScale` | `VIRIDIS` | 발현량 색상 스케일 |
| `autoFit` | `boolean` | `true` | 데이터 범위에 맞춰 자동 줌 |
| `style` | `CSSProperties` | - | 컨테이너 스타일 |
| `className` | `string` | - | 컨테이너 CSS 클래스 |

## FeaturePlotData

```typescript
interface FeaturePlotData {
  x: Float32Array;           // UMAP/tSNE X 좌표
  y: Float32Array;           // UMAP/tSNE Y 좌표
  expression: Float32Array;  // 유전자 발현값 (raw 값, 내부에서 정규화됨)
  geneName?: string;         // 유전자 이름 (차트 제목으로 표시)
}
```

## 예시: 기본 사용

```tsx
import { FeaturePlotChart, VIRIDIS } from '@seegak/react';

function GeneExpression() {
  const data = {
    x: new Float32Array(umapX),
    y: new Float32Array(umapY),
    expression: new Float32Array(sftpcExpression),
    geneName: 'SFTPC',
  };

  return (
    <div style={{ width: 600, height: 500 }}>
      <FeaturePlotChart
        data={data}
        pointSize={3}
        opacity={0.9}
        colorScale={VIRIDIS}
        autoFit
      />
    </div>
  );
}
```

## 예시: 커스텀 색상 스케일

내장 스케일(VIRIDIS, PLASMA, INFERNO)의 낮은 값이 어두운 배경에서 보이지 않을 수 있습니다.
이 경우 커스텀 색상 스케일을 정의하세요.

```tsx
import { FeaturePlotChart } from '@seegak/react';
import type { ColorScale } from '@seegak/core';

const CUSTOM_SCALE: ColorScale = {
  stops: [
    { position: 0.0, color: { r: 0.6, g: 0.6, b: 0.65, a: 1 } },  // 밝은 회색
    { position: 0.3, color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } },   // 파랑
    { position: 0.6, color: { r: 0.9, g: 0.2, b: 0.2, a: 1 } },   // 빨강
    { position: 1.0, color: { r: 1.0, g: 0.95, b: 0.2, a: 1 } },  // 노랑
  ],
};

function GeneExpression() {
  return (
    <div style={{ width: 600, height: 500, background: '#f5f5f8' }}>
      <FeaturePlotChart
        data={data}
        colorScale={CUSTOM_SCALE}
        autoFit
      />
    </div>
  );
}
```

## 예시: 유전자 선택 인터랙션

```tsx
import { useState } from 'react';
import { FeaturePlotChart, VIRIDIS } from '@seegak/react';

const GENES = ['SFTPC', 'AGER', 'PECAM1', 'CD68'];

function GeneExplorer() {
  const [gene, setGene] = useState('SFTPC');

  // API에서 발현 데이터 로드 (예시)
  const data = {
    x: umapCoords.x,
    y: umapCoords.y,
    expression: geneExpressionMap[gene],
    geneName: gene,
  };

  return (
    <div>
      <div>
        {GENES.map(g => (
          <button key={g} onClick={() => setGene(g)}>{g}</button>
        ))}
      </div>
      <div style={{ width: 600, height: 500 }}>
        <FeaturePlotChart data={data} colorScale={VIRIDIS} autoFit />
      </div>
    </div>
  );
}
```

## ScatterChart와의 차이

| | ScatterChart | FeaturePlotChart |
|---|---|---|
| 색상 입력 | `colors` (hex 배열) 또는 `values` (0~1 정규화 필요) | `expression` (raw 값, 자동 정규화) |
| 용도 | 범주형 클러스터링 | 연속값 오버레이 |
| 정규화 | 사용자가 직접 | 내부에서 min/max 자동 |
| 제목 표시 | 없음 | `geneName`으로 자동 표시 |
