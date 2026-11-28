import type { Timestamp } from 'firebase/firestore';

export const CAMPUS_ID = 'main-campus' as const;
export const BOOTSTRAP_ADMIN_EMAIL = 'mihsia@gmail.com';

export type StaffRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'disabled';
export type SemesterType = '第一學期' | '第二學期';
export type PatrolStatus = 'normal' | 'minor_issue' | 'urgent_issue' | 'empty_relocated';
export type PatrolCheckItem =
  | 'class_normal'
  | 'proper_equipment'
  | 'student_focused'
  | 'good_interaction'
  | 'teacher_late'
  | 'poor_order'
  | 'poor_learning'
  | 'off_schedule_no_change';

export type IncidentCategory =
  | 'teacher_absent'
  | 'classroom_order'
  | 'off_schedule'
  | 'student_truancy'
  | 'facility_issue'
  | 'safety_medical'
  | 'other';
export type IncidentSeverity = 'low' | 'medium' | 'high';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved';

export type NavSection =
  | 'overview'
  | 'dashboard'
  | 'patrol'
  | 'incidents'
  | 'basic_data'
  | 'timetable'
  | 'reports'
  | 'staff'
  | 'manual'
  | 'changelog';

export interface SchoolSettings {
  campusId: typeof CAMPUS_ID;
  schoolName: string;
  academicYear: string;
  semester: SemesterType;
  currentWeek: number;
  buildings: string[];
  updatedBy?: string;
  updatedAt?: Timestamp | null;
}

export const DEFAULT_SCHOOL_SETTINGS: SchoolSettings = {
  campusId: CAMPUS_ID,
  schoolName: '利澤國小',
  academicYear: '115',
  semester: '第一學期',
  currentWeek: 1,
  buildings: ['行政教學大樓', '忠孝樓', '科任專科大樓'],
};

