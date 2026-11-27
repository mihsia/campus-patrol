import type { Timestamp } from 'firebase/firestore';

export const CAMPUS_ID = 'main-campus' as const;
export const BOOTSTRAP_ADMIN_EMAIL = 'mihsia@gmail.com';

export type StaffRole = 'admin' | 'user';
export type AccountStatus = 'active' | 'disabled';
export type PatrolStatus = 'normal' | 'minor_issue' | 'urgent_issue' | 'empty_relocated';
export type LeaveType = 'sick' | 'personal' | 'official' | 'bereavement';
export type ObservedAbsenceType = 'missing' | 'late' | 'left_early' | 'unauthorized_exit';
export type AutoAbsenceStatus = 'truant' | 'late' | 'left_early' | 'excused_leave' | 'pending_review';
export type RiskLevel = 'low' | 'medium' | 'high';
export type IncidentCategory =
  | 'teacher_absent'
  | 'classroom_order'
  | 'student_truancy'
  | 'facility_issue'
  | 'safety_medical'
  | 'other';
export type IncidentSeverity = 'low' | 'medium' | 'high';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved';

export type NavSection = 'dashboard' | 'patrol' | 'incidents' | 'timetable' | 'reports' | 'staff';

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
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface LeaveRecord {
  id: string;
  campusId: typeof CAMPUS_ID;
  date: string; // YYYY-MM-DD
  className: string;
  seatNumber: string;
  studentName: string;
  leaveType: LeaveType;
  periods: number[];
  reason: string;
  approvedBy: string;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
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
  subject: string;
  teacherName: string;
  teacherPresent: boolean;
  expectedCount: number;
  actualCount: number;
  status: PatrolStatus;
  note: string;
  inspectorId: string;
  inspectorName: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AbsenceRecord {
  id: string;
  campusId: typeof CAMPUS_ID;
  date: string; // YYYY-MM-DD
  period: number;
  timetableId: string;
  className: string;
  subject: string;
  teacherName: string;
  seatNumber: string;
  studentName: string;
  observedType: ObservedAbsenceType;
  autoStatus: AutoAbsenceStatus;
  riskLevel: RiskLevel;
  verified: boolean;
  note: string;
  recordedBy: string;
  recordedByName: string;
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
  { period: 1, label: '第 1 節', start: '08:10', end: '09:00' },
  { period: 2, label: '第 2 節', start: '09:10', end: '10:00' },
  { period: 3, label: '第 3 節', start: '10:10', end: '11:00' },
  { period: 4, label: '第 4 節', start: '11:10', end: '12:00' },
  { period: 5, label: '第 5 節', start: '13:10', end: '14:00' },
  { period: 6, label: '第 6 節', start: '14:10', end: '15:00' },
  { period: 7, label: '第 7 節', start: '15:10', end: '16:00' },
  { period: 8, label: '第 8 節', start: '16:10', end: '17:00' },
];

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  1: '星期一',
  2: '星期二',
  3: '星期三',
  4: '星期四',
  5: '星期五',
};

export const PATROL_STATUS_LABELS: Record<PatrolStatus, string> = {
  normal: '正常上課',
  minor_issue: '秩序微異常',
  urgent_issue: '緊急異常',
  empty_relocated: '移地／空堂',
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: '病假',
  personal: '事假',
  official: '公假',
  bereavement: '喪假',
};

export const OBSERVED_ABSENCE_LABELS: Record<ObservedAbsenceType, string> = {
  missing: '未到席',
  late: '遲到進班',
  left_early: '早退離席',
  unauthorized_exit: '擅離教室',
};

export const AUTO_ABSENCE_STATUS_LABELS: Record<AutoAbsenceStatus, string> = {
  truant: '疑似曠課',
  late: '遲到',
  left_early: '早退',
  excused_leave: '已核假',
  pending_review: '待確認',
};

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  low: '一般關注',
  medium: '中度預警',
  high: '高風險通報',
};

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  teacher_absent: '教師未到／遲到',
  classroom_order: '課堂秩序異常',
  student_truancy: '學生缺曠／擅離',
  facility_issue: '設備環境異常',
  safety_medical: '突發安全／傷病',
  other: '其他巡堂事項',
};

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

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getDayOfWeekFromDate(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 1;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const day = d.getDay(); // 0=Sun..6=Sat
  if (day === 0 || day === 6) return 1; // Default school schedule to Monday on weekends
  return day;
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
