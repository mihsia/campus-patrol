import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AbsenceRecord,
  LeaveRecord,
  LeaveType,
  RiskLevel,
  StaffProfile,
  TimetableSlot,
} from '../types/patrol';
import {
  AUTO_ABSENCE_STATUS_LABELS,
  DAY_OF_WEEK_LABELS,
  LEAVE_TYPE_LABELS,
  OBSERVED_ABSENCE_LABELS,
  PERIOD_SCHEDULE,
  RISK_LEVEL_LABELS,
} from '../types/patrol';
import { buildStudentRiskSummaries } from '../lib/truancyEngine';
import {
  batchImportTimetableSlots,
  createIncidentReport,
  createLeaveRecord,
  createTimetableSlot,
  deleteAbsenceRecord,
  deleteLeaveRecord,
  deleteTimetableSlot,
  updateAbsenceVerification,
} from '../lib/firestoreOps';
import {
  downloadTimetableCsvTemplate,
  exportTimetableBackupCsv,
  parseTimetableCsv,
} from '../lib/exportReports';

interface TimetableTruancyViewProps {
  profile: StaffProfile;
  isAdmin: boolean;
  selectedDate: string;
  timetables: TimetableSlot[];
  absences: AbsenceRecord[];
  leaveRecords: LeaveRecord[];
  onSeedDemoData: () => Promise<void>;
  seeding: boolean;
  onActionFeedback: (message: string) => void;
}

type SubTab = 'truancy' | 'timetable' | 'leaves';

