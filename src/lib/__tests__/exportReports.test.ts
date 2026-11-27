import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPatrolReportRows, parseTimetableCsv } from '../exportReports';
import type { PatrolLog, TimetableSlot } from '../../types/patrol';

describe('parseTimetableCsv', () => {
  it('parses UTF-8 BOM standard 11-column CSV including quoted commas and relocated flags', () => {
    const csv = [
      '\uFEFF星期(1-5),節次(1-8),樓棟,樓層,教室編號,班別,年級,授課領域,授課教師姓名,是否移地(是/否),移地備註',
      '1,1,行政教學大樓,1F,101,一甲,一年級,國語,陳淑芬,否,',
      '2,3,科任專科大樓,2F,205,三甲,三年級,"自然,生活",周建宏,是,"自然教室, ""A"" 棟"',
      '9,12,忠孝樓,3F,301,五甲,五年級,體育,林教練,true,戶外操場',
    ].join('\r\n');

    const { rows, errors } = parseTimetableCsv(csv);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 3);

    assert.equal(rows[0].className, '一甲');
    assert.equal(rows[0].isRelocated, false);

    assert.equal(rows[1].subject, '自然,生活');
    assert.equal(rows[1].isRelocated, true);
    assert.equal(rows[1].locationNote, '自然教室, "A" 棟');

    // Out-of-range weekday/period clamped to 1..5 and 1..8
    assert.equal(rows[2].dayOfWeek, 5);
    assert.equal(rows[2].period, 8);
    assert.equal(rows[2].isRelocated, true);
  });

  it('supports legacy CSV format with expectedCount (人數) column at index 9', () => {
    const legacyCsv = [
      '星期,節次,樓棟,樓層,教室,班別,年級,領域,教師,應到人數,是否移地,移地備註',
      '3,2,忠孝樓,2F,202,二甲,二年級,音樂,黃雅鈴,24,是,音樂教室',
    ].join('\n');

    const { rows, errors } = parseTimetableCsv(legacyCsv);
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].isRelocated, true);
    assert.equal(rows[0].locationNote, '音樂教室');
  });

  it('reports clear validation errors for empty or malformed CSVs', () => {
    assert.equal(parseTimetableCsv('   ').errors.length, 1);
    assert.equal(parseTimetableCsv('星期,節次,班別').errors.length, 1);

    const malformed = [
      '星期,節次,樓棟,樓層,教室,班別,年級,領域,教師,是否移地,移地備註',
      '1,1,忠孝樓',
      '1,2,忠孝樓,1F,101,,一年級,國語,陳老師,否,',
    ].join('\n');
    const result = parseTimetableCsv(malformed);
    assert.equal(result.rows.length, 0);
    assert.equal(result.errors.length, 2);
  });
});

describe('buildPatrolReportRows', () => {
  const sampleTimetables: TimetableSlot[] = [
    {
      id: 'tt-3a',
      campusId: 'main-campus',
      dayOfWeek: 1,
      period: 1,
      building: '忠孝樓',
      floor: '2F',
      roomNumber: '201',
      className: '三甲',
      grade: '三年級',
      subject: '數學',
      teacherName: '王老師',
      expectedCount: 26,
      isRelocated: false,
      locationNote: '',
      roster: [],
      createdBy: 'admin1',
    },
    {
      id: 'tt-1a',
      campusId: 'main-campus',
      dayOfWeek: 1,
      period: 1,
      building: '行政教學大樓',
      floor: '1F',
      roomNumber: '101',
      className: '一甲',
      grade: '一年級',
      subject: '國語',
      teacherName: '陳老師',
      expectedCount: 22,
      isRelocated: false,
      locationNote: '',
      roster: [],
      createdBy: 'admin1',
    },
  ];

  const sampleLog: PatrolLog = {
    id: 'log-1',
    campusId: 'main-campus',
    date: '2026-11-23',
    dayOfWeek: 1,
    period: 1,
    timetableId: 'tt-1a',
    building: '行政教學大樓',
    roomNumber: '101',
    className: '一甲',
    grade: '一年級',
    subject: '國語',
    teacherName: '陳老師',
    teacherPresent: true,
    expectedCount: 22,
    actualCount: 22,
    status: 'normal',
    checklist: ['class_normal', 'student_focused'],
    note: '互動佳',
    inspectorId: 'u1',
    inspectorName: '主任',
  };

  it('orders weekly_standard rows by Taiwanese grade order and keeps unpatrolled classes', () => {
    const rows = buildPatrolReportRows({
      patrolLogs: [sampleLog],
      timetables: sampleTimetables,
      mode: 'weekly_standard',
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].classLabel, '一年級');
    assert.equal(rows[0].subClassLabel, '一甲');
    assert.equal(rows[0].hasLog, true);
    assert.equal(rows[0].dateDisplay, '11/23');
    assert.equal(rows[0].weekdayDisplay, '星期一');
    assert.equal(rows[0].periodDisplay, '第 1 節');

    assert.equal(rows[1].classLabel, '三年級');
    assert.equal(rows[1].subClassLabel, '三甲');
    assert.equal(rows[1].hasLog, false);
    assert.deepEqual(rows[1].checklist, []);
  });

  it('returns only logged rows in logged_only mode', () => {
    const rows = buildPatrolReportRows({
      patrolLogs: [sampleLog],
      timetables: sampleTimetables,
      mode: 'logged_only',
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].classLabel, '一年級');
    assert.equal(rows[0].subClassLabel, '一甲');
    assert.equal(rows[0].hasLog, true);
  });
});
