import rawConfigs from './organ-axis-config.json';

export interface AxisConfig {
  /** Column name for the X axis in the embedding */
  xAxis: string;
  /** Column name for the Y axis in the embedding */
  yAxis: string;
  /** Metadata column to color cells by */
  colorBy: string;
  /** Human-readable description shown in the UI */
  label: string;
}

export const ORGAN_AXIS_CONFIGS: Partial<Record<string, AxisConfig>> =
  rawConfigs as Partial<Record<string, AxisConfig>>;

export const DEFAULT_AXIS_CONFIG: AxisConfig = {
  xAxis: 'X_umap_1', yAxis: 'X_umap_2',
  colorBy: 'cell_type',
  label: 'Default — cell type UMAP',
};

export type ResolvedAxisConfig = AxisConfig & {
  /**
   * 'organ'   — all selected organs share the same axis config
   * 'primary' — organs have different configs; using the first selected
   * 'default' — no organ selected, or none have a defined config
   */
  resolution: 'organ' | 'primary' | 'default';
  primaryOrganId: string | null;
};

/**
 * Derives the active axis config from a set of selected organ IDs.
 *
 * Resolution priority:
 *  1. If all selected organs share identical axes → use that config
 *  2. If organs differ → use the first selected organ's config (primary)
 *  3. If no config exists for any selected organ → fall back to default
 */
export function resolveAxisConfig(selectedIds: string[]): ResolvedAxisConfig {
  if (selectedIds.length === 0) {
    return { ...DEFAULT_AXIS_CONFIG, resolution: 'default', primaryOrganId: null };
  }

  const configs = selectedIds
    .map(id => ({ id, config: ORGAN_AXIS_CONFIGS[id] }))
    .filter((x): x is { id: string; config: AxisConfig } => x.config != null);

  if (configs.length === 0) {
    return { ...DEFAULT_AXIS_CONFIG, resolution: 'default', primaryOrganId: null };
  }

  const first = configs[0];
  const allMatch = configs.every(
    x => x.config.xAxis === first.config.xAxis && x.config.yAxis === first.config.yAxis,
  );

  return {
    ...(allMatch ? first.config : first.config),
    resolution: allMatch ? 'organ' : 'primary',
    primaryOrganId: first.id,
  };
}
