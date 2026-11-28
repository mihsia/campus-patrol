import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATE_REGEX,
  ID_REGEX,
  clampInt,
  clampString,
  emailToAccountId,
  isValidEmailFormat,
  normalizeEmail,
  sanitizeBuildings,
  sanitizeChecklist,
  sanitizeDate,
  sanitizeId,
} from '../validation';
import {
  deriveStatusFromChecklist,
  getDayOfWeekFromDate,
  getEffectiveChecklist,
  normalizeStaffRole,
  type PatrolLog,
} from '../../types/patrol';

describe('validation utilities', () => {
  it('normalizes and validates email addresses', () => {
    assert.equal(normalizeEmail('  MiHsia@Gmail.COM  '), 'mihsia@gmail.com');
    assert.equal(normalizeEmail(`${'a'.repeat(130)}@t.tw`).length, 120);

    assert.equal(isValidEmailFormat('teacher@tmail.ilc.edu.tw'), true);
    assert.equal(isValidEmailFormat('  MIHSIA@GMAIL.COM '), true);
    assert.equal(isValidEmailFormat('invalid-email'), false);
    assert.equal(isValidEmailFormat('missing@domain'), false);
    assert.equal(isValidEmailFormat('a@b'), false);
    assert.equal(isValidEmailFormat(''), false);
  });

  it('maps email to Firestore allowedAccounts document ID matching firestore.rules', () => {
    assert.equal(emailToAccountId('mihsia@gmail.com'), 'mihsia_gmail_com');
    assert.equal(emailToAccountId('Teacher.Name+1@tmail.ilc.edu.tw'), 'teacher_name_1_tmail_ilc_edu_tw');
    assert.match(emailToAccountId('mihsia@gmail.com'), ID_REGEX);
  });

  it('sanitizes document IDs with safe fallback', () => {
    assert.equal(sanitizeId('slot_1A-2'), 'slot_1A-2');
    assert.equal(sanitizeId('  bad/id@name!! '), 'bad-id-name');

    const fallback = sanitizeId('!!!', 'tt');
    assert.ok(fallback.startsWith('tt-'));
    assert.match(fallback, ID_REGEX);
    assert.ok(fallback.length <= 128);
  });

  it('clamps strings and integers safely', () => {
    assert.equal(clampString('  國語  ', 10), '國語');
    assert.equal(clampString('   ', 10, '預設值'), '預設值');
    assert.equal(clampString('abcdefghij', 5), 'abcde');

    assert.equal(clampInt(3.6, 1, 8), 4);
    assert.equal(clampInt(-2, 1, 5), 1);
    assert.equal(clampInt(99, 1, 8), 8);
    assert.equal(clampInt(Number.NaN, 1, 8), 1);
  });

  it('sanitizes dates to YYYY-MM-DD', () => {
    assert.equal(sanitizeDate('2026-11-27'), '2026-11-27');
    assert.match(sanitizeDate('invalid-date'), DATE_REGEX);
  });

  it('deduplicates, trims, caps buildings and provides default fallback', () => {
    assert.deepEqual(sanitizeBuildings([' 忠孝樓 ', '忠孝樓', '', '仁愛樓']), ['忠孝樓', '仁愛樓']);
    assert.deepEqual(sanitizeBuildings(['', '   ']), ['教學大樓']);

    const forty = Array.from({ length: 40 }, (_, i) => `大樓${i + 1}`);
    assert.equal(sanitizeBuildings(forty).length, 30);
  });

  it('filters invalid checklist items and removes duplicates', () => {
    assert.deepEqual(
      sanitizeChecklist(['class_normal', 'invalid_item', 'class_normal', 'teacher_late']),
      ['class_normal', 'teacher_late']
    );
  });
});

describe('patrol domain helpers', () => {
  it('normalizes staff roles strictly to admin or user', () => {
    assert.equal(normalizeStaffRole('admin'), 'admin');
    assert.equal(normalizeStaffRole('user'), 'user');
    assert.equal(normalizeStaffRole('superadmin'), 'user');
    assert.equal(normalizeStaffRole(null), 'user');
  });

  it('derives patrol status from 8-item checklist priority rules', () => {
    assert.equal(deriveStatusFromChecklist(['class_normal', 'teacher_late']), 'urgent_issue');
    assert.equal(deriveStatusFromChecklist(['off_schedule_no_change']), 'urgent_issue');
    assert.equal(deriveStatusFromChecklist(['class_normal', 'poor_order']), 'minor_issue');
    assert.equal(deriveStatusFromChecklist(['poor_learning']), 'minor_issue');
    assert.equal(deriveStatusFromChecklist([], true), 'empty_relocated');
    assert.equal(deriveStatusFromChecklist(['class_normal', 'student_focused'], false), 'normal');
  });

  it('derives effective checklist for modern and legacy patrol logs', () => {
    const baseLog: PatrolLog = {
      id: 'log-1',
      campusId: 'main-campus',
      date: '2026-11-27',
      dayOfWeek: 5,
      period: 1,
      timetableId: 'tt-1',
      building: '忠孝樓',
      roomNumber: '101',
      className: '一甲',
      subject: '國語',
      teacherName: '陳老師',
      teacherPresent: true,
      expectedCount: 25,
      actualCount: 25,
      status: 'normal',
      note: '',
      inspectorId: 'u1',
      inspectorName: '巡堂員',
    };

    assert.deepEqual(
      getEffectiveChecklist({ ...baseLog, checklist: ['student_focused', 'good_interaction'] }),
      ['student_focused', 'good_interaction']
    );
    assert.deepEqual(getEffectiveChecklist(baseLog), ['class_normal']);
    assert.deepEqual(
      getEffectiveChecklist({ ...baseLog, status: 'minor_issue', teacherPresent: false }),
      ['teacher_late', 'poor_order']
    );
    assert.deepEqual(getEffectiveChecklist(null), []);
  });

  it('maps weekday dates to 1..5 and falls back to 1 on weekends or invalid input', () => {
    assert.equal(getDayOfWeekFromDate('2026-11-23'), 1); // Monday
    assert.equal(getDayOfWeekFromDate('2026-11-27'), 5); // Friday
    assert.equal(getDayOfWeekFromDate('2026-11-28'), 1); // Saturday -> 1
    assert.equal(getDayOfWeekFromDate('2026-11-29'), 1); // Sunday -> 1
    assert.equal(getDayOfWeekFromDate('not-a-date'), 1);
  });
});
