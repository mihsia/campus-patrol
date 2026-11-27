import type {
  AbsenceRecord,
  AutoAbsenceStatus,
  LeaveRecord,
  ObservedAbsenceType,
  PatrolLog,
  RiskLevel,
  TimetableSlot,
} from '../types/patrol';
import { LEAVE_TYPE_LABELS } from '../types/patrol';

export interface TruancyEvaluationResult {
  autoStatus: AutoAbsenceStatus;
  riskLevel: RiskLevel;
  matchedLeave: LeaveRecord | null;
  rationale: string;
  consecutivePeriods: number;
  dailyTruantCount: number;
  shouldEscalateIncident: boolean;
}

export interface StudentRiskSummary {
  key: string;
  className: string;
  seatNumber: string;
  studentName: string;
  totalRecords: number;
  truantCount: number;
  lateCount: number;
  excusedCount: number;
  maxConsecutiveTruant: number;
  riskLevel: RiskLevel;
  affectedSubjects: string[];
  affectedPeriods: number[];
  recommendedAction: string;
  latestDate: string;
  latestTimetableId: string;
}

export interface ClassAttendanceSummary {
  timetableId: string;
  className: string;
  roomNumber: string;
  building: string;
  subject: string;
  teacherName: string;
  expectedCount: number;
  actualCount: number;
  excusedCount: number;
  truantCount: number;
  lateCount: number;
  patrolled: boolean;
  patrolStatus: PatrolLog['status'] | 'unpatrolled';
  attendanceRate: number;
}

/**
 * Step 1-4 Automated Absence & Truancy Classification Engine
 *
 * 1. Cross-references student's date, className, seatNumber/studentName, and period against approved leaveRecords.
 * 2. Checks whether the timetable slot is marked as relocated (outdoor/lab) to avoid false positives when needed.
 * 3. Determines autoStatus (excused_leave / late / left_early / truant).
 * 4. Computes consecutive unexcused periods on the same date to assign riskLevel (low / medium / high).
 */
export function evaluateSingleAbsence(params: {
  date: string;
  period: number;
  className: string;
  seatNumber: string;
  studentName: string;
  observedType: ObservedAbsenceType;
  leaveRecords: LeaveRecord[];
  existingAbsencesForStudentToday: Array<{ period: number; observedType: ObservedAbsenceType; autoStatus: AutoAbsenceStatus }>;
  timetableSlot?: TimetableSlot | null;
}): TruancyEvaluationResult {
  const {
    date,
    period,
    className,
    seatNumber,
    studentName,
    observedType,
    leaveRecords,
    existingAbsencesForStudentToday,
    timetableSlot,
  } = params;

  // Step 1: Approved Leave Cross-Reference
  const matchedLeave =
    leaveRecords.find(
      (lr) =>
        lr.date === date &&
        lr.className === className &&
        (lr.seatNumber === seatNumber || lr.studentName === studentName) &&
        lr.periods.includes(period)
    ) ?? null;

  if (matchedLeave) {
    return {
      autoStatus: 'excused_leave',
      riskLevel: 'low',
      matchedLeave,
      rationale: `系統自動核銷：符合已核准${LEAVE_TYPE_LABELS[matchedLeave.leaveType]}（核准人：${matchedLeave.approvedBy}）`,
      consecutivePeriods: 0,
      dailyTruantCount: 0,
      shouldEscalateIncident: false,
    };
  }

  // Step 2: Classify based on observed classroom behavior + timetable context
  let autoStatus: AutoAbsenceStatus = 'truant';
  if (observedType === 'late') {
    autoStatus = 'late';
  } else if (observedType === 'left_early') {
    autoStatus = 'left_early';
  } else if (observedType === 'unauthorized_exit') {
    autoStatus = 'truant';
  } else if (timetableSlot?.isRelocated) {
    autoStatus = 'pending_review';
  } else {
    autoStatus = 'truant';
  }

  // Step 3: Multi-period consecutive truancy analysis for the same date
  const truantPeriodsSet = new Set<number>();
  for (const rec of existingAbsencesForStudentToday) {
    if (rec.autoStatus === 'truant' || rec.observedType === 'missing' || rec.observedType === 'unauthorized_exit') {
      truantPeriodsSet.add(rec.period);
    }
  }
  if (autoStatus === 'truant') {
    truantPeriodsSet.add(period);
  }

  const sortedPeriods = Array.from(truantPeriodsSet).sort((a, b) => a - b);
  let maxConsecutive = 0;
  let currentStreak = 0;
  for (let i = 0; i < sortedPeriods.length; i++) {
    if (i === 0 || sortedPeriods[i] === sortedPeriods[i - 1] + 1) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > maxConsecutive) {
      maxConsecutive = currentStreak;
    }
  }

  const dailyTruantCount = sortedPeriods.length;

  // Step 4: Risk scoring & automatic incident escalation rule
  let riskLevel: RiskLevel = 'low';
  let rationale = '單節異常紀錄，列入日常出缺勤追蹤';
  let shouldEscalateIncident = false;

  if (observedType === 'unauthorized_exit') {
    riskLevel = 'high';
    rationale = '未核准擅離教室，涉及校園安全風險，建議立即通報生教組與導師';
    shouldEscalateIncident = true;
  } else if (maxConsecutive >= 3 || dailyTruantCount >= 3) {
    riskLevel = 'high';
    rationale = `當日已達連續 ${maxConsecutive} 節（累計 ${dailyTruantCount} 節）無故未請假缺席，觸發高風險通報規則`;
    shouldEscalateIncident = true;
  } else if (maxConsecutive === 2 || dailyTruantCount === 2) {
    riskLevel = 'medium';
    rationale = `當日累計 ${dailyTruantCount} 節未請假缺席（連續 ${maxConsecutive} 節），建議聯繫導師確認學生動向`;
  } else if (autoStatus === 'pending_review') {
    riskLevel = 'low';
    rationale = `本節課表標記為移地教學（${timetableSlot?.locationNote || '專科教室'}），暫列待確認以避免誤判曠課`;
  } else if (autoStatus === 'truant') {
    riskLevel = 'low';
    rationale = '課表比對無核准假單，系統自動判定為疑似曠課';
  } else if (autoStatus === 'late') {
    riskLevel = 'low';
    rationale = '上課鈴響後遲到入班，列入遲到統計';
  } else if (autoStatus === 'left_early') {
    riskLevel = 'medium';
    rationale = '課間提早離席且查無核准假單，請導師確認去向';
  }

  return {
    autoStatus,
    riskLevel,
    matchedLeave: null,
    rationale,
    consecutivePeriods: maxConsecutive,
    dailyTruantCount,
    shouldEscalateIncident,
  };
}

