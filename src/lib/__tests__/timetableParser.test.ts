import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertParsedClassesToImportRows,
  createSampleLizeClassTimetable,
  parseHtmlOrPastedTimetable,
} from '../timetableParser';

describe('timetableParser', () => {
  it('builds the reference Lize Elementary sample timetable with split & specialist courses', () => {
    const sample = createSampleLizeClassTimetable('忠孝樓', '宜蘭縣利澤國小', '115');
    assert.equal(sample.className, '一年忠班');
    assert.equal(sample.grade, '一年級');
    assert.equal(sample.building, '忠孝樓');
    assert.equal(sample.slots.length, 23);

    const splitSlots = sample.slots.filter((s) => s.isSplitCourse);
    assert.equal(splitSlots.length, 2);
    assert.deepEqual(
      splitSlots.map((s) => [s.dayOfWeek, s.period]),
      [
        [2, 5],
        [2, 6],
      ]
    );
  });

  it('converts parsed classes to Firestore import rows and falls back to homeroomTeacher', () => {
    const sample = createSampleLizeClassTimetable('行政教學大樓');
    sample.slots.push(
      {
        id: 'slot-blank',
        dayOfWeek: 5,
        period: 6,
        rawText: '',
        subject: '   ',
        teacherName: '',
        isSpecialist: false,
        isRelocated: false,
        locationNote: '',
        isSplitCourse: false,
        matchStatus: 'missing_teacher',
      },
      {
        id: 'slot-fallback',
        dayOfWeek: 5,
        period: 5,
        rawText: '自習',
        subject: '自習',
        teacherName: '',
        isSpecialist: false,
        isRelocated: false,
        locationNote: '',
        isSplitCourse: false,
        matchStatus: 'homeroom_fallback',
      }
    );

    const rows = convertParsedClassesToImportRows([sample]);
    // 23 original + 1 fallback (blank slot filtered out)
    assert.equal(rows.length, 24);
    const fallbackRow = rows.find((r) => r.subject === '自習');
    assert.ok(fallbackRow);
    assert.equal(fallbackRow.teacherName, sample.homeroomTeacher);
  });

  it('parses flat pasted TSV timetable rows from Excel/Word copy', () => {
    const tsv = [
      '星期\t節次\t樓棟\t樓層\t教室\t班別\t年級\t領域\t教師\t是否移地\t移地備註',
      '1\t1\t忠孝樓\t1F\t101\t一甲\t一年級\t國語\t陳怡芬\t否\t',
      '1\t2\t忠孝樓\t1F\t101\t一甲\t一年級\t數學\t陳怡芬\t否\t',
      '2\t3\t科任專科大樓\t2F\t202\t一甲\t一年級\t音樂\t黃雅鈴\t是\t音樂教室',
    ].join('\n');

    const result = parseHtmlOrPastedTimetable({
      plainText: tsv,
      defaultBuilding: '行政教學大樓',
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.classes.length, 1);
    assert.equal(result.classes[0].className, '一甲');
    assert.equal(result.classes[0].slots.length, 3);
    assert.equal(result.classes[0].slots[2].isRelocated, true);
  });

  it('returns an error when pasted content is empty', () => {
    const result = parseHtmlOrPastedTimetable({
      plainText: '   \n  ',
      defaultBuilding: '行政教學大樓',
    });

    assert.equal(result.classes.length, 0);
    assert.equal(result.errors.length, 1);
  });
});
