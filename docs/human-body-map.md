# HumanBodyMap

인체 장기를 SVG로 표현한 인터랙티브 맵입니다.
장기를 클릭/호버하면 이벤트가 발생하며, 데이터가 있는 장기는 별도 색상으로 표시됩니다.

## Props

| Prop | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `data` | `Record<string, OrganData>` | - | 장기별 데이터 (키: 장기 ID) |
| `onOrganClick` | `(event: BodyMapEvent) => void` | - | 클릭 이벤트 핸들러 |
| `onOrganHover` | `(event: BodyMapEvent) => void` | - | 호버 이벤트 핸들러 |
| `onOrganLeave` | `(event: BodyMapEvent) => void` | - | 마우스 떠남 이벤트 핸들러 |
| `showLabels` | `boolean` | `false` | 장기 이름 라벨 표시 |
| `defaultColor` | `string` | `'#2a3a4a'` | 데이터 없는 장기 색상 |
| `hoverColor` | `string` | `'#4a6a8a'` | 호버 시 색상 |
| `selectedColor` | `string` | `'#1a8cff'` | 선택된 장기 색상 |
| `activeColor` | `string` | `'#3a7a5a'` | 데이터가 있는 장기 색상 |
| `style` | `CSSProperties` | - | 컨테이너 스타일 |
| `className` | `string` | - | 컨테이너 CSS 클래스 |

## 데이터 타입

```typescript
interface OrganData {
  datasetCount?: number;
  cellCount?: number;
  sampleCount?: number;
  metadata?: Record<string, unknown>;  // 추가 메타데이터
}

interface BodyMapEvent {
  type: 'click' | 'hover' | 'leave';
  organId: string;       // e.g. 'heart', 'lung', 'liver'
  organName: string;     // e.g. 'Heart', 'Lung', 'Liver'
  data?: OrganData;      // 해당 장기의 데이터 (있는 경우)
  originalEvent: MouseEvent;
}
```

## 장기 ID 목록

| ID | 영문명 | 한글명 |
|----|--------|--------|
| `brain` | Brain | 뇌 |
| `heart` | Heart | 심장 |
| `lung` | Lung | 폐 |
| `liver` | Liver | 간 |
| `stomach` | Stomach | 위 |
| `kidney` | Kidney | 신장 |
| `intestine` | Intestine | 장 |
| `spleen` | Spleen | 비장 |
| `bladder` | Bladder | 방광 |
| `skin` | Skin | 피부 |

## 예시: 데이터셋 탐색기

```tsx
import { useState, useCallback } from 'react';
import { HumanBodyMap } from '@seegak/react';
import type { BodyMapEvent } from '@seegak/human-body-map';

function DatasetExplorer() {
  const [selected, setSelected] = useState<string | null>(null);

  const organData = {
    heart: { datasetCount: 2, cellCount: 45000, sampleCount: 12 },
    lung: { datasetCount: 14, cellCount: 128000, sampleCount: 48 },
    liver: { datasetCount: 3, cellCount: 62000, sampleCount: 15 },
    kidney: { datasetCount: 5, cellCount: 78000, sampleCount: 22 },
    brain: { datasetCount: 8, cellCount: 95000, sampleCount: 35 },
  };

  const handleClick = useCallback((e: BodyMapEvent) => {
    setSelected(e.organId);
    console.log(`Clicked: ${e.organName}`, e.data);
  }, []);

  return (
    <div style={{ display: 'flex', gap: 24 }}>
      <div style={{ width: 400, height: 600 }}>
        <HumanBodyMap
          data={organData}
          onOrganClick={handleClick}
          showLabels
          defaultColor="#1a2a3a"
          hoverColor="#2a4a6a"
          activeColor="#3b82f6"
        />
      </div>
      <div>
        {selected && organData[selected] && (
          <div>
            <h3>{selected}</h3>
            <p>Datasets: {organData[selected].datasetCount}</p>
            <p>Cells: {organData[selected].cellCount.toLocaleString()}</p>
            <p>Samples: {organData[selected].sampleCount}</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

## 예시: 커스텀 색상 테마

```tsx
<HumanBodyMap
  data={organData}
  defaultColor="#e8e8e8"    // 밝은 회색 (라이트 테마)
  hoverColor="#b0c4de"      // 연한 파랑
  selectedColor="#ff6347"   // 토마토 레드
  activeColor="#32cd32"     // 라임 그린
  showLabels
/>
```

## 툴팁

HumanBodyMap은 호버 시 자동으로 툴팁을 표시합니다.
툴팁에는 장기 이름(한글/영문)과 데이터(데이터셋 수, 세포 수, 샘플 수)가 표시됩니다.
별도의 설정 없이 `data`를 전달하면 자동으로 동작합니다.