/**
 * Re-evaluates all absence records against current leaveRecords and timetables
 * to produce live per-student risk summaries and real-time classification results.
 */
export function buildStudentRiskSummaries(
  absences: AbsenceRecord[],
  leaveRecords: LeaveRecord[],
  timetables: TimetableSlot[]
): {
  evaluatedAbsences: Array<AbsenceRecord & { liveEval: TruancyEvaluationResult }>;
  studentSummaries: StudentRiskSummary[];
} {
  const timetableMap = new Map<string, TimetableSlot>();
  for (const slot of timetables) {
    timetableMap.set(slot.id, slot);
  }

  // Group absences by date + student key
  const byDateAndStudent = new Map<string, AbsenceRecord[]>();
  for (const abs of absences) {
    const key = `${abs.date}::${abs.className}::${abs.seatNumber}::${abs.studentName}`;
    const list = byDateAndStudent.get(key) ?? [];
    list.push(abs);
    byDateAndStudent.set(key, list);
  }

  const evaluatedAbsences = absences.map((abs) => {
    const dayKey = `${abs.date}::${abs.className}::${abs.seatNumber}::${abs.studentName}`;
    const sameDayRecords = byDateAndStudent.get(dayKey) ?? [];
    const liveEval = evaluateSingleAbsence({
      date: abs.date,
      period: abs.period,
      className: abs.className,
      seatNumber: abs.seatNumber,
      studentName: abs.studentName,
      observedType: abs.observedType,
      leaveRecords,
      existingAbsencesForStudentToday: sameDayRecords
        .filter((r) => r.id !== abs.id)
        .map((r) => ({
          period: r.period,
          observedType: r.observedType,
          autoStatus: r.autoStatus,
        })),
      timetableSlot: timetableMap.get(abs.timetableId) ?? null,
    });
    return { ...abs, liveEval };
  });

  // Aggregate per student across all filtered records
  const studentMap = new Map<string, Array<AbsenceRecord & { liveEval: TruancyEvaluationResult }>>();
  for (const item of evaluatedAbsences) {
    const studentKey = `${item.className}::${item.seatNumber}::${item.studentName}`;
    const arr = studentMap.get(studentKey) ?? [];
    arr.push(item);
    studentMap.set(studentKey, arr);
  }

  const studentSummaries: StudentRiskSummary[] = [];
  for (const [key, records] of studentMap.entries()) {
    const first = records[0];
    let truantCount = 0;
    let lateCount = 0;
    let excusedCount = 0;
    let maxConsecutiveTruant = 0;
    let hasUnauthorizedExit = false;
    const subjects = new Set<string>();
    const periods = new Set<number>();
    let latestDate = first.date;
    let latestTimetableId = first.timetableId;

    for (const r of records) {
      subjects.add(r.subject);
      periods.add(r.period);
      if (r.date >= latestDate) {
        latestDate = r.date;
        latestTimetableId = r.timetableId;
      }
      if (r.liveEval.autoStatus === 'excused_leave') {
        excusedCount += 1;
      } else if (r.liveEval.autoStatus === 'late') {
        lateCount += 1;
      } else if (r.liveEval.autoStatus === 'truant') {
        truantCount += 1;
      }
      if (r.observedType === 'unauthorized_exit') {
        hasUnauthorizedExit = true;
      }
      if (r.liveEval.consecutivePeriods > maxConsecutiveTruant) {
        maxConsecutiveTruant = r.liveEval.consecutivePeriods;
      }
    }

    let riskLevel: RiskLevel = 'low';
    let recommendedAction = '持續觀察，列入班級日常紀錄';
    if (hasUnauthorizedExit || maxConsecutiveTruant >= 3 || truantCount >= 3) {
      riskLevel = 'high';
      recommendedAction = '立即通報學務處生教組並聯繫家長與導師確認安全';
    } else if (maxConsecutiveTruant === 2 || truantCount === 2 || lateCount >= 3) {
      riskLevel = 'medium';
      recommendedAction = '通知導師關懷約談，確認是否漏交假單';
    } else if (excusedCount === records.length) {
      riskLevel = 'low';
      recommendedAction = '已由核准假單自動核銷，無需額外處置';
    }

    studentSummaries.push({
      key,
      className: first.className,
      seatNumber: first.seatNumber,
      studentName: first.studentName,
      totalRecords: records.length,
      truantCount,
      lateCount,
      excusedCount,
      maxConsecutiveTruant,
      riskLevel,
      affectedSubjects: Array.from(subjects),
      affectedPeriods: Array.from(periods).sort((a, b) => a - b),
      recommendedAction,
      latestDate,
      latestTimetableId,
    });
  }

  const riskOrder: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };
  studentSummaries.sort((a, b) => {
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return b.truantCount - a.truantCount;
  });

  return { evaluatedAbsences, studentSummaries };
}

