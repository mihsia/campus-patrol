import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  Check,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  PatrolLog,
  SchoolSettings,
  SemesterType,
  StaffProfile,
  TimetableSlot,
} from '../types/patrol';
import { saveSchoolSettings } from '../lib/firestoreOps';

interface BasicDataViewProps {
  profile: StaffProfile;
  isAdmin: boolean;
  schoolSettings: SchoolSettings;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  onGoToTimetable: () => void;
  onActionFeedback: (message: string) => void;
}

export const BasicDataView: React.FC<BasicDataViewProps> = ({
  profile,
  isAdmin,
  schoolSettings,
  timetables,
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
    </div>
  );
};
