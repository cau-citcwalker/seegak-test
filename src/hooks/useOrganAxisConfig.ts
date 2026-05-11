import { useMemo } from 'react';
import { resolveAxisConfig, type ResolvedAxisConfig } from '../organ-axis-config';

/**
 * Derives the active chart axis configuration from the currently selected organs.
 *
 * When the user selects organ(s) on the body map, this hook returns the axis
 * config that the scatter/UMAP charts should use. The config updates instantly
 * whenever selectedIds changes — no extra wiring needed in the chart components.
 *
 * Usage:
 *   const axisConfig = useOrganAxisConfig(selectedOrgans);
 *   // axisConfig.xAxis, axisConfig.yAxis, axisConfig.colorBy, axisConfig.label
 */
export function useOrganAxisConfig(selectedIds: string[]): ResolvedAxisConfig {
  // Stringify for stable memo dependency (array identity changes on every render)
  const key = selectedIds.join(',');
  return useMemo(() => resolveAxisConfig(selectedIds), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
