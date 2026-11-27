import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
} from 'docx';
import { parseTimetableCsv, type ParsedTimetableImportRow } from './exportReports';
import { clampInt, clampString } from './validation';

export interface SubjectTeacherMapping {
  area: string;
  subject: string;
  hours: number | null;
  teacherName: string;
}

export interface ParsedPeriodSlot {
  id: string;
  dayOfWeek: number; // 1..5
  period: number; // 1..8
  rawText: string;
  subject: string;
  teacherName: string;
  isSpecialist: boolean;
  isRelocated: boolean;
  locationNote: string;
  isSplitCourse: boolean;
  matchStatus: 'matched' | 'inline' | 'homeroom_fallback' | 'missing_teacher';
}

export interface ParsedClassTimetable {
  id: string;
  sourceLabel: string;
  title: string;
  schoolName: string;
  academicYear: string;
  grade: string;
  className: string;
  homeroomTeacher: string;
  building: string;
  floor: string;
  roomNumber: string;
  teacherMappings: SubjectTeacherMapping[];
  slots: ParsedPeriodSlot[];
  warnings: string[];
}

export interface TimetableParseResult {
  classes: ParsedClassTimetable[];
  errors: string[];
}

interface GridCell {
  text: string;
  lines: string[];
  colStart: number;
  colSpan: number;
  rowStart: number;
  rowSpan: number;
  shaded: boolean;
  isContinuation: boolean;
}

const CHINESE_GRADE_MAP: Record<string, string> = {
  '1': '一年級',
  '2': '二年級',
  '3': '三年級',
  '4': '四年級',
  '5': '五年級',
  '6': '六年級',
  '7': '七年級',
  '8': '八年級',
  '9': '九年級',
  一: '一年級',
  二: '二年級',
  三: '三年級',
  四: '四年級',
  五: '五年級',
  六: '六年級',
  七: '七年級',
  八: '八年級',
  九: '九年級',
};

const GRADE_TO_DEFAULT_FLOOR: Record<string, { floor: string; roomPrefix: string }> = {
  一年級: { floor: '1F', roomPrefix: '101' },
  二年級: { floor: '1F', roomPrefix: '102' },
  三年級: { floor: '2F', roomPrefix: '201' },
  四年級: { floor: '2F', roomPrefix: '202' },
  五年級: { floor: '3F', roomPrefix: '301' },
  六年級: { floor: '3F', roomPrefix: '302' },
};

const NON_INSTRUCTIONAL_KEYWORDS = [
  '導師時間',
  '教師朝會',
  '升旗',
  '朝會',
  '閱讀時間',
  '課間活動',
  '午餐',
  '午休',
  '整潔',
  '打掃',
  '放學',
  '導護',
  '晨光',
  '早自習',
  '總節數',
  '級任',
];

const SUBJECT_PREFIX_EXPANSIONS: Record<string, string> = {
  生: '生活',
  彈: '彈性',
  健: '健康與體育',
  語: '語文',
  數: '數學',
  自: '自然',
  社: '社會',
  藝: '藝術',
  綜: '綜合',
  英: '英語',
};

const SPECIALIST_VENUE_HINTS: Array<{ keyword: string; venue: string }> = [
  { keyword: '體育', venue: '戶外操場／活動中心' },
  { keyword: '音樂', venue: '音樂專科教室' },
  { keyword: '美勞', venue: '美勞專科教室' },
  { keyword: '表演', venue: '表演藝術教室' },
  { keyword: '自然', venue: '自然科學教室' },
  { keyword: '電腦', venue: '電腦資訊教室' },
  { keyword: '資訊', venue: '電腦資訊教室' },
  { keyword: '英語', venue: '英語專科教室' },
];

function cleanSpaces(str: string): string {
  return str.replace(/[\u00A0\u3000\s]+/g, ' ').trim();
}

function stripAllSpaces(str: string): string {
  return str.replace(/[\u00A0\u3000\s]+/g, '');
}

function parsePeriodNumber(raw: string): number | null {
  const s = stripAllSpaces(raw);
  if (!s) return null;
  if (/^[1-8]$/.test(s)) return Number(s);
  const m1 = s.match(/^第?([1-8])節?$/);
  if (m1) return Number(m1[1]);
  const zhMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
  };
  const m2 = s.match(/^第?([一二三四五六七八])節?$/);
  if (m2 && zhMap[m2[1]]) return zhMap[m2[1]];
  return null;
}

function parseWeekdayHeader(raw: string): number | null {
  const s = stripAllSpaces(raw).toLowerCase();
  if (!s) return null;
  if (s === '一' || s === '星期一' || s === '週一' || s === '周一' || s === 'mon' || s === 'monday')
    return 1;
  if (s === '二' || s === '星期二' || s === '週二' || s === '周二' || s === 'tue' || s === 'tuesday')
    return 2;
  if (s === '三' || s === '星期三' || s === '週三' || s === '周三' || s === 'wed' || s === 'wednesday')
    return 3;
  if (s === '四' || s === '星期四' || s === '週四' || s === '周四' || s === 'thu' || s === 'thursday')
    return 4;
  if (s === '五' || s === '星期五' || s === '週五' || s === '周五' || s === 'fri' || s === 'friday')
    return 5;
  return null;
}

function extractTitleMetadata(
  titleText: string,
  fallbackName: string
): {
  title: string;
  schoolName: string;
  academicYear: string;
  grade: string;
  className: string;
} {
  const compact = stripAllSpaces(titleText);
  let schoolName = '';
  let academicYear = '';
  let grade = '一年級';
  let className = '';

  const schoolMatch = compact.match(/^([^\d]{2,14}?(?:國小|國中|小學|中學|高中|實驗學校))/);
  if (schoolMatch) {
    schoolName = schoolMatch[1];
  }

  const yearMatch = compact.match(/(\d{2,3})學年/);
  if (yearMatch) {
    academicYear = yearMatch[1];
  }

  // Match patterns like "一年忠班", "三年甲班", "1年2班", "六年A班"
  const fullClassMatch = compact.match(
    /([一二三四五六七八九1-9])年([甲乙丙丁戊己庚辛壬癸忠孝仁愛信義和平智勇誠正勤樸A-Za-z0-9]{1,3})班/
  );
  if (fullClassMatch) {
    grade = CHINESE_GRADE_MAP[fullClassMatch[1]] || '一年級';
    className = `${fullClassMatch[1]}年${fullClassMatch[2]}班`;
  } else {
    // Match "101班" / "302"
    const numClassMatch = compact.match(/([1-9])(\d{2})班?/);
    if (numClassMatch) {
      grade = CHINESE_GRADE_MAP[numClassMatch[1]] || '一年級';
      className = `${numClassMatch[1]}${numClassMatch[2]}班`;
    } else {
      // Match "一甲", "三忠"
      const shortMatch = compact.match(
        /([一二三四五六七八九])([甲乙丙丁戊己庚辛壬癸忠孝仁愛信義和平])/
      );
      if (shortMatch) {
        grade = CHINESE_GRADE_MAP[shortMatch[1]] || '一年級';
        className = `${shortMatch[1]}年${shortMatch[2]}班`;
      } else {
        const gradeOnly = compact.match(/([一二三四五六七八九1-9])年級/);
        if (gradeOnly) {
          grade = CHINESE_GRADE_MAP[gradeOnly[1]] || '一年級';
          className = grade;
        }
      }
    }
  }

  if (!className) {
    const cleanFallback = fallbackName.replace(/\.(docx|xlsx|xls|csv|html?|txt)$/i, '').trim();
    const fbMatch = stripAllSpaces(cleanFallback).match(
      /([一二三四五六七八九1-9])年?([甲乙丙丁戊己庚辛壬癸忠孝仁愛信義和平\d]{1,2})班?/
    );
    if (fbMatch) {
      grade = CHINESE_GRADE_MAP[fbMatch[1]] || '一年級';
      className = `${fbMatch[1]}年${fbMatch[2]}班`;
    } else {
      className = cleanFallback.slice(0, 20) || '未命名班級';
    }
  }

  return {
    title: cleanSpaces(titleText) || className,
    schoolName,
    academicYear,
    grade,
    className,
  };
}

function isLikelyPersonName(text: string): boolean {
  const s = stripAllSpaces(text);
  if (!s || s.length < 2 || s.length > 5) return false;
  if (/[\d()（）\[\]/\\:：,，、]/.test(s)) return false;
  const nonNames = [
    '國語',
    '數學',
    '生活',
    '美勞',
    '音樂',
    '表演',
    '健康',
    '體育',
    '自然',
    '社會',
    '英語',
    '英文',
    '閱讀',
    '彈性',
    '語文',
    '綜合',
    '藝術',
    '資訊',
    '電腦',
    '台語',
    '客語',
    '族語',
    '科目',
    '節數',
    '教師',
    '老師',
    '任課教師',
    '總節數',
    '合計',
    '導師',
    '級任',
    '國際禮儀',
    '臺灣台語',
    '台灣台語',
    '彈性時間',
    '彈性課程',
    '生活課程',
    '健康與體育',
  ];
  if (nonNames.some((w) => s === w || s.includes('課程') || s.includes('時間') || s.includes('活動'))) {
    return false;
  }
  return /^[\u4e00-\u9fa5]{2,4}$/.test(s);
}

function normalizeTeacherCell(raw: string): string {
  // e.g., "陳怡芬 (16)" or "陳怡芬(16)" or "陳怡芬 老師"
  const s = stripAllSpaces(raw)
    .replace(/[（(]\s*\d+\s*[）)]/g, '')
    .replace(/(老師|教師)$/g, '')
    .trim();
  return s;
}

function normalizeSubjectRaw(lines: string[], rawText: string): {
  cleanSubject: string;
  inlineTeacher: string;
} {
  const cleanLines = lines.map((l) => stripAllSpaces(l)).filter(Boolean);
  if (cleanLines.length >= 2) {
    const lastLine = cleanLines[cleanLines.length - 1];
    const prevText = cleanLines.slice(0, -1).join('');
    if (isLikelyPersonName(lastLine) && prevText.length >= 2) {
      return {
        cleanSubject: prevText.replace(/（/g, '(').replace(/）/g, ')'),
        inlineTeacher: lastLine,
      };
    }
  }
  const joined = stripAllSpaces(cleanLines.length > 0 ? cleanLines.join('') : rawText)
    .replace(/（/g, '(')
    .replace(/）/g, ')');
  return { cleanSubject: joined, inlineTeacher: '' };
}

