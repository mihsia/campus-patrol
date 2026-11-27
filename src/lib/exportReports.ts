import * as XLSX from 'xlsx';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
} from 'docx';
import type {
  IncidentReport,
  PatrolCheckItem,
  PatrolLog,
  SchoolSettings,
  TimetableSlot,
} from '../types/patrol';
import {
  DAY_OF_WEEK_LABELS,
  DAY_OF_WEEK_SHORT,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  PATROL_CHECKLIST_LABELS,
  PATROL_STATUS_LABELS,
  STANDARD_GRADES,
  getEffectiveChecklist,
} from '../types/patrol';
import { clampInt, clampString } from './validation';

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
  isRelocated: boolean;
  locationNote: string;
}

export interface PatrolReportRowItem {
  key: string;
  classLabel: string;
  subClassLabel?: string;
  grade: string;
  teacherName: string;
  subject: string;
  dateDisplay: string;
  weekdayDisplay: string;
  periodDisplay: string;
  checklist: PatrolCheckItem[];
  note: string;
  inspectorName: string;
  hasLog: boolean;
}

const GRADE_ORDER_MAP: Record<string, number> = {
  一年級: 1,
  二年級: 2,
  三年級: 3,
  四年級: 4,
  五年級: 5,
  六年級: 6,
};

function getGradeRank(gradeOrClass: string): number {
  for (const [k, rank] of Object.entries(GRADE_ORDER_MAP)) {
    if (gradeOrClass.includes(k)) return rank;
  }
  const firstChar = gradeOrClass.trim().slice(0, 1);
  const chineseNum: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  if (chineseNum[firstChar]) return chineseNum[firstChar];
  return 99;
}

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }
  return dateStr;
}

/**
 * Builds deterministic rows for both the formal A4 PDF preview and the Word (.docx) export,
 * matching the official elementary school weekly patrol table layout.
 */
export function buildPatrolReportRows(params: {
  patrolLogs: PatrolLog[];
  timetables: TimetableSlot[];
  mode: 'weekly_standard' | 'logged_only';
}): PatrolReportRowItem[] {
  const { patrolLogs, timetables, mode } = params;

  const slotGradeMap = new Map<string, string>();
  timetables.forEach((t) => {
    slotGradeMap.set(t.id, t.grade);
    if (!slotGradeMap.has(t.className)) {
      slotGradeMap.set(t.className, t.grade);
    }
  });

  const sortedLogs = [...patrolLogs].sort((a, b) => {
    const gA = a.grade || slotGradeMap.get(a.timetableId) || slotGradeMap.get(a.className) || a.className;
    const gB = b.grade || slotGradeMap.get(b.timetableId) || slotGradeMap.get(b.className) || b.className;
    const rankDiff = getGradeRank(gA) - getGradeRank(gB);
    if (rankDiff !== 0) return rankDiff;
    const clsDiff = a.className.localeCompare(b.className, 'zh-Hant');
    if (clsDiff !== 0) return clsDiff;
    const dateDiff = a.date.localeCompare(b.date);
    if (dateDiff !== 0) return dateDiff;
    return a.period - b.period;
  });

  const logToItem = (log: PatrolLog, idx: number): PatrolReportRowItem => {
    const grade = log.grade || slotGradeMap.get(log.timetableId) || slotGradeMap.get(log.className) || '';
    const sameLabel = !grade || grade === log.className;
    return {
      key: `${log.id}-${idx}`,
      classLabel: sameLabel ? log.className : grade,
      subClassLabel: sameLabel ? undefined : log.className,
      grade: grade || log.className,
      teacherName: log.teacherName,
      subject: log.subject,
      dateDisplay: formatShortDate(log.date),
      weekdayDisplay: DAY_OF_WEEK_SHORT[log.dayOfWeek] ? `星期${DAY_OF_WEEK_SHORT[log.dayOfWeek]}` : '',
      periodDisplay: `第 ${log.period} 節`,
      checklist: getEffectiveChecklist(log),
      note: log.note || '',
      inspectorName: log.inspectorName || '',
      hasLog: true,
    };
  };

  if (mode === 'logged_only') {
    return sortedLogs.map(logToItem);
  }

  // Standard Weekly Mode: ensure all standard grades/classes appear in order (Grades 1-6 or timetable classes)
  // Collect distinct (grade, className) pairs from timetables; fallback to STANDARD_GRADES if empty
  const classPairsMap = new Map<string, { grade: string; className: string }>();
  timetables.forEach((t) => {
    const key = `${t.grade}__${t.className}`;
    if (!classPairsMap.has(key)) {
      classPairsMap.set(key, { grade: t.grade, className: t.className });
    }
  });

  const orderedClasses =
    classPairsMap.size > 0
      ? Array.from(classPairsMap.values()).sort((a, b) => {
          const r = getGradeRank(a.grade) - getGradeRank(b.grade);
          if (r !== 0) return r;
          return a.className.localeCompare(b.className, 'zh-Hant');
        })
      : STANDARD_GRADES.map((g) => ({ grade: g, className: g }));

  const rows: PatrolReportRowItem[] = [];
  const usedLogIds = new Set<string>();

  orderedClasses.forEach((cls) => {
    const matched = sortedLogs.filter((l) => {
      const lGrade = l.grade || slotGradeMap.get(l.timetableId) || slotGradeMap.get(l.className) || '';
      return l.className === cls.className || (cls.className === cls.grade && lGrade === cls.grade);
    });

    if (matched.length > 0) {
      matched.forEach((log, idx) => {
        usedLogIds.add(log.id);
        rows.push(logToItem(log, idx));
      });
    } else {
      const sameLabel = cls.grade === cls.className;
      rows.push({
        key: `blank-${cls.grade}-${cls.className}`,
        classLabel: cls.grade,
        subClassLabel: sameLabel ? undefined : cls.className,
        grade: cls.grade,
        teacherName: '',
        subject: '',
        dateDisplay: '',
        weekdayDisplay: '',
        periodDisplay: '',
        checklist: [],
        note: '',
        inspectorName: '',
        hasLog: false,
      });
    }
  });

  // Include any remaining logs whose class wasn't in the current timetable
  sortedLogs.forEach((log, idx) => {
    if (!usedLogIds.has(log.id)) {
      rows.push(logToItem(log, idx));
    }
  });

  return rows;
}

