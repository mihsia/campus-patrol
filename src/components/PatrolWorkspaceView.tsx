import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
  X,
} from 'lucide-react';
import type {
  IncidentCategory,
  IncidentSeverity,
  PatrolCheckItem,
  PatrolLog,
  PatrolStatus,
  SchoolSettings,
  StaffProfile,
  TimetableSlot,
} from '../types/patrol';
import {
  ACTIVE_INCIDENT_CATEGORIES,
  DAY_OF_WEEK_LABELS,
  INCIDENT_CATEGORY_LABELS,
  PATROL_CHECKLIST_LABELS,
  PATROL_ISSUE_ITEMS,
  PATROL_POSITIVE_ITEMS,
  PATROL_STATUS_LABELS,
  PERIOD_SCHEDULE,
  deriveStatusFromChecklist,
  getDayOfWeekFromDate,
  getEffectiveChecklist,
} from '../types/patrol';
import { createIncidentReport, savePatrolLog } from '../lib/firestoreOps';

interface PatrolWorkspaceViewProps {
  profile: StaffProfile;
  schoolSettings: SchoolSettings;
  selectedDate: string;
  selectedPeriod: number;
  onChangeDate: (date: string) => void;
  onChangePeriod: (period: number) => void;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  activeSlot: TimetableSlot | null;
  onSelectSlot: (slot: TimetableSlot | null) => void;
  onActionFeedback: (message: string) => void;
}