function resolveSingleSubjectAndTeacher(
  rawSubject: string,
  inlineTeacher: string,
  mappings: SubjectTeacherMapping[],
  homeroomTeacher: string
): {
  displaySubject: string;
  teacherName: string;
  matchStatus: ParsedPeriodSlot['matchStatus'];
} {
  if (inlineTeacher) {
    return {
      displaySubject: rawSubject,
      teacherName: inlineTeacher,
      matchStatus: 'inline',
    };
  }

  const normalized = rawSubject.replace(/（/g, '(').replace(/）/g, ')').trim();
  const byExact = new Map<string, SubjectTeacherMapping>();
  mappings.forEach((m) => {
    const key = stripAllSpaces(m.subject);
    if (key && m.teacherName) {
      byExact.set(key, m);
    }
  });

  // 1. Exact subject match (e.g., 國語, 臺灣台語, 國際禮儀, 彈性時間, 數學, 生活)
  const exactHit = byExact.get(normalized);
  if (exactHit) {
    return {
      displaySubject: exactHit.subject,
      teacherName: exactHit.teacherName,
      matchStatus: 'matched',
    };
  }

  // 2. Parenthetical sub-subject match: e.g., 生活(表演), 健康與體育(體), 生(美), 彈(閱)
  const parenMatch = normalized.match(/^([^(]+)\(([^)]+)\)$/);
  if (parenMatch) {
    const mainRaw = parenMatch[1].trim();
    const subRaw = parenMatch[2].trim();
    const expandedMain = SUBJECT_PREFIX_EXPANSIONS[mainRaw] || mainRaw;

    // 2a. Exact match on sub-subject (e.g., 表演 -> 曹祐慈, 音樂 -> 黃雅鈴)
    const exactSub = byExact.get(subRaw);
    if (exactSub) {
      return {
        displaySubject: `${expandedMain}(${exactSub.subject})`,
        teacherName: exactSub.teacherName,
        matchStatus: 'matched',
      };
    }

    // 2b. Prefix/contains match on sub-subject (e.g., 體 -> 體育, 健 -> 健康, 美 -> 美勞, 閱 -> 閱讀)
    const subPrefixHit = mappings.find((m) => {
      const s = stripAllSpaces(m.subject);
      return m.teacherName && (s.startsWith(subRaw) || (subRaw.length >= 2 && s.includes(subRaw)));
    });
    if (subPrefixHit) {
      return {
        displaySubject: `${expandedMain}(${subPrefixHit.subject})`,
        teacherName: subPrefixHit.teacherName,
        matchStatus: 'matched',
      };
    }

    // 2c. Match on main subject
    const mainHit =
      byExact.get(mainRaw) ||
      byExact.get(expandedMain) ||
      mappings.find((m) => m.teacherName && stripAllSpaces(m.subject) === expandedMain);
    if (mainHit) {
      return {
        displaySubject: `${expandedMain}(${subRaw})`,
        teacherName: mainHit.teacherName,
        matchStatus: 'matched',
      };
    }
  }

  // 3. Substring / prefix match against mapping subjects (prefer longest match)
  const sortedMappings = [...mappings]
    .filter((m) => m.teacherName && m.subject.length >= 1)
    .sort((a, b) => b.subject.length - a.subject.length);

  for (const m of sortedMappings) {
    const key = stripAllSpaces(m.subject);
    if (normalized.includes(key) || (normalized.length >= 2 && key.includes(normalized))) {
      return {
        displaySubject: normalized,
        teacherName: m.teacherName,
        matchStatus: 'matched',
      };
    }
  }

  // 4. Fallback to homeroom teacher
  if (homeroomTeacher) {
    return {
      displaySubject: normalized,
      teacherName: homeroomTeacher,
      matchStatus: 'homeroom_fallback',
    };
  }

  return {
    displaySubject: normalized,
    teacherName: '',
    matchStatus: 'missing_teacher',
  };
}

function suggestVenueHint(subject: string): string {
  for (const item of SPECIALIST_VENUE_HINTS) {
    if (subject.includes(item.keyword)) {
      return item.venue;
    }
  }
  return '';
}

function extractRightSideTeachers(
  grid: GridCell[][],
  rightStartCol: number
): { mappings: SubjectTeacherMapping[]; homeroomTeacher: string } {
  const mappings: SubjectTeacherMapping[] = [];
  let homeroomTeacher = '';

  if (grid.length === 0) return { mappings, homeroomTeacher };

  const seenSubjects = new Set<string>();

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row || rightStartCol >= row.length) continue;

    // Collect distinct non-continuation cells (or vertical-merge anchor cells for area) in the right panel
    const rightCells: Array<{ col: number; text: string; isCont: boolean }> = [];
    for (let c = rightStartCol; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      // Only take the start of horizontal spans
      if (cell.colStart !== c) continue;
      rightCells.push({
        col: c,
        text: stripAllSpaces(cell.text),
        isCont: cell.isContinuation,
      });
    }

    const rowJoined = rightCells.map((x) => x.text).join(' ');
    if (!rowJoined.trim()) continue;

    // Detect 級任老師 / 導師
    if (/級任|導師/.test(rowJoined)) {
      for (const rc of rightCells) {
        if (!rc.text || /級任|導師|總節數/.test(rc.text)) continue;
        const cleaned = normalizeTeacherCell(rc.text);
        if (cleaned.length >= 2 && cleaned.length <= 5) {
          homeroomTeacher = cleaned;
          break;
        }
      }
      continue;
    }

    // Skip summary or header rows
    if (/總節數|合計|任課教師|每週各科/.test(rowJoined)) continue;

    // Find a numeric "節數" cell — in school timetables the right table is: [領域] | 科目 | 節數 | 任課教師
    const hoursIdx = rightCells.findIndex(
      (rc) => !rc.isCont && /^\d{1,2}(\.\d+)?$/.test(rc.text) && Number(rc.text) >= 1 && Number(rc.text) <= 20
    );

    if (hoursIdx >= 1) {
      const subjectCell = rightCells[hoursIdx - 1];
      const areaCell = hoursIdx >= 2 ? rightCells[hoursIdx - 2] : null;
      const teacherCell = rightCells.slice(hoursIdx + 1).find((rc) => rc.text.length > 0);

      const subject = subjectCell?.text || '';
      const teacherName = teacherCell ? normalizeTeacherCell(teacherCell.text) : '';
      const area = areaCell?.text && areaCell.text !== subject ? areaCell.text : '';
      const hours = Number(rightCells[hoursIdx].text);

      if (subject && subject !== '科目' && subject !== '領域' && teacherName) {
        if (!seenSubjects.has(subject)) {
          seenSubjects.add(subject);
          mappings.push({ area, subject, hours, teacherName });
        }
      }
    } else {
      // Fallback: 2-column right panel (科目 | 任課教師) without 節數
      const nonEmpty = rightCells.filter((rc) => !rc.isCont && rc.text.length > 0);
      if (nonEmpty.length === 2) {
        const [left, right] = nonEmpty;
        const candidateTeacher = normalizeTeacherCell(right.text);
        if (
          left.text.length >= 1 &&
          left.text.length <= 12 &&
          !/^(科目|領域|節數)$/.test(left.text) &&
          isLikelyPersonName(candidateTeacher) &&
          !seenSubjects.has(left.text)
        ) {
          seenSubjects.add(left.text);
          mappings.push({ area: '', subject: left.text, hours: null, teacherName: candidateTeacher });
        }
      }
    }
  }

  return { mappings, homeroomTeacher };
}