/**
 * Computes per-class live attendance stats for the selected date & period
 * to drive the real-time Dashboard bar charts & classroom matrix.
 */
export function computeClassAttendanceStats(params: {
  periodSlots: TimetableSlot[];
  periodPatrolLogs: PatrolLog[];
  periodAbsences: AbsenceRecord[];
  leaveRecords: LeaveRecord[];
  date: string;
  period: number;
}): ClassAttendanceSummary[] {
  const { periodSlots, periodPatrolLogs, periodAbsences, leaveRecords, date, period } = params;

  // Pick the latest patrol log per timetableId
  const latestLogBySlot = new Map<string, PatrolLog>();
  for (const log of periodPatrolLogs) {
    const existing = latestLogBySlot.get(log.timetableId);
    const logTime = log.updatedAt?.toMillis?.() ?? 0;
    const existTime = existing?.updatedAt?.toMillis?.() ?? 0;
    if (!existing || logTime >= existTime) {
      latestLogBySlot.set(log.timetableId, log);
    }
  }

  return periodSlots.map((slot) => {
    const log = latestLogBySlot.get(slot.id);
    const classAbsences = periodAbsences.filter((a) => a.timetableId === slot.id);
    const classLeaves = leaveRecords.filter(
      (lr) => lr.date === date && lr.className === slot.className && lr.periods.includes(period)
    );

    let excusedCount = 0;
    let truantCount = 0;
    let lateCount = 0;

    for (const abs of classAbsences) {
      const hasLeave = classLeaves.some(
        (lr) => lr.seatNumber === abs.seatNumber || lr.studentName === abs.studentName
      );
      if (hasLeave || abs.autoStatus === 'excused_leave') {
        excusedCount += 1;
      } else if (abs.observedType === 'late' || abs.autoStatus === 'late') {
        lateCount += 1;
      } else {
        truantCount += 1;
      }
    }

    // Include approved leaves even if not separately logged as absences
    const totalExcused = Math.max(excusedCount, classLeaves.length);
    const expectedCount = slot.expectedCount;
    const actualCount = log
      ? log.actualCount
      : Math.max(0, expectedCount - totalExcused - truantCount);
    const attendanceRate =
      expectedCount > 0 ? Math.round((actualCount / expectedCount) * 1000) / 10 : 100;

    return {
      timetableId: slot.id,
      className: slot.className,
      roomNumber: slot.roomNumber,
      building: slot.building,
      subject: slot.subject,
      teacherName: slot.teacherName,
      expectedCount,
      actualCount,
      excusedCount: totalExcused,
      truantCount,
      lateCount,
      patrolled: Boolean(log),
      patrolStatus: log ? log.status : 'unpatrolled',
      attendanceRate,
    };
  });
}
