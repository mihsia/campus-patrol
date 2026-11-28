import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCalendarDayOfWeek,
  getDayOfWeekLabel,
  getLatestSchoolDateString,
  getWeekDateRange,
  isWeekendDate,
} from '../../types/patrol';
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
});

describe('changelog and user manual data integrity', () => {
  it('orders changelog entries newest-to-oldest with latest matching CURRENT_APP_VERSION', () => {
    assert.ok(CHANGELOG_ENTRIES.length >= 10);
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
