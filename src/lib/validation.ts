// Synchronized verbatim with firebase-blueprint.json maxLength and pattern constraints
export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function sanitizeId(raw: string, fallbackPrefix = 'rec'): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (cleaned.length >= 1 && cleaned.length <= 128 && ID_REGEX.test(cleaned)) {
    return cleaned;
  }
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${fallbackPrefix}-${Date.now()}-${randomSuffix}`.slice(0, 128);
}

export function clampString(value: string, maxLength: number, fallback = ''): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback.slice(0, maxLength);
  return trimmed.slice(0, maxLength);
}

export function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function sanitizeDate(dateStr: string): string {
  if (DATE_REGEX.test(dateStr)) return dateStr;
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function sanitizeRoster(roster: string[]): string[] {
  return roster
    .map((entry) => entry.trim().slice(0, 60))
    .filter((entry) => entry.length > 0)
    .slice(0, 60);
}

export function sanitizePeriods(periods: number[]): number[] {
  const unique = Array.from(
    new Set(
      periods
        .map((p) => clampInt(p, 1, 8))
        .filter((p) => p >= 1 && p <= 8)
    )
  ).sort((a, b) => a - b);
  return unique.length > 0 ? unique.slice(0, 8) : [1];
}
