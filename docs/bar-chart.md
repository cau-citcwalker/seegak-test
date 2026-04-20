# BarChart

범주형 데이터의 수치를 막대로 비교합니다. 단순 막대와 스택 막대 차트를 지원합니다.

## Props

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `data` | `BarChartData` | - | 차트 데이터 |
| `barWidth` | `number` | - | 막대 너비 |
| `defaultColor` | `string` | - | 기본 막대 색상 (hex) |
| `gap` | `number` | - | 막대 간 간격 |
| `style` | `CSSProperties` | - | 컨테이너 스타일 |
| `className` | `string` | - | 컨테이너 CSS 클래스 |

## 데이터 타입

```typescript
// 단순 막대
interface BarGroup {
  label: string;
  value: number;
  color?: string;  // 개별 색상 (hex)
}

// 스택 막대
interface StackedBarGroup {
  label: string;
  segments: Array<{
    value: number;
    color: string;
    label?: string;
  }>;
}

interface BarChartData {
  groups: BarGroup[] | StackedBarGroup[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  orientation?: 'vertical' | 'horizontal';
  stacked?: boolean;  // true이면 StackedBarGroup으로 해석
}
```

## 예시: 세포 수 비교

```tsx
import { BarChart } from '@seegak/react';

function CellCounts() {
  const data = {
    groups: [
      { label: 'AT1', value: 800, color: '#e41a1c' },
      { label: 'AT2', value: 1200, color: '#377eb8' },
      { label: 'Endothelial', value: 1500, color: '#4daf4a' },
      { label: 'Fibroblast', value: 900, color: '#984ea3' },
      { label: 'Macrophage', value: 700, color: '#ff7f00' },
    ],
    title: 'Cell Count per Type',
    xLabel: 'Cell Type',
    yLabel: 'Count',
  };

  return (
    <div style={{ width: 600, height: 400 }}>
      <BarChart data={data} />
    </div>
  );
}
```

## 예시: 단일 색상

모든 막대에 같은 색상을 적용하려면 `defaultColor`를 사용합니다.

```tsx
<BarChart data={data} defaultColor="#3b82f6" />
```

## 예시: 스택 막대 차트

```tsx
const data = {
  groups: [
    {
      label: 'Sample A',
      segments: [
        { value: 300, color: '#e41a1c', label: 'AT1' },
        { value: 500, color: '#377eb8', label: 'AT2' },
        { value: 200, color: '#4daf4a', label: 'Endothelial' },
      ],
    },
    {
      label: 'Sample B',
      segments: [
        { value: 400, color: '#e41a1c', label: 'AT1' },
        { value: 350, color: '#377eb8', label: 'AT2' },
        { value: 250, color: '#4daf4a', label: 'Endothelial' },
      ],
    },
  ],
  stacked: true,
  title: 'Cell Composition by Sample',
};

<BarChart data={data} />
```
