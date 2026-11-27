import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  MapPin,
  Minus,
  Plus,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import type {
  AbsenceRecord,
  IncidentCategory,
  IncidentSeverity,
  LeaveRecord,
  ObservedAbsenceType,
  PatrolLog,
  PatrolStatus,
  StaffProfile,
  TimetableSlot,
} from '../types/patrol';
import {
  AUTO_ABSENCE_STATUS_LABELS,
  DAY_OF_WEEK_LABELS,
  INCIDENT_CATEGORY_LABELS,
  OBSERVED_ABSENCE_LABELS,
  PATROL_STATUS_LABELS,
  PERIOD_SCHEDULE,
  getDayOfWeekFromDate,
} from '../types/patrol';
import { evaluateSingleAbsence } from '../lib/truancyEngine';
import {
  createAbsenceRecord,
  createIncidentReport,
  savePatrolLog,
} from '../lib/firestoreOps';

interface PatrolWorkspaceViewProps {
  profile: StaffProfile;
  selectedDate: string;
  selectedPeriod: number;
  onChangePeriod: (period: number) => void;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  absences: AbsenceRecord[];
  leaveRecords: LeaveRecord[];
  activeSlot: TimetableSlot | null;
  onSelectSlot: (slot: TimetableSlot | null) => void;
  onActionFeedback: (message: string) => void;
}

interface PendingStudentAbsence {
  seatNumber: string;
  studentName: string;
  observedType: ObservedAbsenceType;
}

