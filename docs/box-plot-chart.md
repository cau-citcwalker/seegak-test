# BoxPlotChart

그룹별 데이터 분포를 사분위수, 중앙값, 이상치로 시각화합니다.
유전자 발현량의 세포 타입별 비교 등에 적합합니다.

## Props

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `data` | `BoxPlotData` | - | 차트 데이터 |
| `boxWidth` | `number` | - | 박스 너비 |
| `whiskerWidth` | `number` | - | 수염 너비 |
| `showOutliers` | `boolean` | `true` | 이상치 표시 여부 |
| `outlierSize` | `number` | - | 이상치 점 크기 |
| `defaultColor` | `string` | - | 기본 색상 (hex) |
| `style` | `CSSProperties` | - | 컨테이너 스타일 |
| `className` | `string` | - | 컨테이너 CSS 클래스 |

## 데이터 타입

```typescript
interface BoxPlotData {
  groups: BoxPlotGroup[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  orientation?: 'vertical' | 'horizontal';  // 기본값: 'vertical'
}

interface BoxPlotGroup {
  label: string;       // 그룹 이름
  values: number[];    // raw 데이터 (통계량 자동 계산)
  color?: string;      // 그룹별 색상 (hex)
  stats?: BoxStats;    // 미리 계산된 통계량 (선택)
}

interface BoxStats {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
}
```

## 예시: 유전자 발현 분포 비교

```tsx
import { BoxPlotChart } from '@seegak/react';

function ExpressionDistribution() {
  const data = {
    groups: [
      { label: 'AT1', values: at1Expression, color: '#e41a1c' },
      { label: 'AT2', values: at2Expression, color: '#377eb8' },
      { label: 'Endothelial', values: endoExpression, color: '#4daf4a' },
      { label: 'Fibroblast', values: fibroExpression, color: '#984ea3' },
      { label: 'Macrophage', values: macroExpression, color: '#ff7f00' },
    ],
    title: 'SFTPC Expression by Cell Type',
    xLabel: 'Cell Type',
    yLabel: 'log2(Expression + 1)',
  };

  return (
    <div style={{ width: 800, height: 500 }}>
      <BoxPlotChart
        data={data}
        showOutliers
        outlierSize={2}
      />
    </div>
  );
}
```

## 예시: 사전 계산된 통계량 사용

서버에서 이미 통계량을 계산한 경우 `stats`를 직접 전달하여 클라이언트 계산을 생략할 수 있습니다.

```tsx
const data = {
  groups: [
    {
      label: 'Group A',
      values: [],  // stats가 있으면 values는 무시
      stats: {
        min: 0.5,
        q1: 2.1,
        median: 3.4,
        q3: 5.2,
        max: 8.1,
        outliers: [0.1, 9.5, 10.2],
      },
    },
  ],
};
```

## 예시: 수평 방향

```tsx
const data = {
  groups: [...],
  orientation: 'horizontal',
};

<BoxPlotChart data={data} />
```
