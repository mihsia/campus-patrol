import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import {
  CAMPUS_ID,
  DEFAULT_SCHOOL_SETTINGS,
  getDayOfWeekFromDate,
  getTodayDateString,
  type PatrolCheckItem,
  type SchoolSettings,
} from '../types/patrol';
import { db, handleFirestoreError, OperationType } from './firebase';

interface ClassMeta {
  className: string;
  grade: string;
  buildingIndex: number;
  floor: string;
  roomNumber: string;
}

const SAMPLE_CLASSES: ClassMeta[] = [
  { className: '一甲', grade: '一年級', buildingIndex: 0, floor: '1F', roomNumber: '101' },
  { className: '二甲', grade: '二年級', buildingIndex: 0, floor: '1F', roomNumber: '102' },
  { className: '三甲', grade: '三年級', buildingIndex: 1, floor: '2F', roomNumber: '201' },
  { className: '四甲', grade: '四年級', buildingIndex: 1, floor: '2F', roomNumber: '202' },
  { className: '五甲', grade: '五年級', buildingIndex: 1, floor: '3F', roomNumber: '301' },
  { className: '六甲', grade: '六年級', buildingIndex: 2, floor: '3F', roomNumber: '302' },
];

const SUBJECT_POOL: Array<{ subject: string; teacher: string; relocated?: boolean; note?: string }> = [
  { subject: '國語', teacher: '陳淑芬' },
  { subject: '數學', teacher: '林志明' },
  { subject: '自然', teacher: '周建宏', relocated: true, note: '自然專科教室' },
  { subject: '社會', teacher: '張文傑' },
  { subject: '英語', teacher: '王美玲' },
  { subject: '體育', teacher: '劉大衛', relocated: true, note: '戶外操場' },
  { subject: '音樂', teacher: '吳佳蓉', relocated: true, note: '音樂教室' },
  { subject: '美勞', teacher: '黃雅雯' },
  { subject: '綜合', teacher: '蔡明憲' },
];

/**
 * Seeds a realistic elementary school timetable (Grades 1-6) + sample patrol checklist logs
 * strictly respecting Firestore exists() invariants (timetables committed first).
 */
