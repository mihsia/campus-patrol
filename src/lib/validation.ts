import type { PatrolCheckItem } from '../types/patrol';

// Synchronized verbatim with firebase-blueprint.json maxLength and pattern constraints
export const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
export const DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_CHECKLIST_SET = new Set<PatrolCheckItem>([
  'class_normal',
  'proper_equipment',
  'student_focused',
  'good_interaction',
  'teacher_late',
  'poor_order',
  'poor_learning',
  'off_schedule_no_change',
]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 120);
}

export function isValidEmailFormat(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length >= 3 && normalized.length <= 120 && EMAIL_REGEX.test(normalized);
}

export function emailToAccountId(email: string): string {
  return normalizeEmail(email).replace(/[^a-z0-9]/g, '_');
}

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

export function sanitizeBuildings(buildings: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of buildings) {
    const val = raw.trim().slice(0, 40);
    if (val && !seen.has(val)) {
      seen.add(val);
      cleaned.push(val);
    }
    if (cleaned.length >= 30) break;
  }
  return cleaned.length > 0 ? cleaned : ['教學大樓'];
}

export function sanitizeChecklist(items: string[]): PatrolCheckItem[] {
  const seen = new Set<PatrolCheckItem>();
  const result: PatrolCheckItem[] = [];
  for (const item of items) {
    if (VALID_CHECKLIST_SET.has(item as PatrolCheckItem)) {
      const typed = item as PatrolCheckItem;
      if (!seen.has(typed)) {
        seen.add(typed);
        result.push(typed);
      }
    }
    if (result.length >= 8) break;
  }
  return result;
}
