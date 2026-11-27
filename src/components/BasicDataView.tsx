import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  CalendarClock,
  Check,
  Download,
  Eye,
  History,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ArchivedTimetableSlot,
  PatrolLog,
  SchoolSettings,
  SemesterType,
  StaffProfile,
  TimetableArchive,
  TimetableSlot,
} from '../types/patrol';
import {
  DAY_OF_WEEK_SHORT,
  PERIOD_SCHEDULE,
  STANDARD_GRADES,
} from '../types/patrol';
import {
  archiveCurrentTimetables,
  deleteTimetableArchive,
  fetchArchivedTimetableSlots,
  restoreArchivedTimetable,
  saveSchoolSettings,
} from '../lib/firestoreOps';
import { exportTimetableBackupCsv } from '../lib/exportReports';

interface BasicDataViewProps {
  profile: StaffProfile;
  isAdmin: boolean;
  schoolSettings: SchoolSettings;
  timetables: TimetableSlot[];
  timetableArchives: TimetableArchive[];
  patrolLogs: PatrolLog[];
  onGoToTimetable: () => void;
  onActionFeedback: (message: string) => void;
}

function formatArchiveTimestamp(archive: TimetableArchive): string {
  const dt = archive.archivedAt?.toDate?.();
  if (!dt) return '剛剛歸檔';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

export const BasicDataView: React.FC<BasicDataViewProps> = ({
  profile,
  isAdmin,
  schoolSettings,
  timetables,
  timetableArchives,
  patrolLogs,
  onGoToTimetable,
  onActionFeedback,
}) => {
  const [editing, setEditing] = useState(false);
  const [schoolName, setSchoolName] = useState(schoolSettings.schoolName);
  const [academicYear, setAcademicYear] = useState(schoolSettings.academicYear);
  const [semester, setSemester] = useState<SemesterType>(schoolSettings.semester);
  const [currentWeek, setCurrentWeek] = useState<number>(schoolSettings.currentWeek);
  const [buildings, setBuildings] = useState<string[]>(schoolSettings.buildings);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Academic Year Archive & History Viewer states
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [viewingArchive, setViewingArchive] = useState<TimetableArchive | null>(null);
  const [confirmDeleteArchiveId, setConfirmDeleteArchiveId] = useState<string | null>(null);
  const [deletingArchiveId, setDeletingArchiveId] = useState<string | null>(null);
  const [exportingArchiveId, setExportingArchiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setSchoolName(schoolSettings.schoolName);
      setAcademicYear(schoolSettings.academicYear);
      setSemester(schoolSettings.semester);
      setCurrentWeek(schoolSettings.currentWeek);
      setBuildings(schoolSettings.buildings);
    }
  }, [schoolSettings, editing]);

  const stats = useMemo(() => {
    const classSet = new Set<string>();
    const teacherSet = new Set<string>();
    const buildingSlotCounts = new Map<string, number>();

    timetables.forEach((t) => {
      classSet.add(t.className);
      teacherSet.add(t.teacherName);
      buildingSlotCounts.set(t.building, (buildingSlotCounts.get(t.building) || 0) + 1);
    });

    return {
      classCount: classSet.size,
      teacherCount: teacherSet.size,
      totalSlots: timetables.length,
      totalPatrols: patrolLogs.length,
      buildingSlotCounts,
    };
  }, [timetables, patrolLogs]);

  const handleAddBuilding = () => {
    const trimmed = newBuildingName.trim().slice(0, 40);
    if (!trimmed) return;
    if (buildings.includes(trimmed)) {
      setFormError(`樓棟「${trimmed}」已存在清單中`);
      return;
    }
    if (buildings.length >= 30) {
      setFormError('最多可設定 30 棟樓棟名稱');
      return;
    }
    setBuildings((prev) => [...prev, trimmed]);
    setNewBuildingName('');
    setFormError(null);
  };

  const handleRenameBuilding = (index: number, value: string) => {
    setBuildings((prev) => prev.map((b, i) => (i === index ? value.slice(0, 40) : b)));
  };

  const handleRemoveBuilding = (index: number) => {
    if (buildings.length <= 1) {
      setFormError('至少需保留一棟校舍樓棟名稱');
      return;
    }
    setBuildings((prev) => prev.filter((_, i) => i !== index));
    setFormError(null);
  };

  const handleMoveBuilding = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= buildings.length) return;
    setBuildings((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedName = schoolName.trim();
    const cleanedYear = academicYear.trim();
    const cleanedBuildings = buildings.map((b) => b.trim()).filter(Boolean);

    if (!cleanedName) {
      setFormError('請輸入學校名稱');
      return;
    }
    if (!cleanedYear) {
      setFormError('請輸入學年度（例如：115）');
      return;
    }
    if (cleanedBuildings.length === 0) {
      setFormError('請至少設定一棟校舍樓棟名稱');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await saveSchoolSettings(profile.uid, {
        schoolName: cleanedName,
        academicYear: cleanedYear,
        semester,
        currentWeek,
        buildings: cleanedBuildings,
      });
      setEditing(false);
      onActionFeedback('已更新學校基本資料與各棟樓名稱，並即時同步至全站與報表抬頭');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '儲存基本資料失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setSchoolName(schoolSettings.schoolName);
    setAcademicYear(schoolSettings.academicYear);
    setSemester(schoolSettings.semester);
    setCurrentWeek(schoolSettings.currentWeek);
    setBuildings(schoolSettings.buildings);
    setNewBuildingName('');
    setFormError(null);
    setEditing(false);
  };

  const handleQuickExportArchiveCsv = async (archive: TimetableArchive) => {
    setExportingArchiveId(archive.id);
    try {
      const slots = await fetchArchivedTimetableSlots(archive.id);
      if (slots.length === 0) {
        onActionFeedback(`歷史檔「${archive.label}」內無課表節次資料`);
        return;
      }
      exportTimetableBackupCsv(
        slots,
        `${schoolSettings.schoolName}_${archive.academicYear}學年度${archive.semester}_歷史課表.csv`
      );
      onActionFeedback(`已匯出「${archive.label}」共 ${slots.length} 節課表 CSV`);
    } finally {
      setExportingArchiveId(null);
    }
  };

  const handleDeleteArchive = async (archive: TimetableArchive) => {
    setDeletingArchiveId(archive.id);
    try {
      await deleteTimetableArchive(archive.id);
      setConfirmDeleteArchiveId(null);
      onActionFeedback(`已刪除歷史課表封存檔「${archive.label}」`);
    } finally {
      setDeletingArchiveId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Page Title Header (Matching Reference School Basic Data Aesthetic) */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2421] tracking-tight">學校基本資料</h1>
          <p className="text-sm text-[#7C7A72] mt-1">
            管理學校名稱、學年度學期與校舍各棟樓名稱 · {schoolSettings.academicYear} 學年度{schoolSettings.semester}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onGoToTimetable}
            className="min-h-[42px] px-4 py-2 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            前往班級課表管理
            <ArrowRight className="w-4 h-4" />
          </button>

          {isAdmin && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Pencil className="w-4 h-4" />
              編輯基本資料
            </button>
          )}
        </div>
      </div>

      {/* Subtle Context Info Strip (Inspired by Reference Top Warm Bar) */}
      <div className="bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs sm:text-sm text-[#5C615C]">
        <span>
          報表抬頭預覽：
          <strong className="text-[#1F2421] font-semibold ml-1">
            {schoolName || schoolSettings.schoolName} {academicYear || schoolSettings.academicYear} 學年度{semester}第 {currentWeek} 週 巡堂紀錄表
          </strong>
        </span>
        <span className="text-xs text-[#7C7A72] whitespace-nowrap">
          {isAdmin ? '管理者可隨時更新設定' : '僅供檢視（修改限管理者）'}
        </span>
      </div>

      {/* Overview Card OR Edit Form */}
      {!editing ? (
        <div className="space-y-6">
          {/* Card 1: School Overview (Clean 2-column label-over-bold-value matching Screenshot 1) */}
          <section className="space-y-2.5">
            <h2 className="text-sm font-bold text-[#1F2421]">學校、學期與課務概況</h2>
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-6 sm:p-7 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-6">
                <div>
                  <p className="text-xs font-medium text-[#7C7A72]">學校名稱</p>
                  <p className="text-xl font-bold text-[#1F2421] mt-1">{schoolSettings.schoolName}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#7C7A72]">學年度與學期</p>
                  <p className="text-xl font-bold text-[#1F2421] mt-1 font-mono-num">
                    {schoolSettings.academicYear} 學年度 {schoolSettings.semester}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#7C7A72]">目前巡堂週次</p>
                  <p className="text-xl font-bold text-[#1F2421] mt-1 font-mono-num">
                    第 {schoolSettings.currentWeek} 週
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#7C7A72]">設定樓棟總數</p>
                  <p className="text-xl font-bold text-[#1F2421] mt-1 font-mono-num">
                    {schoolSettings.buildings.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#7C7A72]">已建置班級數</p>
                  <p className="text-xl font-bold text-[#1F2421] mt-1 font-mono-num">
                    {stats.classCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[#7C7A72]">班級課表總節數</p>
                  <p className="text-xl font-bold text-[#1F2421] mt-1 font-mono-num">
                    {stats.totalSlots}
                  </p>
                </div>
              </div>

              {/* Warm-sand summary bar matching Screenshot 1 */}
              <div className="bg-[#F4F1EA] rounded-xl px-4 py-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#3A3F3B]">
                <span>
                  授課教師總數 <strong className="font-mono-num text-[#1F2421] ml-1">{stats.teacherCount}</strong>
                </span>
                <span>
                  校舍樓棟 <strong className="font-mono-num text-[#1F2421] ml-1">{schoolSettings.buildings.length} 棟</strong>
                </span>
                <span>
                  累計巡堂紀錄 <strong className="font-mono-num text-[#1F2421] ml-1">{stats.totalPatrols} 筆</strong>
                </span>
                <span>
                  歷史課表封存 <strong className="font-mono-num text-[#1F2421] ml-1">{timetableArchives.length} 份</strong>
                </span>
              </div>
            </div>
          </section>

          {/* Card 2: Configured Buildings Directory */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#1F2421]">各棟樓名稱設定</h2>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] cursor-pointer"
                >
                  管理樓棟清單
                </button>
              )}
            </div>

            <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden divide-y divide-[#F0ECE3]">
              {schoolSettings.buildings.map((bName, idx) => {
                const slotCount = stats.buildingSlotCounts.get(bName) || 0;
                return (
                  <div
                    key={`${bName}-${idx}`}
                    className="px-5 py-4 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-[#E5F2EE] text-[#1E5C4B] flex items-center justify-center shrink-0">
                        <Building2 className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#1F2421] truncate">{bName}</p>
                        <p className="text-xs text-[#7C7A72]">
                          樓棟序號 <span className="font-mono-num">#{idx + 1}</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-[#5C615C] font-mono-num whitespace-nowrap shrink-0">
                      已排課 {slotCount} 節
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Card 3: Academic Year Lifecycle & Historical Timetable Archives */}
          <section className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#1F2421]">學年度切換與課表歷史歸檔</h2>
                <p className="text-xs text-[#7C7A72] mt-0.5">
                  每學年度或每學期更新課表前，可將舊課表完整封存至歷史檔留存，再匯入新學年度課表
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowArchiveModal(true)}
                  disabled={timetables.length === 0}
                  className="min-h-[40px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-45 text-white text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 self-start sm:self-auto"
                >
                  <Archive className="w-4 h-4" />
                  封存現行課表並切換學年度
                </button>
              )}
            </div>

            <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
              {/* Current Active Term Banner inside Archive Section */}
              <div className="px-5 py-4 bg-[#FAF9F5] border-b border-[#E5E1D8] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-[#E5F2EE] text-[#1E5C4B] flex items-center justify-center shrink-0">
                    <CalendarClock className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1F2421]">
                      現行使用中：{schoolSettings.academicYear} 學年度 {schoolSettings.semester}
                    </p>
                    <p className="text-xs text-[#7C7A72] mt-0.5">
                      目前共{' '}
                      <span className="font-mono-num font-semibold text-[#1F2421]">{stats.classCount}</span>{' '}
                      個班級、
                      <span className="font-mono-num font-semibold text-[#1F2421]">{stats.totalSlots}</span>{' '}
                      節有效巡堂課表
                      {timetables.length === 0 ? '（尚無現行課表可封存，請先至班級課表管理匯入）' : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onGoToTimetable}
                  className="text-xs font-semibold text-[#1E5C4B] hover:underline whitespace-nowrap self-start sm:self-auto cursor-pointer"
                >
                  前往管理現行課表 →
                </button>
              </div>

              {/* Archive History List */}
              {timetableArchives.length === 0 ? (
                <div className="px-6 py-8 text-center space-y-2">
                  <History className="w-7 h-7 text-[#9A968C] mx-auto" />
                  <p className="text-sm font-semibold text-[#1F2421]">尚無歷史學年度課表封存紀錄</p>
                  <p className="text-xs text-[#7C7A72] max-w-md mx-auto leading-relaxed">
                    當學年度或學期結束、準備換用新課表時，點選上方「封存現行課表並切換學年度」，即可將舊課表完整轉入歷史檔備查，隨時可線上瀏覽、匯出 CSV 或還原。
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[#F0ECE3]">
                  {timetableArchives.map((archive) => {
                    const previewClasses = archive.classNames.slice(0, 6).join('、');
                    const extraClassCount = Math.max(0, archive.classCount - 6);
                    const confirmingDelete = confirmDeleteArchiveId === archive.id;

                    return (
                      <div
                        key={archive.id}
                        className="px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-3.5"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono-num font-bold text-[#1E5C4B] bg-[#E5F2EE] px-2 py-0.5 rounded-md">
                              {archive.academicYear} 學年度 · {archive.semester}
                            </span>
                            <span className="text-sm font-bold text-[#1F2421] truncate">
                              {archive.label}
                            </span>
                          </div>
                          <p className="text-xs text-[#5C615C]">
                            共 <span className="font-mono-num font-semibold">{archive.classCount}</span> 班・
                            <span className="font-mono-num font-semibold">{archive.slotCount}</span> 節
                            {previewClasses && (
                              <span className="text-[#7C7A72] ml-2">
                                （{previewClasses}
                                {extraClassCount > 0 ? ` 等 ${archive.classCount} 班` : ''}）
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-[#7C7A72]">
                            封存時間：<span className="font-mono-num">{formatArchiveTimestamp(archive)}</span> · 歸檔人：
                            {archive.archivedByName}
                            {archive.note ? ` · 備註：${archive.note}` : ''}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => setViewingArchive(archive)}
                            className="min-h-[36px] px-3 py-1.5 bg-[#FAF9F5] hover:bg-[#F0ECE3] text-[#1F2421] border border-[#DDD8CD] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#1E5C4B]" />
                            檢視課表
                          </button>

                          <button
                            type="button"
                            disabled={exportingArchiveId === archive.id}
                            onClick={() => handleQuickExportArchiveCsv(archive)}
                            className="min-h-[36px] px-3 py-1.5 bg-white hover:bg-[#FAF9F5] text-[#5C615C] border border-[#DDD8CD] text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {exportingArchiveId === archive.id ? '匯出中...' : '匯出 CSV'}
                          </button>

                          {isAdmin &&
                            (confirmingDelete ? (
                              <div className="inline-flex items-center gap-1 px-2 py-1 bg-[#FCECE6] border border-[#EABEB0] rounded-xl text-xs">
                                <span className="text-[#7A2716] font-semibold">確定刪除？</span>
                                <button
                                  type="button"
                                  disabled={deletingArchiveId === archive.id}
                                  onClick={() => handleDeleteArchive(archive)}
                                  className="px-2 py-0.5 bg-[#B44326] text-white rounded-lg font-semibold cursor-pointer"
                                >
                                  {deletingArchiveId === archive.id ? '刪除中' : '確定'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteArchiveId(null)}
                                  className="px-1.5 py-0.5 text-[#5C615C] cursor-pointer"
                                >
                                  取消
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteArchiveId(archive.id)}
                                aria-label="刪除此歷史課表封存"
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#9A968C] hover:text-[#B44326] hover:bg-[#FCECE6]/70 rounded-xl cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        /* Interactive Edit Form (Admin) */
        <form onSubmit={handleSave} className="space-y-6">
          {formError && (
            <div className="bg-[#FCECE6] border border-[#EABEB0] rounded-xl px-4 py-3 text-xs sm:text-sm text-[#9E351E]">
              {formError}
            </div>
          )}

          {/* Section 1: School Info & Academic Term */}
          <section className="bg-white border border-[#E5E1D8] rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-[#1F2421]">一、學校名稱與學期資訊</h2>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                此處設定會自動套用於系統頂部標題及 Word／PDF 巡堂紀錄表抬頭
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#3A3F3B] block">學校名稱</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  placeholder="例如：利澤國小"
                  className="w-full min-h-[42px] px-3.5 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#3A3F3B] block">學年度</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={academicYear}
                    onChange={(e) => setAcademicYear(e.target.value)}
                    placeholder="115"
                    className="w-full min-h-[42px] px-3 text-sm font-mono-num bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#3A3F3B] block">學期</label>
                  <select
                    value={semester}
                    onChange={(e) => setSemester(e.target.value as SemesterType)}
                    className="w-full min-h-[42px] px-2.5 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
                  >
                    <option value="第一學期">第一學期</option>
                    <option value="第二學期">第二學期</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[#3A3F3B] block">目前週次</label>
                  <input
                    type="number"
                    min={1}
                    max={25}
                    required
                    value={currentWeek}
                    onChange={(e) => setCurrentWeek(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
                    className="w-full min-h-[42px] px-3 text-sm font-mono-num bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Campus Buildings Manager */}
          <section className="bg-white border border-[#E5E1D8] rounded-2xl p-6 space-y-5">
            <div>
              <h2 className="text-base font-bold text-[#1F2421]">二、校舍各棟樓名稱設定</h2>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                建立各教學大樓與專科大樓名稱後，班級課表維護與行動巡堂篩選將自動連動此清單
              </p>
            </div>

            {/* Add new building */}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                maxLength={40}
                value={newBuildingName}
                onChange={(e) => setNewBuildingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddBuilding();
                  }
                }}
                placeholder="輸入新樓棟名稱，例如：仁愛樓、活動中心..."
                className="flex-1 min-h-[42px] px-3.5 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
              />
              <button
                type="button"
                onClick={handleAddBuilding}
                className="min-h-[42px] px-4 py-2 bg-[#1F2421] hover:bg-[#313834] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                新增樓棟
              </button>
            </div>

            {/* Editable building list */}
            <div className="space-y-2.5">
              {buildings.map((bName, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8]"
                >
                  <span className="w-7 text-center text-xs font-mono-num text-[#7C7A72] shrink-0">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    value={bName}
                    onChange={(e) => handleRenameBuilding(idx, e.target.value)}
                    className="flex-1 min-h-[38px] px-3 text-sm bg-white border border-[#E5E1D8] rounded-lg focus:outline-none focus:border-[#1E5C4B]"
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveBuilding(idx, -1)}
                      disabled={idx === 0}
                      aria-label="上移樓棟"
                      className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#5C615C] hover:bg-[#EAE5DC] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveBuilding(idx, 1)}
                      disabled={idx === buildings.length - 1}
                      aria-label="下移樓棟"
                      className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#5C615C] hover:bg-[#EAE5DC] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveBuilding(idx)}
                      aria-label="刪除樓棟"
                      className="min-h-[36px] min-w-[36px] rounded-lg flex items-center justify-center text-[#7C7A72] hover:text-[#B44326] hover:bg-[#FCECE6] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Form Footer Actions */}
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleCancelEdit}
              className="min-h-[44px] px-4 py-2 bg-white hover:bg-[#FAF9F5] border border-[#DDD8CD] text-[#5C615C] text-sm font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
            >
              <X className="w-4 h-4" />
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-6 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
            >
              {saving ? <Save className="w-4 h-4 animate-pulse" /> : <Check className="w-4 h-4" />}
              {saving ? '儲存設定中...' : '儲存基本資料設定'}
            </button>
          </div>
        </form>
      )}

      {/* Modal 1: Archive Current Timetable & Switch Academic Year/Semester */}
      {showArchiveModal && (
        <ArchiveTermModal
          uid={profile.uid}
          actorName={profile.displayName}
          schoolSettings={schoolSettings}
          timetables={timetables}
          classCount={stats.classCount}
          onClose={() => setShowArchiveModal(false)}
          onArchived={(msg, goTimetable) => {
            setShowArchiveModal(false);
            onActionFeedback(msg);
            if (goTimetable) {
              onGoToTimetable();
            }
          }}
        />
      )}

      {/* Modal 2: Read-Only Archived Weekly Grid Viewer & Restore */}
      {viewingArchive && (
        <ArchiveViewerModal
          uid={profile.uid}
          isAdmin={isAdmin}
          schoolSettings={schoolSettings}
          archive={viewingArchive}
          existingTimetableIds={timetables.map((t) => t.id)}
          onClose={() => setViewingArchive(null)}
          onRestored={(msg) => {
            setViewingArchive(null);
            onActionFeedback(msg);
          }}
        />
      )}
    </div>
  );
};

interface ArchiveTermModalProps {
  uid: string;
  actorName: string;
  schoolSettings: SchoolSettings;
  timetables: TimetableSlot[];
  classCount: number;
  onClose: () => void;
  onArchived: (message: string, goToTimetable: boolean) => void;
}

const ArchiveTermModal: React.FC<ArchiveTermModalProps> = ({
  uid,
  actorName,
  schoolSettings,
  timetables,
  classCount,
  onClose,
  onArchived,
}) => {
  const numericYear = Number.parseInt(schoolSettings.academicYear, 10);
  const nextYearSuggestion = Number.isFinite(numericYear)
    ? String(numericYear + 1)
    : schoolSettings.academicYear;

  const defaultNextYear =
    schoolSettings.semester === '第一學期' ? schoolSettings.academicYear : nextYearSuggestion;
  const defaultNextSemester: SemesterType =
    schoolSettings.semester === '第一學期' ? '第二學期' : '第一學期';

  const [label, setLabel] = useState(
    `${schoolSettings.academicYear} 學年度${schoolSettings.semester}課表`
  );
  const [note, setNote] = useState('');
  const [clearActive, setClearActive] = useState(true);
  const [switchTerm, setSwitchTerm] = useState(true);
  const [nextAcademicYear, setNextAcademicYear] = useState(defaultNextYear);
  const [nextSemester, setNextSemester] = useState<SemesterType>(defaultNextSemester);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirmArchive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (timetables.length === 0) {
      setError('目前沒有可封存的現行課表資料');
      return;
    }
    if (switchTerm && !nextAcademicYear.trim()) {
      setError('請輸入要切換的新學年度（例如：116）');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await archiveCurrentTimetables({
        uid,
        actorName,
        schoolSettings,
        timetables,
        archiveAcademicYear: schoolSettings.academicYear,
        archiveSemester: schoolSettings.semester,
        label: label.trim() || `${schoolSettings.academicYear} 學年度${schoolSettings.semester}課表`,
        note: note.trim(),
        clearActiveAfterArchive: clearActive,
        switchToNewTerm: switchTerm
          ? {
              academicYear: nextAcademicYear.trim(),
              semester: nextSemester,
              currentWeek: 1,
            }
          : undefined,
      });

      const parts: string[] = [
        `已將「${schoolSettings.academicYear} 學年度${schoolSettings.semester}」共 ${res.archivedSlotCount} 節課表轉入歷史檔`,
      ];
      if (res.clearedSlotCount > 0) {
        parts.push(`並清空現行課表`);
      }
      if (switchTerm) {
        parts.push(`且切換至 ${nextAcademicYear.trim()} 學年度${nextSemester}第 1 週`);
      }
      onArchived(parts.join('，'), clearActive);
    } catch (err) {
      setError(err instanceof Error ? err.message : '封存歸檔時發生錯誤，請稍後再試');
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
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8]">
        <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between bg-[#FAF9F5]">
          <div>
            <h3 className="text-base font-bold text-[#1F2421]">封存現行課表並切換學年度</h3>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              舊課表將完整保存於歷史檔，可供隨時查閱、匯出或還原
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#7C7A72] hover:text-[#1F2421] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleConfirmArchive} className="p-5 space-y-4 text-sm">
          {error && (
            <div className="p-3 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#7A2716]">
              {error}
            </div>
          )}

          {/* Snapshot Summary */}
          <div className="p-3.5 rounded-xl bg-[#F4F1EA] border border-[#E5E1D8] text-xs space-y-1">
            <p className="font-bold text-[#1F2421]">
              即將封存：{schoolSettings.academicYear} 學年度 {schoolSettings.semester}
            </p>
            <p className="text-[#5C615C]">
              包含 <strong className="font-mono-num text-[#1F2421]">{classCount}</strong> 個班級、共{' '}
              <strong className="font-mono-num text-[#1F2421]">{timetables.length}</strong> 節課表（原有巡堂紀錄與報表資料將完整保留不受影響）。
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3A3F3B] block">歷史封存名稱</label>
            <input
              type="text"
              required
              maxLength={80}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full min-h-[40px] px-3 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3A3F3B] block">封存備註（選填）</label>
            <input
              type="text"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：期末封存、改版前備份..."
              className="w-full min-h-[40px] px-3 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-start gap-2.5 text-xs text-[#1F2421] cursor-pointer">
              <input
                type="checkbox"
                checked={clearActive}
                onChange={(e) => setClearActive(e.target.checked)}
                className="w-4 h-4 accent-[#1E5C4B] mt-0.5 shrink-0"
              />
              <span>
                <strong className="block">封存完成後，清空現行班級課表</strong>
                <span className="text-[#7C7A72]">
                  勾選後可從乾淨狀態直接上傳匯入新學年度／學期課表（取消勾選則僅做歷史備份）
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-xs text-[#1F2421] cursor-pointer">
              <input
                type="checkbox"
                checked={switchTerm}
                onChange={(e) => setSwitchTerm(e.target.checked)}
                className="w-4 h-4 accent-[#1E5C4B] mt-0.5 shrink-0"
              />
              <span>
                <strong className="block">同步切換系統至新學年度／學期（週次重設為第 1 週）</strong>
              </span>
            </label>
          </div>

          {switchTerm && (
            <div className="p-3.5 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#1F2421]">新學期設定</span>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setNextAcademicYear(schoolSettings.academicYear);
                      setNextSemester('第二學期');
                    }}
                    className="px-2 py-0.5 rounded-md bg-white border border-[#DDD8CD] text-[#3A3F3B] hover:border-[#1E5C4B] cursor-pointer"
                  >
                    {schoolSettings.academicYear} 第二學期
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNextAcademicYear(nextYearSuggestion);
                      setNextSemester('第一學期');
                    }}
                    className="px-2 py-0.5 rounded-md bg-white border border-[#DDD8CD] text-[#3A3F3B] hover:border-[#1E5C4B] cursor-pointer"
                  >
                    {nextYearSuggestion} 第一學期
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-semibold text-[#5C615C] block mb-1">新學年度</label>
                  <input
                    type="text"
                    required={switchTerm}
                    maxLength={10}
                    value={nextAcademicYear}
                    onChange={(e) => setNextAcademicYear(e.target.value)}
                    placeholder="例如：116"
                    className="w-full min-h-[38px] px-3 text-sm font-mono-num bg-white border border-[#DDD8CD] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[#5C615C] block mb-1">新學期</label>
                  <select
                    value={nextSemester}
                    onChange={(e) => setNextSemester(e.target.value as SemesterType)}
                    className="w-full min-h-[38px] px-2.5 text-sm bg-white border border-[#DDD8CD] rounded-xl focus:outline-none focus:border-[#1E5C4B]"
                  >
                    <option value="第一學期">第一學期</option>
                    <option value="第二學期">第二學期</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 text-xs sm:text-sm text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] px-5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Archive className="w-4 h-4" />
              {submitting ? '正在轉入歷史檔...' : '確認封存轉入歷史檔'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ArchiveViewerModalProps {
  uid: string;
  isAdmin: boolean;
  schoolSettings: SchoolSettings;
  archive: TimetableArchive;
  existingTimetableIds: string[];
  onClose: () => void;
  onRestored: (message: string) => void;
}

const ArchiveViewerModal: React.FC<ArchiveViewerModalProps> = ({
  uid,
  isAdmin,
  schoolSettings,
  archive,
  existingTimetableIds,
  onClose,
  onRestored,
}) => {
  const [slots, setSlots] = useState<ArchivedTimetableSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState('');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [replaceActive, setReplaceActive] = useState(true);
  const [syncTerm, setSyncTerm] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchArchivedTimetableSlots(archive.id)
      .then((list) => {
        if (!active) return;
        setSlots(list);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '讀取歷史課表失敗');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archive.id]);

  const classDirectory = useMemo(() => {
    const map = new Map<
      string,
      { className: string; grade: string; building: string; floor: string; roomNumber: string; count: number }
    >();
    slots.forEach((s) => {
      const ex = map.get(s.className);
      if (ex) {
        ex.count += 1;
      } else {
        map.set(s.className, {
          className: s.className,
          grade: s.grade,
          building: s.building,
          floor: s.floor,
          roomNumber: s.roomNumber,
          count: 1,
        });
      }
    });
    const gradeRank = (g: string) => {
      const idx = STANDARD_GRADES.findIndex((std) => g.includes(std));
      return idx === -1 ? 99 : idx;
    };
    return Array.from(map.values()).sort(
      (a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.className.localeCompare(b.className, 'zh-Hant')
    );
  }, [slots]);

  const effectiveClass = useMemo(() => {
    if (selectedClass && classDirectory.some((c) => c.className === selectedClass)) {
      return selectedClass;
    }
    return classDirectory[0]?.className || '';
  }, [selectedClass, classDirectory]);

  const activeSlots = useMemo(
    () => slots.filter((s) => s.className === effectiveClass),
    [slots, effectiveClass]
  );

  const activeMeta = useMemo(
    () => classDirectory.find((c) => c.className === effectiveClass) ?? null,
    [classDirectory, effectiveClass]
  );

  const maxPeriod = useMemo(() => {
    const maxP = activeSlots.reduce((m, s) => Math.max(m, s.period), 7);
    return Math.min(8, Math.max(7, maxP));
  }, [activeSlots]);

  const handleRestore = async () => {
    if (slots.length === 0) return;
    setRestoring(true);
    setError(null);
    try {
      const restoredCount = await restoreArchivedTimetable({
        uid,
        archive,
        slots,
        existingTimetableIds,
        replaceActive,
        updateSchoolTerm: syncTerm ? { schoolSettings } : undefined,
      });
      onRestored(
        `已從歷史檔「${archive.label}」還原共 ${restoredCount} 節課表至現行巡堂系統${
          syncTerm ? `，並切換回 ${archive.academicYear} 學年度${archive.semester}` : ''
        }`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '還原歷史課表時發生錯誤');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full sm:max-w-5xl max-h-[92vh] rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E1D8] bg-[#FAF9F5] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono-num font-bold text-[#1E5C4B] bg-[#E5F2EE] px-2 py-0.5 rounded-md">
                歷史封存 · {archive.academicYear} 學年度 {archive.semester}
              </span>
              <h3 className="text-base font-bold text-[#1F2421] truncate">{archive.label}</h3>
            </div>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              歸檔時間：{formatArchiveTimestamp(archive)} · 歸檔人：{archive.archivedByName} · 共{' '}
              {archive.classCount} 班 {archive.slotCount} 節
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉檢視"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#7C7A72] hover:text-[#1F2421] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#7A2716]">
              {error}
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center space-y-2">
              <div className="w-7 h-7 border-2 border-[#1E5C4B] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-[#7C7A72]">正在載入歷史課表資料...</p>
            </div>
          ) : slots.length === 0 ? (
            <div className="py-10 text-center text-xs text-[#7C7A72]">此封存檔內沒有課表節次資料</div>
          ) : (
            <>
              {/* Class Tabs */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {classDirectory.map((cls) => {
                  const active = cls.className === effectiveClass;
                  return (
                    <button
                      key={cls.className}
                      type="button"
                      onClick={() => setSelectedClass(cls.className)}
                      className={`min-h-[36px] px-3 py-1 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 border cursor-pointer transition-colors ${
                        active
                          ? 'bg-[#1E5C4B] text-white border-[#1E5C4B]'
                          : 'bg-[#FAF9F5] text-[#3A3F3B] border-[#E5E1D8] hover:bg-[#F2EFE9]'
                      }`}
                    >
                      {cls.className}
                      <span className="font-mono-num ml-1 opacity-80">({cls.count})</span>
                    </button>
                  );
                })}
              </div>

              {activeMeta && (
                <div className="px-4 py-2.5 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] flex flex-wrap items-center justify-between gap-2 text-xs text-[#5C615C]">
                  <span className="font-bold text-[#1F2421]">
                    {activeMeta.grade} · {activeMeta.className}
                  </span>
                  <span>
                    原教室位置：{activeMeta.building} {activeMeta.floor}{' '}
                    <span className="font-mono-num font-semibold text-[#1E5C4B]">
                      {activeMeta.roomNumber}
                    </span>
                  </span>
                </div>
              )}

              {/* Read-Only Mon-Fri Grid */}
              <div className="overflow-x-auto border border-[#E5E1D8] rounded-2xl">
                <table className="w-full min-w-[680px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF9F5] border-b border-[#E5E1D8] text-[#5C615C]">
                      <th className="py-2.5 px-3 text-center font-semibold w-24 border-r border-[#E5E1D8]">
                        節次／時間
                      </th>
                      {[1, 2, 3, 4, 5].map((day) => (
                        <th
                          key={day}
                          className="py-2.5 px-2 text-center font-bold text-[#1F2421] border-r last:border-r-0 border-[#E5E1D8]"
                        >
                          星期{DAY_OF_WEEK_SHORT[day]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDE9E0]">
                    {PERIOD_SCHEDULE.slice(0, maxPeriod).map((pInfo) => (
                      <tr key={pInfo.period}>
                        <td className="py-2 px-2.5 text-center bg-[#FAF9F5]/70 border-r border-[#E5E1D8] whitespace-nowrap">
                          <div className="font-bold text-[#1F2421] font-mono-num">{pInfo.label}</div>
                          <div className="text-[10px] text-[#7C7A72] font-mono-num">
                            {pInfo.start}–{pInfo.end}
                          </div>
                        </td>
                        {[1, 2, 3, 4, 5].map((day) => {
                          const slot = activeSlots.find(
                            (s) => s.dayOfWeek === day && s.period === pInfo.period
                          );
                          return (
                            <td
                              key={day}
                              className="p-1.5 border-r last:border-r-0 border-[#EDE9E0] align-top"
                            >
                              {slot ? (
                                <div
                                  className={`min-h-[60px] p-2 rounded-xl border ${
                                    slot.isRelocated
                                      ? 'bg-[#EDF6F3] border-[#C5E0D7]'
                                      : 'bg-white border-[#E5E1D8]'
                                  }`}
                                >
                                  <div className="font-bold text-[#1F2421] leading-snug">
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
                              ) : (
                                <div className="min-h-[60px] flex items-center justify-center text-[#D4CEC2] text-[11px]">
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

              {/* Restore Confirmation Panel (Admin) */}
              {isAdmin && confirmRestore && (
                <div className="p-4 rounded-2xl bg-[#FBF0E2]/70 border border-[#EBD4B4] space-y-3 text-xs">
                  <p className="font-bold text-[#8A4F0F]">
                    確定要將「{archive.label}」（共 {slots.length} 節）還原至現行課表？
                  </p>
                  <label className="flex items-center gap-2 text-[#1F2421] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={replaceActive}
                      onChange={(e) => setReplaceActive(e.target.checked)}
                      className="w-4 h-4 accent-[#1E5C4B]"
                    />
                    <span>
                      覆蓋目前所有現行課表（共 {existingTimetableIds.length} 節）；取消勾選則為合併加入
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-[#1F2421] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncTerm}
                      onChange={(e) => setSyncTerm(e.target.checked)}
                      className="w-4 h-4 accent-[#1E5C4B]"
                    />
                    <span>
                      同步將系統學期切換回「{archive.academicYear} 學年度{archive.semester}」
                    </span>
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={restoring}
                      onClick={handleRestore}
                      className="min-h-[38px] px-4 bg-[#1E5C4B] hover:bg-[#16473A] text-white font-semibold rounded-xl cursor-pointer disabled:opacity-60"
                    >
                      {restoring ? '還原中...' : '確認還原'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRestore(false)}
                      className="min-h-[38px] px-3 text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E5E1D8] bg-[#FAF9F5] flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {slots.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  exportTimetableBackupCsv(
                    slots,
                    `${schoolSettings.schoolName}_${archive.academicYear}學年度${archive.semester}_歷史課表.csv`
                  )
                }
                className="min-h-[38px] px-3.5 bg-white hover:bg-[#F2EFE9] text-[#3A3F3B] border border-[#DDD8CD] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                匯出此歷史課表 CSV
              </button>
            )}
            {isAdmin && slots.length > 0 && !confirmRestore && (
              <button
                type="button"
                onClick={() => setConfirmRestore(true)}
                className="min-h-[38px] px-3.5 bg-white hover:bg-[#FBF0E2] text-[#8A4F0F] border border-[#EBD4B4] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                還原為現行課表
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[38px] px-4 bg-[#1F2421] hover:bg-[#313834] text-white text-xs font-semibold rounded-xl cursor-pointer"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