export const TimetableTruancyView: React.FC<TimetableTruancyViewProps> = ({
  profile,
  isAdmin,
  selectedDate,
  timetables,
  absences,
  leaveRecords,
  onSeedDemoData,
  seeding,
  onActionFeedback,
}) => {
  const [subTab, setSubTab] = useState<SubTab>('truancy');
  const [searchQuery, setSearchQuery] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all');
  const [dayFilter, setDayFilter] = useState<number>(0); // 0 = all days
  const [showAddSlotModal, setShowAddSlotModal] = useState(false);
  const [showAddLeaveModal, setShowAddLeaveModal] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const { evaluatedAbsences, studentSummaries } = useMemo(
    () => buildStudentRiskSummaries(absences, leaveRecords, timetables),
    [absences, leaveRecords, timetables]
  );

  const filteredSummaries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return studentSummaries
      .filter((s) => riskFilter === 'all' || s.riskLevel === riskFilter)
      .filter((s) => {
        if (!q) return true;
        return (
          s.className.toLowerCase().includes(q) ||
          s.studentName.toLowerCase().includes(q) ||
          s.seatNumber.toLowerCase().includes(q) ||
          s.affectedSubjects.some((sub) => sub.toLowerCase().includes(q))
        );
      });
  }, [studentSummaries, riskFilter, searchQuery]);

  const filteredAbsences = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return evaluatedAbsences
      .filter((a) => riskFilter === 'all' || a.liveEval.riskLevel === riskFilter)
      .filter((a) => {
        if (!q) return true;
        return (
          a.className.toLowerCase().includes(q) ||
          a.studentName.toLowerCase().includes(q) ||
          a.subject.toLowerCase().includes(q) ||
          a.teacherName.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.period - b.period);
  }, [evaluatedAbsences, riskFilter, searchQuery]);

  const filteredTimetables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return timetables
      .filter((t) => dayFilter === 0 || t.dayOfWeek === dayFilter)
      .filter((t) => {
        if (!q) return true;
        return (
          t.className.toLowerCase().includes(q) ||
          t.roomNumber.toLowerCase().includes(q) ||
          t.subject.toLowerCase().includes(q) ||
          t.teacherName.toLowerCase().includes(q) ||
          t.building.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.period - b.period || a.roomNumber.localeCompare(b.roomNumber));
  }, [timetables, dayFilter, searchQuery]);

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingCsv(true);
    try {
      const text = await file.text();
      const { rows, errors } = parseTimetableCsv(text);
      if (rows.length === 0) {
        onActionFeedback(`課表匯入失敗：${errors[0] || '未解析到有效資料'}`);
        return;
      }
      const count = await batchImportTimetableSlots(profile.uid, rows);
      const errSuffix = errors.length > 0 ? `（略過 ${errors.length} 列格式錯誤）` : '';
      onActionFeedback(`成功匯入 ${count} 筆學校課表資料至資料庫${errSuffix}`);
    } finally {
      setImportingCsv(false);
      if (csvInputRef.current) csvInputRef.current.value = '';
    }
  };

  const handleEscalateStudent = async (summary: (typeof studentSummaries)[number]) => {
    await createIncidentReport({
      reporterId: profile.uid,
      reporterName: profile.displayName,
      date: summary.latestDate || selectedDate,
      period: summary.affectedPeriods[summary.affectedPeriods.length - 1] || 1,
      timetableId: summary.latestTimetableId || '',
      location: `${summary.className}（座號 ${summary.seatNumber}）`,
      className: summary.className,
      category: 'student_truancy',
      severity: summary.riskLevel === 'high' ? 'high' : 'medium',
      title: `缺曠預警轉通報：${summary.className} ${summary.seatNumber}號 ${summary.studentName}`,
      description: `自動缺曠判別引擎偵測該生疑似曠課 ${summary.truantCount} 節（最高連續 ${summary.maxConsecutiveTruant} 節），涉及科目：${summary.affectedSubjects.join('、')}。建議處置：${summary.recommendedAction}`,
    });
    onActionFeedback(`已將 ${summary.className} ${summary.studentName} 的缺曠預警轉發至異常通報中心`);
  };

  const handleToggleVerifyAbsence = async (item: (typeof evaluatedAbsences)[number]) => {
    await updateAbsenceVerification(item.id, {
      autoStatus: item.liveEval.autoStatus,
      riskLevel: item.liveEval.riskLevel,
      verified: !item.verified,
      note: item.liveEval.rationale,
    });
    onActionFeedback(item.verified ? '已取消覆核標記' : `已覆核 ${item.studentName} 第 ${item.period} 節出缺勤狀態`);
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation + Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              ['truancy', '自動缺曠判別與查詢', ShieldAlert],
              ['timetable', `學校課表資料庫（${timetables.length}）`, BookOpen],
              ['leaves', `核准假單核銷（${leaveRecords.length}）`, CalendarCheck],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                subTab === id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋班級、學生、科目或教師..."
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
          />
        </div>
      </div>

      {/* SUB-TAB 1: Automated Truancy Detection & Lookup */}
      {subTab === 'truancy' && (
        <div className="space-y-6">
          {/* Algorithm Pipeline Overview */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  自動化缺曠課判別演算法引擎
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  即時整合巡堂點名紀錄、全校課表時間軸與學務處核准假單，自動完成四階段判別與風險分級
                </p>
              </div>
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
                {(
                  [
                    ['all', '全部風險'],
                    ['high', '高風險通報'],
                    ['medium', '中度預警'],
                    ['low', '一般關注'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setRiskFilter(k)}
                    className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                      riskFilter === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 text-xs">
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">01. 課表時間軸自動對齊</p>
                <p className="text-slate-500 leading-relaxed">
                  依日期、節次與教室自動匹配任課科目、教師與移地教學標記，避免戶外課誤判。
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">02. 核准假單自動核銷</p>
                <p className="text-slate-500 leading-relaxed">
                  比對病假、事假、公假與喪單節次，符合者自動歸類「已核假」不計入曠課。
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">03. 跨節次連續曠課計算</p>
                <p className="text-slate-500 leading-relaxed">
                  彙整同日各節次未核假紀錄，自動辨識連續 2 節中度預警與連續 3 節高風險。
                </p>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">04. 風險升級與通報連動</p>
                <p className="text-slate-500 leading-relaxed">
                  擅離教室或連續 3 節以上曠課自動觸發異常通報，即時推播至生教組與管理員。
                </p>
              </div>
            </div>
          </div>

          {/* Student Cumulative Risk Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                學生個別缺曠風險彙整（共 <span className="font-mono-num">{filteredSummaries.length}</span> 人）
              </h3>
            </div>
            {filteredSummaries.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                目前無符合條件的學生缺曠風險紀錄
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">班級／學生</th>
                      <th className="py-3 px-4">風險分級</th>
                      <th className="py-3 px-4 text-right">疑似曠課</th>
                      <th className="py-3 px-4 text-right">最高連續</th>
                      <th className="py-3 px-4 text-right">遲到／核假</th>
                      <th className="py-3 px-4">涉及節次與科目</th>
                      <th className="py-3 px-4">系統建議處置</th>
                      <th className="py-3 px-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                    {filteredSummaries.map((s) => (
                      <tr key={s.key} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {s.className} · {s.seatNumber}號 {s.studentName}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-semibold inline-flex items-center gap-1 ${
                              s.riskLevel === 'high'
                                ? 'text-red-700'
                                : s.riskLevel === 'medium'
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {s.riskLevel === 'high' && <AlertTriangle className="w-3.5 h-3.5" />}
                            {RISK_LEVEL_LABELS[s.riskLevel]}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num font-semibold text-red-700">
                          {s.truantCount} 節
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num text-slate-700">
                          {s.maxConsecutiveTruant} 節
                        </td>
                        <td className="py-3 px-4 text-right font-mono-num text-slate-600">
                          遲 {s.lateCount} / 假 {s.excusedCount}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-[200px]">
                          <div className="truncate">
                            第 {s.affectedPeriods.join('、')} 節 · {s.affectedSubjects.join('、')}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-[220px]">
                          {s.recommendedAction}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {s.truantCount > 0 && (
                            <button
                              type="button"
                              onClick={() => handleEscalateStudent(s)}
                              className="min-h-[34px] px-3 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg cursor-pointer"
                            >
                              轉發通報
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Individual Absence Records with Live Algorithm Verdict */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                逐節缺曠判別明細（共 <span className="font-mono-num">{filteredAbsences.length}</span> 筆）
              </h3>
            </div>
            {filteredAbsences.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                尚無缺曠明細資料
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">日期／節次</th>
                      <th className="py-3 px-4">班級／學生</th>
                      <th className="py-3 px-4">課表科目／教師</th>
                      <th className="py-3 px-4">現場觀察</th>
                      <th className="py-3 px-4">自動判別結果</th>
                      <th className="py-3 px-4">演算法判別依據</th>
                      <th className="py-3 px-4 text-right">覆核／操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                    {filteredAbsences.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono-num whitespace-nowrap text-slate-700">
                          {item.date} · 第{item.period}節
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-900">
                          {item.className} · {item.seatNumber}號 {item.studentName}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-600">
                          {item.subject} / {item.teacherName}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-700">
                          {OBSERVED_ABSENCE_LABELS[item.observedType]}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`text-xs font-semibold ${
                              item.liveEval.autoStatus === 'excused_leave'
                                ? 'text-blue-700'
                                : item.liveEval.autoStatus === 'truant'
                                  ? 'text-red-700'
                                  : 'text-amber-700'
                            }`}
                          >
                            {AUTO_ABSENCE_STATUS_LABELS[item.liveEval.autoStatus]}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 max-w-[260px]">
                          {item.liveEval.rationale}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleVerifyAbsence(item)}
                              className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-lg border cursor-pointer inline-flex items-center gap-1 ${
                                item.verified
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {item.verified ? '已覆核' : '確認覆核'}
                            </button>
                            {(isAdmin || item.recordedBy === profile.uid) && (
                              <button
                                type="button"
                                onClick={async () => {
                                  await deleteAbsenceRecord(item.id);
                                  onActionFeedback('已刪除該筆缺曠紀錄');
                                }}
                                aria-label="刪除缺曠紀錄"
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400 hover:text-red-700 cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: School Timetable Database */}
      {subTab === 'timetable' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">學校課表資料庫整合管理</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  支援 CSV 批次匯入現有校務課表、手動維護教室移地資訊與班級點名名單
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCsvUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={importingCsv}
                  className="min-h-[40px] px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  {importingCsv ? '匯入解析中...' : '上傳學校 CSV 課表'}
                </button>
                <button
                  type="button"
                  onClick={downloadTimetableCsvTemplate}
                  className="min-h-[40px] px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  下載匯入範本
                </button>
                {timetables.length > 0 && (
                  <button
                    type="button"
                    onClick={() => exportTimetableBackupCsv(timetables)}
                    className="min-h-[40px] px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs font-medium rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    備份課表 CSV
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddSlotModal(true)}
                  className="min-h-[40px] px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  新增單節課表
                </button>
                {timetables.length === 0 && (
                  <button
                    type="button"
                    onClick={onSeedDemoData}
                    disabled={seeding}
                    className="min-h-[40px] px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Database className="w-4 h-4" />
                    {seeding ? '建立中...' : '載入範例課表'}
                  </button>
                )}
              </div>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
              {[0, 1, 2, 3, 4, 5].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayFilter(d)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                    dayFilter === d ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  {d === 0 ? '全部星期' : DAY_OF_WEEK_LABELS[d]}
                </button>
              ))}
            </div>
          </div>

          {filteredTimetables.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              目前尚無符合條件的課表排課資料
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">星期／節次</th>
                    <th className="py-3 px-4">樓棟／教室</th>
                    <th className="py-3 px-4">班級（年級）</th>
                    <th className="py-3 px-4">科目</th>
                    <th className="py-3 px-4">任課教師</th>
                    <th className="py-3 px-4 text-right">應到人數</th>
                    <th className="py-3 px-4">移地教學</th>
                    <th className="py-3 px-4 text-right">管理</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                  {filteredTimetables.slice(0, 80).map((slot) => (
                    <tr key={slot.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-4 font-mono-num whitespace-nowrap text-slate-700">
                        {DAY_OF_WEEK_LABELS[slot.dayOfWeek]} · 第{slot.period}節
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-slate-700">
                        {slot.building} {slot.floor} · <span className="font-mono-num font-medium">{slot.roomNumber}</span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap font-semibold text-slate-900">
                        {slot.className}
                        <span className="text-xs font-normal text-slate-500 ml-1.5">{slot.grade}</span>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-slate-800">{slot.subject}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-slate-700">{slot.teacherName}</td>
                      <td className="py-2.5 px-4 text-right font-mono-num text-slate-700">
                        {slot.expectedCount} 人
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">
                        {slot.isRelocated ? (
                          <span className="text-blue-700 font-medium">{slot.locationNote || '移地教學'}</span>
                        ) : (
                          '原班教室'
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {(isAdmin || slot.createdBy === profile.uid) && (
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteTimetableSlot(slot.id);
                              onActionFeedback(`已刪除 ${slot.className} 第 ${slot.period} 節課表`);
                            }}
                            aria-label="刪除課表"
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-400 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredTimetables.length > 80 && (
                <div className="px-4 py-3 text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
                  顯示前 80 筆（共 {filteredTimetables.length} 筆），請使用星期篩選或關鍵字精準搜尋。
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: Approved Leave Records */}
      {subTab === 'leaves' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">核准假單資料庫（自動核銷比對來源）</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                登錄學生核准假單後，自動缺曠判別演算法將即時核銷對應節次之缺席紀錄，不再誤判曠課
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddLeaveModal(true)}
              className="min-h-[40px] px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              登錄核准假單
            </button>
          </div>

          {leaveRecords.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              尚未登錄任何學生核准假單
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">請假日期</th>
                    <th className="py-3 px-4">班級／學生</th>
                    <th className="py-3 px-4">假別</th>
                    <th className="py-3 px-4">核准節次</th>
                    <th className="py-3 px-4">事由</th>
                    <th className="py-3 px-4">核准單位／人員</th>
                    <th className="py-3 px-4 text-right">管理</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                  {leaveRecords.map((lr) => (
                    <tr key={lr.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-mono-num whitespace-nowrap text-slate-700">{lr.date}</td>
                      <td className="py-3 px-4 whitespace-nowrap font-semibold text-slate-900">
                        {lr.className} · {lr.seatNumber}號 {lr.studentName}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-blue-700 font-semibold">
                        {LEAVE_TYPE_LABELS[lr.leaveType]}
                      </td>
                      <td className="py-3 px-4 font-mono-num text-slate-700">
                        第 {lr.periods.join('、')} 節
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 max-w-[240px]">{lr.reason || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">{lr.approvedBy}</td>
                      <td className="py-3 px-4 text-right">
                        {(isAdmin || lr.createdBy === profile.uid) && (
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteLeaveRecord(lr.id);
                              onActionFeedback('已移除該筆假單，系統將重新計算相關缺曠狀態');
                            }}
                            aria-label="刪除假單"
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-400 hover:text-red-700 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add Timetable Slot Modal */}
      {showAddSlotModal && (
        <AddTimetableModal
          uid={profile.uid}
          onClose={() => setShowAddSlotModal(false)}
          onCreated={() => {
            setShowAddSlotModal(false);
            onActionFeedback('已新增課表節次並即時同步至巡堂名單');
          }}
        />
      )}

      {/* Add Approved Leave Modal */}
      {showAddLeaveModal && (
        <AddLeaveModal
          uid={profile.uid}
          defaultDate={selectedDate}
          approvedByDefault={profile.displayName}
          onClose={() => setShowAddLeaveModal(false)}
          onCreated={() => {
            setShowAddLeaveModal(false);
            onActionFeedback('已登錄核准假單，自動缺曠演算法已即時重新核銷');
          }}
        />
      )}
    </div>
  );
};

const AddTimetableModal: React.FC<{
  uid: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ uid, onClose, onCreated }) => {
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [period, setPeriod] = useState(1);
  const [building, setBuilding] = useState('教學A棟');
  const [floor, setFloor] = useState('2F');
  const [roomNumber, setRoomNumber] = useState('A203');
  const [className, setClassName] = useState('高一愛');
  const [grade, setGrade] = useState('高一');
  const [subject, setSubject] = useState('英文');
  const [teacherName, setTeacherName] = useState('');
  const [expectedCount, setExpectedCount] = useState(32);
  const [isRelocated, setIsRelocated] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const [rosterInput, setRosterInput] = useState('01 王小明、02 陳怡君、03 林宇軒');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!className.trim() || !subject.trim() || !teacherName.trim()) return;
    setSaving(true);
    try {
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
        expectedCount,
        isRelocated,
        locationNote,
        roster: rosterInput.split(/[、,;|]/).map((s) => s.trim()).filter(Boolean),
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">新增學校課表節次</h3>
          <button type="button" onClick={onClose} className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">星期</label>
              <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg">
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>{DAY_OF_WEEK_LABELS[d]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">節次</label>
              <select value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg">
                {PERIOD_SCHEDULE.map((p) => (
                  <option key={p.period} value={p.period}>{p.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">樓棟</label>
              <input required value={building} onChange={(e) => setBuilding(e.target.value)} maxLength={40} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">樓層</label>
              <input required value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={20} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">教室編號</label>
              <input required value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} maxLength={20} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">班級</label>
              <input required value={className} onChange={(e) => setClassName(e.target.value)} maxLength={30} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">年級</label>
              <input required value={grade} onChange={(e) => setGrade(e.target.value)} maxLength={20} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">應到人數</label>
              <input type="number" min={1} max={120} required value={expectedCount} onChange={(e) => setExpectedCount(Number(e.target.value) || 30)} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg font-mono-num" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">科目名稱</label>
              <input required value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={50} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">任課教師</label>
              <input required value={teacherName} onChange={(e) => setTeacherName(e.target.value)} maxLength={40} placeholder="例如：陳美華" className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
            <input type="checkbox" checked={isRelocated} onChange={(e) => setIsRelocated(e.target.checked)} className="w-4 h-4 accent-teal-700" />
            <span>本節為移地教學／戶外或實驗室課程</span>
          </label>
          {isRelocated && (
            <input
              value={locationNote}
              onChange={(e) => setLocationNote(e.target.value)}
              maxLength={100}
              placeholder="輸入實際上課地點，例如：科學館3F物理實驗室"
              className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg text-xs"
            />
          )}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">班級快選名單（頓號分隔，最多 60 人）</label>
            <textarea
              rows={2}
              value={rosterInput}
              onChange={(e) => setRosterInput(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="min-h-[42px] px-4 text-slate-600 cursor-pointer">取消</button>
            <button type="submit" disabled={saving} className="min-h-[42px] px-5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg cursor-pointer">
              {saving ? '儲存中...' : '確認新增'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const AddLeaveModal: React.FC<{
  uid: string;
  defaultDate: string;
  approvedByDefault: string;
  onClose: () => void;
  onCreated: () => void;
}> = ({ uid, defaultDate, approvedByDefault, onClose, onCreated }) => {
  const [date, setDate] = useState(defaultDate);
  const [className, setClassName] = useState('高一忠');
  const [seatNumber, setSeatNumber] = useState('03');
  const [studentName, setStudentName] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('sick');
  const [periods, setPeriods] = useState<number[]>([1, 2, 3]);
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState(approvedByDefault);
  const [saving, setSaving] = useState(false);

  const togglePeriod = (p: number) => {
    setPeriods((prev) =>
      prev.includes(p)
        ? prev.length > 1
          ? prev.filter((x) => x !== p)
          : prev
        : [...prev, p].sort((a, b) => a - b)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim()) return;
    setSaving(true);
    try {
      await createLeaveRecord(uid, {
        date,
        className,
        seatNumber,
        studentName,
        leaveType,
        periods,
        reason,
        approvedBy,
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">登錄學生核准假單</h3>
          <button type="button" onClick={onClose} className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">請假日期</label>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg font-mono-num" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">假別</label>
              <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg">
                {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">班級</label>
              <input required value={className} onChange={(e) => setClassName(e.target.value)} maxLength={30} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">座號</label>
              <input required value={seatNumber} onChange={(e) => setSeatNumber(e.target.value)} maxLength={10} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg font-mono-num" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">學生姓名</label>
              <input required value={studentName} onChange={(e) => setStudentName(e.target.value)} maxLength={40} placeholder="例如：林宇軒" className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">核准請假節次（可複選）</label>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePeriod(p)}
                  className={`min-h-[38px] px-3 py-1 rounded-lg text-xs font-mono-num font-medium border cursor-pointer ${
                    periods.includes(p)
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  第{p}節
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">請假事由</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="如：感冒就醫、公假出賽" className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">核准單位／人員</label>
              <input required value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} maxLength={60} className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="min-h-[42px] px-4 text-slate-600 cursor-pointer">取消</button>
            <button type="submit" disabled={saving} className="min-h-[42px] px-5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg cursor-pointer">
              {saving ? '儲存中...' : '儲存並自動核銷'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