function getDateForWeekdayInSameWeek(baseDateStr: string, targetDayOfWeek: number): string {
  const parts = baseDateStr.split('-').map(Number);
  const d =
    parts.length === 3 && !parts.some(Number.isNaN)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : new Date();
  const jsDay = d.getDay(); // 0=Sun..6=Sat
  const offsetToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetToMonday);
  const target = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + (targetDayOfWeek - 1));
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const PatrolWorkspaceView: React.FC<PatrolWorkspaceViewProps> = ({
  profile,
  schoolSettings,
  selectedDate,
  selectedPeriod,
  onChangeDate,
  onChangePeriod,
  timetables,
  patrolLogs,
  activeSlot,
  onSelectSlot,
  onActionFeedback,
}) => {
  const [buildingFilter, setBuildingFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const dayOfWeek = getDayOfWeekFromDate(selectedDate);

  const buildings = useMemo(() => {
    const ordered = [...schoolSettings.buildings];
    timetables.forEach((t) => {
      if (t.building && !ordered.includes(t.building)) {
        ordered.push(t.building);
      }
    });
    return ['ALL', ...ordered];
  }, [schoolSettings.buildings, timetables]);

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
          t.grade.toLowerCase().includes(q) ||
          t.roomNumber.toLowerCase().includes(q) ||
          t.teacherName.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          a.building.localeCompare(b.building, 'zh-Hant') ||
          a.roomNumber.localeCompare(b.roomNumber)
      );
  }, [
    timetables,
    dayOfWeek,
    selectedPeriod,
    buildingFilter,
    statusFilter,
    searchQuery,
    periodLogsBySlot,
  ]);

  return (
    <div className="space-y-5">
      {/* Mobile & Desktop Quick Filter Header */}
      <div className="bg-white border border-[#E5E1D8] rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#1F2421]">即時行動巡堂作業</h2>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              {selectedDate} · {DAY_OF_WEEK_LABELS[dayOfWeek]} · 點擊班級卡片即可勾選巡堂檢核項目與備註
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#9A968C] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋班別、教室、授課教師或領域..."
              className="w-full min-h-[42px] pl-9 pr-3 py-2 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
            />
          </div>
        </div>

        {/* Date & Weekday Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl overflow-x-auto">
            {[1, 2, 3, 4, 5].map((d) => {
              const active = dayOfWeek === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onChangeDate(getDateForWeekdayInSameWeek(selectedDate, d))}
                  className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#1E5C4B] text-white shadow-xs'
                      : 'text-[#5C615C] hover:text-[#1F2421]'
                  }`}
                >
                  {DAY_OF_WEEK_LABELS[d]}
                </button>
              );
            })}
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && onChangeDate(e.target.value)}
            aria-label="選擇巡堂日期"
            className="min-h-[36px] px-3 py-1 text-xs font-mono-num bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl text-[#1F2421] focus:outline-none focus:border-[#1E5C4B]"
          />
        </div>

        {/* Period Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {PERIOD_SCHEDULE.map((p) => (
            <button
              key={p.period}
              type="button"
              onClick={() => onChangePeriod(p.period)}
              className={`min-h-[42px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                selectedPeriod === p.period
                  ? 'bg-[#1E5C4B] text-white border-[#1E5C4B]'
                  : 'bg-[#FAF9F5] text-[#5C615C] border-[#E5E1D8] hover:bg-[#F2EFE9]'
              }`}
            >
              <span className="font-mono-num">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Building + Completion Filter */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-[#F0ECE3]">
          <div className="flex items-center gap-1 overflow-x-auto">
            {buildings.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBuildingFilter(b)}
                className={`min-h-[38px] px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  buildingFilter === b
                    ? 'bg-[#1F2421] text-white'
                    : 'text-[#5C615C] hover:bg-[#F2EFE9]'
                }`}
              >
                {b === 'ALL' ? '全部樓棟' : b}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl">
            {(
              [
                ['all', '全部班級'],
                ['pending', '待巡查'],
                ['done', '已完成'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === key
                    ? 'bg-[#1E5C4B] text-white shadow-xs'
                    : 'text-[#5C615C] hover:text-[#1F2421]'
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
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-10 text-center space-y-2">
          <p className="text-sm font-medium text-[#1F2421]">沒有符合條件的教室排課</p>
          <p className="text-xs text-[#7C7A72]">請切換節次、樓棟或清除搜尋關鍵字</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredSlots.map((slot) => {
            const log = periodLogsBySlot.get(slot.id);
            const checklist = getEffectiveChecklist(log);

            const statusColor = !log
              ? 'text-[#7C7A72]'
              : log.status === 'urgent_issue'
                ? 'text-[#B44326]'
                : log.status === 'minor_issue'
                  ? 'text-[#9A5B13]'
                  : log.status === 'empty_relocated'
                    ? 'text-[#245A84]'
                    : 'text-[#1E5C4B]';

            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => onSelectSlot(slot)}
                className="bg-white border border-[#E5E1D8] hover:border-[#1E5C4B] rounded-2xl p-4 text-left transition-colors flex flex-col justify-between gap-3.5 min-h-[152px] cursor-pointer active:scale-[0.99]"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-base font-bold text-[#1F2421]">
                      <span>{slot.className}</span>
                      <span className="text-[#D4CEC2] font-normal" aria-hidden="true">
                        /
                      </span>
                      <span className="font-mono-num text-[#1E5C4B]">{slot.roomNumber}</span>
                    </div>
                    <span
                      className={`text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${statusColor}`}
                    >
                      {log ? (
                        log.status === 'urgent_issue' || log.status === 'minor_issue' ? (
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

                  <div className="text-xs text-[#5C615C] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold text-[#1F2421]">{slot.subject}</span>
                    <span aria-hidden="true">·</span>
                    <span>授課：{slot.teacherName}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {slot.building} {slot.floor}
                    </span>
                  </div>

                  {slot.isRelocated && (
                    <div className="text-xs text-[#245A84] inline-flex items-center gap-1 pt-0.5">
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span>移地教學：{slot.locationNote || '專科教室'}</span>
                    </div>
                  )}

                  {log && checklist.length > 0 && (
                    <p className="text-xs text-[#5C615C] pt-1 line-clamp-2 leading-relaxed">
                      {checklist.map((k) => `☑ ${PATROL_CHECKLIST_LABELS[k]}`).join(' · ')}
                    </p>
                  )}

                  {log && log.note && (
                    <p className="text-xs text-[#7C7A72] line-clamp-1">其他：{log.note}</p>
                  )}
                </div>

                <div className="pt-3 border-t border-[#F0ECE3] flex items-center justify-between text-xs text-[#7C7A72]">
                  <span>{log ? `巡堂人：${log.inspectorName}` : `${slot.grade}`}</span>
                  <span className="text-[#1E5C4B] font-semibold">
                    {log ? '更新巡堂紀錄' : '開始勾選巡堂'}
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
  onClose: () => void;
  onSaved: (message: string) => void;
}

const QuickPatrolDrawer: React.FC<QuickPatrolDrawerProps> = ({
  slot,
  profile,
  selectedDate,
  existingLog,
  onClose,
  onSaved,
}) => {
  const initialChecklist: PatrolCheckItem[] = existingLog
    ? getEffectiveChecklist(existingLog)
    : ['class_normal'];

  const [checklist, setChecklist] = useState<PatrolCheckItem[]>(initialChecklist);
  const [status, setStatus] = useState<PatrolStatus>(
    existingLog?.status ?? deriveStatusFromChecklist(initialChecklist, slot.isRelocated)
  );
  const [note, setNote] = useState<string>(existingLog?.note ?? '');

  // Optional simultaneous incident alert
  const [alsoReportIncident, setAlsoReportIncident] = useState(false);
  const [incidentCategory, setIncidentCategory] = useState<IncidentCategory>('classroom_order');
  const [incidentSeverity, setIncidentSeverity] = useState<IncidentSeverity>('medium');
  const [incidentTitle, setIncidentTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleCheckItem = (key: PatrolCheckItem) => {
    setChecklist((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      const nextStatus = deriveStatusFromChecklist(next, slot.isRelocated);
      setStatus(nextStatus);

      // Automatically pre-fill incident report category when urgent issue items are checked
      if (!prev.includes(key)) {
        if (key === 'teacher_late') {
          setAlsoReportIncident(true);
          setIncidentCategory('teacher_absent');
          setIncidentSeverity('high');
        } else if (key === 'off_schedule_no_change') {
          setAlsoReportIncident(true);
          setIncidentCategory('off_schedule');
          setIncidentSeverity('high');
        }
      }
      return next;
    });
  };

  const selectAllPositive = () => {
    const next: PatrolCheckItem[] = [
      'class_normal',
      'proper_equipment',
      'student_focused',
      'good_interaction',
    ];
    setChecklist(next);
    setStatus('normal');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await savePatrolLog({
        inspectorId: profile.uid,
        inspectorName: profile.displayName,
        date: selectedDate,
        slot,
        checklist,
        status,
        note,
        existingOwnLog: existingLog?.inspectorId === profile.uid ? existingLog : null,
      });

      if (alsoReportIncident) {
        const issueLabels = checklist
          .filter((k) => PATROL_ISSUE_ITEMS.some((it) => it.key === k))
          .map((k) => PATROL_CHECKLIST_LABELS[k]);

        const finalTitle =
          incidentTitle.trim() ||
          (issueLabels.length > 0
            ? `${slot.className} 第 ${slot.period} 節：${issueLabels[0]}`
            : `${slot.className} 第 ${slot.period} 節巡堂異常通報`);

        const detailParts = [
          issueLabels.length > 0 ? `檢核異常項目：${issueLabels.join('、')}` : '',
          note.trim() ? `其他說明：${note.trim()}` : '',
          `授課教師：${slot.teacherName}（${slot.subject}）`,
        ].filter(Boolean);

        await createIncidentReport({
          reporterId: profile.uid,
          reporterName: profile.displayName,
          date: selectedDate,
          period: slot.period,
          timetableId: slot.id,
          location: `${slot.building} ${slot.roomNumber} · ${slot.className}`,
          className: slot.className,
          category: incidentCategory,
          severity: incidentSeverity,
          title: finalTitle,
          description: detailParts.join('；'),
        });
      }

      onSaved(
        `已完成 ${slot.className}（${slot.roomNumber}）第 ${slot.period} 節巡堂紀錄${
          alsoReportIncident ? '並同步送出異常通報' : ''
        }`
      );
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
      <div className="bg-white w-full sm:max-w-xl max-h-[92vh] rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8] flex flex-col overflow-hidden">
        {/* Drag handle on mobile */}
        <div className="sm:hidden pt-3 pb-1">
          <div className="w-10 h-1.5 bg-[#DDD8CD] rounded-full mx-auto" />
        </div>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[#1F2421]">
              {slot.grade} · {slot.className}（{slot.roomNumber}）
            </h3>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              第 {slot.period} 節 · 授課領域：{slot.subject} · 授課教師：{slot.teacherName} · {slot.building}{' '}
              {slot.floor}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉巡堂視窗"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#7C7A72] hover:text-[#1F2421] rounded-xl hover:bg-[#F2EFE9] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Group 1: Positive / Normal Patrol Items (4 checkboxes matching official Word form) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[#1E5C4B]">
                一、教學正常情形（可複選）
              </label>
              <button
                type="button"
                onClick={selectAllPositive}
                className="text-xs font-semibold text-[#1E5C4B] hover:underline cursor-pointer"
              >
                一鍵全選正常
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PATROL_POSITIVE_ITEMS.map((item) => {
                const checked = checklist.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleCheckItem(item.key)}
                    className={`min-h-[48px] px-3.5 py-2.5 rounded-xl border text-left flex items-center gap-3 transition-colors cursor-pointer ${
                      checked
                        ? 'bg-[#E5F2EE] border-[#1E5C4B] text-[#144437] font-semibold'
                        : 'bg-white border-[#E5E1D8] text-[#3A3F3B] hover:bg-[#FAF9F5]'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                        checked
                          ? 'bg-[#1E5C4B] border-[#1E5C4B] text-white'
                          : 'bg-white border-[#C8C3B8]'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </span>
                    <span className="text-sm leading-snug">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group 2: Issue / Needs Attention Patrol Items (4 checkboxes matching official Word form) */}
          <div className="space-y-2.5 pt-2 border-t border-[#F0ECE3]">
            <label className="text-xs font-bold text-[#B44326] block">
              二、異常／待改善情形（可複選）
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PATROL_ISSUE_ITEMS.map((item) => {
                const checked = checklist.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleCheckItem(item.key)}
                    className={`min-h-[48px] px-3.5 py-2.5 rounded-xl border text-left flex items-center gap-3 transition-colors cursor-pointer ${
                      checked
                        ? 'bg-[#FCECE6] border-[#B44326] text-[#7A2716] font-semibold'
                        : 'bg-white border-[#E5E1D8] text-[#3A3F3B] hover:bg-[#FAF9F5]'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                        checked
                          ? 'bg-[#B44326] border-[#B44326] text-white'
                          : 'bg-white border-[#C8C3B8]'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </span>
                    <span className="text-sm leading-snug">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Group 3: 其他 (Free-text note shown directly as ☑ 其他：... on report) */}
          <div className="space-y-1.5 pt-2 border-t border-[#F0ECE3]">
            <label className="text-xs font-bold text-[#3A3F3B] block">
              三、其他紀錄說明（填寫後報表將自動勾選「☑ 其他」）
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入其他巡堂觀察、設備狀況、調代課備註等..."
              className="w-full px-3.5 py-2.5 text-sm border border-[#E5E1D8] rounded-xl bg-[#FAF9F5] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
            />
          </div>

          {/* Overall Patrol Status Override */}
          <div className="space-y-2 pt-2 border-t border-[#F0ECE3]">
            <label className="text-xs font-semibold text-[#5C615C] block">
              巡堂總評狀態（已依勾選自動判定，可手動調整）
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  ['normal', '教學正常'],
                  ['minor_issue', '待改善事項'],
                  ['urgent_issue', '緊急異常'],
                  ['empty_relocated', '移地／空堂'],
                ] as const
              ).map(([val, label]) => {
                const active = status === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStatus(val)}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                      active
                        ? val === 'urgent_issue'
                          ? 'bg-[#B44326] text-white border-[#B44326]'
                          : val === 'minor_issue'
                            ? 'bg-[#C98A2E] text-white border-[#C98A2E]'
                            : 'bg-[#1E5C4B] text-white border-[#1E5C4B]'
                        : 'bg-white text-[#5C615C] border-[#E5E1D8] hover:bg-[#FAF9F5]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Simultaneous Abnormal Incident Filing */}
          <div className="pt-2 border-t border-[#F0ECE3] space-y-3">
            <label className="flex items-center gap-2.5 text-sm font-medium text-[#1F2421] cursor-pointer">
              <input
                type="checkbox"
                checked={alsoReportIncident}
                onChange={(e) => setAlsoReportIncident(e.target.checked)}
                className="w-4 h-4 rounded accent-[#1E5C4B]"
              />
              <span>同步建立異常事件通報並通知行政單位</span>
            </label>

            {alsoReportIncident && (
              <div className="p-3.5 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <select
                    value={incidentCategory}
                    onChange={(e) => setIncidentCategory(e.target.value as IncidentCategory)}
                    className="min-h-[40px] px-2.5 text-xs border border-[#E5E1D8] rounded-lg bg-white"
                  >
                    {ACTIVE_INCIDENT_CATEGORIES.map((k) => (
                      <option key={k} value={k}>
                        {INCIDENT_CATEGORY_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={incidentSeverity}
                    onChange={(e) => setIncidentSeverity(e.target.value as IncidentSeverity)}
                    className="min-h-[40px] px-2.5 text-xs border border-[#E5E1D8] rounded-lg bg-white"
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
                  placeholder="輸入異常事件標題（留空將自動帶入班級與異常項目）"
                  className="w-full min-h-[40px] px-3 text-xs border border-[#E5E1D8] rounded-lg bg-white"
                />
              </div>
            )}
          </div>

          {/* Sticky Footer Submit */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[46px] px-4 py-2 text-sm font-medium text-[#5C615C] hover:text-[#1F2421] rounded-xl cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[46px] px-6 py-2.5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
            >
              {submitting ? '正在儲存同步...' : '完成巡堂並即時同步'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