export async function seedCampusDemoDataset(params: {
  uid: string;
  displayName: string;
  schoolSettings?: SchoolSettings;
}): Promise<{ timetableCount: number; patrolCount: number; incidentCount: number }> {
  const { uid, displayName, schoolSettings } = params;
  const settings = schoolSettings || DEFAULT_SCHOOL_SETTINGS;
  const buildings =
    settings.buildings.length > 0 ? settings.buildings : DEFAULT_SCHOOL_SETTINGS.buildings;

  const today = getTodayDateString();
  const todayDow = getDayOfWeekFromDate(today);

  // Step 0: Ensure schoolSettings document exists in Firestore
  try {
    const settingsRef = doc(db, 'schoolSettings', CAMPUS_ID);
    const snap = await getDoc(settingsRef);
    if (!snap.exists()) {
      const sBatch = writeBatch(db);
      sBatch.set(settingsRef, {
        campusId: CAMPUS_ID,
        schoolName: settings.schoolName,
        academicYear: settings.academicYear,
        semester: settings.semester,
        currentWeek: settings.currentWeek,
        buildings,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
      await sBatch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `schoolSettings/${CAMPUS_ID}`);
  }

  // Step 1: Commit timetables for Mon-Fri
  const timetableBatch = writeBatch(db);
  const createdSlots: Array<{
    id: string;
    dayOfWeek: number;
    period: number;
    cls: ClassMeta;
    building: string;
    subject: string;
    teacherName: string;
    isRelocated: boolean;
    locationNote: string;
  }> = [];

  for (let day = 1; day <= 5; day++) {
    const maxPeriod = day === todayDow ? 6 : 4;
    for (let period = 1; period <= maxPeriod; period++) {
      SAMPLE_CLASSES.forEach((cls, classIdx) => {
        const building = buildings[cls.buildingIndex % buildings.length];
        const pick = SUBJECT_POOL[(day * 3 + period + classIdx * 2) % SUBJECT_POOL.length];
        const id = `tt-d${day}-p${period}-${cls.roomNumber}`;
        const isRelocated = Boolean(pick.relocated);
        const locationNote = pick.note || '';

        timetableBatch.set(doc(db, 'timetables', id), {
          campusId: CAMPUS_ID,
          dayOfWeek: day,
          period,
          building,
          floor: cls.floor,
          roomNumber: cls.roomNumber,
          className: cls.className,
          grade: cls.grade,
          subject: pick.subject,
          teacherName: pick.teacher,
          expectedCount: 0,
          isRelocated,
          locationNote,
          roster: [],
          createdBy: uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (day === todayDow) {
          createdSlots.push({
            id,
            dayOfWeek: day,
            period,
            cls,
            building,
            subject: pick.subject,
            teacherName: pick.teacher,
            isRelocated,
            locationNote,
          });
        }
      });
    }
  }

  try {
    await timetableBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'timetables');
  }

  // Step 2: Commit sample patrol logs with official 8-item checklist & patrol incidents
  const opsBatch = writeBatch(db);
  const p1Slots = createdSlots.filter((s) => s.period === 1);
  const p2Slots = createdSlots.filter((s) => s.period === 2);
  let patrolCount = 0;

  p1Slots.forEach((slot, idx) => {
    let checklist: PatrolCheckItem[];
    let status: 'normal' | 'minor_issue' | 'urgent_issue' | 'empty_relocated' = 'normal';
    let note = '';

    if (idx === 1) {
      checklist = ['class_normal', 'poor_order'];
      status = 'minor_issue';
      note = '分組討論音量略大，已提醒班級注意秩序';
    } else if (idx === 3) {
      checklist = ['teacher_late'];
      status = 'urgent_issue';
      note = '鐘響後 8 分鐘教師尚未進班，已請教務處聯繫確認';
    } else if (idx === 0) {
      checklist = ['class_normal', 'proper_equipment', 'student_focused', 'good_interaction'];
      status = 'normal';
      note = '運用互動大屏教學，全班專注投入';
    } else {
      checklist = ['class_normal', 'student_focused', 'good_interaction'];
      status = slot.isRelocated ? 'empty_relocated' : 'normal';
      note = slot.isRelocated ? `依課表移至「${slot.locationNote}」上課` : '';
    }

    opsBatch.set(doc(db, 'patrolLogs', `log-${today}-p1-${slot.cls.roomNumber}`), {
      campusId: CAMPUS_ID,
      date: today,
      dayOfWeek: todayDow,
      period: 1,
      timetableId: slot.id,
      building: slot.building,
      roomNumber: slot.cls.roomNumber,
      className: slot.cls.className,
      grade: slot.cls.grade,
      subject: slot.subject,
      teacherName: slot.teacherName,
      teacherPresent: !checklist.includes('teacher_late'),
      expectedCount: 0,
      actualCount: 0,
      status,
      checklist,
      note,
      inspectorId: uid,
      inspectorName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    patrolCount += 1;
  });

  // Partially patrol Period 2 (first 3 classes)
  p2Slots.slice(0, 3).forEach((slot, idx) => {
    const checklist: PatrolCheckItem[] =
      idx === 2
        ? ['class_normal', 'proper_equipment', 'good_interaction']
        : ['class_normal', 'student_focused'];
    opsBatch.set(doc(db, 'patrolLogs', `log-${today}-p2-${slot.cls.roomNumber}`), {
      campusId: CAMPUS_ID,
      date: today,
      dayOfWeek: todayDow,
      period: 2,
      timetableId: slot.id,
      building: slot.building,
      roomNumber: slot.cls.roomNumber,
      className: slot.cls.className,
      grade: slot.cls.grade,
      subject: slot.subject,
      teacherName: slot.teacherName,
      teacherPresent: true,
      expectedCount: 0,
      actualCount: 0,
      status: slot.isRelocated ? 'empty_relocated' : 'normal',
      checklist,
      note: '',
      inspectorId: uid,
      inspectorName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    patrolCount += 1;
  });

  // Patrol Incidents
  let incidentCount = 0;
  const slot4P1 = p1Slots[3];
  if (slot4P1) {
    opsBatch.set(doc(db, 'incidents', `inc-${today}-demo-1`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 1,
      timetableId: slot4P1.id,
      location: `${slot4P1.building} ${slot4P1.cls.roomNumber} · ${slot4P1.cls.className}`,
      className: slot4P1.cls.className,
      category: 'teacher_absent',
      severity: 'high',
      title: `${slot4P1.cls.className} 第 1 節教師未準時上課`,
      description: '上課鐘響逾 8 分鐘任課教師尚未到班，目前先由班級幹部協助維持安靜閱讀，請教務處聯繫確認。',
      status: 'open',
      reporterId: uid,
      reporterName: displayName,
      handlerId: '',
      handlerName: '',
      resolutionNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    incidentCount += 1;
  }

  opsBatch.set(doc(db, 'incidents', `inc-${today}-demo-2`), {
    campusId: CAMPUS_ID,
    date: today,
    period: 2,
    timetableId: '',
    location: `${buildings[0]} 1F 102 教室`,
    className: '二甲',
    category: 'facility_issue',
    severity: 'low',
    title: '102 教室觸控大屏訊號線接觸不良',
    description: '巡堂時教師反映投影畫面偶發閃爍，請總務處／資訊組於課間協助檢修線材。',
    status: 'open',
    reporterId: uid,
    reporterName: displayName,
    handlerId: '',
    handlerName: '',
    resolutionNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  incidentCount += 1;

  try {
    await opsBatch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'demoSeed');
  }

  return {
    timetableCount: createdSlots.length + 4 * 4 * SAMPLE_CLASSES.length,
    patrolCount,
    incidentCount,
  };
}
