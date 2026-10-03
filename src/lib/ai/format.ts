/** Display helpers for token counts and USD estimates (client-safe). */

export function formatTokens(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString("en-US");
}

/** Per-run costs are fractions of a cent, so keep more decimals for small amounts. */
export function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 0.0001) return "<$0.0001";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return value < 1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}