function parseMatrixGridToClassTimetable(params: {
  grid: GridCell[][];
  precedingTitle: string;
  sourceLabel: string;
  defaultBuilding: string;
  companionTeacherInfo?: { mappings: SubjectTeacherMapping[]; homeroomTeacher: string };
}): ParsedClassTimetable | null {
  const { grid, precedingTitle, sourceLabel, defaultBuilding, companionTeacherInfo } = params;
  if (grid.length < 3) return null;

  // 1. Find the weekday header row (contains at least 3 of 一..五)
  let weekdayRowIdx = -1;
  let weekdaySpans = new Map<number, { colStart: number; colEnd: number }>();

  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const found = new Map<number, { colStart: number; colEnd: number }>();
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell || cell.colStart !== c) continue;
      const day = parseWeekdayHeader(cell.text);
      if (day && !found.has(day)) {
        found.set(day, { colStart: cell.colStart, colEnd: cell.colStart + cell.colSpan });
      }
    }
    if (found.size >= 4) {
      weekdayRowIdx = r;
      weekdaySpans = found;
      break;
    }
  }

  if (weekdayRowIdx === -1) return null;

  // 2. Collect title text from rows above weekdayRowIdx or preceding paragraph
  let titleCandidates: string[] = [];
  for (let r = 0; r < weekdayRowIdx; r++) {
    const seen = new Set<string>();
    const rowTexts: string[] = [];
    for (let c = 0; c < grid[r].length; c++) {
      const cell = grid[r][c];
      if (cell && cell.colStart === c && !cell.isContinuation) {
        const t = cleanSpaces(cell.text);
        if (t && !seen.has(t)) {
          seen.add(t);
          rowTexts.push(t);
        }
      }
    }
    const line = rowTexts.join(' ').trim();
    if (line) titleCandidates.push(line);
  }
  if (precedingTitle.trim()) {
    titleCandidates.push(precedingTitle.trim());
  }

  const bestTitle =
    titleCandidates.find((t) => /日課表|課表|年.*班/.test(stripAllSpaces(t))) ||
    titleCandidates[0] ||
    sourceLabel;

  const meta = extractTitleMetadata(bestTitle, sourceLabel);

  // 3. Determine period column (usually col 0, or column labeled 節次/節 to the left of Monday)
  const mondayColStart = weekdaySpans.get(1)?.colStart ?? 1;
  let periodCol = 0;
  for (let r = Math.max(0, weekdayRowIdx - 1); r <= Math.min(grid.length - 1, weekdayRowIdx + 1); r++) {
    for (let c = 0; c < mondayColStart; c++) {
      const t = stripAllSpaces(grid[r][c]?.text || '');
      if (t === '節次' || t === '節' || t === '節數') {
        periodCol = c;
        break;
      }
    }
  }

  // 4. Extract right-side teacher table (columns strictly to the right of Friday)
  let maxWeekdayColEnd = 0;
  weekdaySpans.forEach((span) => {
    if (span.colEnd > maxWeekdayColEnd) maxWeekdayColEnd = span.colEnd;
  });

  const rightTeacherInfo = extractRightSideTeachers(grid, maxWeekdayColEnd);
  const teacherMappings =
    rightTeacherInfo.mappings.length > 0
      ? rightTeacherInfo.mappings
      : companionTeacherInfo?.mappings || [];
  const homeroomTeacher =
    rightTeacherInfo.homeroomTeacher || companionTeacherInfo?.homeroomTeacher || '';

  // 5. Walk rows below weekdayRowIdx and parse instructional periods 1..8
  const slots: ParsedPeriodSlot[] = [];
  const warnings: string[] = [];

  for (let r = weekdayRowIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;

    // Check period number in periodCol (or any col < mondayColStart)
    let periodNum = parsePeriodNumber(row[periodCol]?.text || '');
    if (periodNum === null) {
      for (let c = 0; c < mondayColStart; c++) {
        const candidate = parsePeriodNumber(row[c]?.text || '');
        if (candidate !== null && row[c]?.colSpan === 1) {
          // Make sure this isn't the "分鐘" column (values like 10, 20, 40 won't match 1..8)
          periodNum = candidate;
          break;
        }
      }
    }
    if (periodNum === null) continue;

    // For each weekday 1..5, collect all distinct cells spanning inside [colStart, colEnd)
    for (let day = 1; day <= 5; day++) {
      const span = weekdaySpans.get(day);
      if (!span) continue;

      const dayCells: GridCell[] = [];
      for (let c = span.colStart; c < Math.min(span.colEnd, row.length); c++) {
        const cell = row[c];
        if (!cell) continue;
        // Avoid duplicating a horizontally merged cell
        if (c > span.colStart && cell.colStart < c) continue;
        // Skip rows that span across multiple weekdays (like 午餐時間, 閱讀時間, 整潔活動)
        if (cell.colSpan > span.colEnd - span.colStart) continue;
        const clean = stripAllSpaces(cell.text);
        if (!clean) continue;
        if (NON_INSTRUCTIONAL_KEYWORDS.some((kw) => clean.includes(kw))) continue;
        dayCells.push(cell);
      }

      if (dayCells.length === 0) continue;

      const resolvedParts = dayCells.map((cell) => {
        const { cleanSubject, inlineTeacher } = normalizeSubjectRaw(cell.lines, cell.text);
        const resolved = resolveSingleSubjectAndTeacher(
          cleanSubject,
          inlineTeacher,
          teacherMappings,
          homeroomTeacher
        );
        return {
          raw: cleanSubject,
          shaded: cell.shaded,
          ...resolved,
        };
      });

      const isSplitCourse = resolvedParts.length > 1;
      const combinedSubject = resolvedParts.map((p) => p.displaySubject).join('／');
      const uniqueTeachers = Array.from(
        new Set(resolvedParts.map((p) => p.teacherName).filter(Boolean))
      );
      const combinedTeacher = uniqueTeachers.join('／');
      const isSpecialist =
        resolvedParts.some((p) => p.shaded) ||
        (Boolean(homeroomTeacher) &&
          uniqueTeachers.length > 0 &&
          uniqueTeachers.some((t) => t !== homeroomTeacher));

      const matchStatus: ParsedPeriodSlot['matchStatus'] = resolvedParts.some(
        (p) => p.matchStatus === 'missing_teacher'
      )
        ? 'missing_teacher'
        : resolvedParts.some((p) => p.matchStatus === 'homeroom_fallback')
          ? 'homeroom_fallback'
          : resolvedParts.every((p) => p.matchStatus === 'inline')
            ? 'inline'
            : 'matched';

      const venueHint = isSpecialist ? suggestVenueHint(combinedSubject) : '';
      const locationNote = isSplitCourse
        ? `分組／輪課${venueHint ? `（${venueHint}）` : ''}`
        : venueHint;

      slots.push({
        id: `slot-d${day}-p${periodNum}`,
        dayOfWeek: day,
        period: periodNum,
        rawText: resolvedParts.map((p) => p.raw).join(' / '),
        subject: clampString(combinedSubject, 50, '未命名科目'),
        teacherName: clampString(combinedTeacher, 40, ''),
        isSpecialist,
        isRelocated: Boolean(venueHint),
        locationNote: clampString(locationNote, 100, ''),
        isSplitCourse,
        matchStatus,
      });
    }
  }

  if (slots.length === 0) return null;

  const missingTeacherCount = slots.filter((s) => !s.teacherName).length;
  if (missingTeacherCount > 0) {
    warnings.push(`有 ${missingTeacherCount} 節課尚未對應到授課教師，請於下方課表補填。`);
  }
  const splitCount = slots.filter((s) => s.isSplitCourse).length;
  if (splitCount > 0) {
    warnings.push(`已自動偵測 ${splitCount} 節分割併排課程（例如單雙週或分組授課），並合併對應任課教師。`);
  }

  const defaults = GRADE_TO_DEFAULT_FLOOR[meta.grade] || { floor: '1F', roomPrefix: '101' };

  return {
    id: `cls-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    sourceLabel,
    title: meta.title,
    schoolName: meta.schoolName,
    academicYear: meta.academicYear,
    grade: meta.grade,
    className: meta.className,
    homeroomTeacher,
    building: defaultBuilding,
    floor: defaults.floor,
    roomNumber: defaults.roomPrefix,
    teacherMappings,
    slots,
    warnings,
  };
}

// ============================================================================
// 1. Word (.docx) XML Table Matrix Extractor (via JSZip + DOMParser)
// ============================================================================

function getXmlChildrenByLocalName(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < parent.childNodes.length; i++) {
    const node = parent.childNodes[i];
    if (node.nodeType === 1 && (node as Element).localName === localName) {
      result.push(node as Element);
    }
  }
  return result;
}

function getXmlAttr(el: Element | null, localName: string): string | null {
  if (!el) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    if (attr.localName === localName) {
      return attr.value;
    }
  }
  return null;
}

function extractParagraphText(pEl: Element): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const ln = el.localName;
    if (ln === 't' || ln === 'delText') {
      out += el.textContent || '';
    } else if (ln === 'br' || ln === 'cr') {
      out += '\n';
    } else if (ln === 'tab') {
      out += ' ';
    } else {
      for (let i = 0; i < el.childNodes.length; i++) {
        walk(el.childNodes[i]);
      }
    }
  };
  walk(pEl);
  return out.trim();
}

function extractDocxTableGrid(tblEl: Element): GridCell[][] {
  const trEls = getXmlChildrenByLocalName(tblEl, 'tr');
  const rawRows: Array<
    Array<{
      text: string;
      lines: string[];
      colStart: number;
      colSpan: number;
      vMerge: 'restart' | 'continue' | null;
      shaded: boolean;
    }>
  > = [];
  let maxCols = 0;

  for (const tr of trEls) {
    const trPr = getXmlChildrenByLocalName(tr, 'trPr')[0] || null;
    const gridBeforeEl = trPr ? getXmlChildrenByLocalName(trPr, 'gridBefore')[0] || null : null;
    let colCursor = Number(getXmlAttr(gridBeforeEl, 'val') || '0') || 0;

    const rowItems: (typeof rawRows)[number] = [];
    const tcEls = getXmlChildrenByLocalName(tr, 'tc');

    for (const tc of tcEls) {
      const tcPr = getXmlChildrenByLocalName(tc, 'tcPr')[0] || null;
      const gridSpanEl = tcPr ? getXmlChildrenByLocalName(tcPr, 'gridSpan')[0] || null : null;
      const colSpan = Math.max(1, Number(getXmlAttr(gridSpanEl, 'val') || '1') || 1);

      const vMergeEl = tcPr ? getXmlChildrenByLocalName(tcPr, 'vMerge')[0] || null : null;
      let vMerge: 'restart' | 'continue' | null = null;
      if (vMergeEl) {
        const val = getXmlAttr(vMergeEl, 'val');
        vMerge = val === 'restart' ? 'restart' : 'continue';
      }

      const shdEl = tcPr ? getXmlChildrenByLocalName(tcPr, 'shd')[0] || null : null;
      const fill = (getXmlAttr(shdEl, 'fill') || '').toUpperCase();
      const shaded = Boolean(fill && fill !== 'AUTO' && fill !== 'FFFFFF' && fill !== '000000');

      const paragraphs = getXmlChildrenByLocalName(tc, 'p');
      const lines = paragraphs
        .flatMap((p) => extractParagraphText(p).split('\n'))
        .map((l) => l.trim())
        .filter(Boolean);
      const text = lines.join('\n');

      rowItems.push({
        text,
        lines,
        colStart: colCursor,
        colSpan,
        vMerge,
        shaded,
      });

      colCursor += colSpan;
    }

    if (colCursor > maxCols) maxCols = colCursor;
    rawRows.push(rowItems);
  }

  // Build normalized 2D matrix resolving vMerge continuations
  const grid: GridCell[][] = [];
  for (let r = 0; r < rawRows.length; r++) {
    const rowCells: GridCell[] = new Array(maxCols);
    for (const item of rawRows[r]) {
      if (item.vMerge === 'continue' && r > 0) {
        const above = grid[r - 1]?.[item.colStart];
        const contCell: GridCell = {
          text: above?.text || item.text,
          lines: above?.lines || item.lines,
          colStart: item.colStart,
          colSpan: item.colSpan,
          rowStart: above?.rowStart ?? r,
          rowSpan: 1,
          shaded: above?.shaded || item.shaded,
          isContinuation: true,
        };
        for (let c = item.colStart; c < item.colStart + item.colSpan && c < maxCols; c++) {
          rowCells[c] = contCell;
        }
      } else {
        const cell: GridCell = {
          text: item.text,
          lines: item.lines,
          colStart: item.colStart,
          colSpan: item.colSpan,
          rowStart: r,
          rowSpan: 1,
          shaded: item.shaded,
          isContinuation: false,
        };
        for (let c = item.colStart; c < item.colStart + item.colSpan && c < maxCols; c++) {
          rowCells[c] = cell;
        }
      }
    }
    grid.push(rowCells);
  }

  return grid;
}

async function parseDocxFile(
  file: File,
  defaultBuilding: string
): Promise<TimetableParseResult> {
  try {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) {
      return {
        classes: [],
        errors: [`${file.name}：無法讀取 Word 內容（請確認為 .docx 格式，若是舊版 .doc 請先於 Word 另存為 .docx）`],
      };
    }

    const xmlText = await docXmlFile.async('string');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    const body = xmlDoc.getElementsByTagNameNS('*', 'body')[0];
    if (!body) {
      return { classes: [], errors: [`${file.name}：Word 文件結構異常`] };
    }

    // Collect top-level tables paired with their nearest preceding heading paragraph
    const tablesWithTitle: Array<{ tbl: Element; precedingTitle: string }> = [];
    let lastParagraphText = '';

    const collectFromContainer = (container: Element) => {
      for (let i = 0; i < container.childNodes.length; i++) {
        const node = container.childNodes[i];
        if (node.nodeType !== 1) continue;
        const el = node as Element;
        if (el.localName === 'p') {
          const txt = extractParagraphText(el);
          if (txt) lastParagraphText = txt;
        } else if (el.localName === 'tbl') {
          tablesWithTitle.push({ tbl: el, precedingTitle: lastParagraphText });
          lastParagraphText = '';
        } else if (el.localName === 'sdt') {
          const sdtContent = getXmlChildrenByLocalName(el, 'sdtContent')[0];
          if (sdtContent) collectFromContainer(sdtContent);
        }
      }
    };

    collectFromContainer(body);

    if (tablesWithTitle.length === 0) {
      return { classes: [], errors: [`${file.name}：文件中未找到任何課表表格`] };
    }

    const grids = tablesWithTitle.map((t) => ({
      grid: extractDocxTableGrid(t.tbl),
      precedingTitle: t.precedingTitle,
    }));

    const classes: ParsedClassTimetable[] = [];
    for (let i = 0; i < grids.length; i++) {
      // If next table is a standalone teacher assignment table, pass it as companion info
      const nextGrid = grids[i + 1]?.grid;
      const companion = nextGrid ? extractRightSideTeachers(nextGrid, 0) : undefined;
      const parsed = parseMatrixGridToClassTimetable({
        grid: grids[i].grid,
        precedingTitle: grids[i].precedingTitle,
        sourceLabel: grids.length > 1 ? `${file.name} (表 ${i + 1})` : file.name,
        defaultBuilding,
        companionTeacherInfo: companion,
      });
      if (parsed) {
        classes.push(parsed);
      }
    }

    if (classes.length === 0) {
      return {
        classes: [],
        errors: [`${file.name}：已讀取 ${tablesWithTitle.length} 個表格，但未偵測到「星期一～五」與「節次 1～8」結構`],
      };
    }

    return { classes, errors: [] };
  } catch (err) {
    return {
      classes: [],
      errors: [`${file.name} 解析失敗：${err instanceof Error ? err.message : '檔案格式不支援'}`],
    };
  }
}

// ============================================================================
// 2. Excel (.xlsx / .xls) Matrix & Flat Extractor
// ============================================================================

function sheetToGrid(ws: XLSX.WorkSheet): GridCell[][] {
  const ref = ws['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const rowCount = Math.min(range.e.r - range.s.r + 1, 60);
  const colCount = Math.min(range.e.c - range.s.c + 1, 30);

  const grid: GridCell[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => {
      const addr = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c });
      const rawCell = ws[addr];
      const text = rawCell?.v !== undefined && rawCell?.v !== null ? String(rawCell.v).trim() : '';
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      return {
        text,
        lines,
        colStart: c,
        colSpan: 1,
        rowStart: r,
        rowSpan: 1,
        shaded: false,
        isContinuation: false,
      };
    })
  );

  // Apply merged ranges
  const merges = ws['!merges'] || [];
  for (const m of merges) {
    const r0 = m.s.r - range.s.r;
    const c0 = m.s.c - range.s.c;
    const r1 = Math.min(m.e.r - range.s.r, rowCount - 1);
    const c1 = Math.min(m.e.c - range.s.c, colCount - 1);
    if (r0 < 0 || c0 < 0 || r0 >= rowCount || c0 >= colCount) continue;
    const anchor = grid[r0][c0];
    anchor.colSpan = c1 - c0 + 1;
    anchor.rowSpan = r1 - r0 + 1;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r === r0 && c === c0) continue;
        grid[r][c] = {
          text: anchor.text,
          lines: anchor.lines,
          colStart: c0,
          colSpan: anchor.colSpan,
          rowStart: r0,
          rowSpan: anchor.rowSpan,
          shaded: anchor.shaded,
          isContinuation: r > r0,
        };
      }
    }
  }

  return grid;
}

function flatRowsToParsedClasses(
  rows: ParsedTimetableImportRow[],
  sourceLabel: string
): ParsedClassTimetable[] {
  const byClass = new Map<string, ParsedTimetableImportRow[]>();
  rows.forEach((r) => {
    const list = byClass.get(r.className) || [];
    list.push(r);
    byClass.set(r.className, list);
  });

  const classes: ParsedClassTimetable[] = [];
  byClass.forEach((classRows, className) => {
    const first = classRows[0];
    classes.push({
      id: `cls-flat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sourceLabel,
      title: `${first.grade} ${className} 日課表`,
      schoolName: '',
      academicYear: '',
      grade: first.grade,
      className,
      homeroomTeacher: '',
      building: first.building,
      floor: first.floor,
      roomNumber: first.roomNumber,
      teacherMappings: [],
      slots: classRows.map((r, idx) => ({
        id: `slot-d${r.dayOfWeek}-p${r.period}-${idx}`,
        dayOfWeek: r.dayOfWeek,
        period: r.period,
        rawText: r.subject,
        subject: r.subject,
        teacherName: r.teacherName,
        isSpecialist: r.isRelocated,
        isRelocated: r.isRelocated,
        locationNote: r.locationNote,
        isSplitCourse: false,
        matchStatus: 'matched',
      })),
      warnings: [],
    });
  });

  return classes;
}

