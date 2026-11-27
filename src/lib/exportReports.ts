import * as XLSX from 'xlsx';
import type {
  AbsenceRecord,
  IncidentReport,
  LeaveRecord,
  PatrolLog,
  TimetableSlot,
} from '../types/patrol';
import {
  AUTO_ABSENCE_STATUS_LABELS,
  DAY_OF_WEEK_LABELS,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  OBSERVED_ABSENCE_LABELS,
  PATROL_STATUS_LABELS,
  RISK_LEVEL_LABELS,
} from '../types/patrol';
import type { StudentRiskSummary, TruancyEvaluationResult } from './truancyEngine';
import { clampInt, clampString, sanitizeRoster } from './validation';

export interface ParsedTimetableImportRow {
  dayOfWeek: number;
  period: number;
  building: string;
  floor: string;
  roomNumber: string;
  className: string;
  grade: string;
  subject: string;
  teacherName: string;
  expectedCount: number;
  isRelocated: boolean;
  locationNote: string;
  roster: string[];
}

export function exportFullExcelWorkbook(params: {
  schoolName: string;
  startDate: string;
  endDate: string;
  patrolLogs: PatrolLog[];
  evaluatedAbsences: Array<AbsenceRecord & { liveEval: TruancyEvaluationResult }>;
  studentSummaries: StudentRiskSummary[];
  incidents: IncidentReport[];
}): void {
  const { schoolName, startDate, endDate, patrolLogs, evaluatedAbsences, studentSummaries, incidents } =
    params;

  const wb = XLSX.utils.book_new();

  // Sheet 1: 巡堂紀錄總表
  const patrolRows = patrolLogs.map((log) => ({
    日期: log.date,
    星期: DAY_OF_WEEK_LABELS[log.dayOfWeek] || `星期${log.dayOfWeek}`,
    節次: `第 ${log.period} 節`,
    樓棟: log.building,
    教室: log.roomNumber,
    班級: log.className,
    科目: log.subject,
    任課教師: log.teacherName,
    教師到班: log.teacherPresent ? '已到班' : '未到／異常',
    應到人數: log.expectedCount,
    實到人數: log.actualCount,
    出席率: log.expectedCount > 0 ? `${Math.round((log.actualCount / log.expectedCount) * 1000) / 10}%` : '—',
    巡堂狀態: PATROL_STATUS_LABELS[log.status],
    備註說明: log.note || '',
    巡堂人員: log.inspectorName,
  }));
  const wsPatrol = XLSX.utils.json_to_sheet(
    patrolRows.length > 0
      ? patrolRows
      : [{ 訊息: `${startDate} 至 ${endDate} 尚無巡堂紀錄` }]
  );
  wsPatrol['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 9 }, { wch: 12 }, { wch: 10 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 9 },
    { wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 28 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPatrol, '巡堂紀錄總表');

  // Sheet 2: 缺曠課自動判別明細
  const absenceRows = evaluatedAbsences.map((a) => ({
    日期: a.date,
    節次: `第 ${a.period} 節`,
    班級: a.className,
    座號: a.seatNumber,
    學生姓名: a.studentName,
    課表科目: a.subject,
    任課教師: a.teacherName,
    現場觀察: OBSERVED_ABSENCE_LABELS[a.observedType],
    演算法自動判定: AUTO_ABSENCE_STATUS_LABELS[a.liveEval.autoStatus],
    風險等級: RISK_LEVEL_LABELS[a.liveEval.riskLevel],
    已人工覆核: a.verified ? '已覆核' : '待覆核',
    判定依據: a.liveEval.rationale,
    登錄人員: a.recordedByName,
  }));
  const wsAbs = XLSX.utils.json_to_sheet(
    absenceRows.length > 0
      ? absenceRows
      : [{ 訊息: `${startDate} 至 ${endDate} 尚無缺曠紀錄` }]
  );
  wsAbs['!cols'] = [
    { wch: 12 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
    { wch: 10 }, { wch: 36 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAbs, '缺曠自動判別明細');

  // Sheet 3: 學生缺曠風險預警名單
  const riskRows = studentSummaries.map((s) => ({
    班級: s.className,
    座號: s.seatNumber,
    學生姓名: s.studentName,
    風險等級: RISK_LEVEL_LABELS[s.riskLevel],
    疑似曠課節數: s.truantCount,
    最高連續曠課: s.maxConsecutiveTruant,
    遲到次數: s.lateCount,
    已核假節數: s.excusedCount,
    涉及節次: s.affectedPeriods.map((p) => `第${p}節`).join('、'),
    涉及科目: s.affectedSubjects.join('、'),
    系統建議處置: s.recommendedAction,
  }));
  const wsRisk = XLSX.utils.json_to_sheet(
    riskRows.length > 0 ? riskRows : [{ 訊息: '目前無學生缺曠風險紀錄' }]
  );
  wsRisk['!cols'] = [
    { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 13 },
    { wch: 13 }, { wch: 10 }, { wch: 11 }, { wch: 20 }, { wch: 22 }, { wch: 38 },
  ];
  XLSX.utils.book_append_sheet(wb, wsRisk, '學生風險預警名單');

  // Sheet 4: 異常事件通報清冊
  const incidentRows = incidents.map((inc) => ({
    日期: inc.date,
    節次: `第 ${inc.period} 節`,
    嚴重度: INCIDENT_SEVERITY_LABELS[inc.severity],
    類別: INCIDENT_CATEGORY_LABELS[inc.category],
    地點班級: inc.location,
    事件標題: inc.title,
    詳細描述: inc.description,
    處理狀態: INCIDENT_STATUS_LABELS[inc.status],
    通報人員: inc.reporterName,
    承辦人員: inc.handlerName || '尚未接手',
    處置結案說明: inc.resolutionNote || '',
  }));
  const wsInc = XLSX.utils.json_to_sheet(
    incidentRows.length > 0 ? incidentRows : [{ 訊息: '區間內無異常通報紀錄' }]
  );
  wsInc['!cols'] = [
    { wch: 12 }, { wch: 9 }, { wch: 11 }, { wch: 15 }, { wch: 20 },
    { wch: 24 }, { wch: 36 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, wsInc, '異常事件清冊');

  const safeSchool = schoolName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') || 'CampusPatrol';
  XLSX.writeFile(wb, `${safeSchool}_巡堂與缺曠統計報告_${startDate}_${endDate}.xlsx`);
}

function escapeCsvCell(val: string | number | boolean): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCsvWithBom(filename: string, headers: string[], rows: Array<Array<string | number | boolean>>): void {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadTimetableCsvTemplate(): void {
  const headers = [
    '星期(1-5)',
    '節次(1-8)',
    '樓棟',
    '樓層',
    '教室編號',
    '班級',
    '年級',
    '科目',
    '任課教師',
    '應到人數',
    '是否移地(是/否)',
    '移地備註',
    '學生名單(頓號分隔)',
  ];
  const sampleRows = [
    [1, 1, '教學A棟', '2F', 'A201', '高一忠', '高一', '數學', '林志明', 32, '否', '', '01 王小明、02 陳怡君、03 林宇軒、04 張雅婷'],
    [1, 2, '科學館', '3F', 'S302', '高一忠', '高一', '物理實驗', '周建宏', 32, '是', '物理實驗室二', '01 王小明、02 陳怡君、03 林宇軒、04 張雅婷'],
  ];
  exportCsvWithBom('學校課表匯入範本_CampusPatrol.csv', headers, sampleRows);
}

/**
 * Parses uploaded school timetable CSV (UTF-8 / Excel CSV) into validated TimetableSlot payloads.
 */
export function parseTimetableCsv(csvText: string): {
  rows: ParsedTimetableImportRow[];
  errors: string[];
} {
  const cleanText = csvText.replace(/^\uFEFF/, '').trim();
  if (!cleanText) {
    return { rows: [], errors: ['檔案內容為空'] };
  }

  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV 需包含標題列與至少一筆課表資料'] };
  }

  const rows: ParsedTimetableImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 10) {
      errors.push(`第 ${i + 1} 列欄位數不足（至少需 10 欄）`);
      continue;
    }

    const dayOfWeek = clampInt(Number(cols[0]), 1, 5);
    const period = clampInt(Number(cols[1]), 1, 8);
    const building = clampString(cols[2], 40, '教學大樓');
    const floor = clampString(cols[3], 20, '1F');
    const roomNumber = clampString(cols[4], 20, `R${i}`);
    const className = clampString(cols[5], 30);
    const grade = clampString(cols[6], 20, className.slice(0, 2) || '未分年級');
    const subject = clampString(cols[7], 50);
    const teacherName = clampString(cols[8], 40);
    const expectedCount = clampInt(Number(cols[9]) || 30, 1, 120);
    const relocatedRaw = (cols[10] || '').trim().toLowerCase();
    const isRelocated = relocatedRaw === '是' || relocatedRaw === 'true' || relocatedRaw === '1' || relocatedRaw === 'yes';
    const locationNote = clampString(cols[11] || '', 100);
    const rosterRaw = cols[12] || '';
    const roster = sanitizeRoster(rosterRaw.split(/[、;|]/));

    if (!className || !subject || !teacherName) {
      errors.push(`第 ${i + 1} 列缺少班級、科目或任課教師`);
      continue;
    }

    rows.push({
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
      roster,
    });
  }

  return { rows, errors };
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function exportTimetableBackupCsv(timetables: TimetableSlot[]): void {
  const headers = [
    '星期(1-5)', '節次(1-8)', '樓棟', '樓層', '教室編號',
    '班級', '年級', '科目', '任課教師', '應到人數',
    '是否移地(是/否)', '移地備註', '學生名單(頓號分隔)',
  ];
  const rows = timetables.map((t) => [
    t.dayOfWeek,
    t.period,
    t.building,
    t.floor,
    t.roomNumber,
    t.className,
    t.grade,
    t.subject,
    t.teacherName,
    t.expectedCount,
    t.isRelocated ? '是' : '否',
    t.locationNote,
    t.roster.join('、'),
  ]);
  exportCsvWithBom('全校課表資料庫備份.csv', headers, rows);
}

export function exportLeavesCsv(leaves: LeaveRecord[]): void {
  const headers = ['日期', '班級', '座號', '學生姓名', '假別', '節次', '事由', '核准人'];
  const rows = leaves.map((l) => [
    l.date,
    l.className,
    l.seatNumber,
    l.studentName,
    l.leaveType,
    l.periods.join('、'),
    l.reason,
    l.approvedBy,
  ]);
  exportCsvWithBom('核准假單清冊.csv', headers, rows);
}
