import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { CAMPUS_ID, getDayOfWeekFromDate, getTodayDateString } from '../types/patrol';
import { db, handleFirestoreError, OperationType } from './firebase';

interface ClassMeta {
  className: string;
  grade: string;
  building: string;
  floor: string;
  roomNumber: string;
  expectedCount: number;
  roster: string[];
}

const SAMPLE_CLASSES: ClassMeta[] = [
  {
    className: '高一忠',
    grade: '高一',
    building: '教學A棟',
    floor: '2F',
    roomNumber: 'A201',
    expectedCount: 34,
    roster: ['01 王小明', '02 陳怡君', '03 林宇軒', '04 張雅婷', '05 李承翰', '06 黃詩涵', '07 吳柏宇', '08 蔡沛珊'],
  },
  {
    className: '高一孝',
    grade: '高一',
    building: '教學A棟',
    floor: '2F',
    roomNumber: 'A202',
    expectedCount: 33,
    roster: ['01 劉冠廷', '02 鄭詠晴', '03 許家豪', '04 楊欣霓', '05 謝明哲', '06 賴品妍', '07 曾子豪', '08 郭語彤'],
  },
  {
    className: '高一仁',
    grade: '高一',
    building: '教學A棟',
    floor: '3F',
    roomNumber: 'A301',
    expectedCount: 35,
    roster: ['01 洪嘉宏', '02 邱郁婷', '03 廖偉倫', '04 徐珮琪', '05 蘇柏諺', '06 葉芷瑜', '07 呂俊賢', '08 詹宜蓁'],
  },
  {
    className: '高二忠',
    grade: '高二',
    building: '教學B棟',
    floor: '2F',
    roomNumber: 'B201',
    expectedCount: 32,
    roster: ['01 周彥廷', '02 蕭采薇', '03 何冠宇', '04 羅心怡', '05 傅哲維', '06 柯雅筑', '07 盧建霖', '08 宋佳穎'],
  },
  {
    className: '高二孝',
    grade: '高二',
    building: '教學B棟',
    floor: '3F',
    roomNumber: 'B301',
    expectedCount: 34,
    roster: ['01 彭宇翔', '02 戴詩婷', '03 范瑋倫', '04 方思穎', '05 沈祐誠', '06 袁若彤', '07 江承恩', '08 韓語晨'],
  },
  {
    className: '高三忠',
    grade: '高三',
    building: '科學館',
    floor: '2F',
    roomNumber: 'S201',
    expectedCount: 30,
    roster: ['01 趙子揚', '02 孫鈺涵', '03 魏廷宇', '04 顏語柔', '05 程柏翰', '06 鄧欣樺', '07 姚景翔', '08 簡佩樺'],
  },
];

const SUBJECT_POOL: Array<{ subject: string; teacher: string; relocated?: boolean; note?: string }> = [
  { subject: '數學', teacher: '林志明' },
  { subject: '國語文', teacher: '陳淑芬' },
  { subject: '英文', teacher: '王美玲' },
  { subject: '物理實驗', teacher: '周建宏', relocated: true, note: '科學館3F 物理實驗室' },
  { subject: '歷史', teacher: '張文傑' },
  { subject: '體育', teacher: '劉大衛', relocated: true, note: '戶外操場跑道' },
  { subject: '化學', teacher: '黃俊榮' },
  { subject: '公民與社會', teacher: '吳佳蓉' },
  { subject: '資訊科技', teacher: '蔡明憲', relocated: true, note: '電腦教室二' },
];

/**
 * Seeds a complete, realistic Taiwanese school timetable + today's live patrol scenario
 * strictly respecting Firestore exists() invariants (timetables committed first).
 */
