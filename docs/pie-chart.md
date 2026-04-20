# PieChart

비율과 구성을 원형 차트로 시각화합니다. 도넛 차트도 지원합니다.

## Props

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `data` | `PieChartData` | - | 차트 데이터 |
| `showLabels` | `boolean` | `false` | 라벨 표시 여부 |
| `showPercentage` | `boolean` | `false` | 퍼센트 표시 여부 |
| `style` | `CSSProperties` | - | 컨테이너 스타일 |
| `className` | `string` | - | 컨테이너 CSS 클래스 |

## 데이터 타입

```typescript
interface PieSlice {
  label: string;
  value: number;
  color?: string;  // hex 색상
}

interface PieChartData {
  slices: PieSlice[];
  title?: string;
  innerRadius?: number;  // 도넛 차트 (0 = 원형, 0.5 = 도넛)
}
```

## 예시: 세포 타입 비율

```tsx
import { PieChart } from '@seegak/react';

function CellTypeProportions() {
  const data = {
    slices: [
      { label: 'AT1', value: 800, color: '#e41a1c' },
      { label: 'AT2', value: 1200, color: '#377eb8' },
      { label: 'Endothelial', value: 1500, color: '#4daf4a' },
      { label: 'Fibroblast', value: 900, color: '#984ea3' },
      { label: 'Macrophage', value: 700, color: '#ff7f00' },
    ],
  };

  return (
    <div style={{ width: 400, height: 400 }}>
      <PieChart data={data} showLabels showPercentage />
    </div>
  );
}
```

## 예시: 도넛 차트

`innerRadius`로 도넛 차트를 만들 수 있습니다. 값은 0~1 범위 (외곽 반지름 대비 비율).

```tsx
const data = {
  slices: [...],
  innerRadius: 0.5,  // 안쪽 반지름 = 바깥 반지름의 50%
  title: 'Sample Composition',
};

<PieChart data={data} showLabels showPercentage />
```