async function parseExcelFile(
  file: File,
  defaultBuilding: string
): Promise<TimetableParseResult> {
  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const classes: ParsedClassTimetable[] = [];
    const errors: string[] = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;

      // 1. Check if sheet is a flat tabular timetable (columns include 星期 + 節次 + 班別/班級)
      const csvText = XLSX.utils.sheet_to_csv(ws);
      const firstLine = csvText.split(/\r?\n/)[0] || '';
      if (firstLine.includes('星期') && firstLine.includes('節次') && /班別|班級/.test(firstLine)) {
        const { rows, errors: flatErrs } = parseTimetableCsv(csvText);
        if (rows.length > 0) {
          classes.push(...flatRowsToParsedClasses(rows, `${file.name} · ${sheetName}`));
          continue;
        }
        if (flatErrs.length > 0) errors.push(`${sheetName}：${flatErrs[0]}`);
      }

      // 2. Otherwise parse as a Taiwanese school 日課表 matrix
      const grid = sheetToGrid(ws);
      const parsed = parseMatrixGridToClassTimetable({
        grid,
        precedingTitle: sheetName,
        sourceLabel: `${file.name} · ${sheetName}`,
        defaultBuilding,
      });
      if (parsed) {
        classes.push(parsed);
      }
    }

    if (classes.length === 0 && errors.length === 0) {
      errors.push(`${file.name}：未在工作表中找到「星期一～五」日課表格式或標準清單欄位`);
    }

    return { classes, errors };
  } catch (err) {
    return {
      classes: [],
      errors: [`${file.name} 解析失敗：${err instanceof Error ? err.message : 'Excel 格式錯誤'}`],
    };
  }
}

// ============================================================================
// 3. HTML Table & Clipboard Paste Extractor
// ============================================================================

function htmlTableToGrid(tableEl: HTMLTableElement): GridCell[][] {
  const trs = Array.from(tableEl.querySelectorAll('tr'));
  const grid: Array<Array<GridCell | undefined>> = [];

  trs.forEach((tr, r) => {
    if (!grid[r]) grid[r] = [];
    let colCursor = 0;
    const cells = Array.from(tr.children).filter(
      (el) => el.tagName === 'TD' || el.tagName === 'TH'
    ) as HTMLTableCellElement[];

    cells.forEach((td) => {
      while (grid[r][colCursor]) colCursor++;
      const colSpan = Math.max(1, td.colSpan || 1);
      const rowSpan = Math.max(1, td.rowSpan || 1);

      const rawText = (td.innerText || td.textContent || '').trim();
      const lines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const bg = (td.style.backgroundColor || td.getAttribute('bgcolor') || '').toLowerCase();
      const shaded = Boolean(bg && bg !== 'transparent' && bg !== '#ffffff' && bg !== 'white' && bg !== 'rgb(255, 255, 255)');

      const anchor: GridCell = {
        text: rawText,
        lines,
        colStart: colCursor,
        colSpan,
        rowStart: r,
        rowSpan,
        shaded,
        isContinuation: false,
      };

      for (let rr = r; rr < r + rowSpan; rr++) {
        if (!grid[rr]) grid[rr] = [];
        for (let cc = colCursor; cc < colCursor + colSpan; cc++) {
          grid[rr][cc] =
            rr === r
              ? anchor
              : {
                  ...anchor,
                  isContinuation: true,
                };
        }
      }
      colCursor += colSpan;
    });
  });

  const maxCols = grid.reduce((m, row) => Math.max(m, row.length), 0);
  return grid.map((row, r) =>
    Array.from({ length: maxCols }, (_, c) => {
      return (
        row[c] || {
          text: '',
          lines: [],
          colStart: c,
          colSpan: 1,
          rowStart: r,
          rowSpan: 1,
          shaded: false,
          isContinuation: false,
        }
      );
    })
  );
}

export function parseHtmlOrPastedTimetable(params: {
  html?: string;
  plainText?: string;
  sourceLabel?: string;
  defaultBuilding: string;
}): TimetableParseResult {
  const { html = '', plainText = '', sourceLabel = '貼上課表', defaultBuilding } = params;
  const classes: ParsedClassTimetable[] = [];

  if (html && /<table/i.test(html)) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const tables = Array.from(doc.querySelectorAll('table'));

    tables.forEach((tbl, idx) => {
      let precedingTitle = '';
      let prev = tbl.previousElementSibling;
      while (prev) {
        const t = (prev.textContent || '').trim();
        if (t) {
          precedingTitle = t;
          break;
        }
        prev = prev.previousElementSibling;
      }
      const grid = htmlTableToGrid(tbl);
      const parsed = parseMatrixGridToClassTimetable({
        grid,
        precedingTitle,
        sourceLabel: tables.length > 1 ? `${sourceLabel} (表 ${idx + 1})` : sourceLabel,
        defaultBuilding,
      });
      if (parsed) classes.push(parsed);
    });

    if (classes.length > 0) {
      return { classes, errors: [] };
    }
  }

  // Try plain text (TSV from Word/Excel copy or CSV)
  const trimmed = plainText.trim();
  if (!trimmed) {
    return { classes: [], errors: ['未偵測到貼上的課表內容'] };
  }

  // First check flat CSV/TSV format
  const asCsv = trimmed.includes('\t')
    ? trimmed
        .split(/\r?\n/)
        .map((line) =>
          line
            .split('\t')
            .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
            .join(',')
        )
        .join('\n')
    : trimmed;

  const firstLine = asCsv.split(/\r?\n/)[0] || '';
  if (firstLine.includes('星期') && firstLine.includes('節次') && /班別|班級/.test(firstLine)) {
    const { rows, errors } = parseTimetableCsv(asCsv);
    if (rows.length > 0) {
      return { classes: flatRowsToParsedClasses(rows, sourceLabel), errors };
    }
  }

  // Otherwise try matrix TSV
  const tsvRows = trimmed.split(/\r?\n/).map((line) => line.split('\t'));
  const maxCols = tsvRows.reduce((m, r) => Math.max(m, r.length), 0);
  const grid: GridCell[][] = tsvRows.map((row, r) =>
    Array.from({ length: maxCols }, (_, c) => {
      const text = (row[c] || '').trim();
      return {
        text,
        lines: text ? [text] : [],
        colStart: c,
        colSpan: 1,
        rowStart: r,
        rowSpan: 1,
        shaded: false,
        isContinuation: false,
      };
    })
  );

  const parsed = parseMatrixGridToClassTimetable({
    grid,
    precedingTitle: tsvRows[0]?.join(' ') || '',
    sourceLabel,
    defaultBuilding,
  });

  if (parsed) {
    return { classes: [parsed], errors: [] };
  }

  return {
    classes: [],
    errors: [
      '無法辨識貼上的表格格式。建議直接上傳 Word (.docx)／Excel (.xlsx) 檔案，或在 Word/Excel 全選課表複製貼上。',
    ],
  };
}

