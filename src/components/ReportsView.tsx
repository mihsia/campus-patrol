import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ClipboardList, FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import type {
  IncidentReport,
  PatrolCheckItem,
  PatrolLog,
  SchoolSettings,
  SemesterType,
  TimetableSlot,
} from '../types/patrol';
import {
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  PERIOD_SCHEDULE,
  getAcademicYearPeriod,
} from '../types/patrol';
import {
  buildPatrolReportRows,
  exportClassTimetablesWordDocx,
  exportPatrolExcelWorkbook,
  exportPatrolWordDocx,
  groupTimetablesByClass,
  printClassTimetablesPdf,
} from '../lib/exportReports';

interface ReportsViewProps {
  schoolSettings: SchoolSettings;
  selectedDate: string;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  incidents: IncidentReport[];
  onActionFeedback: (message: string) => void;
}

type ReportMode = 'weekly_standard' | 'logged_only';
type ReportTab = 'patrol_record' | 'class_timetable';

export const ReportsView: React.FC<ReportsViewProps> = ({
  schoolSettings,
  selectedDate,
  timetables,
  patrolLogs,
  incidents,
  onActionFeedback,
}) => {
  const [reportTab, setReportTab] = useState<ReportTab>('patrol_record');
  const [schoolName, setSchoolName] = useState(schoolSettings.schoolName);
  const [academicYear, setAcademicYear] = useState(schoolSettings.academicYear);
  const [semester, setSemester] = useState<SemesterType>(schoolSettings.semester);
  const [weekNumber, setWeekNumber] = useState<number | ''>(schoolSettings.currentWeek);
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [reportMode, setReportMode] = useState<ReportMode>('weekly_standard');
  const [includeIncidentsAppendix, setIncludeIncidentsAppendix] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);

  // Class timetable export selection state
  const [selectedTimetableClasses, setSelectedTimetableClasses] = useState<string[]>([]);
  const [exportingClassWord, setExportingClassWord] = useState(false);

  // Sync defaults when schoolSettings updates from Firestore
  useEffect(() => {
    setSchoolName(schoolSettings.schoolName);
    setAcademicYear(schoolSettings.academicYear);
    setSemester(schoolSettings.semester);
    setWeekNumber(schoolSettings.currentWeek);
  }, [schoolSettings]);

  const buildings = useMemo(() => {
    const ordered = [...schoolSettings.buildings];
    timetables.forEach((t) => {
      if (t.building && !ordered.includes(t.building)) {
        ordered.push(t.building);
      }
    });
    return ['ALL', ...ordered];
  }, [schoolSettings.buildings, timetables]);

  const allClassGroups = useMemo(() => groupTimetablesByClass(timetables), [timetables]);

  const activeTimetableGroups = useMemo(() => {
    if (selectedTimetableClasses.length === 0) return allClassGroups;
    const set = new Set(selectedTimetableClasses);
    return allClassGroups.filter((g) => set.has(g.className));
  }, [allClassGroups, selectedTimetableClasses]);

  const filteredTimetables = useMemo(() => {
    return timetables.filter((t) => buildingFilter === 'ALL' || t.building === buildingFilter);
  }, [timetables, buildingFilter]);

  const filteredLogs = useMemo(() => {
    return patrolLogs
      .filter((l) => l.date >= startDate && l.date <= endDate)
      .filter((l) => buildingFilter === 'ALL' || l.building === buildingFilter);
  }, [patrolLogs, startDate, endDate, buildingFilter]);

  const filteredIncidents = useMemo(() => {
    return incidents
      .filter((i) => i.date >= startDate && i.date <= endDate)
      .filter((i) => buildingFilter === 'ALL' || i.location.includes(buildingFilter));
  }, [incidents, startDate, endDate, buildingFilter]);

  const reportRows = useMemo(
    () =>
      buildPatrolReportRows({
        patrolLogs: filteredLogs,
        timetables: filteredTimetables,
        mode: reportMode,
      }),
    [filteredLogs, filteredTimetables, reportMode]
  );

  const effectiveSettings: SchoolSettings = useMemo(
    () => ({
      ...schoolSettings,
      schoolName: schoolName.trim() || schoolSettings.schoolName,
      academicYear: academicYear.trim() || schoolSettings.academicYear,
      semester,
      currentWeek: typeof weekNumber === 'number' ? weekNumber : schoolSettings.currentWeek,
    }),
    [schoolSettings, schoolName, academicYear, semester, weekNumber]
  );

  const effectiveYearInfo = useMemo(
    () => getAcademicYearPeriod(effectiveSettings.academicYear),
    [effectiveSettings.academicYear]
  );

  const handleExportWord = async () => {
    setExportingWord(true);
    try {
      await exportPatrolWordDocx({
        schoolSettings: effectiveSettings,
        weekNumber,
        startDate,
        endDate,
        rows: reportRows,
        incidents: filteredIncidents,
        includeIncidentsAppendix,
      });
      onActionFeedback('已產生並下載正式 Word 巡堂紀錄表（.docx）');
    } catch (err) {
      onActionFeedback(
        `Word 匯出失敗：${err instanceof Error ? err.message : '請稍後再試'}`
      );
    } finally {
      setExportingWord(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      await exportPatrolExcelWorkbook({
        schoolSettings: effectiveSettings,
        startDate,
        endDate,
        patrolLogs: filteredLogs,
        incidents: filteredIncidents,
      });
      onActionFeedback('已匯出巡堂紀錄 Excel 報表（.xlsx）');
    } catch (err) {
      onActionFeedback(
        `Excel 匯出失敗：${err instanceof Error ? err.message : '請稍後再試'}`
      );
    }
  };

  const handleExportTimetableWord = async () => {
    setExportingClassWord(true);
    try {
      const targetNames =
        selectedTimetableClasses.length > 0 ? selectedTimetableClasses : undefined;
      const count = await exportClassTimetablesWordDocx({
        schoolSettings: effectiveSettings,
        timetables,
        selectedClassNames: targetNames,
      });
      onActionFeedback(
        count === 1
          ? `已下載「${activeTimetableGroups[0]?.className}」日課表 Word（.docx）`
          : `已下載 ${count} 個班級日課表 Word（.docx，每班一頁）`
      );
    } catch (err) {
      onActionFeedback(
        `課表 Word 匯出失敗：${err instanceof Error ? err.message : '請稍後再試'}`
      );
    } finally {
      setExportingClassWord(false);
    }
  };

  const handlePrintTimetablePdf = () => {
    try {
      const targetNames =
        selectedTimetableClasses.length > 0 ? selectedTimetableClasses : undefined;
      const count = printClassTimetablesPdf({
        schoolSettings: effectiveSettings,
        timetables,
        selectedClassNames: targetNames,
      });
      onActionFeedback(
        count === 1
          ? `已開啟「${activeTimetableGroups[0]?.className}」日課表 PDF 列印視窗`
          : `已開啟 ${count} 個班級日課表 PDF 列印視窗（每班一頁）`
      );
    } catch (err) {
      onActionFeedback(
        `課表 PDF 列印失敗：${err instanceof Error ? err.message : '請稍後再試'}`
      );
    }
  };

  const toggleClassSelection = (className: string) => {
    setSelectedTimetableClasses((prev) =>
      prev.includes(className) ? prev.filter((c) => c !== className) : [...prev, className]
    );
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const weekDisplayText =
    weekNumber !== '' && Number(weekNumber) > 0 ? ` ${weekNumber} ` : ' ______ ';

  const glyph = (list: PatrolCheckItem[], key: PatrolCheckItem) =>
    list.includes(key) ? '☑' : '☐';

  return (
    <div className="space-y-6">
      {/* Report Type Switcher (Hidden when printing) */}
      <div className="no-print inline-flex items-center gap-1 p-1 bg-[#EAE6DC] rounded-xl">
        <button
          type="button"
          onClick={() => setReportTab('patrol_record')}
          className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
            reportTab === 'patrol_record'
              ? 'bg-[#1E5C4B] text-white shadow-xs'
              : 'text-[#5C615C] hover:text-[#1F2421]'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          巡堂紀錄報表
        </button>
        <button
          type="button"
          onClick={() => setReportTab('class_timetable')}
          className={`min-h-[38px] px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
            reportTab === 'class_timetable'
              ? 'bg-[#1E5C4B] text-white shadow-xs'
              : 'text-[#5C615C] hover:text-[#1F2421]'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          各班級日課表（Word / PDF）
        </button>
      </div>

      {reportTab === 'class_timetable' ? (
        <div className="space-y-6">
          <div className="no-print bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-[#1F2421]">
                  各班級日課表匯出（Word / PDF）
                </h2>
                <p className="text-xs text-[#7C7A72] mt-0.5">
                  {effectiveSettings.schoolName} · {effectiveYearInfo.fullLabel} · 每班自動獨立分頁排版，可直接張貼教室門口或留存教務處
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={exportingClassWord || activeTimetableGroups.length === 0}
                  onClick={handleExportTimetableWord}
                  className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <FileDown className="w-4 h-4" />
                  {exportingClassWord
                    ? '產生 Word 中...'
                    : `下載 Word（${activeTimetableGroups.length} 班）`}
                </button>
                <button
                  type="button"
                  disabled={activeTimetableGroups.length === 0}
                  onClick={handlePrintTimetablePdf}
                  className="min-h-[42px] px-4 py-2 bg-[#1F2421] hover:bg-[#313834] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  列印／另存 PDF（{activeTimetableGroups.length} 班）
                </button>
              </div>
            </div>

            {allClassGroups.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#7C7A72] border border-dashed border-[#DDD8CD] rounded-xl">
                尚未建立班級課表資料，請先至「班級課表」匯入或新增課表。
              </div>
            ) : (
              <div className="space-y-2.5 pt-3 border-t border-[#F0ECE3]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#3A3F3B]">
                    選擇要匯出的班級（未勾選時預設匯出全校 {allClassGroups.length} 個班級）：
                  </span>
                  {selectedTimetableClasses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedTimetableClasses([])}
                      className="text-[#1E5C4B] font-semibold hover:underline cursor-pointer"
                    >
                      重設為全校所有班級
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {allClassGroups.map((group) => {
                    const checked = selectedTimetableClasses.includes(group.className);
                    return (
                      <button
                        key={group.className}
                        type="button"
                        onClick={() => toggleClassSelection(group.className)}
                        className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold border inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                          checked
                            ? 'bg-[#E5F2EE] border-[#1E5C4B] text-[#1E5C4B]'
                            : 'bg-[#FAF9F5] border-[#E5E1D8] text-[#3A3F3B] hover:bg-[#F2EFE9]'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                        <span>{group.className}</span>
                        <span className="font-mono-num opacity-70">({group.slots.length}節)</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Live Preview of Selected Class Timetables */}
          {activeTimetableGroups.length > 0 && (
            <div className="space-y-6">
              {activeTimetableGroups.map((group) => {
                const slotMap = new Map<string, TimetableSlot[]>();
                group.slots.forEach((s) => {
                  const key = `${s.dayOfWeek}-${s.period}`;
                  const list = slotMap.get(key) || [];
                  list.push(s);
                  slotMap.set(key, list);
                });

                return (
                  <article
                    key={group.className}
                    className="bg-white border border-[#E5E1D8] rounded-2xl p-5 sm:p-7 space-y-4"
                  >
                    <div className="text-center space-y-1">
                      <h3 className="text-lg font-bold text-[#1F2421]">
                        {effectiveSettings.schoolName} {effectiveYearInfo.academicYear} 學年度{' '}
                        {group.className} 日課表
                      </h3>
                      <p className="text-xs text-[#5C615C] font-mono-num">
                        學年度期間：{effectiveYearInfo.rangeText} ｜ 教室：{group.building}{' '}
                        {group.floor} {group.roomNumber} ｜ 排課總計：{group.slots.length} 節
                      </p>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] border-collapse border border-black text-xs text-center">
                        <thead>
                          <tr className="bg-[#E8F1EE]">
                            <th className="border border-black py-2 px-2 w-[16%] font-bold">
                              節次／時間
                            </th>
                            {['星期一', '星期二', '星期三', '星期四', '星期五'].map((label) => (
                              <th key={label} className="border border-black py-2 px-2 font-bold">
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {PERIOD_SCHEDULE.filter((p) => p.period <= group.maxPeriod).map((p) => (
                            <tr key={p.period}>
                              <th className="border border-black py-2 px-2 bg-[#FAF9F5] font-semibold">
                                <div>{p.label}</div>
                                <div className="text-[10px] font-mono-num font-normal text-[#5C615C]">
                                  {p.start}–{p.end}
                                </div>
                              </th>
                              {[1, 2, 3, 4, 5].map((dow) => {
                                const items = slotMap.get(`${dow}-${p.period}`) || [];
                                return (
                                  <td
                                    key={dow}
                                    className="border border-black py-2 px-1.5 align-middle"
                                  >
                                    {items.length === 0 ? (
                                      <span className="text-[#9A968C]">—</span>
                                    ) : (
                                      <div className="space-y-1">
                                        {items.map((slot) => (
                                          <div key={slot.id}>
                                            <div className="font-bold text-[#1F2421]">
                                              {slot.subject}
                                            </div>
                                            <div className="text-[11px] text-[#5C615C]">
                                              {slot.teacherName}
                                            </div>
                                            {slot.isRelocated && slot.locationNote && (
                                              <div className="text-[10px] text-[#245A84]">
                                                ({slot.locationNote})
                                              </div>
                                            )}
                                          </div>
                                        ))}
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
                  </article>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* Export Control Bar (Hidden when printing PDF) */}
      <div className="no-print bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#1F2421]">巡堂紀錄表匯出中心（Word / PDF）</h2>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              依學校正式巡堂紀錄表格式自動套印各班級檢核勾選與核章欄，支援下載 Microsoft Word（.docx）與 A4 列印／另存 PDF
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportWord}
              disabled={exportingWord}
              className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <FileDown className="w-4 h-4" />
              {exportingWord ? '產生 Word 中...' : '下載 Word (.docx)'}
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="min-h-[42px] px-4 py-2 bg-[#1F2421] hover:bg-[#313834] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Printer className="w-4 h-4" />
              列印／另存 PDF
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="min-h-[42px] px-3.5 py-2 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs sm:text-sm font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              匯出 Excel
            </button>
          </div>
        </div>

        {/* Report Metadata & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-3 border-t border-[#F0ECE3] text-xs">
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">學校名稱</label>
            <input
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="font-semibold text-[#5C615C] block mb-1">學年度</label>
              <input
                type="text"
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full min-h-[38px] px-2.5 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] font-mono-num focus:outline-none focus:border-[#1E5C4B]"
              />
            </div>
            <div>
              <label className="font-semibold text-[#5C615C] block mb-1">週次</label>
              <input
                type="number"
                min={1}
                max={25}
                value={weekNumber}
                placeholder="空白"
                onChange={(e) =>
                  setWeekNumber(
                    e.target.value === ''
                      ? ''
                      : Math.max(1, Math.min(25, Number(e.target.value) || 1))
                  )
                }
                className="w-full min-h-[38px] px-2.5 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] font-mono-num focus:outline-none focus:border-[#1E5C4B]"
              />
            </div>
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">學期</label>
            <select
              value={semester}
              onChange={(e) => setSemester(e.target.value as SemesterType)}
              className="w-full min-h-[38px] px-2.5 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] focus:outline-none focus:border-[#1E5C4B]"
            >
              <option value="第一學期">第一學期</option>
              <option value="第二學期">第二學期</option>
            </select>
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">起始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] font-mono-num focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">結束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full min-h-[38px] px-2.5 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] font-mono-num focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">樓棟範圍</label>
            <select
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              className="w-full min-h-[38px] px-2.5 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] focus:outline-none focus:border-[#1E5C4B]"
            >
              {buildings.map((b) => (
                <option key={b} value={b}>
                  {b === 'ALL' ? '全校所有樓棟' : b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#F0ECE3] text-xs">
          <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl">
            <button
              type="button"
              onClick={() => setReportMode('weekly_standard')}
              className={`min-h-[34px] px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                reportMode === 'weekly_standard'
                  ? 'bg-[#1E5C4B] text-white shadow-xs'
                  : 'text-[#5C615C] hover:text-[#1F2421]'
              }`}
            >
              標準各年級巡堂表（含空列）
            </button>
            <button
              type="button"
              onClick={() => setReportMode('logged_only')}
              className={`min-h-[34px] px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                reportMode === 'logged_only'
                  ? 'bg-[#1E5C4B] text-white shadow-xs'
                  : 'text-[#5C615C] hover:text-[#1F2421]'
              }`}
            >
              僅列出已巡堂紀錄（{filteredLogs.length} 筆）
            </button>
          </div>

          <label className="inline-flex items-center gap-2 text-[#3A3F3B] cursor-pointer">
            <input
              type="checkbox"
              checked={includeIncidentsAppendix}
              onChange={(e) => setIncludeIncidentsAppendix(e.target.checked)}
              className="w-4 h-4 accent-[#1E5C4B]"
            />
            <span>附加異常事件通報清冊（區間內 {filteredIncidents.length} 件）</span>
          </label>
        </div>
      </div>

      {/* Live Formal A4 Printable School Patrol Form (Matches Official Word Template) */}
      <article className="print-surface bg-white border border-[#E5E1D8] rounded-2xl p-5 sm:p-10 max-w-4xl mx-auto">
        <div className="font-serif text-black space-y-4">
          {/* Official Centered Title */}
          <h1 className="text-center text-xl sm:text-2xl font-bold tracking-wider text-black">
            {effectiveSettings.schoolName} {effectiveSettings.academicYear} 學年度
            {effectiveSettings.semester}第{weekDisplayText}週 巡堂紀錄表
          </h1>

          {/* Official Formal Black-Bordered Table */}
          {reportRows.length === 0 ? (
            <div className="border border-black p-10 text-center text-sm text-neutral-600">
              所選日期區間（{startDate} 至 {endDate}）尚無已登錄之巡堂紀錄，可切換為「標準各年級巡堂表」列印空白表單。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-black text-[13px] leading-snug text-black">
                <thead>
                  <tr>
                    <th className="border border-black py-1.5 px-2 text-center font-bold w-[13%]">
                      班別
                    </th>
                    <th className="border border-black py-1.5 px-2 text-center font-bold w-[17%]">
                      授課教師姓名
                    </th>
                    <th className="border border-black py-1.5 px-2 text-center font-bold w-[14%]">
                      授課領域
                    </th>
                    <th
                      rowSpan={2}
                      className="border border-black py-1.5 px-3 text-center font-bold w-[56%]"
                    >
                      巡堂結果紀錄
                    </th>
                  </tr>
                  <tr>
                    <th className="border border-black py-1.5 px-2 text-center font-bold">日期</th>
                    <th className="border border-black py-1.5 px-2 text-center font-bold">星期</th>
                    <th className="border border-black py-1.5 px-2 text-center font-bold">節次</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => {
                    const hasNote = row.note.trim().length > 0;
                    return (
                      <React.Fragment key={row.key}>
                        {/* Row A: Class / Teacher / Subject / 8 Checkboxes */}
                        <tr>
                          <td className="border border-black py-2 px-1.5 text-center font-bold align-middle">
                            <div>{row.classLabel}</div>
                            {row.subClassLabel && (
                              <div className="text-xs font-normal mt-0.5">
                                （{row.subClassLabel}）
                              </div>
                            )}
                          </td>
                          <td className="border border-black py-2 px-1.5 text-center align-middle">
                            {row.teacherName}
                          </td>
                          <td className="border border-black py-2 px-1.5 text-center align-middle">
                            {row.subject}
                          </td>
                          <td className="border border-black py-2 px-3 align-middle">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                              <span>{glyph(row.checklist, 'class_normal')}上課大致正常</span>
                              <span>{glyph(row.checklist, 'proper_equipment')}妥善運用教學設備</span>
                              <span>{glyph(row.checklist, 'student_focused')}學生專注上課</span>
                              <span>{glyph(row.checklist, 'good_interaction')}師生互動良好</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 mt-1.5 pt-1.5 border-t border-black/30">
                              <span>{glyph(row.checklist, 'teacher_late')}教師未準時上課</span>
                              <span>{glyph(row.checklist, 'poor_order')}班級秩序欠佳</span>
                              <span>{glyph(row.checklist, 'poor_learning')}學生學習狀況差</span>
                              <span>
                                {glyph(row.checklist, 'off_schedule_no_change')}未按課表上課且無調課
                              </span>
                            </div>
                          </td>
                        </tr>
                        {/* Row B: Date / Weekday / Period / 其他 */}
                        <tr>
                          <td className="border border-black py-1.5 px-1.5 text-center font-mono-num align-middle h-9">
                            {row.dateDisplay}
                          </td>
                          <td className="border border-black py-1.5 px-1.5 text-center align-middle">
                            {row.weekdayDisplay}
                          </td>
                          <td className="border border-black py-1.5 px-1.5 text-center font-mono-num align-middle">
                            {row.periodDisplay}
                          </td>
                          <td className="border border-black py-1.5 px-3 align-middle">
                            <span>{hasNote ? '☑' : '☐'} 其他：</span>
                            {hasNote && <span className="ml-1">{row.note}</span>}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Official Signature Line (Matches Screenshots 2 & 3) */}
          <footer className="pt-4 grid grid-cols-3 gap-4 text-sm sm:text-base font-bold text-black">
            <div>巡堂人員：</div>
            <div>教務主任：</div>
            <div>校長：</div>
          </footer>

          {/* Optional Incident Appendix in Print/PDF */}
          {includeIncidentsAppendix && filteredIncidents.length > 0 && (
            <section className="pt-8 mt-6 border-t border-black/40 space-y-3">
              <h2 className="text-center text-lg font-bold text-black">
                附錄：{effectiveSettings.schoolName} 巡堂異常事件通報與處置清冊（{startDate} 至{' '}
                {endDate}）
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse border border-black text-xs text-black">
                  <thead>
                    <tr>
                      <th className="border border-black py-1.5 px-2 text-center font-bold">
                        日期／節次
                      </th>
                      <th className="border border-black py-1.5 px-2 text-center font-bold">
                        等級／類別
                      </th>
                      <th className="border border-black py-1.5 px-2 text-center font-bold">
                        地點與班級
                      </th>
                      <th className="border border-black py-1.5 px-2 text-center font-bold">
                        事件標題與說明
                      </th>
                      <th className="border border-black py-1.5 px-2 text-center font-bold">
                        處理狀態與結案
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIncidents.map((inc) => (
                      <tr key={inc.id}>
                        <td className="border border-black py-1.5 px-2 text-center font-mono-num whitespace-nowrap">
                          {inc.date}
                          <br />第 {inc.period} 節
                        </td>
                        <td className="border border-black py-1.5 px-2 text-center whitespace-nowrap">
                          {INCIDENT_SEVERITY_LABELS[inc.severity]}
                          <br />
                          {INCIDENT_CATEGORY_LABELS[inc.category]}
                        </td>
                        <td className="border border-black py-1.5 px-2">{inc.location}</td>
                        <td className="border border-black py-1.5 px-2">
                          <div className="font-bold">{inc.title}</div>
                          <div>{inc.description}</div>
                        </td>
                        <td className="border border-black py-1.5 px-2">
                          <div className="font-bold">{INCIDENT_STATUS_LABELS[inc.status]}</div>
                          <div>
                            {inc.handlerName ? `${inc.handlerName}：` : ''}
                            {inc.resolutionNote || '尚未填寫結案說明'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </article>
      </>
      )}
    </div>
  );
};