export interface AllowedAccount {
  id: string;
  campusId: typeof CAMPUS_ID;
  email: string;
  displayName: string;
  department: string;
  jobTitle: string;
  role: StaffRole;
  status: AccountStatus;
  uid: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface StaffProfile {
  uid: string;
  campusId: typeof CAMPUS_ID;
  displayName: string;
  department: string;
  jobTitle: string;
  role: StaffRole;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface TimetableSlot {
  id: string;
  campusId: typeof CAMPUS_ID;
  dayOfWeek: number; // 1..5
  period: number; // 1..8
  building: string;
  floor: string;
  roomNumber: string;
  className: string;
  grade: string;
  subject: string;
  teacherName: string;
  expectedCount: number;
  isRelocated: boolean;
  locationNote: string;
  roster: string[];
  academicYear?: string;
  semester?: SemesterType;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface TimetableArchive {
  id: string;
  campusId: typeof CAMPUS_ID;
  academicYear: string;
  semester: SemesterType;
  label: string;
  note: string;
  classCount: number;
  slotCount: number;
  classNames: string[];
  archivedBy: string;
  archivedByName: string;
  archivedAt?: Timestamp | null;
}

export interface ArchivedTimetableSlot {
  id: string;
  campusId: typeof CAMPUS_ID;
  archiveId: string;
  dayOfWeek: number; // 1..5
  period: number; // 1..8
  building: string;
  floor: string;
  roomNumber: string;
  className: string;
  grade: string;
  subject: string;
  teacherName: string;
  isRelocated: boolean;
  locationNote: string;
  archivedBy: string;
  archivedAt?: Timestamp | null;
}

export interface PatrolLog {
  id: string;
  campusId: typeof CAMPUS_ID;
  date: string; // YYYY-MM-DD
  dayOfWeek: number;
  period: number;
  timetableId: string;
  building: string;
  roomNumber: string;
  className: string;
  grade?: string;
  subject: string;
  teacherName: string;
  teacherPresent: boolean;
  expectedCount: number;
  actualCount: number;
  status: PatrolStatus;
  checklist?: PatrolCheckItem[];
  note: string;
  inspectorId: string;
  inspectorName: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface IncidentReport {
  id: string;
  campusId: typeof CAMPUS_ID;
  date: string; // YYYY-MM-DD
  period: number;
  timetableId: string;
  location: string;
  className: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  description: string;
  status: IncidentStatus;
  reporterId: string;
  reporterName: string;
  handlerId: string;
  handlerName: string;
  resolutionNote: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface NotificationPreferences {
  browserPushEnabled: boolean;
  soundEnabled: boolean;
  minSeverity: IncidentSeverity;
  subscribedBuilding: string; // 'ALL' or specific building
}

export interface PeriodBellInfo {
  period: number;
  label: string;
  start: string;
  end: string;
}

export const PERIOD_SCHEDULE: PeriodBellInfo[] = [
  { period: 1, label: '第 1 節', start: '08:30', end: '09:10' },
  { period: 2, label: '第 2 節', start: '09:20', end: '10:00' },
  { period: 3, label: '第 3 節', start: '10:30', end: '11:10' },
  { period: 4, label: '第 4 節', start: '11:20', end: '12:00' },
  { period: 5, label: '第 5 節', start: '13:30', end: '14:10' },
  { period: 6, label: '第 6 節', start: '14:30', end: '15:10' },
  { period: 7, label: '第 7 節', start: '15:20', end: '16:00' },
  { period: 8, label: '第 8 節', start: '16:10', end: '16:50' },
];

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
};

export const DAY_OF_WEEK_SHORT: Record<number, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
};

export const PATROL_POSITIVE_ITEMS: Array<{ key: PatrolCheckItem; label: string }> = [
  { key: 'class_normal', label: '上課大致正常' },
  { key: 'proper_equipment', label: '妥善運用教學設備' },
  { key: 'student_focused', label: '學生專注上課' },
  { key: 'good_interaction', label: '師生互動良好' },
];

export const PATROL_ISSUE_ITEMS: Array<{ key: PatrolCheckItem; label: string }> = [
  { key: 'teacher_late', label: '教師未準時上課' },
  { key: 'poor_order', label: '班級秩序欠佳' },
  { key: 'poor_learning', label: '學生學習狀況差' },
  { key: 'off_schedule_no_change', label: '未按課表上課且無調課' },
];

export const ALL_PATROL_CHECKLIST_ITEMS: Array<{
  key: PatrolCheckItem;
  label: string;
  group: 'positive' | 'issue';
}> = [
  ...PATROL_POSITIVE_ITEMS.map((item) => ({ ...item, group: 'positive' as const })),
  ...PATROL_ISSUE_ITEMS.map((item) => ({ ...item, group: 'issue' as const })),
];

export const PATROL_CHECKLIST_LABELS: Record<PatrolCheckItem, string> = {
  class_normal: '上課大致正常',
  proper_equipment: '妥善運用教學設備',
  student_focused: '學生專注上課',
  good_interaction: '師生互動良好',
  teacher_late: '教師未準時上課',
  poor_order: '班級秩序欠佳',
  poor_learning: '學生學習狀況差',
  off_schedule_no_change: '未按課表上課且無調課',
};

export const STANDARD_GRADES = [
  '一年級',
  '二年級',
  '三年級',
  '四年級',
  '五年級',
  '六年級',
] as const;

export const PATROL_STATUS_LABELS: Record<PatrolStatus, string> = {
  normal: '教學正常',
  minor_issue: '待改善事項',
  urgent_issue: '緊急異常',
  empty_relocated: '移地／空堂',
};

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  teacher_absent: '教師未準時／未到班',
  classroom_order: '班級秩序／學習狀況',
  off_schedule: '未按課表上課且無調課',
  student_truancy: '學生出缺席（歷史）',
  facility_issue: '教學設備環境異常',
  safety_medical: '突發安全／傷病',
  other: '其他巡堂事項',
};

export const ACTIVE_INCIDENT_CATEGORIES: IncidentCategory[] = [
  'teacher_absent',
  'classroom_order',
  'off_schedule',
  'facility_issue',
  'safety_medical',
  'other',
];

export const INCIDENT_SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: '一般提醒',
  medium: '中度異常',
  high: '緊急通報',
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  open: '待處理',
  in_progress: '處理中',
  resolved: '已結案',
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: '管理者',
  user: '使用者',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: '使用中',
  disabled: '已停用',
};

export const DEFAULT_DEPARTMENTS = [
  '校長室',
  '教務處',
  '學務處',
  '總務處',
  '輔導室',
  '導師群',
] as const;

export function normalizeStaffRole(role: unknown): StaffRole {
  return role === 'admin' ? 'admin' : 'user';
}

export function deriveStatusFromChecklist(
  checklist: PatrolCheckItem[],
  isRelocated?: boolean
): PatrolStatus {
  if (checklist.includes('teacher_late') || checklist.includes('off_schedule_no_change')) {
    return 'urgent_issue';
  }
  if (checklist.includes('poor_order') || checklist.includes('poor_learning')) {
    return 'minor_issue';
  }
  if (isRelocated && checklist.length === 0) {
    return 'empty_relocated';
  }
  return 'normal';
}

export function getEffectiveChecklist(log: PatrolLog | null | undefined): PatrolCheckItem[] {
  if (!log) return [];
  if (Array.isArray(log.checklist) && log.checklist.length > 0) {
    return log.checklist;
  }
  // Graceful fallback for any legacy logs saved before the 8-item checklist
  const derived: PatrolCheckItem[] = [];
  if (log.status === 'normal') {
    derived.push('class_normal');
  }
  if (!log.teacherPresent) {
    derived.push('teacher_late');
  }
  if (log.status === 'minor_issue') {
    derived.push('poor_order');
  }
  return derived;
}

export const FULL_DAY_OF_WEEK_LABELS: Record<number, string> = {
  0: '星期日',
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
  6: '星期六',
};

export const FULL_DAY_OF_WEEK_SHORT: Record<number, string> = {
  0: '日',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
};

function formatDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

export function getTodayDateString(): string {
  return formatDateLocal(new Date());
}

/**
 * Returns the true calendar day of week (0 = Sunday .. 6 = Saturday) for YYYY-MM-DD.
 */
export function getCalendarDayOfWeek(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return new Date().getDay();
  }
  return new Date(parts[0], parts[1] - 1, parts[2]).getDay();
}

