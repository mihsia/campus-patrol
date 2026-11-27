import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Database,
  Download,
  FileUp,
  List,
  MapPin,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type {
  SchoolSettings,
  StaffProfile,
  TimetableSlot,
} from '../types/patrol';
import {
  DAY_OF_WEEK_LABELS,
  DAY_OF_WEEK_SHORT,
  PERIOD_SCHEDULE,
  STANDARD_GRADES,
} from '../types/patrol';
import {
  batchDeleteTimetableSlots,
  createTimetableSlot,
  deleteTimetableSlot,
  updateTimetableSlot,
} from '../lib/firestoreOps';
import { exportTimetableBackupCsv } from '../lib/exportReports';
import { TimetableImportModal } from './TimetableImportModal';

interface TimetableViewProps {
  profile: StaffProfile;
  isAdmin: boolean;
  schoolSettings: SchoolSettings;
  timetables: TimetableSlot[];
  onGoToBasicData: () => void;
  onJumpToPatrol: (dayOfWeek: number, period: number, slot?: TimetableSlot) => void;
  onSeedDemoData: () => Promise<void>;
  seeding: boolean;
  onActionFeedback: (message: string) => void;
}

export const TimetableTruancyView: React.FC<TimetableViewProps> = ({
  profile,
  isAdmin,
  schoolSettings,
  timetables,
  onGoToBasicData,
  onJumpToPatrol,
  onSeedDemoData,
  seeding,
  onActionFeedback,
}) => {
  const [viewMode, setViewMode] = useState<'weekly' | 'list'>('weekly');
  const [selectedClassName, setSelectedClassName] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dayFilter, setDayFilter] = useState<number>(0); // 0 = all days
  const [buildingFilter, setBuildingFilter] = useState<string>('ALL');

  const [showImportModal, setShowImportModal] = useState(false);
  const [addSlotPrefill, setAddSlotPrefill] = useState<{
    dayOfWeek?: number;
    period?: number;
    className?: string;
    grade?: string;
    building?: string;
    floor?: string;
    roomNumber?: string;
  } | null>(null);
  const [editingSlot, setEditingSlot] = useState<TimetableSlot | null>(null);
  const [confirmClearClass, setConfirmClearClass] = useState(false);
  const [clearingClass, setClearingClass] = useState(false);

  const buildings = useMemo(() => {
    const ordered = [...schoolSettings.buildings];
    timetables.forEach((t) => {
      if (t.building && !ordered.includes(t.building)) {
        ordered.push(t.building);
      }
    });
    return ['ALL', ...ordered];
  }, [schoolSettings.buildings, timetables]);

  const classDirectory = useMemo(() => {
    const map = new Map<
      string,
      {
        className: string;
        grade: string;
        building: string;
        floor: string;
        roomNumber: string;
        slotCount: number;
      }
    >();
    timetables.forEach((t) => {
      const existing = map.get(t.className);
      if (existing) {
        existing.slotCount += 1;
      } else {
        map.set(t.className, {
          className: t.className,
          grade: t.grade,
          building: t.building,
          floor: t.floor,
          roomNumber: t.roomNumber,
          slotCount: 1,
        });
      }
    });
    const gradeRank = (g: string) => {
      const idx = STANDARD_GRADES.findIndex((std) => g.includes(std));
      return idx === -1 ? 99 : idx;
    };
    return Array.from(map.values()).sort(
      (a, b) =>
        gradeRank(a.grade) - gradeRank(b.grade) ||
        a.className.localeCompare(b.className, 'zh-Hant')
    );
  }, [timetables]);

  const effectiveClassName = useMemo(() => {
    if (selectedClassName && classDirectory.some((c) => c.className === selectedClassName)) {
      return selectedClassName;
    }
    return classDirectory[0]?.className || '';
  }, [selectedClassName, classDirectory]);

  const activeClassMeta = useMemo(
    () => classDirectory.find((c) => c.className === effectiveClassName) ?? null,
    [classDirectory, effectiveClassName]
  );

  const activeClassSlots = useMemo(
    () => timetables.filter((t) => t.className === effectiveClassName),
    [timetables, effectiveClassName]
  );

  const maxWeeklyPeriod = useMemo(() => {
    const maxP = activeClassSlots.reduce((m, s) => Math.max(m, s.period), 7);
    return Math.min(8, Math.max(7, maxP));
  }, [activeClassSlots]);

  const filteredTimetables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return timetables
      .filter((t) => dayFilter === 0 || t.dayOfWeek === dayFilter)
      .filter((t) => buildingFilter === 'ALL' || t.building === buildingFilter)
      .filter((t) => {
        if (!q) return true;
        return (
          t.className.toLowerCase().includes(q) ||
          t.grade.toLowerCase().includes(q) ||
          t.roomNumber.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.teacherName.toLowerCase().includes(q) ||
          t.building.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          a.dayOfWeek - b.dayOfWeek ||
          a.period - b.period ||
          a.building.localeCompare(b.building, 'zh-Hant') ||
          a.roomNumber.localeCompare(b.roomNumber)
      );
  }, [timetables, dayFilter, buildingFilter, searchQuery]);

  const handleClearActiveClass = async () => {
    if (!effectiveClassName || activeClassSlots.length === 0) return;
    setClearingClass(true);
    try {
      const deleted = await batchDeleteTimetableSlots(activeClassSlots.map((s) => s.id));
      setConfirmClearClass(false);
      onActionFeedback(`已清除「${effectiveClassName}」共 ${deleted} 筆課表節次`);
    } finally {
      setClearingClass(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Import Actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2421] tracking-tight">班級課表管理</h1>
          <p className="text-sm text-[#7C7A72] mt-1">
            {schoolSettings.schoolName} · {schoolSettings.academicYear} 學年度{schoolSettings.semester} · 已建立{' '}
            <span className="font-mono-num font-semibold text-[#1F2421]">{classDirectory.length}</span> 個班級、共{' '}
            <span className="font-mono-num font-semibold text-[#1F2421]">{timetables.length}</span> 筆巡堂排課
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-2 whitespace-nowrap cursor-pointer shadow-xs"
            >
              <FileUp className="w-4 h-4" />
              讀取／上傳學校課表（PDF / Word / Excel）
            </button>
          )}
          <button
            type="button"
            onClick={onGoToBasicData}
            className="min-h-[42px] px-3.5 py-2 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <Building2 className="w-3.5 h-3.5 text-[#1E5C4B]" />
            設定學校與樓棟
          </button>
        </div>
      </div>

      {/* Mode Switcher & Secondary Controls */}
      <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-[#E5E1D8] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl self-start">
            <button
              type="button"
              onClick={() => setViewMode('weekly')}
              className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                viewMode === 'weekly'
                  ? 'bg-[#1E5C4B] text-white shadow-xs'
                  : 'text-[#5C615C] hover:text-[#1F2421]'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              班級週課表（一～五）
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                viewMode === 'list'
                  ? 'bg-[#1E5C4B] text-white shadow-xs'
                  : 'text-[#5C615C] hover:text-[#1F2421]'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              全校節次明細
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() =>
                  setAddSlotPrefill(
                    activeClassMeta
                      ? {
                          className: activeClassMeta.className,
                          grade: activeClassMeta.grade,
                          building: activeClassMeta.building,
                          floor: activeClassMeta.floor,
                          roomNumber: activeClassMeta.roomNumber,
                        }
                      : {}
                  )
                }
                className="min-h-[38px] px-3.5 py-1.5 bg-[#1F2421] hover:bg-[#313834] text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                新增單節課表
              </button>
            )}
            {timetables.length > 0 && (
              <button
                type="button"
                onClick={() => exportTimetableBackupCsv(timetables)}
                className="min-h-[38px] px-3.5 py-1.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                備份課表 CSV
              </button>
            )}
            {isAdmin && timetables.length === 0 && (
              <button
                type="button"
                onClick={onSeedDemoData}
                disabled={seeding}
                className="min-h-[38px] px-3.5 py-1.5 bg-white hover:bg-[#FAF9F5] text-[#1E5C4B] border border-[#1E5C4B]/30 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                {seeding ? '建立中...' : '載入全校範例資料'}
              </button>
            )}
            {!isAdmin && (
              <span className="text-xs text-[#7C7A72]">課表讀取與維護限管理者操作</span>
            )}
          </div>
        </div>

        {/* Empty State */}
        {timetables.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <BookOpen className="w-8 h-8 text-[#9A968C] mx-auto" />
            <p className="text-base font-bold text-[#1F2421]">尚未匯入學校班級課表</p>
            <p className="text-xs text-[#7C7A72] max-w-md mx-auto leading-relaxed">
              可直接上傳貴校既有的 PDF (.pdf)、Word (.docx) 或 Excel (.xlsx) 班級日課表，系統將自動對應各科授課教師並轉換為每週一至週五的即時巡堂名單。
            </p>
            {isAdmin && (
              <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  className="min-h-[42px] px-5 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-2 cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  立即讀取學校課表檔案
                </button>
              </div>
            )}
          </div>
        ) : viewMode === 'weekly' ? (
          /* ================= WEEKLY CLASS MATRIX VIEW ================= */
          <div className="p-4 sm:p-5 space-y-4">
            {/* Class Selector Strip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {classDirectory.map((cls) => {
                  const active = cls.className === effectiveClassName;
                  return (
                    <button
                      key={cls.className}
                      type="button"
                      onClick={() => {
                        setSelectedClassName(cls.className);
                        setConfirmClearClass(false);
                      }}
                      className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer border transition-colors ${
                        active
                          ? 'bg-[#1E5C4B] text-white border-[#1E5C4B]'
                          : 'bg-[#FAF9F5] text-[#3A3F3B] border-[#E5E1D8] hover:bg-[#F2EFE9]'
                      }`}
                    >
                      {cls.className}
                      <span className="font-mono-num ml-1.5 opacity-80">({cls.slotCount})</span>
                    </button>
                  );
                })}
              </div>

              {activeClassMeta && isAdmin && (
                <div className="flex items-center gap-2 shrink-0">
                  {confirmClearClass ? (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#FCECE6] border border-[#EABEB0] rounded-xl text-xs">
                      <span className="text-[#7A2716] font-semibold">確定清除此班課表？</span>
                      <button
                        type="button"
                        disabled={clearingClass}
                        onClick={handleClearActiveClass}
                        className="px-2.5 py-1 bg-[#B44326] text-white rounded-lg font-semibold cursor-pointer"
                      >
                        {clearingClass ? '清除中...' : '確定'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearClass(false)}
                        className="px-2 py-1 text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearClass(true)}
                      className="min-h-[36px] px-3 py-1 text-xs font-medium text-[#7C7A72] hover:text-[#B44326] hover:bg-[#FCECE6]/60 rounded-xl inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      清除本班課表
                    </button>
                  )}
                </div>
              )}
            </div>

            {activeClassMeta && (
              <div className="px-4 py-3 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C615C]">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-bold text-[#1F2421]">
                    {activeClassMeta.grade} · {activeClassMeta.className}
                  </span>
                  <span>
                    教室位置：{activeClassMeta.building} {activeClassMeta.floor}{' '}
                    <span className="font-mono-num font-semibold text-[#1E5C4B]">
                      {activeClassMeta.roomNumber}
                    </span>
                  </span>
                  <span>
                    已匯入 <span className="font-mono-num font-semibold text-[#1F2421]">{activeClassMeta.slotCount}</span> 節授課時段
                  </span>
                </div>
                <span className="text-[11px] text-[#7C7A72]">
                  點擊任一課程卡片可前往巡堂{isAdmin ? '或編修課表' : ''}
                </span>
              </div>
            )}

            {/* Mon-Fri Weekly Grid */}
            <div className="overflow-x-auto border border-[#E5E1D8] rounded-2xl">
              <table className="w-full min-w-[700px] border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAF9F5] border-b border-[#E5E1D8] text-[#5C615C]">
                    <th className="py-3 px-3 text-center font-semibold w-28 border-r border-[#E5E1D8]">
                      節次／時間
                    </th>
                    {[1, 2, 3, 4, 5].map((day) => (
                      <th
                        key={day}
                        className="py-3 px-2.5 text-center font-bold text-[#1F2421] border-r last:border-r-0 border-[#E5E1D8]"
                      >
                        星期{DAY_OF_WEEK_SHORT[day]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDE9E0]">
                  {PERIOD_SCHEDULE.slice(0, maxWeeklyPeriod).map((pInfo) => (
                    <tr key={pInfo.period}>
                      <td className="py-2.5 px-2.5 text-center bg-[#FAF9F5]/70 border-r border-[#E5E1D8] whitespace-nowrap">
                        <div className="font-bold text-[#1F2421] font-mono-num">{pInfo.label}</div>
                        <div className="text-[10px] text-[#7C7A72] font-mono-num">
                          {pInfo.start}–{pInfo.end}
                        </div>
                      </td>
                      {[1, 2, 3, 4, 5].map((day) => {
                        const slot = activeClassSlots.find(
                          (s) => s.dayOfWeek === day && s.period === pInfo.period
                        );

                        return (
                          <td
                            key={day}
                            className="p-1.5 border-r last:border-r-0 border-[#EDE9E0] align-top"
                          >
                            {slot ? (
                              <div
                                className={`min-h-[78px] p-2.5 rounded-xl border flex flex-col justify-between gap-2 transition-colors ${
                                  slot.isRelocated
                                    ? 'bg-[#EDF6F3] border-[#C5E0D7]'
                                    : 'bg-white border-[#E5E1D8]'
                                }`}
                              >
                                <div>
                                  <div className="font-bold text-[#1F2421] text-xs sm:text-[13px] leading-snug">
                                    {slot.subject}
                                  </div>
                                  <div className="text-[11px] text-[#5C615C] mt-0.5">
                                    {slot.teacherName}
                                  </div>
                                  {slot.isRelocated && (
                                    <div className="text-[10px] text-[#245A84] inline-flex items-center gap-0.5 mt-0.5">
                                      <MapPin className="w-2.5 h-2.5 shrink-0" />
                                      <span className="truncate max-w-[115px]">
                                        {slot.locationNote || '專科教室'}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center justify-between gap-1 pt-1 border-t border-black/5">
                                  <button
                                    type="button"
                                    onClick={() => onJumpToPatrol(day, pInfo.period, slot)}
                                    className="text-[11px] font-semibold text-[#1E5C4B] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <ClipboardCheck className="w-3 h-3" />
                                    巡堂
                                  </button>
                                  {isAdmin && (
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => setEditingSlot(slot)}
                                        aria-label="編輯此節課表"
                                        className="p-1 text-[#7C7A72] hover:text-[#1E5C4B] rounded cursor-pointer"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await deleteTimetableSlot(slot.id);
                                          onActionFeedback(
                                            `已刪除 ${slot.className}（${DAY_OF_WEEK_LABELS[slot.dayOfWeek]} 第 ${slot.period} 節）`
                                          );
                                        }}
                                        aria-label="刪除此節課表"
                                        className="p-1 text-[#9A968C] hover:text-[#B44326] rounded cursor-pointer"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : isAdmin ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setAddSlotPrefill({
                                    dayOfWeek: day,
                                    period: pInfo.period,
                                    className: activeClassMeta?.className,
                                    grade: activeClassMeta?.grade,
                                    building: activeClassMeta?.building,
                                    floor: activeClassMeta?.floor,
                                    roomNumber: activeClassMeta?.roomNumber,
                                  })
                                }
                                className="w-full min-h-[78px] rounded-xl border border-dashed border-transparent hover:border-[#D5D0C5] hover:bg-[#FAF9F5] text-[#C5C0B5] hover:text-[#7C7A72] flex items-center justify-center text-[11px] cursor-pointer transition-colors"
                              >
                                ＋ 新增
                              </button>
                            ) : (
                              <div className="min-h-[78px] flex items-center justify-center text-[#D4CEC2] text-[11px]">
                                —
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* ================= FLAT LIST DETAIL VIEW ================= */
          <>
            <div className="p-4 sm:p-5 border-b border-[#E5E1D8] space-y-3.5">
              <div className="relative w-full lg:w-80">
                <Search className="w-4 h-4 text-[#9A968C] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜尋班級、年級、授課領域或教師..."
                  className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl overflow-x-auto">
                  {[0, 1, 2, 3, 4, 5].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDayFilter(d)}
                      className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                        dayFilter === d
                          ? 'bg-[#1E5C4B] text-white shadow-xs'
                          : 'text-[#5C615C] hover:text-[#1F2421]'
                      }`}
                    >
                      {d === 0 ? '全部星期' : DAY_OF_WEEK_LABELS[d]}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 overflow-x-auto">
                  {buildings.map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBuildingFilter(b)}
                      className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                        buildingFilter === b
                          ? 'bg-[#1F2421] text-white'
                          : 'text-[#5C615C] hover:bg-[#F2EFE9]'
                      }`}
                    >
                      {b === 'ALL' ? '全部樓棟' : b}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {filteredTimetables.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <BookOpen className="w-7 h-7 text-[#9A968C] mx-auto" />
                <p className="text-sm font-medium text-[#1F2421]">目前尚無符合條件的班級課表</p>
                <p className="text-xs text-[#7C7A72]">請調整星期、樓棟篩選條件或清除關鍵字</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#E5E1D8] bg-[#FAF9F5] text-xs font-semibold text-[#5C615C]">
                      <th className="py-3 px-4">星期／節次</th>
                      <th className="py-3 px-4">樓棟／教室</th>
                      <th className="py-3 px-4">年級／班別</th>
                      <th className="py-3 px-4">授課領域</th>
                      <th className="py-3 px-4">授課教師姓名</th>
                      <th className="py-3 px-4">上課地點備註</th>
                      <th className="py-3 px-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0ECE3] text-xs sm:text-sm">
                    {filteredTimetables.slice(0, 150).map((slot) => (
                      <tr key={slot.id} className="hover:bg-[#FAF9F5]">
                        <td className="py-3 px-4 font-mono-num whitespace-nowrap text-[#3A3F3B]">
                          {DAY_OF_WEEK_LABELS[slot.dayOfWeek]} · 第 {slot.period} 節
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-[#3A3F3B]">
                          {slot.building} {slot.floor} ·{' '}
                          <span className="font-mono-num font-semibold text-[#1E5C4B]">
                            {slot.roomNumber}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-semibold text-[#1F2421]">
                          {slot.className}
                          {slot.grade !== slot.className && (
                            <span className="text-xs font-normal text-[#7C7A72] ml-1.5">
                              （{slot.grade}）
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-[#1F2421] font-medium">
                          {slot.subject}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-[#3A3F3B]">
                          {slot.teacherName}
                        </td>
                        <td className="py-3 px-4 text-xs text-[#5C615C]">
                          {slot.isRelocated ? (
                            <span className="text-[#245A84] font-semibold">
                              移地：{slot.locationNote || '專科教室'}
                            </span>
                          ) : (
                            '原班教室'
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onJumpToPatrol(slot.dayOfWeek, slot.period, slot)}
                              className="min-h-[32px] px-2.5 text-xs font-semibold text-[#1E5C4B] hover:bg-[#E5F2EE] rounded-lg cursor-pointer"
                            >
                              巡堂
                            </button>
                            {isAdmin && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditingSlot(slot)}
                                  aria-label="編輯課表"
                                  className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-[#7C7A72] hover:text-[#1E5C4B] cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteTimetableSlot(slot.id);
                                    onActionFeedback(
                                      `已刪除 ${slot.className}（${DAY_OF_WEEK_LABELS[slot.dayOfWeek]} 第 ${slot.period} 節）課表`
                                    );
                                  }}
                                  aria-label="刪除課表"
                                  className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center text-[#9A968C] hover:text-[#B44326] cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredTimetables.length > 150 && (
                  <div className="px-4 py-3 text-xs text-[#7C7A72] bg-[#FAF9F5] border-t border-[#F0ECE3]">
                    顯示前 150 筆（共 {filteredTimetables.length} 筆），請使用星期、樓棟篩選或關鍵字精準搜尋。
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* School Timetable File Reader & Import Wizard Modal */}
      {showImportModal && (
        <TimetableImportModal
          uid={profile.uid}
          schoolSettings={schoolSettings}
          existingTimetables={timetables}
          onClose={() => setShowImportModal(false)}
          onImported={({ importedCount, replacedCount, classNames }) => {
            setShowImportModal(false);
            if (classNames[0]) {
              setSelectedClassName(classNames[0]);
              setViewMode('weekly');
            }
            const replaceMsg = replacedCount > 0 ? `（已覆蓋舊課表 ${replacedCount} 筆）` : '';
            onActionFeedback(
              `已成功轉入 ${classNames.join('、')} 共 ${importedCount} 節巡堂課表${replaceMsg}，現在即可於行動巡堂使用！`
            );
          }}
        />
      )}

      {/* Add Timetable Slot Modal */}
      {addSlotPrefill && (
        <TimetableSlotFormModal
          mode="create"
          uid={profile.uid}
          buildings={schoolSettings.buildings}
          prefill={addSlotPrefill}
          onClose={() => setAddSlotPrefill(null)}
          onSaved={() => {
            setAddSlotPrefill(null);
            onActionFeedback('已新增班級課表節次並即時同步至巡堂名單');
          }}
        />
      )}

      {/* Edit Timetable Slot Modal */}
      {editingSlot && (
        <TimetableSlotFormModal
          mode="edit"
          uid={profile.uid}
          buildings={schoolSettings.buildings}
          existingSlot={editingSlot}
          onClose={() => setEditingSlot(null)}
          onSaved={() => {
            setEditingSlot(null);
            onActionFeedback('已更新課表節次內容並同步至巡堂名單');
          }}
        />
      )}
    </div>
  );
};

interface TimetableSlotFormModalProps {
  mode: 'create' | 'edit';
  uid: string;
  buildings: string[];
  prefill?: {
    dayOfWeek?: number;
    period?: number;
    className?: string;
    grade?: string;
    building?: string;
    floor?: string;
    roomNumber?: string;
  };
  existingSlot?: TimetableSlot;
  onClose: () => void;
  onSaved: () => void;
}

const TimetableSlotFormModal: React.FC<TimetableSlotFormModalProps> = ({
  mode,
  uid,
  buildings,
  prefill,
  existingSlot,
  onClose,
  onSaved,
}) => {
  const defaultBuilding =
    existingSlot?.building || prefill?.building || buildings[0] || '行政教學大樓';
  const buildingOptions = useMemo(() => {
    const list = [...buildings];
    if (defaultBuilding && !list.includes(defaultBuilding)) list.push(defaultBuilding);
    return list;
  }, [buildings, defaultBuilding]);

  const [dayOfWeek, setDayOfWeek] = useState(existingSlot?.dayOfWeek ?? prefill?.dayOfWeek ?? 1);
  const [period, setPeriod] = useState(existingSlot?.period ?? prefill?.period ?? 1);
  const [building, setBuilding] = useState(defaultBuilding);
  const [floor, setFloor] = useState(existingSlot?.floor ?? prefill?.floor ?? '1F');
  const [roomNumber, setRoomNumber] = useState(
    existingSlot?.roomNumber ?? prefill?.roomNumber ?? '101'
  );
  const [grade, setGrade] = useState<string>(
    existingSlot?.grade ?? prefill?.grade ?? STANDARD_GRADES[0]
  );
  const [className, setClassName] = useState(
    existingSlot?.className ?? prefill?.className ?? '一年忠班'
  );
  const [subject, setSubject] = useState(existingSlot?.subject ?? '國語');
  const [teacherName, setTeacherName] = useState(existingSlot?.teacherName ?? '');
  const [isRelocated, setIsRelocated] = useState(existingSlot?.isRelocated ?? false);
  const [locationNote, setLocationNote] = useState(existingSlot?.locationNote ?? '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim() || !subject.trim() || !teacherName.trim()) return;
    setSaving(true);
    try {
      if (mode === 'edit' && existingSlot) {
        await updateTimetableSlot(existingSlot.id, {
          building,
          floor,
          roomNumber,
          className,
          grade,
          subject,
          teacherName,
          isRelocated,
          locationNote,
        });
      } else {
        await createTimetableSlot(uid, {
          dayOfWeek,
          period,
          building,
          floor,
          roomNumber,
          className,
          grade,
          subject,
          teacherName,
          isRelocated,
          locationNote,
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8]">
        <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between">
          <h3 className="text-base font-bold text-[#1F2421]">
            {mode === 'edit' ? '編輯班級課表節次' : '新增班級課表節次'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#7C7A72] hover:text-[#1F2421] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">星期</label>
              <select
                value={dayOfWeek}
                disabled={mode === 'edit'}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl disabled:opacity-60"
              >
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {DAY_OF_WEEK_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">節次</label>
              <select
                value={period}
                disabled={mode === 'edit'}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl disabled:opacity-60"
              >
                {PERIOD_SCHEDULE.map((p) => (
                  <option key={p.period} value={p.period}>
                    {p.label}（{p.start}–{p.end}）
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">校舍樓棟</label>
              <select
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                className="w-full min-h-[40px] px-2.5 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              >
                {buildingOptions.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">樓層</label>
              <input
                required
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                maxLength={20}
                placeholder="1F"
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">教室編號</label>
              <input
                required
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                maxLength={20}
                placeholder="101"
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">年級</label>
              <select
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              >
                {STANDARD_GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="特教／資源班">特教／資源班</option>
                <option value="其他">其他</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">班別</label>
              <input
                required
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                maxLength={30}
                placeholder="例如：一年忠班、一甲"
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">授課領域／科目</label>
              <input
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={50}
                placeholder="例如：國語、生活(表演)"
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#5C615C] block mb-1">授課教師姓名</label>
              <input
                required
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                maxLength={40}
                placeholder="例如：陳怡芬"
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#3A3F3B] cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={isRelocated}
              onChange={(e) => setIsRelocated(e.target.checked)}
              className="w-4 h-4 accent-[#1E5C4B]"
            />
            <span>本節為移地教學／戶外或專科教室上課</span>
          </label>

          {isRelocated && (
            <input
              value={locationNote}
              onChange={(e) => setLocationNote(e.target.value)}
              maxLength={100}
              placeholder="輸入實際上課地點，例如：自然專科教室、戶外操場"
              className="w-full min-h-[40px] px-3 border border-[#E5E1D8] bg-[#FAF9F5] rounded-xl text-xs"
            />
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] px-5 bg-[#1E5C4B] hover:bg-[#16473A] text-white font-semibold rounded-xl cursor-pointer"
            >
              {saving ? '儲存中...' : mode === 'edit' ? '儲存變更' : '確認新增'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
