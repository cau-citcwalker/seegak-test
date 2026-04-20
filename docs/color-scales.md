# 색상 스케일 (Color Scales)

연속값을 색상으로 매핑하는 색상 스케일입니다.
ScatterChart의 `values`와 FeaturePlotChart의 `expression`에 사용됩니다.

## 내장 스케일

```tsx
import { VIRIDIS, PLASMA, INFERNO } from '@seegak/react';
```

| 스케일 | 범위 | 특성 |
|--------|------|------|
| **VIRIDIS** | 진한 보라 → 청록 → 노랑 | 밝은 배경에 적합. 인지적 균일성 |
| **PLASMA** | 진한 파랑 → 보라 → 주황 → 노랑 | 밝은 배경에 적합. 높은 대비 |
| **INFERNO** | 검정 → 보라 → 주황 → 노랑 | 밝은 배경에 적합 |

> **참고**: 내장 스케일은 낮은 값이 어두운 색으로 시작합니다.
> 어두운 배경에서 사용할 경우 커스텀 스케일을 권장합니다.

## 커스텀 색상 스케일

`ColorScale`은 `stops` 배열로 정의합니다. 각 stop은 위치(0~1)와 RGBA 색상(0~1 범위)으로 구성됩니다.

```typescript
import type { ColorScale } from '@seegak/core';

const MY_SCALE: ColorScale = {
  stops: [
    { position: 0.0, color: { r: 0.6, g: 0.6, b: 0.65, a: 1 } },
    { position: 0.5, color: { r: 0.9, g: 0.2, b: 0.2, a: 1 } },
    { position: 1.0, color: { r: 1.0, g: 0.95, b: 0.2, a: 1 } },
  ],
};
```

### 규칙

- `position`은 0.0 ~ 1.0 범위
- `color`의 각 채널 (r, g, b, a)은 0.0 ~ 1.0 범위
- stops는 position 순서대로 정렬
- 최소 1개 이상의 stop 필요
- stop 사이는 선형 보간(lerp)

## 예시: 어두운 배경용 스케일

```tsx
const DARK_BG_SCALE: ColorScale = {
  stops: [
    { position: 0.0, color: { r: 0.6, g: 0.6, b: 0.65, a: 1 } },  // 밝은 회색
    { position: 0.3, color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } },   // 파랑
    { position: 0.6, color: { r: 0.9, g: 0.2, b: 0.2, a: 1 } },   // 빨강
    { position: 1.0, color: { r: 1.0, g: 0.95, b: 0.2, a: 1 } },  // 노랑
  ],
};

<FeaturePlotChart data={data} colorScale={DARK_BG_SCALE} />
```

## 예시: 파랑-흰-빨강 (발현 차이 비교용)

```tsx
const BLUE_WHITE_RED: ColorScale = {
  stops: [
    { position: 0.0, color: { r: 0.0, g: 0.0, b: 1.0, a: 1 } },   // 파랑 (하향 조절)
    { position: 0.5, color: { r: 0.95, g: 0.95, b: 0.95, a: 1 } }, // 흰색 (변화 없음)
    { position: 1.0, color: { r: 1.0, g: 0.0, b: 0.0, a: 1 } },   // 빨강 (상향 조절)
  ],
};
```

## 예시: 2색 그라데이션

```tsx
const SIMPLE_GRADIENT: ColorScale = {
  stops: [
    { position: 0.0, color: { r: 0.9, g: 0.9, b: 0.9, a: 1 } },  // 연한 회색
    { position: 1.0, color: { r: 0.8, g: 0.0, b: 0.0, a: 1 } },  // 진한 빨강
  ],
};
```

## 유틸리티 함수

`@seegak/core`에서 색상 스케일 관련 유틸리티를 사용할 수 있습니다:

```tsx
import { sampleColorScale, colorScaleToTexture, hexToVec4, vec4ToHex } from '@seegak/core';

// 특정 위치의 색상 샘플링
const color = sampleColorScale(VIRIDIS, 0.5);
// → { r: 0.127, g: 0.566, b: 0.551, a: 1 }

// hex → Vec4 변환
const vec4 = hexToVec4('#e41a1c');
// → { r: 0.894, g: 0.102, b: 0.110, a: 1 }

// Vec4 → hex 변환
const hex = vec4ToHex({ r: 0.894, g: 0.102, b: 0.110, a: 1 });
// → '#e41a1c'
```