export async function seedCampusDemoDataset(params: {
  uid: string;
  displayName: string;
}): Promise<{ timetableCount: number; patrolCount: number; absenceCount: number; incidentCount: number }> {
  const { uid, displayName } = params;
  const today = getTodayDateString();
  const todayDow = getDayOfWeekFromDate(today);

  // Step 1: Commit timetables for Mon-Fri (periods 1-6 for todayDow, plus periods 1-4 for other weekdays)
  const timetableBatch = writeBatch(db);
  const createdSlots: Array<{
    id: string;
    dayOfWeek: number;
    period: number;
    cls: ClassMeta;
    subject: string;
    teacherName: string;
    isRelocated: boolean;
    locationNote: string;
  }> = [];

  for (let day = 1; day <= 5; day++) {
    const maxPeriod = day === todayDow ? 6 : 4;
    for (let period = 1; period <= maxPeriod; period++) {
      SAMPLE_CLASSES.forEach((cls, classIdx) => {
        const pick = SUBJECT_POOL[(day * 3 + period + classIdx * 2) % SUBJECT_POOL.length];
        const id = `tt-d${day}-p${period}-${cls.roomNumber}`;
        const isRelocated = Boolean(pick.relocated);
        const locationNote = pick.note || '';

        timetableBatch.set(doc(db, 'timetables', id), {
          campusId: CAMPUS_ID,
          dayOfWeek: day,
          period,
          building: cls.building,
          floor: cls.floor,
          roomNumber: cls.roomNumber,
          className: cls.className,
          grade: cls.grade,
          subject: pick.subject,
          teacherName: pick.teacher,
          expectedCount: cls.expectedCount,
          isRelocated,
          locationNote,
          roster: cls.roster,
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

  // Step 2: Commit approved leave records, sample patrol logs, absences, and incidents
  // (Timetables now exist, so exists() in Firestore rules will pass!)
  const opsBatch = writeBatch(db);

  // Approved Leave Records (so automated truancy engine demonstrates auto-reconciliation!)
  opsBatch.set(doc(db, 'leaveRecords', `lv-${today}-demo-1`), {
    campusId: CAMPUS_ID,
    date: today,
    className: '高一忠',
    seatNumber: '02',
    studentName: '陳怡君',
    leaveType: 'sick',
    periods: [1, 2, 3, 4],
    reason: '發燒就醫，家長已來電請病假',
    approvedBy: '學務處生教組',
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  opsBatch.set(doc(db, 'leaveRecords', `lv-${today}-demo-2`), {
    campusId: CAMPUS_ID,
    date: today,
    className: '高二忠',
    seatNumber: '05',
    studentName: '傅哲維',
    leaveType: 'official',
    periods: [1, 2, 3],
    reason: '代表學校參加全市科展簡報彩排',
    approvedBy: '教務處設備組',
    createdBy: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Patrol Logs for Period 1 & Period 2 today
  const p1Slots = createdSlots.filter((s) => s.period === 1);
  const p2Slots = createdSlots.filter((s) => s.period === 2);
  let patrolCount = 0;

  p1Slots.forEach((slot, idx) => {
    const status =
      idx === 1 ? 'minor_issue' : idx === 3 ? 'urgent_issue' : slot.isRelocated ? 'empty_relocated' : 'normal';
    const actualCount =
      idx === 0 ? slot.cls.expectedCount - 2 : idx === 3 ? slot.cls.expectedCount - 2 : slot.cls.expectedCount - (idx % 2);
    const teacherPresent = idx !== 3;
    const note =
      idx === 1
        ? '後排兩位學生交談聲較大，已口頭提醒改善'
        : idx === 3
          ? '上課逾 12 分鐘任課教師尚未到班，已由幹部維持自習並通報教務處'
          : slot.isRelocated
            ? `班級依課表移至「${slot.locationNote}」上課`
            : '師生互動良好，教學秩序正常';

    opsBatch.set(doc(db, 'patrolLogs', `log-${today}-p1-${slot.cls.roomNumber}`), {
      campusId: CAMPUS_ID,
      date: today,
      dayOfWeek: todayDow,
      period: 1,
      timetableId: slot.id,
      building: slot.cls.building,
      roomNumber: slot.cls.roomNumber,
      className: slot.cls.className,
      subject: slot.subject,
      teacherName: slot.teacherName,
      teacherPresent,
      expectedCount: slot.cls.expectedCount,
      actualCount,
      status,
      note,
      inspectorId: uid,
      inspectorName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    patrolCount += 1;
  });

  // Partially patrol Period 2 (first 4 classes) so user sees live progress & unpatrolled items
  p2Slots.slice(0, 4).forEach((slot, idx) => {
    const status = slot.isRelocated ? 'empty_relocated' : idx === 0 ? 'minor_issue' : 'normal';
    opsBatch.set(doc(db, 'patrolLogs', `log-${today}-p2-${slot.cls.roomNumber}`), {
      campusId: CAMPUS_ID,
      date: today,
      dayOfWeek: todayDow,
      period: 2,
      timetableId: slot.id,
      building: slot.cls.building,
      roomNumber: slot.cls.roomNumber,
      className: slot.cls.className,
      subject: slot.subject,
      teacherName: slot.teacherName,
      teacherPresent: true,
      expectedCount: slot.cls.expectedCount,
      actualCount: slot.cls.expectedCount - (idx === 0 ? 2 : 0),
      status,
      note: idx === 0 ? '03 林宇軒連續兩節未到席，請生教組追蹤' : '課堂運作正常',
      inspectorId: uid,
      inspectorName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    patrolCount += 1;
  });

  // Absences showcasing all automated algorithm branches:
  // 1) 02 陳怡君 (has approved sick leave -> auto excused_leave)
  // 2) 03 林宇軒 missing Period 1, 2, 3 -> triggers consecutive 3-period HIGH RISK!
  // 3) 05 傅哲維 (has approved official leave -> auto excused_leave)
  // 4) 07 曾子豪 late in Period 1 -> auto late (low risk)
  const slot101P1 = createdSlots.find((s) => s.cls.className === '高一忠' && s.period === 1);
  const slot101P2 = createdSlots.find((s) => s.cls.className === '高一忠' && s.period === 2);
  const slot101P3 = createdSlots.find((s) => s.cls.className === '高一忠' && s.period === 3);
  const slot102P1 = createdSlots.find((s) => s.cls.className === '高一孝' && s.period === 1);
  const slot201P1 = createdSlots.find((s) => s.cls.className === '高二忠' && s.period === 1);

  let absenceCount = 0;
  if (slot101P1) {
    opsBatch.set(doc(db, 'absences', `abs-${today}-demo-1`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 1,
      timetableId: slot101P1.id,
      className: slot101P1.cls.className,
      subject: slot101P1.subject,
      teacherName: slot101P1.teacherName,
      seatNumber: '02',
      studentName: '陳怡君',
      observedType: 'missing',
      autoStatus: 'excused_leave',
      riskLevel: 'low',
      verified: true,
      note: '系統自動比對病假假單核銷',
      recordedBy: uid,
      recordedByName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    opsBatch.set(doc(db, 'absences', `abs-${today}-demo-2`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 1,
      timetableId: slot101P1.id,
      className: slot101P1.cls.className,
      subject: slot101P1.subject,
      teacherName: slot101P1.teacherName,
      seatNumber: '03',
      studentName: '林宇軒',
      observedType: 'missing',
      autoStatus: 'truant',
      riskLevel: 'high',
      verified: false,
      note: '未到席且查無請假紀錄',
      recordedBy: uid,
      recordedByName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    absenceCount += 2;
  }

  if (slot101P2) {
    opsBatch.set(doc(db, 'absences', `abs-${today}-demo-3`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 2,
      timetableId: slot101P2.id,
      className: slot101P2.cls.className,
      subject: slot101P2.subject,
      teacherName: slot101P2.teacherName,
      seatNumber: '03',
      studentName: '林宇軒',
      observedType: 'missing',
      autoStatus: 'truant',
      riskLevel: 'high',
      verified: false,
      note: '連續第 2 節未到席',
      recordedBy: uid,
      recordedByName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    absenceCount += 1;
  }

  if (slot101P3) {
    opsBatch.set(doc(db, 'absences', `abs-${today}-demo-4`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 3,
      timetableId: slot101P3.id,
      className: slot101P3.cls.className,
      subject: slot101P3.subject,
      teacherName: slot101P3.teacherName,
      seatNumber: '03',
      studentName: '林宇軒',
      observedType: 'missing',
      autoStatus: 'truant',
      riskLevel: 'high',
      verified: false,
      note: '連續第 3 節無故未到，觸發自動高風險通報',
      recordedBy: uid,
      recordedByName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    absenceCount += 1;
  }

  if (slot102P1) {
    opsBatch.set(doc(db, 'absences', `abs-${today}-demo-5`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 1,
      timetableId: slot102P1.id,
      className: slot102P1.cls.className,
      subject: slot102P1.subject,
      teacherName: slot102P1.teacherName,
      seatNumber: '07',
      studentName: '曾子豪',
      observedType: 'late',
      autoStatus: 'late',
      riskLevel: 'low',
      verified: false,
      note: '遲到 12 分鐘進班',
      recordedBy: uid,
      recordedByName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    absenceCount += 1;
  }

  if (slot201P1) {
    opsBatch.set(doc(db, 'absences', `abs-${today}-demo-6`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 1,
      timetableId: slot201P1.id,
      className: slot201P1.cls.className,
      subject: slot201P1.subject,
      teacherName: slot201P1.teacherName,
      seatNumber: '05',
      studentName: '傅哲維',
      observedType: 'missing',
      autoStatus: 'excused_leave',
      riskLevel: 'low',
      verified: true,
      note: '公假彩排自動核銷',
      recordedBy: uid,
      recordedByName: displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    absenceCount += 1;
  }

  // Incidents (Open high-severity + medium + low)
  let incidentCount = 0;
  if (slot201P1) {
    opsBatch.set(doc(db, 'incidents', `inc-${today}-demo-1`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 1,
      timetableId: slot201P1.id,
      location: `${slot201P1.cls.building} ${slot201P1.cls.roomNumber} · ${slot201P1.cls.className}`,
      className: slot201P1.cls.className,
      category: 'teacher_absent',
      severity: 'high',
      title: '高二忠第 1 節任課教師尚未到班',
      description: '上課已逾 12 分鐘，任課教師尚未進入教室，目前由班長協助維持班級自習秩序，請教務處立即確認代課或聯繫教師。',
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

  if (slot101P3) {
    opsBatch.set(doc(db, 'incidents', `inc-${today}-demo-2`), {
      campusId: CAMPUS_ID,
      date: today,
      period: 3,
      timetableId: slot101P3.id,
      location: `${slot101P3.cls.building} ${slot101P3.cls.roomNumber} · ${slot101P3.cls.className}`,
      className: slot101P3.cls.className,
      category: 'student_truancy',
      severity: 'medium',
      title: '高一忠 03 號林宇軒連續 3 節未請假缺席',
      description: '自動缺曠判別演算法偵測該生今日第 1 至第 3 節均未到席且查無假單，請導師與生教組協助聯繫家長確認安全。',
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

  opsBatch.set(doc(db, 'incidents', `inc-${today}-demo-3`), {
    campusId: CAMPUS_ID,
    date: today,
    period: 2,
    timetableId: '',
    location: '教學A棟 2F 走廊東側',
    className: '',
    category: 'facility_issue',
    severity: 'low',
    title: 'A202 教室投影機訊號線接觸不良',
    description: '巡堂時教師反映 HDMI 訊號偶發閃爍，請總務處／資訊組於下課空檔協助更換線材。',
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
    absenceCount,
    incidentCount,
  };
}