// ============================================================================
// 4. Native PDF (.pdf) Coordinate-Based School Timetable Extractor (pdfjs-dist)
// ============================================================================

interface PdfTextBox {
  str: string;
  x0: number;
  x1: number;
  cx: number;
  y: number;
  cy: number;
  w: number;
  h: number;
}

function joinPdfBoxesAsLines(boxes: PdfTextBox[]): string[] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => b.cy - a.cy || a.x0 - b.x0);
  const lines: PdfTextBox[][] = [];

  for (const box of sorted) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      lines.push([box]);
    } else {
      const refY = lastLine.reduce((s, b) => s + b.cy, 0) / lastLine.length;
      if (Math.abs(box.cy - refY) <= 5.5) {
        lastLine.push(box);
      } else {
        lines.push([box]);
      }
    }
  }

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x0 - b.x0)
        .map((b) => b.str)
        .join('')
        .trim()
    )
    .filter(Boolean);
}

function clusterBoxesByX(boxes: PdfTextBox[], minGap = 9): PdfTextBox[][] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => a.x0 - b.x0);
  const clusters: PdfTextBox[][] = [[sorted[0]]];
  let clusterMaxX = sorted[0].x1;

  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.x0 - clusterMaxX > minGap) {
      clusters.push([b]);
      clusterMaxX = b.x1;
    } else {
      clusters[clusters.length - 1].push(b);
      if (b.x1 > clusterMaxX) clusterMaxX = b.x1;
    }
  }
  return clusters;
}

function mergeAdjacentPdfChars(rawBoxes: PdfTextBox[]): PdfTextBox[] {
  if (rawBoxes.length <= 1) return rawBoxes;
  const sorted = [...rawBoxes].sort((a, b) => b.cy - a.cy || a.x0 - b.x0);
  const merged: PdfTextBox[] = [];

  for (const box of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      Math.abs(prev.cy - box.cy) <= 3.5 &&
      box.x0 >= prev.x0 - 1 &&
      box.x0 - prev.x1 <= 3.5
    ) {
      const nextX1 = Math.max(prev.x1, box.x1);
      const nextStr = prev.str + box.str;
      prev.str = nextStr;
      prev.x1 = nextX1;
      prev.w = nextX1 - prev.x0;
      prev.cx = prev.x0 + prev.w / 2;
      prev.cy = (prev.cy + box.cy) / 2;
    } else {
      merged.push({ ...box });
    }
  }
  return merged;
}