export const PatrolWorkspaceView: React.FC<PatrolWorkspaceViewProps> = ({
  profile,
  selectedDate,
  selectedPeriod,
  onChangePeriod,
  timetables,
  patrolLogs,
  absences,
  leaveRecords,
  activeSlot,
  onSelectSlot,
  onActionFeedback,
}) => {
  const [buildingFilter, setBuildingFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const dayOfWeek = getDayOfWeekFromDate(selectedDate);

  const buildings = useMemo(() => {
    const s = new Set<string>();
    timetables.forEach((t) => s.add(t.building));
    return ['ALL', ...Array.from(s).sort()];
  }, [timetables]);

  const periodLogsBySlot = useMemo(() => {
    const map = new Map<string, PatrolLog>();
    patrolLogs
      .filter((l) => l.date === selectedDate && l.period === selectedPeriod)
      .forEach((log) => {
        const existing = map.get(log.timetableId);
        const t1 = log.updatedAt?.toMillis?.() ?? 0;
        const t2 = existing?.updatedAt?.toMillis?.() ?? 0;
        if (!existing || t1 >= t2) {
          map.set(log.timetableId, log);
        }
      });
    return map;
  }, [patrolLogs, selectedDate, selectedPeriod]);

  const filteredSlots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return timetables
      .filter((t) => t.dayOfWeek === dayOfWeek && t.period === selectedPeriod)
      .filter((t) => buildingFilter === 'ALL' || t.building === buildingFilter)
      .filter((t) => {
        const logged = periodLogsBySlot.has(t.id);
        if (statusFilter === 'pending') return !logged;
        if (statusFilter === 'done') return logged;
        return true;
      })
      .filter((t) => {
        if (!q) return true;
        return (
          t.className.toLowerCase().includes(q) ||
          t.roomNumber.toLowerCase().includes(q) ||
          t.teacherName.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.building.localeCompare(b.building) || a.roomNumber.localeCompare(b.roomNumber));
  }, [timetables, dayOfWeek, selectedPeriod, buildingFilter, statusFilter, searchQuery, periodLogsBySlot]);

  return (
    <div className="space-y-5">
      {/* Mobile & Desktop Quick Filter Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              即時行動巡堂作業
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {selectedDate} · {DAY_OF_WEEK_LABELS[dayOfWeek]} · 點擊教室卡片單手完成檢核、缺曠點名與異常通報
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋班級、教室、教師或科目..."
              className="w-full min-h-[42px] pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
            />
          </div>
        </div>

        {/* Period Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {PERIOD_SCHEDULE.map((p) => (
            <button
              key={p.period}
              type="button"
              onClick={() => onChangePeriod(p.period)}
              className={`min-h-[42px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                selectedPeriod === p.period
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <span className="font-mono-num">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Building + Completion Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1 overflow-x-auto">
            {buildings.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBuildingFilter(b)}
                className={`min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  buildingFilter === b
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {b === 'ALL' ? '全部樓棟' : b}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                ['all', '全部教室'],
                ['pending', '待巡查'],
                ['done', '已完成'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Classroom Patrol Grid / Mobile Touch Cards */}
      {filteredSlots.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
          <p className="text-sm font-medium text-slate-900">沒有符合條件的教室排課</p>
          <p className="text-xs text-slate-500">請切換節次、樓棟或清除搜尋關鍵字</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredSlots.map((slot) => {
            const log = periodLogsBySlot.get(slot.id);
            const slotAbsences = absences.filter(
              (a) => a.date === selectedDate && a.period === selectedPeriod && a.timetableId === slot.id
            );
            const slotLeaves = leaveRecords.filter(
              (lr) => lr.date === selectedDate && lr.className === slot.className && lr.periods.includes(selectedPeriod)
            );

            const statusColor = !log
              ? 'text-slate-500'
              : log.status === 'urgent_issue'
                ? 'text-red-700'
                : log.status === 'minor_issue'
                  ? 'text-amber-700'
                  : log.status === 'empty_relocated'
                    ? 'text-blue-700'
                    : 'text-emerald-700';

            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => onSelectSlot(slot)}
                className="bg-white border border-slate-200 hover:border-teal-600 rounded-xl p-4 text-left transition-colors flex flex-col justify-between gap-3.5 min-h-[144px] cursor-pointer active:scale-[0.99]"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                      <span>{slot.className}</span>
                      <span className="text-slate-300 font-normal" aria-hidden="true">/</span>
                      <span className="font-mono-num text-teal-800">{slot.roomNumber}</span>
                    </div>
                    <span className={`text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${statusColor}`}>
                      {log ? (
                        log.status === 'urgent_issue' ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      {log ? PATROL_STATUS_LABELS[log.status] : '待巡查'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium text-slate-800">{slot.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span>任課：{slot.teacherName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{slot.building} {slot.floor}</span>
                  </div>

                  {slot.isRelocated && (
                    <div className="text-xs text-blue-700 inline-flex items-center gap-1 pt-0.5">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span>課表移地：{slot.locationNote || '專科教室'}</span>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono-num">
                    {log ? (
                      <>
                        實到 <strong className="text-slate-900">{log.actualCount}</strong> / {slot.expectedCount}
                        {!log.teacherPresent && <span className="text-red-700 font-semibold ml-2">教師未到</span>}
                      </>
                    ) : (
                      <>應到 {slot.expectedCount} 人</>
                    )}
                  </span>
                  <span className="font-mono-num">
                    {slotLeaves.length > 0 && <span className="text-blue-700 mr-2">核假 {slotLeaves.length}</span>}
                    {slotAbsences.length > 0 && <span className="text-red-700 font-medium">缺曠 {slotAbsences.length}</span>}
                    {slotLeaves.length === 0 && slotAbsences.length === 0 && (
                      <span className="text-teal-700 font-medium">{log ? '更新巡查' : '開始巡查'}</span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick Patrol Drawer / Mobile Bottom Sheet */}
      {activeSlot && (
        <QuickPatrolDrawer
          key={`${activeSlot.id}-${selectedDate}`}
          slot={activeSlot}
          profile={profile}
          selectedDate={selectedDate}
          existingLog={periodLogsBySlot.get(activeSlot.id) ?? null}
          todayAbsences={absences.filter((a) => a.date === selectedDate)}
          leaveRecords={leaveRecords}
          onClose={() => onSelectSlot(null)}
          onSaved={(msg) => {
            onSelectSlot(null);
            onActionFeedback(msg);
          }}
        />
      )}
    </div>
  );
};

interface QuickPatrolDrawerProps {
  slot: TimetableSlot;
  profile: StaffProfile;
  selectedDate: string;
  existingLog: PatrolLog | null;
  todayAbsences: AbsenceRecord[];
  leaveRecords: LeaveRecord[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

const QuickPatrolDrawer: React.FC<QuickPatrolDrawerProps> = ({
  slot,
  profile,
  selectedDate,
  existingLog,
  todayAbsences,
  leaveRecords,
  onClose,
  onSaved,
}) => {
  const preApprovedLeaves = useMemo(
    () =>
      leaveRecords.filter(
        (lr) => lr.date === selectedDate && lr.className === slot.className && lr.periods.includes(slot.period)
      ),
    [leaveRecords, selectedDate, slot]
  );

  const [status, setStatus] = useState<PatrolStatus>(
    existingLog?.status ?? (slot.isRelocated ? 'empty_relocated' : 'normal')
  );
  const [teacherPresent, setTeacherPresent] = useState<boolean>(
    existingLog ? existingLog.teacherPresent : true
  );
  const [actualCount, setActualCount] = useState<number>(
    existingLog ? existingLog.actualCount : Math.max(0, slot.expectedCount - preApprovedLeaves.length)
  );
  const [note, setNote] = useState<string>(existingLog?.note ?? '');

  // Quick student absence marking
  const [pendingAbsences, setPendingAbsences] = useState<PendingStudentAbsence[]>([]);
  const [customSeat, setCustomSeat] = useState('');
  const [customName, setCustomName] = useState('');
  const [customType, setCustomType] = useState<ObservedAbsenceType>('missing');

  // Optional simultaneous incident alert
  const [alsoReportIncident, setAlsoReportIncident] = useState(false);
  const [incidentCategory, setIncidentCategory] = useState<IncidentCategory>('classroom_order');
  const [incidentSeverity, setIncidentSeverity] = useState<IncidentSeverity>('medium');
  const [incidentTitle, setIncidentTitle] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const existingSlotAbsences = useMemo(
    () => todayAbsences.filter((a) => a.timetableId === slot.id && a.period === slot.period),
    [todayAbsences, slot]
  );

  const toggleRosterStudent = (entry: string) => {
    const parts = entry.trim().split(/\s+/);
    const seatNumber = parts[0] || '00';
    const studentName = parts.slice(1).join(' ') || entry;

    setPendingAbsences((prev) => {
      const exists = prev.some((p) => p.seatNumber === seatNumber && p.studentName === studentName);
      if (exists) {
        setActualCount((c) => Math.min(slot.expectedCount, c + 1));
        return prev.filter((p) => !(p.seatNumber === seatNumber && p.studentName === studentName));
      }
      setActualCount((c) => Math.max(0, c - 1));
      return [...prev, { seatNumber, studentName, observedType: 'missing' }];
    });
  };

  const addCustomStudent = () => {
    const seat = customSeat.trim() || '00';
    const name = customName.trim();
    if (!name) return;
    setPendingAbsences((prev) => [...prev, { seatNumber: seat, studentName: name, observedType: customType }]);
    setActualCount((c) => Math.max(0, c - 1));
    setCustomSeat('');
    setCustomName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // 1. Save patrol log
      await savePatrolLog({
        inspectorId: profile.uid,
        inspectorName: profile.displayName,
        date: selectedDate,
        slot,
        teacherPresent,
        actualCount,
        status,
        note,
        existingOwnLog: existingLog?.inspectorId === profile.uid ? existingLog : null,
      });

      // 2. Save marked student absences using Automated Truancy Engine
      let autoEscalatedHighCount = 0;
      for (const item of pendingAbsences) {
        const studentHistoryToday = todayAbsences
          .filter(
            (a) =>
              a.className === slot.className &&
              (a.seatNumber === item.seatNumber || a.studentName === item.studentName)
          )
          .map((a) => ({
            period: a.period,
            observedType: a.observedType,
            autoStatus: a.autoStatus,
          }));

        const evalRes = evaluateSingleAbsence({
          date: selectedDate,
          period: slot.period,
          className: slot.className,
          seatNumber: item.seatNumber,
          studentName: item.studentName,
          observedType: item.observedType,
          leaveRecords,
          existingAbsencesForStudentToday: studentHistoryToday,
          timetableSlot: slot,
        });

        await createAbsenceRecord({
          recordedBy: profile.uid,
          recordedByName: profile.displayName,
          date: selectedDate,
          slot,
          seatNumber: item.seatNumber,
          studentName: item.studentName,
          observedType: item.observedType,
          autoStatus: evalRes.autoStatus,
          riskLevel: evalRes.riskLevel,
          note: evalRes.rationale,
        });

        if (evalRes.shouldEscalateIncident) {
          autoEscalatedHighCount += 1;
          await createIncidentReport({
            reporterId: profile.uid,
            reporterName: profile.displayName,
            date: selectedDate,
            period: slot.period,
            timetableId: slot.id,
            location: `${slot.building} ${slot.roomNumber} · ${slot.className}`,
            className: slot.className,
            category: 'student_truancy',
            severity: 'high',
            title: `[系統自動預警] ${slot.className} ${item.seatNumber}號 ${item.studentName} 高風險缺曠`,
            description: `${evalRes.rationale}。該節課程為「${slot.subject}」（任課教師：${slot.teacherName}），請生教組與導師立即協助確認學生安全。`,
          });
        }
      }

      // 3. Optional manual abnormal incident report
      if (alsoReportIncident || status === 'urgent_issue') {
        const finalTitle =
          incidentTitle.trim() ||
          (!teacherPresent
            ? `${slot.className} 第 ${slot.period} 節任課教師（${slot.teacherName}）未到班`
            : `${slot.className} 第 ${slot.period} 節巡堂異常通報`);
        await createIncidentReport({
          reporterId: profile.uid,
          reporterName: profile.displayName,
          date: selectedDate,
          period: slot.period,
          timetableId: slot.id,
          location: `${slot.building} ${slot.roomNumber} · ${slot.className}`,
          className: slot.className,
          category: !teacherPresent ? 'teacher_absent' : incidentCategory,
          severity: status === 'urgent_issue' ? 'high' : incidentSeverity,
          title: finalTitle,
          description: note.trim() || `巡堂狀態：${PATROL_STATUS_LABELS[status]}，實到 ${actualCount}/${slot.expectedCount} 人。`,
        });
      }

      const extraMsg =
        autoEscalatedHighCount > 0
          ? `（已自動觸發 ${autoEscalatedHighCount} 件高風險缺曠推播通報）`
          : '';
      onSaved(`已完成 ${slot.className}（${slot.roomNumber}）第 ${slot.period} 節巡堂登錄${extraMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full sm:max-w-xl max-h-[92vh] rounded-t-3xl sm:rounded-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Drag handle on mobile */}
        <div className="sm:hidden pt-3 pb-1">
          <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto" />
        </div>

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {slot.className} · {slot.roomNumber}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              第 {slot.period} 節 · {slot.subject} · 任課：{slot.teacherName} · {slot.building} {slot.floor}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉巡堂視窗"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Status Selection (48px tactile buttons) */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 block">巡堂課堂狀態</label>
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  ['normal', '正常上課'],
                  ['minor_issue', '秩序微異常'],
                  ['urgent_issue', '緊急異常（同步通報）'],
                  ['empty_relocated', '移地／空堂'],
                ] as const
              ).map(([val, label]) => {
                const active = status === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      setStatus(val);
                      if (val === 'urgent_issue') {
                        setAlsoReportIncident(true);
                        setIncidentSeverity('high');
                      }
                    }}
                    className={`min-h-[46px] px-3 py-2 rounded-xl text-xs sm:text-sm font-medium border text-left transition-colors cursor-pointer ${
                      active
                        ? val === 'urgent_issue'
                          ? 'bg-red-700 text-white border-red-700'
                          : val === 'minor_issue'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-teal-700 text-white border-teal-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Teacher Attendance & Headcount Stepper */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">任課教師到班狀態</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTeacherPresent(true)}
                  className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium border inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    teacherPresent
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <UserCheck className="w-4 h-4" />
                  已到班
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTeacherPresent(false);
                    setStatus('urgent_issue');
                    setAlsoReportIncident(true);
                    setIncidentCategory('teacher_absent');
                    setIncidentSeverity('high');
                  }}
                  className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium border inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                    !teacherPresent
                      ? 'bg-red-700 text-white border-red-700'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  <UserX className="w-4 h-4" />
                  未到／遲到
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">
                實到人數（應到 {slot.expectedCount} 人）
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActualCount((c) => Math.max(0, c - 1))}
                  className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                  aria-label="減少實到人數"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={actualCount}
                  onChange={(e) => setActualCount(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
                  className="flex-1 min-h-[44px] text-center text-base font-bold font-mono-num border border-slate-200 rounded-lg bg-white"
                />
                <button
                  type="button"
                  onClick={() => setActualCount((c) => Math.min(120, c + 1))}
                  className="min-h-[44px] min-w-[44px] rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-700 cursor-pointer"
                  aria-label="增加實到人數"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Pre-approved Leave Info */}
          {preApprovedLeaves.length > 0 && (
            <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 space-y-1">
              <p className="font-semibold">課表系統偵測本節已有 {preApprovedLeaves.length} 筆核准假單：</p>
              <p className="text-blue-800">
                {preApprovedLeaves.map((l) => `${l.seatNumber}號 ${l.studentName}（${l.reason || '已核假'}）`).join('、')}
              </p>
            </div>
          )}

          {/* Class Roster Quick Absence Marking */}
          <div className="space-y-2.5 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">
                缺曠學生快速點名（自動比對假單與連續曠課）
              </label>
              {existingSlotAbsences.length > 0 && (
                <span className="text-xs text-slate-500 font-mono-num">
                  本節已登錄 {existingSlotAbsences.length} 筆
                </span>
              )}
            </div>

            {slot.roster.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {slot.roster.map((entry) => {
                  const parts = entry.trim().split(/\s+/);
                  const seat = parts[0] || '00';
                  const name = parts.slice(1).join(' ') || entry;
                  const selected = pendingAbsences.some((p) => p.seatNumber === seat && p.studentName === name);
                  const hasLeave = preApprovedLeaves.some((l) => l.seatNumber === seat || l.studentName === name);

                  return (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => toggleRosterStudent(entry)}
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
                        selected
                          ? 'bg-red-700 text-white border-red-700'
                          : hasLeave
                            ? 'bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5" />}
                      <span>{entry}</span>
                      {hasLeave && !selected && <span className="text-[10px] opacity-75">已請假</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Manual Student Entry */}
            <div className="grid grid-cols-12 gap-2 pt-1">
              <input
                type="text"
                value={customSeat}
                onChange={(e) => setCustomSeat(e.target.value)}
                placeholder="座號"
                maxLength={10}
                className="col-span-3 min-h-[42px] px-2.5 text-xs border border-slate-200 rounded-lg bg-white"
              />
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="輸入學生姓名"
                maxLength={40}
                className="col-span-4 min-h-[42px] px-2.5 text-xs border border-slate-200 rounded-lg bg-white"
              />
              <select
                value={customType}
                onChange={(e) => setCustomType(e.target.value as ObservedAbsenceType)}
                className="col-span-3 min-h-[42px] px-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                {Object.entries(OBSERVED_ABSENCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={addCustomStudent}
                className="col-span-2 min-h-[42px] rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
              >
                加入
              </button>
            </div>

            {/* Live Preview of Automated Algorithm Verdict for Pending Absences */}
            {pendingAbsences.length > 0 && (
              <div className="space-y-2 pt-1">
                {pendingAbsences.map((item, idx) => {
                  const preview = evaluateSingleAbsence({
                    date: selectedDate,
                    period: slot.period,
                    className: slot.className,
                    seatNumber: item.seatNumber,
                    studentName: item.studentName,
                    observedType: item.observedType,
                    leaveRecords,
                    existingAbsencesForStudentToday: todayAbsences
                      .filter(
                        (a) =>
                          a.className === slot.className &&
                          (a.seatNumber === item.seatNumber || a.studentName === item.studentName)
                      )
                      .map((a) => ({
                        period: a.period,
                        observedType: a.observedType,
                        autoStatus: a.autoStatus,
                      })),
                    timetableSlot: slot,
                  });

                  return (
                    <div
                      key={`${item.seatNumber}-${item.studentName}-${idx}`}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-900">
                          {item.seatNumber} 號 {item.studentName}
                          <span className="mx-1.5 text-slate-300">·</span>
                          <span
                            className={
                              preview.autoStatus === 'excused_leave'
                                ? 'text-blue-700'
                                : preview.riskLevel === 'high'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }
                          >
                            預判：{AUTO_ABSENCE_STATUS_LABELS[preview.autoStatus]}
                          </span>
                        </div>
                        <p className="text-slate-500">{preview.rationale}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          value={item.observedType}
                          onChange={(e) => {
                            const nextType = e.target.value as ObservedAbsenceType;
                            setPendingAbsences((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, observedType: nextType } : p))
                            );
                          }}
                          className="min-h-[34px] px-2 text-xs border border-slate-200 rounded bg-white"
                        >
                          {Object.entries(OBSERVED_ABSENCE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setPendingAbsences((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-red-700 cursor-pointer"
                          aria-label="移除學生"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Patrol Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">巡堂觀察備註（選填）</label>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="記錄教學秩序、冷氣設備、代課情形或其他備註..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
            />
          </div>

          {/* Optional Simultaneous Abnormal Incident Filing */}
          <div className="pt-2 border-t border-slate-100 space-y-3">
            <label className="flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoReportIncident || status === 'urgent_issue'}
                onChange={(e) => setAlsoReportIncident(e.target.checked)}
                className="w-4 h-4 rounded accent-teal-700"
              />
              <span>同步建立異常事件通報並即時推播</span>
            </label>

            {(alsoReportIncident || status === 'urgent_issue') && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <select
                    value={incidentCategory}
                    onChange={(e) => setIncidentCategory(e.target.value as IncidentCategory)}
                    className="min-h-[40px] px-2.5 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    {Object.entries(INCIDENT_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <select
                    value={status === 'urgent_issue' ? 'high' : incidentSeverity}
                    onChange={(e) => setIncidentSeverity(e.target.value as IncidentSeverity)}
                    className="min-h-[40px] px-2.5 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="low">一般提醒</option>
                    <option value="medium">中度異常</option>
                    <option value="high">緊急通報（即刻推播）</option>
                  </select>
                </div>
                <input
                  type="text"
                  maxLength={120}
                  value={incidentTitle}
                  onChange={(e) => setIncidentTitle(e.target.value)}
                  placeholder="輸入異常事件標題（留空將自動帶入班級與狀態）"
                  className="w-full min-h-[40px] px-3 text-xs border border-slate-200 rounded-lg bg-white"
                />
              </div>
            )}
          </div>

          {/* Sticky Footer Submit */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[46px] px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 rounded-lg cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[46px] px-6 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {submitting ? '正在儲存同步...' : '完成巡堂並即時同步'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
