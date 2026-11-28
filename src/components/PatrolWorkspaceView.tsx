import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
  Sparkles,
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
  PATROL_QUICK_NOTES,
  PATROL_STATUS_LABELS,
  PERIOD_SCHEDULE,
  deriveStatusFromChecklist,
  getCalendarDayOfWeek,
  getDayOfWeekLabel,
  getEffectiveChecklist,
  getLatestSchoolDateString,
  getTodayDateString,
  isWeekendDate,
} from '../types/patrol';
import { createIncidentReport, savePatrolLog } from '../lib/firestoreOps';

function parseFloorRank(floor: string): number {
  const m = /(\d+)/.exec(floor || '');
  if (!m) return 99;
  const num = Number(m[1]);
  if (/B/i.test(floor)) return -num;
  return num;
}

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
  const [quickSavingSlotId, setQuickSavingSlotId] = useState<string | null>(null);

  const calendarDayOfWeek = getCalendarDayOfWeek(selectedDate);
  const selectedWeekdayLabel = getDayOfWeekLabel(selectedDate);
  const isWeekend = isWeekendDate(selectedDate);
  const todayStr = getTodayDateString();
  const latestSchoolDate = getLatestSchoolDateString(selectedDate);

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

  // All slots for current date/period/building (for progress bar & continuous patrol queue)
  const buildingPeriodSlots = useMemo(() => {
    return timetables
      .filter((t) => t.dayOfWeek === calendarDayOfWeek && t.period === selectedPeriod)
      .filter((t) => buildingFilter === 'ALL' || t.building === buildingFilter)
      .sort(
        (a, b) =>
          a.building.localeCompare(b.building, 'zh-Hant') ||
          parseFloorRank(a.floor) - parseFloorRank(b.floor) ||
          a.roomNumber.localeCompare(b.roomNumber, 'zh-Hant', { numeric: true })
      );
  }, [timetables, calendarDayOfWeek, selectedPeriod, buildingFilter]);

  const filteredSlots = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return buildingPeriodSlots
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
      });
  }, [buildingPeriodSlots, statusFilter, searchQuery, periodLogsBySlot]);

  const periodProgress = useMemo(() => {
    const total = buildingPeriodSlots.length;
    const done = buildingPeriodSlots.filter((s) => periodLogsBySlot.has(s.id)).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, done, remaining: Math.max(0, total - done), pct };
  }, [buildingPeriodSlots, periodLogsBySlot]);

  const nextPendingSlot = useMemo(() => {
    if (!activeSlot) return null;
    const idx = buildingPeriodSlots.findIndex((s) => s.id === activeSlot.id);
    const orderedCandidates =
      idx >= 0
        ? [...buildingPeriodSlots.slice(idx + 1), ...buildingPeriodSlots.slice(0, idx)]
        : buildingPeriodSlots;
    return orderedCandidates.find((s) => s.id !== activeSlot.id && !periodLogsBySlot.has(s.id)) ?? null;
  }, [activeSlot, buildingPeriodSlots, periodLogsBySlot]);

  const handleQuickTapSave = async (
    slot: TimetableSlot,
    preset: 'normal' | 'excellent'
  ) => {
    setQuickSavingSlotId(slot.id);
    try {
      const checklist: PatrolCheckItem[] =
        preset === 'excellent'
          ? ['class_normal', 'proper_equipment', 'student_focused', 'good_interaction']
          : ['class_normal', 'student_focused'];
      const existing = periodLogsBySlot.get(slot.id);
      await savePatrolLog({
        inspectorId: profile.uid,
        inspectorName: profile.displayName,
        date: selectedDate,
        slot,
        checklist,
        status: 'normal',
        note: existing?.note ?? '',
        existingOwnLog: existing?.inspectorId === profile.uid ? existing : null,
      });
      onActionFeedback(
        preset === 'excellent'
          ? `★ 已快速登錄 ${slot.className}（${slot.roomNumber}）全項正向優良`
          : `✓ 已快速打卡 ${slot.className}（${slot.roomNumber}）教學正常`
      );
    } catch (err) {
      onActionFeedback(
        `快速打卡失敗：${err instanceof Error ? err.message : '請稍後再試'}`
      );
    } finally {
      setQuickSavingSlotId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mobile & Desktop Quick Filter Header */}
      <div className="bg-white border border-[#E5E1D8] rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#1F2421]">即時行動巡堂作業</h2>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              {selectedDate} · {selectedWeekdayLabel} · 點擊班級卡片即可勾選巡堂檢核項目與備註
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
              const active = calendarDayOfWeek === d;
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
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && onChangeDate(e.target.value)}
              aria-label="選擇巡堂日期"
              className="min-h-[36px] px-3 py-1 text-xs font-mono-num bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl text-[#1F2421] focus:outline-none focus:border-[#1E5C4B]"
            />
            {selectedDate !== todayStr && (
              <button
                type="button"
                onClick={() => onChangeDate(todayStr)}
                className="min-h-[36px] px-3 py-1 text-xs font-semibold rounded-xl bg-[#E5F2EE] hover:bg-[#D5EAE3] text-[#1E5C4B] whitespace-nowrap cursor-pointer transition-colors"
              >
                回到今日
              </button>
            )}
          </div>
        </div>

        {isWeekend && (
          <div className="bg-[#FDF4E6] border border-[#E9D1AE] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#8F5312]">
            <span>
              {selectedDate}（{selectedWeekdayLabel}）為週末非上課日，無表定排課。如需檢視或補登平日巡堂，請點擊上方星期一～五或跳至最近上課日。
            </span>
            <button
              type="button"
              onClick={() => onChangeDate(latestSchoolDate)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-[#9A5B13] hover:bg-[#7D490E] text-white font-semibold cursor-pointer transition-colors"
            >
              跳至最近上課日（{latestSchoolDate}）
            </button>
          </div>
        )}

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

      {/* Live Period Progress Strip */}
      {periodProgress.total > 0 && (
        <div className="bg-white border border-[#E5E1D8] rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-bold text-[#1F2421]">
              本節巡堂進度：
              <span className="font-mono-num text-[#1E5C4B] ml-1">
                {periodProgress.done} / {periodProgress.total} 班（{periodProgress.pct}%）
              </span>
            </span>
            <span className="text-[#7C7A72]">
              {periodProgress.remaining > 0
                ? `尚有 ${periodProgress.remaining} 班待巡 · 可直接點擊卡片「正常／優良」一鍵打卡`
                : '本節全部班級已完成巡堂！'}
            </span>
          </div>
          <div className="w-full sm:w-44 h-2 bg-[#F2EFE9] rounded-full overflow-hidden shrink-0">
            <div
              className="h-full bg-[#1E5C4B] rounded-full transition-all duration-300"
              style={{ width: `${periodProgress.pct}%` }}
            />
          </div>
        </div>
      )}

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
            const isQuickSaving = quickSavingSlotId === slot.id;

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
              <div
                key={slot.id}
                className={`bg-white border rounded-2xl p-4 transition-colors flex flex-col justify-between gap-3.5 min-h-[168px] ${
                  log
                    ? 'border-[#C6DFD7] bg-[#FCFDFC]'
                    : 'border-[#E5E1D8] hover:border-[#1E5C4B]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSlot(slot)}
                  className="text-left space-y-1.5 cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-base font-bold text-[#1F2421] group-hover:text-[#1E5C4B] transition-colors">
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
                </button>

                {/* Quick 1-Tap Field Patrol Actions */}
                <div className="pt-2.5 border-t border-[#F0ECE3] space-y-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={isQuickSaving}
                      onClick={() => handleQuickTapSave(slot, 'normal')}
                      className="min-h-[38px] px-2 py-1.5 rounded-xl bg-[#E5F2EE] hover:bg-[#D5EAE3] active:scale-[0.98] disabled:opacity-50 text-[#1E5C4B] text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                      {isQuickSaving ? '儲存中' : '正常'}
                    </button>
                    <button
                      type="button"
                      disabled={isQuickSaving}
                      onClick={() => handleQuickTapSave(slot, 'excellent')}
                      className="min-h-[38px] px-2 py-1.5 rounded-xl bg-[#FBF0E2] hover:bg-[#F4E2CB] active:scale-[0.98] disabled:opacity-50 text-[#9A5B13] text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      優良
                    </button>
                    <button
                      type="button"
                      disabled={isQuickSaving}
                      onClick={() => onSelectSlot(slot)}
                      className="min-h-[38px] px-2 py-1.5 rounded-xl bg-[#FAF9F5] hover:bg-[#FCEBE7] hover:text-[#B44326] border border-[#E5E1D8] text-[#3A3F3B] text-xs font-semibold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {log ? '修改' : '詳填'}
                    </button>
                  </div>

                  {log && (
                    <div className="flex items-center justify-between text-[11px] text-[#7C7A72] px-0.5">
                      <span>巡堂人：{log.inspectorName}</span>
                      <span>點擊上方文字可詳修</span>
                    </div>
                  )}
                </div>
              </div>
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
          nextPendingSlot={nextPendingSlot}
          onClose={() => onSelectSlot(null)}
          onSaved={(msg, advanceToNext) => {
            onActionFeedback(msg);
            if (advanceToNext && nextPendingSlot) {
              onSelectSlot(nextPendingSlot);
            } else {
              onSelectSlot(null);
            }
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
  nextPendingSlot: TimetableSlot | null;
  onClose: () => void;
  onSaved: (message: string, advanceToNext?: boolean) => void;
}

const QuickPatrolDrawer: React.FC<QuickPatrolDrawerProps> = ({
  slot,
  profile,
  selectedDate,
  existingLog,
  nextPendingSlot,
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

  const appendQuickNote = (phrase: string) => {
    setNote((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return phrase;
      if (trimmed.includes(phrase)) return prev;
      return `${trimmed}、${phrase}`.slice(0, 500);
    });
  };

  const saveCurrentPatrol = async (advanceToNext: boolean) => {
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
        }`,
        advanceToNext
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveCurrentPatrol(false);
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

          {/* Group 3: 其他 + Quick Note Phrase Chips */}
          <div className="space-y-2 pt-2 border-t border-[#F0ECE3]">
            <label className="text-xs font-bold text-[#3A3F3B] block">
              三、其他紀錄說明（點選快捷詞彙即可帶入，免打字）
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PATROL_QUICK_NOTES.map((phrase) => {
                const selected = note.includes(phrase);
                return (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => appendQuickNote(phrase)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#E5F2EE] border-[#1E5C4B] text-[#1E5C4B]'
                        : 'bg-[#FAF9F5] border-[#E5E1D8] text-[#5C615C] hover:bg-[#F2EFE9]'
                    }`}
                  >
                    + {phrase}
                  </button>
                );
              })}
            </div>
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

          {/* Sticky Footer Submit with Continuous Next-Room Patrol */}
          <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-3.5 py-2 text-sm font-medium text-[#5C615C] hover:text-[#1F2421] rounded-xl cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`min-h-[44px] px-4 py-2 text-sm font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-60 ${
                nextPendingSlot
                  ? 'bg-white hover:bg-[#FAF9F5] text-[#1E5C4B] border border-[#1E5C4B]'
                  : 'bg-[#1E5C4B] hover:bg-[#16473A] text-white px-6'
              }`}
            >
              {submitting ? '儲存中...' : nextPendingSlot ? '儲存並關閉' : '完成巡堂並即時同步'}
            </button>
            {nextPendingSlot && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void saveCurrentPatrol(true)}
                className="min-h-[44px] px-5 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>儲存並巡下一班（{nextPendingSlot.className}）</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
