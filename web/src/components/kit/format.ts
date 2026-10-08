// Shared (server + client) number formatting for the kit.

export interface NumberFormat {
  decimals?: number;
  /** 12,900 → 12.9K (Indian grouping: 1.5L). */
  compact?: boolean;
}

export function formatNumber(value: number, { decimals = 0, compact = false }: NumberFormat = {}): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    notation: compact ? "compact" : "standard",
  }).format(value);
}