export function getDayOfWeekLabel(dateStr: string): string {
  return FULL_DAY_OF_WEEK_LABELS[getCalendarDayOfWeek(dateStr)] ?? '星期一';
}

export function isWeekendDate(dateStr: string): boolean {
  const day = getCalendarDayOfWeek(dateStr);
  return day === 0 || day === 6;
}

/**
 * Returns the date itself if Mon–Fri, or the most recent Friday if Sat/Sun.
 */
export function getLatestSchoolDateString(fromDateStr?: string): string {
  const base = fromDateStr ? parseLocalDate(fromDateStr) : new Date();
  const day = base.getDay();
  if (day === 6) {
    return formatDateLocal(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1));
  }
  if (day === 0) {
    return formatDateLocal(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 2));
  }
  return formatDateLocal(base);
}

/**
 * Returns the Mon–Fri date range for the week containing dateStr.
 */
export function getWeekDateRange(dateStr: string): {
  monday: string;
  friday: string;
  dates: string[];
} {
  const base = parseLocalDate(dateStr);
  const jsDay = base.getDay();
  const offsetToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const mondayDate = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetToMonday);
  const dates = Array.from({ length: 5 }, (_, idx) =>
    formatDateLocal(
      new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + idx)
    )
  );
  return {
    monday: dates[0],
    friday: dates[4],
    dates,
  };
}

/**
 * Returns school timetable day index (1..5), mapping Sat/Sun to 1 for legacy callers
 * that require a valid Mon–Fri timetable index (e.g. demo seed generation).
 * For UI weekday display or filtering live schedules, use getCalendarDayOfWeek / getDayOfWeekLabel.
 */
export function getDayOfWeekFromDate(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 1;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay(); // 0=Sun..6=Sat
  if (day === 0 || day === 6) return 1;
  return day;
}

export const PATROL_QUICK_NOTES: readonly string[] = [
  '學生專注度高',
  '分組討論熱絡',
  '科任移地正常',
  '已調代課正常上課',
  '已現場口頭提醒秩序',
  '教師晚到 5 分鐘',
  '投影／音響待報修',
  '教室環境整潔良好',
];

export interface AcademicYearPeriodInfo {
  academicYear: string;
  startYearAD: number;
  endYearAD: number;
  startDate: string; // YYYY/08/01
  endDate: string; // YYYY/07/31
  rangeText: string; // e.g. 2026/08/01 ～ 2027/07/31
  fullLabel: string; // e.g. 115 學年度（2026/08/01 ～ 2027/07/31）
}

/**
 * Computes Taiwanese school academic year range (Aug 1 to next year Jul 31).
 * Accepts ROC year (e.g. "115") or 4-digit AD year (e.g. "2026").
 */
export function getAcademicYearPeriod(academicYearRaw: string): AcademicYearPeriodInfo {
  const numeric = Number(String(academicYearRaw).replace(/[^0-9]/g, ''));
  const startYearAD =
    numeric >= 1912 ? numeric : numeric >= 1 && numeric < 300 ? numeric + 1911 : new Date().getFullYear();
  const rocYear = startYearAD - 1911;
  const endYearAD = startYearAD + 1;
  const academicYear = String(rocYear > 0 ? rocYear : numeric || '115');
  const startDate = `${startYearAD}/08/01`;
  const endDate = `${endYearAD}/07/31`;
  const rangeText = `${startDate} ～ ${endDate}`;
  return {
    academicYear,
    startYearAD,
    endYearAD,
    startDate,
    endDate,
    rangeText,
    fullLabel: `${academicYear} 學年度（${rangeText}）`,
  };
}

/**
 * Detects current ROC academic year from a date (Aug 1 starts the new academic year).
 */
export function detectCurrentAcademicYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1..12
  const rocStartYear = month >= 8 ? year - 1911 : year - 1912;
  return String(Math.max(100, rocStartYear));
}

export function detectCurrentPeriod(): number {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const slot of PERIOD_SCHEDULE) {
    const [sh, sm] = slot.start.split(':').map(Number);
    const [eh, em] = slot.end.split(':').map(Number);
    if (minutes >= sh * 60 + sm - 10 && minutes <= eh * 60 + em) {
      return slot.period;
    }
  }
  return 1;
}
