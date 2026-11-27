import React, { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import type {
  AbsenceRecord,
  IncidentReport,
  LeaveRecord,
  PatrolLog,
  TimetableSlot,
} from '../types/patrol';
import {
  AUTO_ABSENCE_STATUS_LABELS,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  PATROL_STATUS_LABELS,
  RISK_LEVEL_LABELS,
} from '../types/patrol';
import { buildStudentRiskSummaries } from '../lib/truancyEngine';
import { exportCsvWithBom, exportFullExcelWorkbook } from '../lib/exportReports';

interface ReportsViewProps {
  selectedDate: string;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  absences: AbsenceRecord[];
  leaveRecords: LeaveRecord[];
  incidents: IncidentReport[];
  onActionFeedback: (message: string) => void;
}

type ReportTemplate = 'comprehensive' | 'truancy' | 'incidents';

export const ReportsView: React.FC<ReportsViewProps> = ({
  selectedDate,
  timetables,
  patrolLogs,
  absences,
  leaveRecords,
  incidents,
  onActionFeedback,
}) => {
  const [schoolName, setSchoolName] = useState('國立範例高級中學');
  const [startDate, setStartDate] = useState(selectedDate);
  const [endDate, setEndDate] = useState(selectedDate);
  const [buildingFilter, setBuildingFilter] = useState('ALL');
  const [template, setTemplate] = useState<ReportTemplate>('comprehensive');

  const buildings = useMemo(() => {
    const s = new Set<string>();
    timetables.forEach((t) => s.add(t.building));
    return ['ALL', ...Array.from(s).sort()];
  }, [timetables]);

  const filteredLogs = useMemo(() => {
    return patrolLogs
      .filter((l) => l.date >= startDate && l.date <= endDate)
      .filter((l) => buildingFilter === 'ALL' || l.building === buildingFilter)
      .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period || a.roomNumber.localeCompare(b.roomNumber));
  }, [patrolLogs, startDate, endDate, buildingFilter]);

  const filteredAbsences = useMemo(() => {
    return absences.filter((a) => a.date >= startDate && a.date <= endDate);
  }, [absences, startDate, endDate]);

  const filteredIncidents = useMemo(() => {
    return incidents
      .filter((i) => i.date >= startDate && i.date <= endDate)
      .filter((i) => buildingFilter === 'ALL' || i.location.includes(buildingFilter));
  }, [incidents, startDate, endDate, buildingFilter]);

  const { evaluatedAbsences, studentSummaries } = useMemo(
    () => buildStudentRiskSummaries(filteredAbsences, leaveRecords, timetables),
    [filteredAbsences, leaveRecords, timetables]
  );

  const summaryStats = useMemo(() => {
    const totalPatrols = filteredLogs.length;
    const normalPatrols = filteredLogs.filter(
      (l) => l.status === 'normal' || l.status === 'empty_relocated'
    ).length;
    const normalRate = totalPatrols > 0 ? Math.round((normalPatrols / totalPatrols) * 1000) / 10 : 100;
    const truantCount = evaluatedAbsences.filter((a) => a.liveEval.autoStatus === 'truant').length;
    const excusedCount = evaluatedAbsences.filter((a) => a.liveEval.autoStatus === 'excused_leave').length;
    const resolvedIncidents = filteredIncidents.filter((i) => i.status === 'resolved').length;
    return {
      totalPatrols,
      normalRate,
      truantCount,
      excusedCount,
      incidentCount: filteredIncidents.length,
      resolvedIncidents,
    };
  }, [filteredLogs, evaluatedAbsences, filteredIncidents]);

  const handleExportExcel = () => {
    exportFullExcelWorkbook({
      schoolName,
      startDate,
      endDate,
      patrolLogs: filteredLogs,
      evaluatedAbsences,
      studentSummaries,
      incidents: filteredIncidents,
    });
    onActionFeedback('已匯出多工作表 Excel 報表（.xlsx）');
  };

  const handleExportCsv = () => {
    if (template === 'truancy') {
      exportCsvWithBom(
        `${schoolName}_缺曠自動判別報表_${startDate}_${endDate}.csv`,
        ['日期', '節次', '班級', '座號', '姓名', '科目', '任課教師', '自動判定', '風險等級', '依據'],
        evaluatedAbsences.map((a) => [
          a.date,
          `第${a.period}節`,
          a.className,
          a.seatNumber,
          a.studentName,
          a.subject,
          a.teacherName,
          AUTO_ABSENCE_STATUS_LABELS[a.liveEval.autoStatus],
          RISK_LEVEL_LABELS[a.liveEval.riskLevel],
          a.liveEval.rationale,
        ])
      );
    } else if (template === 'incidents') {
      exportCsvWithBom(
        `${schoolName}_異常事件通報報表_${startDate}_${endDate}.csv`,
        ['日期', '節次', '嚴重度', '類別', '地點', '標題', '狀態', '通報人', '承辦人', '結案說明'],
        filteredIncidents.map((i) => [
          i.date,
          `第${i.period}節`,
          INCIDENT_SEVERITY_LABELS[i.severity],
          INCIDENT_CATEGORY_LABELS[i.category],
          i.location,
          i.title,
          INCIDENT_STATUS_LABELS[i.status],
          i.reporterName,
          i.handlerName || '尚未接手',
          i.resolutionNote,
        ])
      );
    } else {
      exportCsvWithBom(
        `${schoolName}_巡堂紀錄總表_${startDate}_${endDate}.csv`,
        ['日期', '節次', '樓棟', '教室', '班級', '科目', '任課教師', '應到', '實到', '狀態', '備註', '巡堂人員'],
        filteredLogs.map((l) => [
          l.date,
          `第${l.period}節`,
          l.building,
          l.roomNumber,
          l.className,
          l.subject,
          l.teacherName,
          l.expectedCount,
          l.actualCount,
          PATROL_STATUS_LABELS[l.status],
          l.note,
          l.inspectorName,
        ])
      );
    }
    onActionFeedback('已下載 UTF-8 BOM CSV 報表（支援 Excel 直接開啟無亂碼）');
  };

  const handlePrintPdf = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Export Control Bar (Hidden when printing PDF) */}
      <div className="no-print bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-[#1F2421]">PDF 與 Excel 報表匯出中心</h2>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              即時整合課表、巡堂紀錄、缺曠判別與異常結案資料，一鍵產生多工作表 Excel（.xlsx）或正式 A4 簽核 PDF
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              匯出多工作表 Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="min-h-[42px] px-3.5 py-2 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs sm:text-sm font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Download className="w-4 h-4" />
              匯出 CSV
            </button>
            <button
              type="button"
              onClick={handlePrintPdf}
              className="min-h-[42px] px-4 py-2 bg-[#1F2421] hover:bg-[#313834] text-white text-xs sm:text-sm font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
            >
              <Printer className="w-4 h-4" />
              列印／另存 PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-3 border-t border-[#F0ECE3] text-xs">
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">報表抬頭校名</label>
            <input
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">起始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] font-mono-num focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">結束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] font-mono-num focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">樓棟範圍</label>
            <select
              value={buildingFilter}
              onChange={(e) => setBuildingFilter(e.target.value)}
              className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] focus:outline-none focus:border-[#1E5C4B]"
            >
              {buildings.map((b) => (
                <option key={b} value={b}>{b === 'ALL' ? '全校所有樓棟' : b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-semibold text-[#5C615C] block mb-1">PDF 預覽版型</label>
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value as ReportTemplate)}
              className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5] focus:outline-none focus:border-[#1E5C4B]"
            >
              <option value="comprehensive">綜合巡堂與缺曠總表</option>
              <option value="truancy">缺曠課自動判別專表</option>
              <option value="incidents">異常事件處置報告</option>
            </select>
          </div>
        </div>
      </div>

      {/* Live Formal A4 Printable School Report Preview */}
      <article className="print-surface bg-white border border-[#E5E1D8] rounded-xl p-6 sm:p-10 max-w-5xl mx-auto space-y-8">
        {/* Official Report Header */}
        <header className="border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 no-print" />
              學務處日常教學巡堂正式統計報告
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
              {schoolName} — {template === 'truancy' ? '學生缺曠自動判別明細表' : template === 'incidents' ? '校園巡堂異常通報結案報告' : '課堂巡堂與出缺勤統計總表'}
            </h1>
          </div>
          <div className="text-xs text-slate-600 font-mono-num sm:text-right space-y-0.5">
            <p>統計區間：{startDate} 至 {endDate}</p>
            <p>涵蓋範圍：{buildingFilter === 'ALL' ? '全校樓棟' : buildingFilter}</p>
          </div>
        </header>

        {/* Executive Summary Strip */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 border border-slate-200 rounded-lg p-4">
          <div>
            <p className="text-xs text-slate-500">累計巡堂班次</p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {summaryStats.totalPatrols} 次
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">課堂正常運作率</p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {summaryStats.normalRate}%
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">自動判定曠課／核假</p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {summaryStats.truantCount} / {summaryStats.excusedCount} 人次
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">異常通報（已結案）</p>
            <p className="text-lg font-bold font-mono-num text-slate-900 mt-0.5">
              {summaryStats.incidentCount} 件（{summaryStats.resolvedIncidents}）
            </p>
          </div>
        </section>

        {/* Section 1: Patrol Logs Table */}
        {(template === 'comprehensive') && (
          <section className="space-y-2.5">
            <h3 className="text-sm font-bold text-slate-900">一、各班級巡堂檢核紀錄</h3>
            {filteredLogs.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">所選區間內無巡堂紀錄。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-y border-slate-300 bg-slate-50 text-slate-700">
                      <th className="py-2 px-2.5">日期／節次</th>
                      <th className="py-2 px-2.5">班級／教室</th>
                      <th className="py-2 px-2.5">科目／教師</th>
                      <th className="py-2 px-2.5 text-right">實到／應到</th>
                      <th className="py-2 px-2.5">巡堂狀態</th>
                      <th className="py-2 px-2.5">巡堂人員</th>
                      <th className="py-2 px-2.5">備註</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-2.5 font-mono-num whitespace-nowrap">
                          {log.date} 第{log.period}節
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap font-medium">
                          {log.className}（{log.roomNumber}）
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {log.subject} · {log.teacherName}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono-num">
                          {log.actualCount} / {log.expectedCount}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {PATROL_STATUS_LABELS[log.status]}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">{log.inspectorName}</td>
                        <td className="py-2 px-2.5 text-slate-600">{log.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Section 2: Truancy Summary */}
        {(template === 'comprehensive' || template === 'truancy') && (
          <section className="space-y-2.5">
            <h3 className="text-sm font-bold text-slate-900">
              {template === 'comprehensive' ? '二、學生缺曠自動判別與風險名單' : '一、學生缺曠自動判別明細表'}
            </h3>
            {evaluatedAbsences.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">所選區間內無缺曠課紀錄。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-y border-slate-300 bg-slate-50 text-slate-700">
                      <th className="py-2 px-2.5">日期／節次</th>
                      <th className="py-2 px-2.5">班級／學生</th>
                      <th className="py-2 px-2.5">課表科目</th>
                      <th className="py-2 px-2.5">系統自動判定</th>
                      <th className="py-2 px-2.5">風險分級</th>
                      <th className="py-2 px-2.5">判別依據</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {evaluatedAbsences.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 px-2.5 font-mono-num whitespace-nowrap">
                          {a.date} 第{a.period}節
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap font-medium">
                          {a.className} {a.seatNumber}號 {a.studentName}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {a.subject}（{a.teacherName}）
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap font-semibold">
                          {AUTO_ABSENCE_STATUS_LABELS[a.liveEval.autoStatus]}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {RISK_LEVEL_LABELS[a.liveEval.riskLevel]}
                        </td>
                        <td className="py-2 px-2.5 text-slate-600">{a.liveEval.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Section 3: Incidents Table */}
        {(template === 'comprehensive' || template === 'incidents') && (
          <section className="space-y-2.5">
            <h3 className="text-sm font-bold text-slate-900">
              {template === 'comprehensive' ? '三、異常事件通報與處置紀錄' : '一、異常事件通報與結案清冊'}
            </h3>
            {filteredIncidents.length === 0 ? (
              <p className="text-xs text-slate-500 py-3">所選區間內無異常事件通報。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-y border-slate-300 bg-slate-50 text-slate-700">
                      <th className="py-2 px-2.5">日期／節次</th>
                      <th className="py-2 px-2.5">等級／類別</th>
                      <th className="py-2 px-2.5">地點與事件標題</th>
                      <th className="py-2 px-2.5">處理狀態</th>
                      <th className="py-2 px-2.5">承辦與結案說明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredIncidents.map((inc) => (
                      <tr key={inc.id}>
                        <td className="py-2 px-2.5 font-mono-num whitespace-nowrap">
                          {inc.date} 第{inc.period}節
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {INCIDENT_SEVERITY_LABELS[inc.severity]} · {INCIDENT_CATEGORY_LABELS[inc.category]}
                        </td>
                        <td className="py-2 px-2.5">
                          <span className="font-medium text-slate-900">{inc.title}</span>
                          <span className="block text-slate-500">{inc.location}</span>
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          {INCIDENT_STATUS_LABELS[inc.status]}
                        </td>
                        <td className="py-2 px-2.5 text-slate-600">
                          {inc.handlerName ? `${inc.handlerName}：` : ''}
                          {inc.resolutionNote || '尚未填寫結案說明'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Formal Taiwanese School Approval Signature Block */}
        <footer className="pt-8 border-t border-slate-300">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-xs text-slate-700">
            {['值日巡堂人員', '生教組長', '學務主任', '校長'].map((roleTitle) => (
              <div key={roleTitle} className="space-y-8">
                <p className="font-semibold text-slate-800">{roleTitle}核章：</p>
                <div className="border-b border-slate-400" />
              </div>
            ))}
          </div>
        </footer>
      </article>
    </div>
  );
};
