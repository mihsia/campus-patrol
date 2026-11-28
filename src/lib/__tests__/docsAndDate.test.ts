import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCurrentAcademicYear,
  getAcademicYearPeriod,
  getCalendarDayOfWeek,
  getDayOfWeekLabel,
  getLatestSchoolDateString,
  getWeekDateRange,
  isWeekendDate,
  type TimetableSlot,
} from '../../types/patrol';
import { groupTimetablesByClass } from '../exportReports';
import { CHANGELOG_ENTRIES, CURRENT_APP_VERSION } from '../../data/changelog';
import { MANUAL_SECTIONS, MANUAL_VERIFIED_VERSION } from '../../data/manual';

describe('calendar weekday & date helpers', () => {
  it('returns true calendar weekdays including Saturday and Sunday', () => {
    assert.equal(getCalendarDayOfWeek('2026-11-23'), 1);
    assert.equal(getDayOfWeekLabel('2026-11-23'), '星期一');

    assert.equal(getCalendarDayOfWeek('2026-11-27'), 5);
    assert.equal(getDayOfWeekLabel('2026-11-27'), '星期五');

    // Regression check for reported bug: 2026-11-28 must be 星期六 (not 星期一)
    assert.equal(getCalendarDayOfWeek('2026-11-28'), 6);
    assert.equal(getDayOfWeekLabel('2026-11-28'), '星期六');
    assert.equal(isWeekendDate('2026-11-28'), true);

    assert.equal(getCalendarDayOfWeek('2026-11-29'), 0);
    assert.equal(getDayOfWeekLabel('2026-11-29'), '星期日');
    assert.equal(isWeekendDate('2026-11-29'), true);
    assert.equal(isWeekendDate('2026-11-27'), false);
  });

  it('resolves latest school weekday for weekends and preserves weekdays', () => {
    assert.equal(getLatestSchoolDateString('2026-11-28'), '2026-11-27'); // Sat -> Fri
    assert.equal(getLatestSchoolDateString('2026-11-29'), '2026-11-27'); // Sun -> Fri
    assert.equal(getLatestSchoolDateString('2026-11-25'), '2026-11-25'); // Wed -> Wed
  });

  it('computes Mon–Fri week date range accurately across weekdays and weekends', () => {
    const fromWed = getWeekDateRange('2026-11-25');
    assert.equal(fromWed.monday, '2026-11-23');
    assert.equal(fromWed.friday, '2026-11-27');
    assert.equal(fromWed.dates.length, 5);

    const fromSat = getWeekDateRange('2026-11-28');
    assert.equal(fromSat.monday, '2026-11-23');
    assert.equal(fromSat.friday, '2026-11-27');

    const fromSun = getWeekDateRange('2026-11-29');
    assert.equal(fromSun.monday, '2026-11-23');
    assert.equal(fromSun.friday, '2026-11-27');
  });

  it('computes Taiwanese academic year range (Aug 1 to next Jul 31) accurately', () => {
    const y115 = getAcademicYearPeriod('115');
    assert.equal(y115.academicYear, '115');
    assert.equal(y115.startDate, '2026/08/01');
    assert.equal(y115.endDate, '2027/07/31');
    assert.equal(y115.fullLabel, '115 學年度（2026/08/01 ～ 2027/07/31）');

    // Aug 1 starts new academic year; Jul 31 still belongs to previous academic year
    assert.equal(detectCurrentAcademicYear(new Date(2026, 6, 31)), '114'); // 2026-07-31 -> 114
    assert.equal(detectCurrentAcademicYear(new Date(2026, 7, 1)), '115'); // 2026-08-01 -> 115
    assert.equal(detectCurrentAcademicYear(new Date(2027, 2, 15)), '115'); // 2027-03-15 -> 115
  });

  it('groups class timetables in Taiwanese elementary grade order with optional class filter', () => {
    const base: Omit<TimetableSlot, 'id' | 'className' | 'grade' | 'period'> = {
      campusId: 'main-campus',
      dayOfWeek: 1,
      building: '茗菊樓',
      floor: '1F',
      roomNumber: '101',
      subject: '國語',
      teacherName: '陳老師',
      expectedCount: 25,
      isRelocated: false,
      locationNote: '',
      roster: [],
      createdBy: 'admin1',
    };
    const slots: TimetableSlot[] = [
      { ...base, id: 's1', className: '五甲', grade: '五年級', period: 2 },
      { ...base, id: 's2', className: '一忠', grade: '一年級', period: 1 },
      { ...base, id: 's3', className: '三甲', grade: '三年級', period: 3 },
    ];

    const all = groupTimetablesByClass(slots);
    assert.deepEqual(
      all.map((g) => g.className),
      ['一忠', '三甲', '五甲']
    );

    const filtered = groupTimetablesByClass(slots, ['三甲']);
    assert.deepEqual(
      filtered.map((g) => g.className),
      ['三甲']
    );
  });
});

describe('changelog and user manual data integrity', () => {
  it('orders changelog entries newest-to-oldest with latest matching CURRENT_APP_VERSION', () => {
    assert.ok(CHANGELOG_ENTRIES.length >= 11);
    assert.equal(CHANGELOG_ENTRIES[0].version, CURRENT_APP_VERSION);

    const parseVer = (v: string) => {
      const m = /^v(\d+)\.(\d+)$/.exec(v);
      assert.ok(m, `Invalid version format: ${v}`);
      return Number(m[1]) * 1000 + Number(m[2]);
    };

    for (let i = 1; i < CHANGELOG_ENTRIES.length; i++) {
      assert.ok(
        parseVer(CHANGELOG_ENTRIES[i - 1].version) > parseVer(CHANGELOG_ENTRIES[i].version),
        `Expected ${CHANGELOG_ENTRIES[i - 1].version} > ${CHANGELOG_ENTRIES[i].version}`
      );
    }
  });

  it('defines unique manual sections synchronized with the current app version', () => {
    assert.equal(MANUAL_VERIFIED_VERSION, CURRENT_APP_VERSION);
    assert.ok(MANUAL_SECTIONS.length >= 8);
    const ids = new Set(MANUAL_SECTIONS.map((s) => s.id));
    assert.equal(ids.size, MANUAL_SECTIONS.length);
  });
});