function parsePdfPageBoxes(
  rawBoxes: PdfTextBox[],
  sourceLabel: string,
  defaultBuilding: string
): ParsedClassTimetable | null {
  const boxes = mergeAdjacentPdfChars(rawBoxes);
  if (boxes.length < 10) return null;

  // 1. Locate weekday header row (一, 二, 三, 四, 五) sharing the same horizontal band
  const weekdayCandidates = boxes
    .map((b) => ({ box: b, day: parseWeekdayHeader(b.str) }))
    .filter((item): item is { box: PdfTextBox; day: number } => item.day !== null);

  let bestBand: Array<{ box: PdfTextBox; day: number }> = [];
  for (const seed of weekdayCandidates) {
    const band = weekdayCandidates.filter((c) => Math.abs(c.box.cy - seed.box.cy) <= 12);
    const byDay = new Map<number, { box: PdfTextBox; day: number }>();
    band
      .sort((a, b) => a.box.cx - b.box.cx)
      .forEach((item) => {
        if (!byDay.has(item.day)) byDay.set(item.day, item);
      });
    const ordered = Array.from(byDay.values()).sort((a, b) => a.day - b.day);
    // Verify strictly increasing X from Mon -> Fri
    let strictlyIncreasing = true;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].box.cx <= ordered[i - 1].box.cx + 10) {
        strictlyIncreasing = false;
        break;
      }
    }
    if (strictlyIncreasing && ordered.length > bestBand.length) {
      bestBand = ordered;
    }
  }

  if (bestBand.length < 4) return null;

  const headerY = bestBand.reduce((s, item) => s + item.box.cy, 0) / bestBand.length;
  const dayCenterMap = new Map<number, number>();
  bestBand.forEach((item) => dayCenterMap.set(item.day, item.box.cx));

  // Estimate column spacing for 5 weekdays
  const firstDay = bestBand[0];
  const lastDay = bestBand[bestBand.length - 1];
  const avgColWidth =
    lastDay.day > firstDay.day
      ? (lastDay.box.cx - firstDay.box.cx) / (lastDay.day - firstDay.day)
      : 55;

  // Fill any missing weekday center by linear interpolation
  for (let d = 1; d <= 5; d++) {
    if (!dayCenterMap.has(d)) {
      dayCenterMap.set(d, firstDay.box.cx + (d - firstDay.day) * avgColWidth);
    }
  }

  const colBounds = new Map<number, { left: number; right: number; mid: number }>();
  for (let d = 1; d <= 5; d++) {
    const mid = dayCenterMap.get(d)!;
    const prevMid = d > 1 ? dayCenterMap.get(d - 1)! : mid - avgColWidth;
    const nextMid = d < 5 ? dayCenterMap.get(d + 1)! : mid + avgColWidth;
    colBounds.set(d, {
      left: (prevMid + mid) / 2,
      right: (mid + nextMid) / 2,
      mid,
    });
  }

  const monLeft = colBounds.get(1)!.left;
  const friRight = colBounds.get(5)!.right;

  // 2. Extract Title above headerY
  const titleBoxes = boxes.filter((b) => b.cy > headerY + 14);
  const titleText = joinPdfBoxesAsLines(titleBoxes).join(' ');
  const meta = extractTitleMetadata(titleText, sourceLabel);

  // 3. Locate footer bottom limit (承辦人 / 教務主任 / 校長)
  const footerBoxes = boxes.filter(
    (b) => b.cy < headerY - 200 && /承辦人|教務主任|人事主任|校長/.test(stripAllSpaces(b.str))
  );
  const footerTopY = footerBoxes.length > 0 ? Math.max(...footerBoxes.map((b) => b.cy)) + 16 : 0;

  // 4. Locate instructional period numbers (1..8) in leftmost column (x < monLeft)
  const leftBoxes = boxes.filter((b) => b.cx < monLeft && b.cy < headerY - 12 && b.cy > footerTopY);

  // Find X of the 節次 header column (leftmost header label)
  const periodHeaderBoxes = boxes.filter(
    (b) => b.cx < monLeft && Math.abs(b.cy - headerY) <= 30 && /^(節|次|節次)$/.test(stripAllSpaces(b.str))
  );
  const minLeftX = leftBoxes.length > 0 ? Math.min(...leftBoxes.map((b) => b.cx)) : 40;
  const periodColX =
    periodHeaderBoxes.length > 0
      ? periodHeaderBoxes.reduce((s, b) => s + b.cx, 0) / periodHeaderBoxes.length
      : minLeftX;

  const periodCandidates = leftBoxes
    .filter((b) => Math.abs(b.cx - periodColX) <= 18)
    .map((b) => ({ box: b, period: parsePeriodNumber(b.str) }))
    .filter((item): item is { box: PdfTextBox; period: number } => item.period !== null)
    .sort((a, b) => b.box.cy - a.box.cy);

  // Deduplicate keeping monotonically increasing periods 1..8 from top to bottom
  const periodAnchors: Array<{ period: number; y: number }> = [];
  let lastPeriod = 0;
  for (const cand of periodCandidates) {
    if (cand.period > lastPeriod) {
      periodAnchors.push({ period: cand.period, y: cand.box.cy });
      lastPeriod = cand.period;
    }
  }

  if (periodAnchors.length === 0) return null;

  // 5. Find non-instructional break row anchors (導師時間 / 閱讀時間 / 課間活動 / 午餐 / 午休 / 整潔)
  // Both from time column ("8:00-8:25", "10:00-10:10", "12:00-12:40"...) and grid text
  const breakAnchorYs: number[] = [];
  const timeRangeRegex = /^\d{1,2}:\d{2}\s*[-–~]\s*\d{1,2}:\d{2}$/;
  leftBoxes.forEach((b) => {
    if (timeRangeRegex.test(stripAllSpaces(b.str))) {
      const nearPeriod = periodAnchors.some((p) => Math.abs(p.y - b.cy) < 12);
      if (!nearPeriod) breakAnchorYs.push(b.cy);
    }
  });

  // Also scan Mon-Fri grid for break-row text lines (e.g., 閱讀時間, 課間活動, 午餐時間, 午休時間, 整潔活動)
  const gridBoxesAll = boxes.filter(
    (b) => b.cx >= monLeft - 2 && b.cx <= friRight + 2 && b.cy < headerY - 8 && b.cy > footerTopY
  );
  const gridLinesByY: Array<{ y: number; text: string }> = [];
  for (const b of [...gridBoxesAll].sort((a, b) => b.cy - a.cy)) {
    const existing = gridLinesByY.find((l) => Math.abs(l.y - b.cy) <= 6);
    if (existing) {
      existing.text += b.str;
    } else {
      gridLinesByY.push({ y: b.cy, text: b.str });
    }
  }
  const breakLineYs: number[] = [];
  gridLinesByY.forEach((line) => {
    const clean = stripAllSpaces(line.text);
    if (NON_INSTRUCTIONAL_KEYWORDS.some((kw) => clean.includes(kw))) {
      breakLineYs.push(line.y);
      const nearPeriod = periodAnchors.some((p) => Math.abs(p.y - line.y) < 12);
      if (!nearPeriod && !breakAnchorYs.some((by) => Math.abs(by - line.y) < 10)) {
        breakAnchorYs.push(line.y);
      }
    }
  });

  // Combine all row anchors sorted from top (high y) to bottom (low y)
  type RowAnchor = { kind: 'period'; period: number; y: number } | { kind: 'break'; y: number };
  const allAnchors: RowAnchor[] = [
    ...periodAnchors.map((p) => ({ kind: 'period' as const, period: p.period, y: p.y })),
    ...breakAnchorYs.map((y) => ({ kind: 'break' as const, y })),
  ].sort((a, b) => b.y - a.y);

  // Compute vertical band [yLow, yHigh] for each period anchor
  const avgRowStep =
    periodAnchors.length >= 2
      ? Math.min(
          75,
          Math.max(
            36,
            (periodAnchors[0].y - periodAnchors[periodAnchors.length - 1].y) /
              Math.max(1, periodAnchors.length - 1)
          )
        )
      : 54;

  const periodBands = new Map<number, { yLow: number; yHigh: number }>();
  for (let i = 0; i < allAnchors.length; i++) {
    const cur = allAnchors[i];
    if (cur.kind !== 'period') continue;
    const prev = allAnchors[i - 1];
    const next = allAnchors[i + 1];

    const yHigh = prev
      ? Math.min(cur.y + avgRowStep * 0.6, (prev.y + cur.y) / 2)
      : Math.min(headerY - 10, cur.y + avgRowStep * 0.55);

    const yLow = next
      ? Math.max(cur.y - avgRowStep * 0.6, (cur.y + next.y) / 2)
      : Math.max(footerTopY, cur.y - avgRowStep * 0.55);

    periodBands.set(cur.period, { yLow, yHigh });
  }

  // 6. Extract Right-Side Teacher Assignment Table (x > friRight)
  const rightBoxes = boxes.filter(
    (b) => b.cx > friRight - 2 && b.cy < headerY + 5 && b.cy > footerTopY
  );

  let homeroomTeacher = '';
  const teacherMappings: SubjectTeacherMapping[] = [];

  // 6a. Detect 級任老師 / 導師 near bottom right
  const homeroomLabelBoxes = rightBoxes.filter((b) =>
    /^(級|任|老|師|級任|級任老師|導師|班導師)$/.test(stripAllSpaces(b.str))
  );
  // Find a cluster of 級/任/老/師 near bottom of rightBoxes
  const bottomRightY =
    rightBoxes.length > 0 ? Math.min(...rightBoxes.map((b) => b.cy)) : footerTopY;
  const bottomHomeroomLabels = homeroomLabelBoxes.filter((b) => b.cy <= bottomRightY + 95);
  if (bottomHomeroomLabels.length > 0) {
    const labelMaxX = Math.max(...bottomHomeroomLabels.map((b) => b.x1));
    const labelMinY = Math.min(...bottomHomeroomLabels.map((b) => b.cy)) - 14;
    const labelMaxY = Math.max(...bottomHomeroomLabels.map((b) => b.cy)) + 14;
    const candidateBoxes = rightBoxes.filter(
      (b) => b.cx > labelMaxX + 4 && b.cy >= labelMinY && b.cy <= labelMaxY
    );
    const rawTeacher = joinPdfBoxesAsLines(candidateBoxes).join('');
    const cleaned = normalizeTeacherCell(rawTeacher);
    if (cleaned.length >= 2 && cleaned.length <= 5) {
      homeroomTeacher = cleaned;
    }
  }

  // 6b. Locate 節數 & 任課教師 column X positions in the right-side panel
  const rightTopLines = rightBoxes.filter((b) => b.cy >= headerY - 95);
  const hoursHeaderBox = rightTopLines.find((b) => /節數/.test(stripAllSpaces(b.str)));
  const teacherHeaderBox = rightTopLines.find((b) => /任課教師|教師|老師/.test(stripAllSpaces(b.str)));

  if (hoursHeaderBox) {
    const xHours = hoursHeaderBox.cx;
    const xTeacherMid = teacherHeaderBox ? teacherHeaderBox.cx : xHours + 45;
    const hoursLeftBound = hoursHeaderBox.x0 - 8;
    const hoursRightBound = Math.min(hoursHeaderBox.x1 + 8, (xHours + xTeacherMid) / 2);

    // Find 總節數 row Y so we exclude summary and 級任老師 rows below it
    const totalRowBox = rightBoxes.find((b) => /總節數|合計/.test(stripAllSpaces(b.str)));
    const mappingFloorY = totalRowBox
      ? totalRowBox.cy + 10
      : bottomHomeroomLabels.length > 0
        ? Math.max(...bottomHomeroomLabels.map((b) => b.cy)) + 15
        : footerTopY;

    const hoursRows = rightBoxes
      .filter(
        (b) =>
          b.cy < hoursHeaderBox.cy - 6 &&
          b.cy > mappingFloorY &&
          b.cx >= hoursLeftBound &&
          b.cx <= hoursRightBound &&
          /^\d{1,2}(\.\d+)?$/.test(stripAllSpaces(b.str))
      )
      .sort((a, b) => b.cy - a.cy);

    const seenSubjects = new Set<string>();
    for (let i = 0; i < hoursRows.length; i++) {
      const hr = hoursRows[i];
      const prevHr = hoursRows[i - 1];
      const nextHr = hoursRows[i + 1];

      const rowHigh = prevHr ? (prevHr.cy + hr.cy) / 2 : Math.min(hoursHeaderBox.cy - 4, hr.cy + 20);
      const rowLow = nextHr ? (hr.cy + nextHr.cy) / 2 : Math.max(mappingFloorY, hr.cy - 20);

      // Teacher name to the right of hours column
      const tBoxes = rightBoxes.filter(
        (b) => b.cx > hoursRightBound && b.cy >= rowLow && b.cy <= rowHigh
      );
      const teacherName = normalizeTeacherCell(joinPdfBoxesAsLines(tBoxes).join(''));

      // Subject name to the left of hours column (if both 領域 and 科目 exist, pick rightmost X-cluster!)
      const sBoxes = rightBoxes.filter(
        (b) => b.cx >= friRight - 2 && b.cx < hoursLeftBound && b.cy >= rowLow && b.cy <= rowHigh
      );
      const xClusters = clusterBoxesByX(sBoxes, 8);
      const subjectCluster = xClusters[xClusters.length - 1] || [];
      const areaCluster = xClusters.length >= 2 ? xClusters[0] : [];

      const subject = stripAllSpaces(joinPdfBoxesAsLines(subjectCluster).join(''));
      const area = stripAllSpaces(joinPdfBoxesAsLines(areaCluster).join(''));
      const hours = Number(stripAllSpaces(hr.str));

      if (subject && teacherName && !seenSubjects.has(subject)) {
        seenSubjects.add(subject);
        teacherMappings.push({ area, subject, hours, teacherName });
      }
    }
  }

  // 7. Extract Mon-Fri × Period 1..8 cells (including split-cell detection like 生(美) | 彈(閱))
  const slots: ParsedPeriodSlot[] = [];
  const warnings: string[] = [];

  for (const anchor of periodAnchors) {
    const band = periodBands.get(anchor.period);
    if (!band) continue;

    for (let day = 1; day <= 5; day++) {
      const col = colBounds.get(day)!;
      const cellBoxes = gridBoxesAll.filter(
        (b) =>
          b.cx >= col.left &&
          b.cx <= col.right &&
          b.cy >= band.yLow &&
          b.cy <= band.yHigh &&
          !breakLineYs.some((by) => Math.abs(b.cy - by) <= 7)
      );

      if (cellBoxes.length === 0) continue;

      // Detect horizontally split cell (e.g., 生(美) on left half + 彈(閱) on right half)
      const leftHalf = cellBoxes.filter((b) => b.cx < col.mid - 1);
      const rightHalf = cellBoxes.filter((b) => b.cx > col.mid + 1);
      let subCellGroups: PdfTextBox[][] = [cellBoxes];

      if (leftHalf.length > 0 && rightHalf.length > 0) {
        const leftMaxX = Math.max(...leftHalf.map((b) => b.x1));
        const rightMinX = Math.min(...rightHalf.map((b) => b.x0));
        const leftText = stripAllSpaces(joinPdfBoxesAsLines(leftHalf).join(''));
        const rightText = stripAllSpaces(joinPdfBoxesAsLines(rightHalf).join(''));
        const bothSelfContained =
          leftMaxX <= rightMinX + 1 &&
          leftText.length >= 2 &&
          rightText.length >= 2 &&
          (/[()（）]/.test(leftText) || /[()（）]/.test(rightText));

        if (bothSelfContained) {
          subCellGroups = [leftHalf, rightHalf];
        }
      }

      const resolvedParts: Array<{
        raw: string;
        displaySubject: string;
        teacherName: string;
        matchStatus: ParsedPeriodSlot['matchStatus'];
      }> = [];

      for (const group of subCellGroups) {
        const lines = joinPdfBoxesAsLines(group);
        const rawJoined = lines.join('\n');
        const cleanJoined = stripAllSpaces(rawJoined);
        if (!cleanJoined || NON_INSTRUCTIONAL_KEYWORDS.some((kw) => cleanJoined.includes(kw))) {
          continue;
        }
        const { cleanSubject, inlineTeacher } = normalizeSubjectRaw(lines, rawJoined);
        if (!cleanSubject) continue;
        const resolved = resolveSingleSubjectAndTeacher(
          cleanSubject,
          inlineTeacher,
          teacherMappings,
          homeroomTeacher
        );
        resolvedParts.push({ raw: cleanSubject, ...resolved });
      }

      if (resolvedParts.length === 0) continue;

      const isSplitCourse = resolvedParts.length > 1;
      const combinedSubject = resolvedParts.map((p) => p.displaySubject).join('／');
      const uniqueTeachers = Array.from(
        new Set(resolvedParts.map((p) => p.teacherName).filter(Boolean))
      );
      const combinedTeacher = uniqueTeachers.join('／');
      const isSpecialist =
        Boolean(homeroomTeacher) &&
        uniqueTeachers.length > 0 &&
        uniqueTeachers.some((t) => t !== homeroomTeacher);

      const matchStatus: ParsedPeriodSlot['matchStatus'] = resolvedParts.some(
        (p) => p.matchStatus === 'missing_teacher'
      )
        ? 'missing_teacher'
        : resolvedParts.some((p) => p.matchStatus === 'homeroom_fallback')
          ? 'homeroom_fallback'
          : resolvedParts.every((p) => p.matchStatus === 'inline')
            ? 'inline'
            : 'matched';

      const venueHint = isSpecialist ? suggestVenueHint(combinedSubject) : '';
      const locationNote = isSplitCourse
        ? `分組／輪課${venueHint ? `（${venueHint}）` : ''}`
        : venueHint;

      slots.push({
        id: `slot-d${day}-p${anchor.period}`,
        dayOfWeek: day,
        period: anchor.period,
        rawText: resolvedParts.map((p) => p.raw).join(' / '),
        subject: clampString(combinedSubject, 50, '未命名科目'),
        teacherName: clampString(combinedTeacher, 40, ''),
        isSpecialist,
        isRelocated: Boolean(venueHint),
        locationNote: clampString(locationNote, 100, ''),
        isSplitCourse,
        matchStatus,
      });
    }
  }

  if (slots.length === 0) return null;

  const missingTeacherCount = slots.filter((s) => !s.teacherName).length;
  if (missingTeacherCount > 0) {
    warnings.push(`有 ${missingTeacherCount} 節課尚未對應到授課教師，請於下方課表補填。`);
  }
  const splitCount = slots.filter((s) => s.isSplitCourse).length;
  if (splitCount > 0) {
    warnings.push(`已自動偵測 ${splitCount} 節分割併排課程（例如單雙週或分組授課），並合併對應任課教師。`);
  }

  const defaults = GRADE_TO_DEFAULT_FLOOR[meta.grade] || { floor: '1F', roomPrefix: '101' };

  return {
    id: `cls-pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    sourceLabel,
    title: meta.title,
    schoolName: meta.schoolName,
    academicYear: meta.academicYear,
    grade: meta.grade,
    className: meta.className,
    homeroomTeacher,
    building: defaultBuilding,
    floor: defaults.floor,
    roomNumber: defaults.roomPrefix,
    teacherMappings,
    slots,
    warnings,
  };
}

async function parsePdfFile(
  file: File,
  defaultBuilding: string
): Promise<TimetableParseResult> {
  try {
    const [pdfjsLib, workerMod] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;

    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    const classes: ParsedClassTimetable[] = [];
    const errors: string[] = [];
    let emptyTextPages = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      const boxes: PdfTextBox[] = [];
      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        const str = item.str;
        if (!str || !str.trim()) continue;
        const tr = item.transform;
        const x0 = tr[4];
        const y = tr[5];
        const h = Math.abs(tr[3]) || item.height || 10;
        const w = item.width || Math.max(8, str.trim().length * h * 0.75);
        boxes.push({
          str,
          x0,
          x1: x0 + w,
          cx: x0 + w / 2,
          y,
          cy: y + h * 0.35,
          w,
          h,
        });
      }

      if (boxes.length === 0) {
        emptyTextPages++;
        continue;
      }

      const pageLabel = pdf.numPages > 1 ? `${file.name} (第 ${pageNum} 頁)` : file.name;
      const parsed = parsePdfPageBoxes(boxes, pageLabel, defaultBuilding);
      if (parsed) {
        classes.push(parsed);
      }
    }

    if (classes.length === 0) {
      if (emptyTextPages === pdf.numPages) {
        errors.push(
          `${file.name} 為掃描圖檔型 PDF（無內嵌文字層），建議直接從 Word 另存為 PDF／.docx 上傳，或開啟原檔複製表格貼上。`
        );
      } else {
        errors.push(
          `${file.name}：已讀取 ${pdf.numPages} 頁 PDF 文字，但未偵測到「星期一～五」與「節次 1～8」日課表結構。`
        );
      }
    }

    return { classes, errors };
  } catch (err) {
    return {
      classes: [],
      errors: [`${file.name} PDF 解析失敗：${err instanceof Error ? err.message : '檔案無法讀取'}`],
    };
  }
}

// ============================================================================
// 5. Unified Multi-File Entry Point
// ============================================================================

export async function parseTimetableFiles(
  files: File[],
  defaultBuilding: string
): Promise<TimetableParseResult> {
  const allClasses: ParsedClassTimetable[] = [];
  const allErrors: string[] = [];

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') {
      const res = await parsePdfFile(file, defaultBuilding);
      allClasses.push(...res.classes);
      allErrors.push(...res.errors);
    } else if (ext === 'docx') {
      const res = await parseDocxFile(file, defaultBuilding);
      allClasses.push(...res.classes);
      allErrors.push(...res.errors);
    } else if (ext === 'doc') {
      allErrors.push(
        `${file.name} 為舊版 Word (.doc) 格式，請先於 Word 另存為 .pdf 或 .docx（或全選課表複製貼上）即可匯入。`
      );
    } else if (ext === 'xlsx' || ext === 'xls') {
      const res = await parseExcelFile(file, defaultBuilding);
      allClasses.push(...res.classes);
      allErrors.push(...res.errors);
    } else if (ext === 'htm' || ext === 'html') {
      const html = await file.text();
      const res = parseHtmlOrPastedTimetable({
        html,
        sourceLabel: file.name,
        defaultBuilding,
      });
      allClasses.push(...res.classes);
      allErrors.push(...res.errors);
    } else if (ext === 'csv' || ext === 'txt') {
      const text = await file.text();
      const flat = parseTimetableCsv(text);
      if (flat.rows.length > 0) {
        allClasses.push(...flatRowsToParsedClasses(flat.rows, file.name));
      } else {
        const fallback = parseHtmlOrPastedTimetable({
          plainText: text,
          sourceLabel: file.name,
          defaultBuilding,
        });
        allClasses.push(...fallback.classes);
        allErrors.push(...(fallback.errors.length > 0 ? fallback.errors : flat.errors));
      }
    } else {
      allErrors.push(`${file.name}：不支援的檔案格式（請上傳 .pdf、.docx、.xlsx、.xls、.htm 或 .csv）`);
    }
  }

  return { classes: allClasses, errors: allErrors };
}

// ============================================================================
// 5. Convert Editable ParsedClassTimetable[] -> Firestore Import Rows
// ============================================================================

export function convertParsedClassesToImportRows(
  classes: ParsedClassTimetable[]
): ParsedTimetableImportRow[] {
  const rows: ParsedTimetableImportRow[] = [];
  classes.forEach((cls) => {
    cls.slots.forEach((slot) => {
      if (!slot.subject.trim()) return;
      rows.push({
        dayOfWeek: clampInt(slot.dayOfWeek, 1, 5),
        period: clampInt(slot.period, 1, 8),
        building: clampString(cls.building, 40, '行政教學大樓'),
        floor: clampString(cls.floor, 20, '1F'),
        roomNumber: clampString(cls.roomNumber, 20, '101'),
        className: clampString(cls.className, 30, '未命名班級'),
        grade: clampString(cls.grade, 20, '一年級'),
        subject: clampString(slot.subject, 50, '國語'),
        teacherName: clampString(slot.teacherName || cls.homeroomTeacher || '未指定教師', 40),
        isRelocated: Boolean(slot.isRelocated),
        locationNote: clampString(slot.locationNote, 100, ''),
      });
    });
  });
  return rows;
}

// ============================================================================
// 6. Exact Reference Sample (宜蘭縣利澤國小 115 學年 一年忠班 日課表)
// ============================================================================

export function createSampleLizeClassTimetable(
  defaultBuilding: string,
  schoolName = '宜蘭縣利澤國小',
  academicYear = '115'
): ParsedClassTimetable {
  const teacherMappings: SubjectTeacherMapping[] = [
    { area: '語文', subject: '國語', hours: 6, teacherName: '陳怡芬' },
    { area: '語文', subject: '臺灣台語', hours: 1, teacherName: '何薇慧' },
    { area: '', subject: '數學', hours: 4, teacherName: '陳怡芬' },
    { area: '生活課程', subject: '生活', hours: 3, teacherName: '陳怡芬' },
    { area: '生活課程', subject: '美勞', hours: 1, teacherName: '邱涵' },
    { area: '生活課程', subject: '表演', hours: 1, teacherName: '曹祐慈' },
    { area: '生活課程', subject: '音樂', hours: 1, teacherName: '黃雅鈴' },
    { area: '健康與體育', subject: '健康', hours: 1, teacherName: '陳怡芬' },
    { area: '健康與體育', subject: '體育', hours: 2, teacherName: '陳郁涵' },
    { area: '彈性課程', subject: '國際禮儀', hours: 1, teacherName: '李玉霖' },
    { area: '彈性課程', subject: '閱讀', hours: 1, teacherName: '陳怡芬' },
    { area: '彈性課程', subject: '彈性時間', hours: 1, teacherName: '陳怡芬' },
  ];

  const slots: ParsedPeriodSlot[] = [
    // 第 1 節
    { id: 'slot-d1-p1', dayOfWeek: 1, period: 1, rawText: '國語', subject: '國語', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d2-p1', dayOfWeek: 2, period: 1, rawText: '生活(表演)', subject: '生活(表演)', teacherName: '曹祐慈', isSpecialist: true, isRelocated: true, locationNote: '表演藝術教室', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d3-p1', dayOfWeek: 3, period: 1, rawText: '國際禮儀', subject: '國際禮儀', teacherName: '李玉霖', isSpecialist: true, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d4-p1', dayOfWeek: 4, period: 1, rawText: '國語', subject: '國語', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d5-p1', dayOfWeek: 5, period: 1, rawText: '國語', subject: '國語', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    // 第 2 節
    { id: 'slot-d1-p2', dayOfWeek: 1, period: 2, rawText: '彈性時間', subject: '彈性時間', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d2-p2', dayOfWeek: 2, period: 2, rawText: '臺灣台語', subject: '臺灣台語', teacherName: '何薇慧', isSpecialist: true, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d3-p2', dayOfWeek: 3, period: 2, rawText: '數學', subject: '數學', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d4-p2', dayOfWeek: 4, period: 2, rawText: '數學', subject: '數學', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d5-p2', dayOfWeek: 5, period: 2, rawText: '國語', subject: '國語', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    // 第 3 節
    { id: 'slot-d1-p3', dayOfWeek: 1, period: 3, rawText: '數學', subject: '數學', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d2-p3', dayOfWeek: 2, period: 3, rawText: '國語', subject: '國語', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d3-p3', dayOfWeek: 3, period: 3, rawText: '國語', subject: '國語', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d4-p3', dayOfWeek: 4, period: 3, rawText: '生活(音樂)', subject: '生活(音樂)', teacherName: '黃雅鈴', isSpecialist: true, isRelocated: true, locationNote: '音樂專科教室', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d5-p3', dayOfWeek: 5, period: 3, rawText: '健康與體育(體)', subject: '健康與體育(體育)', teacherName: '陳郁涵', isSpecialist: true, isRelocated: true, locationNote: '戶外操場／活動中心', isSplitCourse: false, matchStatus: 'matched' },
    // 第 4 節
    { id: 'slot-d1-p4', dayOfWeek: 1, period: 4, rawText: '生活', subject: '生活', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d2-p4', dayOfWeek: 2, period: 4, rawText: '數學', subject: '數學', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d3-p4', dayOfWeek: 3, period: 4, rawText: '健康與體育(健)', subject: '健康與體育(健康)', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d4-p4', dayOfWeek: 4, period: 4, rawText: '生活', subject: '生活', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    { id: 'slot-d5-p4', dayOfWeek: 5, period: 4, rawText: '生活', subject: '生活', teacherName: '陳怡芬', isSpecialist: false, isRelocated: false, locationNote: '', isSplitCourse: false, matchStatus: 'matched' },
    // 第 5 節（週二分割課：生(美) | 彈(閱)）
    { id: 'slot-d2-p5', dayOfWeek: 2, period: 5, rawText: '生(美) / 彈(閱)', subject: '生活(美勞)／彈性(閱讀)', teacherName: '邱涵／陳怡芬', isSpecialist: true, isRelocated: true, locationNote: '分組／輪課（美勞專科教室）', isSplitCourse: true, matchStatus: 'matched' },
    // 第 6 節（週二分割課：生(美) | 彈(閱)）
    { id: 'slot-d2-p6', dayOfWeek: 2, period: 6, rawText: '生(美) / 彈(閱)', subject: '生活(美勞)／彈性(閱讀)', teacherName: '邱涵／陳怡芬', isSpecialist: true, isRelocated: true, locationNote: '分組／輪課（美勞專科教室）', isSplitCourse: true, matchStatus: 'matched' },
    // 第 7 節
    { id: 'slot-d2-p7', dayOfWeek: 2, period: 7, rawText: '健康與體育(體)', subject: '健康與體育(體育)', teacherName: '陳郁涵', isSpecialist: true, isRelocated: true, locationNote: '戶外操場／活動中心', isSplitCourse: false, matchStatus: 'matched' },
  ];

  return {
    id: `sample-lize-1z-${Date.now().toString(36)}`,
    sourceLabel: '範例日課表（一年忠班）',
    title: `${schoolName} ${academicYear} 學年 一 年 忠 班 日課表`,
    schoolName,
    academicYear,
    grade: '一年級',
    className: '一年忠班',
    homeroomTeacher: '陳怡芬',
    building: defaultBuilding,
    floor: '1F',
    roomNumber: '101',
    teacherMappings,
    slots,
    warnings: ['已自動偵測 2 節分割併排課程（星期二第 5、6 節：生(美)／彈(閱)），並合併對應任課教師。'],
  };
}

// ============================================================================
// 7. Download Genuine Word (.docx) School Timetable Sample (for Testing/Template)
// ============================================================================

export async function downloadSampleTimetableDocx(
  schoolName = '宜蘭縣利澤國小',
  academicYear = '115'
): Promise<void> {
  const font = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: '標楷體' };
  const border = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
  const borders = { top: border, bottom: border, left: border, right: border };

  const cell = (
    text: string,
    opts?: {
      colSpan?: number;
      vMerge?: (typeof VerticalMergeType)[keyof typeof VerticalMergeType];
      shaded?: boolean;
      bold?: boolean;
      size?: number;
    }
  ) =>
    new TableCell({
      columnSpan: opts?.colSpan,
      verticalMerge: opts?.vMerge,
      borders,
      verticalAlign: VerticalAlign.CENTER,
      shading: opts?.shaded ? { type: ShadingType.CLEAR, fill: 'BFBFBF' } : undefined,
      children: text.split('\n').map(
        (line) =>
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: line,
                bold: opts?.bold,
                size: opts?.size ?? 20,
                font,
                color: '000000',
              }),
            ],
          })
      ),
    });

  // 12-column grid matching the exact school timetable layout:
  // [0]節次 [1]分鐘 [2]時間 [3]一 [4-5]二(split 2) [6]三 [7]四 [8]五 [9]領域 [10]科目 [11]節數 [12]任課教師 -> 13 cols
  const colWidths = [550, 550, 1150, 950, 500, 500, 950, 950, 950, 800, 850, 600, 1050];

  const rows: TableRow[] = [
    new TableRow({
      children: [
        cell(`${schoolName} ${academicYear} 學年 一 年 忠 班 日課表`, {
          colSpan: 13,
          bold: true,
          size: 30,
        }),
      ],
    }),
    new TableRow({
      children: [
        cell('節次', { bold: true }),
        cell('分鐘', { bold: true }),
        cell('星期／時間', { bold: true }),
        cell('一', { bold: true }),
        cell('二', { colSpan: 2, bold: true }),
        cell('三', { bold: true }),
        cell('四', { bold: true }),
        cell('五', { bold: true }),
        cell('每週各科授課教師及節數', { colSpan: 4, bold: true }),
      ],
    }),
    new TableRow({
      children: [
        cell('', { vMerge: VerticalMergeType.RESTART }),
        cell('25', { vMerge: VerticalMergeType.RESTART }),
        cell('8:00-8:25', { vMerge: VerticalMergeType.RESTART }),
        cell('導師\n時間', { vMerge: VerticalMergeType.RESTART }),
        cell('教師\n朝會', { colSpan: 2, vMerge: VerticalMergeType.RESTART }),
        cell('升旗', { vMerge: VerticalMergeType.RESTART }),
        cell('導師\n時間', { vMerge: VerticalMergeType.RESTART }),
        cell('導師\n時間', { vMerge: VerticalMergeType.RESTART }),
        cell('科目', { colSpan: 2, bold: true }),
        cell('節數', { bold: true }),
        cell('任課教師', { bold: true }),
      ],
    }),
    new TableRow({
      children: [
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { colSpan: 2, vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('語文', { vMerge: VerticalMergeType.RESTART }),
        cell('國語'),
        cell('6'),
        cell('陳怡芬'),
      ],
    }),
    new TableRow({
      children: [
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { colSpan: 2, vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('臺灣台語'),
        cell('1'),
        cell('何薇慧'),
      ],
    }),
    new TableRow({
      children: [
        cell('1'),
        cell('40'),
        cell('8:30-9:10'),
        cell('國語'),
        cell('生活\n(表演)', { colSpan: 2, shaded: true }),
        cell('國際\n禮儀', { shaded: true }),
        cell('國語'),
        cell('國語'),
        cell('數學', { colSpan: 2 }),
        cell('4'),
        cell('陳怡芬'),
      ],
    }),
    new TableRow({
      children: [
        cell('2'),
        cell('40'),
        cell('9:20-10:00'),
        cell('彈性\n時間'),
        cell('臺灣\n台語', { colSpan: 2, shaded: true }),
        cell('數學'),
        cell('數學'),
        cell('國語'),
        cell('生活\n課程', { vMerge: VerticalMergeType.RESTART }),
        cell('生活'),
        cell('3'),
        cell('陳怡芬'),
      ],
    }),
    new TableRow({
      children: [
        cell(''),
        cell('10'),
        cell('10:00-10:10'),
        cell('閱 讀 時 間', { colSpan: 6 }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('美勞'),
        cell('1'),
        cell('邱涵'),
      ],
    }),
    new TableRow({
      children: [
        cell(''),
        cell('20'),
        cell('10:10-10:30'),
        cell('課 間 活 動', { colSpan: 6 }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('表演'),
        cell('1'),
        cell('曹祐慈'),
      ],
    }),
    new TableRow({
      children: [
        cell('3'),
        cell('40'),
        cell('10:30-11:10'),
        cell('數學'),
        cell('國語', { colSpan: 2 }),
        cell('國語'),
        cell('生活\n(音樂)', { shaded: true }),
        cell('健康與體\n育(體)', { shaded: true }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('音樂'),
        cell('1'),
        cell('黃雅鈴'),
      ],
    }),
    new TableRow({
      children: [
        cell('4'),
        cell('40'),
        cell('11:20-12:00'),
        cell('生活'),
        cell('數學', { colSpan: 2 }),
        cell('健康與\n體育(健)'),
        cell('生活'),
        cell('生活'),
        cell('健康與\n體育', { vMerge: VerticalMergeType.RESTART }),
        cell('健康'),
        cell('1'),
        cell('陳怡芬'),
      ],
    }),
    new TableRow({
      children: [
        cell(''),
        cell('40'),
        cell('12:00-12:40'),
        cell('午 餐 時 間', { colSpan: 6 }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('體育'),
        cell('2'),
        cell('陳郁涵'),
      ],
    }),
    new TableRow({
      children: [
        cell(''),
        cell('40'),
        cell('12:40-13:20'),
        cell('午 休 時 間', { colSpan: 6 }),
        cell('彈性\n課程', { vMerge: VerticalMergeType.RESTART }),
        cell('國際\n禮儀'),
        cell('1'),
        cell('李玉霖'),
      ],
    }),
    new TableRow({
      children: [
        cell('5'),
        cell('40'),
        cell('13:30-14:10'),
        cell(''),
        cell('生\n(美)', { shaded: true }),
        cell('彈\n(閱)'),
        cell(''),
        cell(''),
        cell(''),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('閱讀'),
        cell('1'),
        cell('陳怡芬'),
      ],
    }),
    new TableRow({
      children: [
        cell(''),
        cell('20'),
        cell('14:10-14:30'),
        cell('整 潔 活 動', { colSpan: 6 }),
        cell('', { vMerge: VerticalMergeType.CONTINUE }),
        cell('彈性\n時間'),
        cell('1'),
        cell('陳怡芬'),
      ],
    }),
    new TableRow({
      children: [
        cell('6'),
        cell('40'),
        cell('14:30-15:10'),
        cell(''),
        cell('生\n(美)', { shaded: true }),
        cell('彈\n(閱)'),
        cell(''),
        cell(''),
        cell(''),
        cell('總節數', { colSpan: 2 }),
        cell('23'),
        cell('7'),
      ],
    }),
    new TableRow({
      children: [
        cell('7'),
        cell('40'),
        cell('15:20-16:00'),
        cell(''),
        cell('健康與\n體育(體)', { colSpan: 2, shaded: true }),
        cell(''),
        cell(''),
        cell(''),
        cell('級任老師', { colSpan: 2 }),
        cell('陳怡芬 (16)', { colSpan: 2 }),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            columnWidths: colWidths,
            rows,
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${schoolName}_${academicYear}學年_一年忠班_日課表範本.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