const FONT_KAITI = {
  ascii: 'Times New Roman',
  hAnsi: 'Times New Roman',
  eastAsia: '標楷體',
  cs: 'Times New Roman',
};

const THIN_BLACK_BORDER = {
  style: BorderStyle.SINGLE,
  size: 6,
  color: '000000',
};

const ALL_CELL_BORDERS = {
  top: THIN_BLACK_BORDER,
  bottom: THIN_BLACK_BORDER,
  left: THIN_BLACK_BORDER,
  right: THIN_BLACK_BORDER,
};

function checkGlyph(checked: boolean): string {
  return checked ? '☑' : '☐';
}

function makeTextRun(text: string, opts?: { bold?: boolean; size?: number }): TextRun {
  return new TextRun({
    text,
    bold: opts?.bold ?? false,
    size: opts?.size ?? 21, // 10.5pt (half-points)
    font: FONT_KAITI,
    color: '000000',
  });
}

/**
 * Generates and downloads a genuine Microsoft Word (.docx) patrol record form
 * faithfully reproducing the official Taiwanese elementary school weekly patrol table.
 */
export async function exportPatrolWordDocx(params: {
  schoolSettings: SchoolSettings;
  weekNumber: number | '';
  startDate: string;
  endDate: string;
  rows: PatrolReportRowItem[];
  incidents?: IncidentReport[];
  includeIncidentsAppendix?: boolean;
}): Promise<void> {
  const {
    schoolSettings,
    weekNumber,
    startDate,
    endDate,
    rows,
    incidents = [],
    includeIncidentsAppendix = false,
  } = params;

  const weekText = weekNumber !== '' && Number(weekNumber) > 0 ? ` ${weekNumber} ` : ' ______ ';
  const titleText = `${schoolSettings.schoolName} ${schoolSettings.academicYear} 學年度${schoolSettings.semester}第${weekText}週 巡堂紀錄表`;

  // Column widths in twips (A4 printable width = 11906 - 1440 = 10466 twips)
  const colWidths = [1350, 1750, 1350, 6016];

  const headerRow1 = new TableRow({
    tableHeader: true,
    height: { value: 420, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        width: { size: colWidths[0], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('班別', { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: colWidths[1], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('授課教師姓名', { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: colWidths[2], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('授課領域', { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: colWidths[3], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        verticalMerge: VerticalMergeType.RESTART,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('巡堂結果紀錄', { bold: true, size: 22 })],
          }),
        ],
      }),
    ],
  });

  const headerRow2 = new TableRow({
    tableHeader: true,
    height: { value: 380, rule: HeightRule.ATLEAST },
    children: [
      new TableCell({
        width: { size: colWidths[0], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('日期', { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: colWidths[1], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('星期', { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: colWidths[2], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [makeTextRun('節次', { bold: true, size: 22 })],
          }),
        ],
      }),
      new TableCell({
        width: { size: colWidths[3], type: WidthType.DXA },
        borders: ALL_CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        verticalMerge: VerticalMergeType.CONTINUE,
        children: [new Paragraph({ children: [] })],
      }),
    ],
  });

  const dataRows: TableRow[] = [];

  rows.forEach((item) => {
    const has = (k: PatrolCheckItem) => item.checklist.includes(k);
    const hasNote = item.note.trim().length > 0;

    // Row A: Class / Teacher / Subject / 8-item checklist (4 lines)
    const classParagraphs: Paragraph[] = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [makeTextRun(item.classLabel, { bold: true, size: 22 })],
      }),
    ];
    if (item.subClassLabel) {
      classParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [makeTextRun(`（${item.subClassLabel}）`, { size: 19 })],
        })
      );
    }

    dataRows.push(
      new TableRow({
        cantSplit: true,
        height: { value: 1180, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: colWidths[0], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: classParagraphs,
          }),
          new TableCell({
            width: { size: colWidths[1], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [makeTextRun(item.teacherName, { size: 21 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: colWidths[2], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [makeTextRun(item.subject, { size: 21 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: colWidths[3], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 110, right: 80 },
            children: [
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  makeTextRun(
                    `${checkGlyph(has('class_normal'))}上課大致正常　　　${checkGlyph(has('proper_equipment'))}妥善運用教學設備`,
                    { size: 20 }
                  ),
                ],
              }),
              new Paragraph({
                spacing: { after: 60 },
                children: [
                  makeTextRun(
                    `${checkGlyph(has('student_focused'))}學生專注上課　　　${checkGlyph(has('good_interaction'))}師生互動良好`,
                    { size: 20 }
                  ),
                ],
              }),
              new Paragraph({
                spacing: { after: 40 },
                children: [
                  makeTextRun(
                    `${checkGlyph(has('teacher_late'))}教師未準時上課　　${checkGlyph(has('poor_order'))}班級秩序欠佳`,
                    { size: 20 }
                  ),
                ],
              }),
              new Paragraph({
                children: [
                  makeTextRun(
                    `${checkGlyph(has('poor_learning'))}學生學習狀況差　　${checkGlyph(has('off_schedule_no_change'))}未按課表上課且無調課`,
                    { size: 20 }
                  ),
                ],
              }),
            ],
          }),
        ],
      })
    );

    // Row B: Date / Weekday / Period / 其他
    dataRows.push(
      new TableRow({
        cantSplit: true,
        height: { value: 440, rule: HeightRule.ATLEAST },
        children: [
          new TableCell({
            width: { size: colWidths[0], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [makeTextRun(item.dateDisplay, { size: 20 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: colWidths[1], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [makeTextRun(item.weekdayDisplay, { size: 20 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: colWidths[2], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 50, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [makeTextRun(item.periodDisplay, { size: 20 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: colWidths[3], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 50, bottom: 50, left: 110, right: 80 },
            children: [
              new Paragraph({
                children: [
                  makeTextRun(
                    `${checkGlyph(hasNote)} 其他：${hasNote ? item.note.trim() : ''}`,
                    { size: 20 }
                  ),
                ],
              }),
            ],
          }),
        ],
      })
    );
  });

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths: colWidths,
    rows: [headerRow1, headerRow2, ...dataRows],
  });

  const sectionChildren: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [makeTextRun(titleText, { bold: true, size: 32 })], // 16pt
    }),
    mainTable,
    new Paragraph({
      spacing: { before: 220 },
      children: [
        makeTextRun('巡堂人員：　　　　　　　　　教務主任：　　　　　　　　　校長：', {
          bold: true,
          size: 23,
        }),
      ],
    }),
  ];

  // Optional Incident Appendix
  if (includeIncidentsAppendix && incidents.length > 0) {
    sectionChildren.push(
      new Paragraph({
        pageBreakBefore: true,
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          makeTextRun(
            `${schoolSettings.schoolName} 巡堂異常事件通報與處置清冊（${startDate} 至 ${endDate}）`,
            { bold: true, size: 28 }
          ),
        ],
      })
    );

    const incWidths = [1500, 1500, 1800, 3666, 2000];
    const incHeader = new TableRow({
      tableHeader: true,
      children: ['日期／節次', '等級／類別', '地點與班級', '事件標題與說明', '處理狀態／結案'].map(
        (label, idx) =>
          new TableCell({
            width: { size: incWidths[idx], type: WidthType.DXA },
            borders: ALL_CELL_BORDERS,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [makeTextRun(label, { bold: true, size: 20 })],
              }),
            ],
          })
      ),
    });

    const incRows = incidents.map(
      (inc) =>
        new TableRow({
          cantSplit: true,
          children: [
            `${inc.date}\n第 ${inc.period} 節`,
            `${INCIDENT_SEVERITY_LABELS[inc.severity]}\n${INCIDENT_CATEGORY_LABELS[inc.category]}`,
            inc.location,
            `${inc.title}：${inc.description}`,
            `${INCIDENT_STATUS_LABELS[inc.status]}${inc.handlerName ? `（${inc.handlerName}）` : ''}${inc.resolutionNote ? `\n${inc.resolutionNote}` : ''}`,
          ].map(
            (txt, idx) =>
              new TableCell({
                width: { size: incWidths[idx], type: WidthType.DXA },
                borders: ALL_CELL_BORDERS,
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 60, bottom: 60, left: 80, right: 80 },
                children: txt.split('\n').map(
                  (line) =>
                    new Paragraph({
                      children: [makeTextRun(line, { size: 19 })],
                    })
                ),
              })
          ),
        })
    );

    sectionChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        columnWidths: incWidths,
        rows: [incHeader, ...incRows],
      })
    );
  }

  const docObj = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 width in twips
              height: 16838, // A4 height in twips
            },
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720,
            },
          },
        },
        children: sectionChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(docObj);
  const safeSchool =
    schoolSettings.schoolName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') || '學校';
  const weekPart = weekNumber !== '' && Number(weekNumber) > 0 ? `第${weekNumber}週` : `${startDate}`;
  const filename = `${safeSchool}_${schoolSettings.academicYear}學年度${schoolSettings.semester}_${weekPart}_巡堂紀錄表.docx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports Excel (.xlsx) workbook with Patrol Logs + Incidents (no student attendance sheets).
 */
export function exportPatrolExcelWorkbook(params: {
  schoolSettings: SchoolSettings;
  startDate: string;
  endDate: string;
  patrolLogs: PatrolLog[];
  incidents: IncidentReport[];
}): void {
  const { schoolSettings, startDate, endDate, patrolLogs, incidents } = params;
  const wb = XLSX.utils.book_new();

  const patrolRows = patrolLogs.map((log) => {
    const checklist = getEffectiveChecklist(log);
    const checklistText = checklist.map((k) => PATROL_CHECKLIST_LABELS[k]).join('、');
    return {
      日期: log.date,
      星期: DAY_OF_WEEK_LABELS[log.dayOfWeek] || `星期${log.dayOfWeek}`,
      節次: `第 ${log.period} 節`,
      樓棟: log.building,
      教室: log.roomNumber,
      年級: log.grade || '',
      班別: log.className,
      授課領域: log.subject,
      授課教師姓名: log.teacherName,
      巡堂狀態: PATROL_STATUS_LABELS[log.status],
      巡堂檢核項目: checklistText || '—',
      其他備註: log.note || '',
      巡堂人員: log.inspectorName,
    };
  });

  const wsPatrol = XLSX.utils.json_to_sheet(
    patrolRows.length > 0
      ? patrolRows
      : [{ 訊息: `${startDate} 至 ${endDate} 尚無巡堂紀錄` }]
  );
  wsPatrol['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 9 }, { wch: 14 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 36 }, { wch: 28 }, { wch: 12 },
  ];
  XLSX.utils.book_append_sheet(wb, wsPatrol, '巡堂紀錄表');

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
    { wch: 12 }, { wch: 9 }, { wch: 11 }, { wch: 18 }, { wch: 20 },
    { wch: 24 }, { wch: 36 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, wsInc, '異常事件清冊');

  const safeSchool =
    schoolSettings.schoolName.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') || '學校';
  XLSX.writeFile(wb, `${safeSchool}_巡堂紀錄報表_${startDate}_${endDate}.xlsx`);
}

function escapeCsvCell(val: string | number | boolean): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCsvWithBom(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean>>
): void {
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

export function downloadTimetableCsvTemplate(buildings?: string[]): void {
  const b1 = buildings?.[0] || '行政教學大樓';
  const b2 = buildings?.[1] || b1;
  const headers = [
    '星期(1-5)',
    '節次(1-8)',
    '樓棟',
    '樓層',
    '教室編號',
    '班別',
    '年級',
    '授課領域',
    '授課教師姓名',
    '是否移地(是/否)',
    '移地備註',
  ];
  const sampleRows = [
    [1, 1, b1, '1F', '101', '一甲', '一年級', '國語', '陳淑芬', '否', ''],
    [1, 2, b2, '2F', '201', '三甲', '三年級', '自然', '周建宏', '是', '自然專科教室'],
  ];
  exportCsvWithBom('班級課表匯入範本.csv', headers, sampleRows);
}

/**
 * Parses uploaded school timetable CSV (UTF-8 / Excel CSV) into validated TimetableSlot payloads.
 * Supports both the streamlined 9-11 column format and legacy 13-column CSVs gracefully.
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

  // Detect whether legacy column 9 is numeric expectedCount
  const headerCols = splitCsvLine(lines[0]);
  const hasLegacyCountCol =
    headerCols[9]?.includes('人數') || headerCols[9]?.toLowerCase().includes('count');

  const rows: ParsedTimetableImportRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 9) {
      errors.push(`第 ${i + 1} 列欄位數不足（至少需 9 欄）`);
      continue;
    }

    const dayOfWeek = clampInt(Number(cols[0]), 1, 5);
    const period = clampInt(Number(cols[1]), 1, 8);
    const building = clampString(cols[2], 40, '行政教學大樓');
    const floor = clampString(cols[3], 20, '1F');
    const roomNumber = clampString(cols[4], 20, `R${i}`);
    const className = clampString(cols[5], 30);
    const grade = clampString(cols[6], 20, className.slice(0, 3) || '一年級');
    const subject = clampString(cols[7], 50);
    const teacherName = clampString(cols[8], 40);

    const relocatedColIdx = hasLegacyCountCol ? 10 : 9;
    const noteColIdx = hasLegacyCountCol ? 11 : 10;

    const relocatedRaw = (cols[relocatedColIdx] || '').trim().toLowerCase();
    const isRelocated =
      relocatedRaw === '是' ||
      relocatedRaw === 'true' ||
      relocatedRaw === '1' ||
      relocatedRaw === 'yes';
    const locationNote = clampString(cols[noteColIdx] || '', 100);

    if (!className || !subject || !teacherName) {
      errors.push(`第 ${i + 1} 列缺少班別、授課領域或授課教師姓名`);
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
      isRelocated,
      locationNote,
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
    '星期(1-5)',
    '節次(1-8)',
    '樓棟',
    '樓層',
    '教室編號',
    '班別',
    '年級',
    '授課領域',
    '授課教師姓名',
    '是否移地(是/否)',
    '移地備註',
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
    t.isRelocated ? '是' : '否',
    t.locationNote,
  ]);
  exportCsvWithBom('班級課表資料庫備份.csv', headers, rows);
}
