import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type {
  ArchivedTimetableSlot,
  IncidentCategory,
  IncidentReport,
  IncidentSeverity,
  IncidentStatus,
  PatrolCheckItem,
  PatrolLog,
  PatrolStatus,
  SchoolSettings,
  SemesterType,
  StaffProfile,
  StaffRole,
  TimetableArchive,
  TimetableSlot,
} from '../types/patrol';
import { CAMPUS_ID, normalizeStaffRole } from '../types/patrol';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  clampInt,
  clampString,
  sanitizeBuildings,
  sanitizeChecklist,
  sanitizeDate,
  sanitizeId,
} from './validation';
import type { ParsedTimetableImportRow } from './exportReports';

export async function syncStaffProfileFromHub(profile: StaffProfile): Promise<void> {
  const safeUid = sanitizeId(profile.uid, 'user');
  const profileRef = doc(db, 'staffProfiles', safeUid);
  const desiredName = clampString(profile.displayName || '使用者', 60, '使用者');
  const desiredDept = clampString(profile.department || '教務處', 60, '教務處');
  const desiredTitle = clampString(
    profile.jobTitle || (profile.role === 'admin' ? '系統管理者' : '巡堂人員'),
    60,
    '巡堂人員'
  );
  const desiredRole: StaffRole = normalizeStaffRole(profile.role);

  try {
    const profSnap = await getDoc(profileRef);
    if (!profSnap.exists()) {
      await setDoc(profileRef, {
        uid: safeUid,
        campusId: CAMPUS_ID,
        displayName: desiredName,
        department: desiredDept,
        jobTitle: desiredTitle,
        role: desiredRole,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return;
    }

    const existingProf = profSnap.data() as StaffProfile;
    if (
      existingProf.displayName !== desiredName ||
      existingProf.department !== desiredDept ||
      existingProf.jobTitle !== desiredTitle ||
      normalizeStaffRole(existingProf.role) !== desiredRole ||
      (existingProf.role as string) !== desiredRole
    ) {
      await updateDoc(profileRef, {
        displayName: desiredName,
        department: desiredDept,
        jobTitle: desiredTitle,
        role: desiredRole,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    // Non-fatal during offline cached startup; log warning without blocking patrol workflow
    console.warn(`syncStaffProfileFromHub(${safeUid}) skipped:`, err);
  }
}

export async function saveSchoolSettings(
  uid: string,
  input: {
    schoolName: string;
    academicYear: string;
    semester: SemesterType;
    currentWeek: number;
    buildings: string[];
  }
): Promise<SchoolSettings> {
  const ref = doc(db, 'schoolSettings', CAMPUS_ID);
  const safeName = clampString(input.schoolName, 60, '利澤國小');
  const safeYear = clampString(input.academicYear, 10, '115');
  const safeSemester: SemesterType = input.semester === '第二學期' ? '第二學期' : '第一學期';
  const safeWeek = clampInt(input.currentWeek, 1, 25);
  const safeBuildings = sanitizeBuildings(input.buildings);
  const safeUid = sanitizeId(uid, 'admin');

  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        schoolName: safeName,
        academicYear: safeYear,
        semester: safeSemester,
        currentWeek: safeWeek,
        buildings: safeBuildings,
        updatedBy: safeUid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        campusId: CAMPUS_ID,
        schoolName: safeName,
        academicYear: safeYear,
        semester: safeSemester,
        currentWeek: safeWeek,
        buildings: safeBuildings,
        updatedBy: safeUid,
        updatedAt: serverTimestamp(),
      });
    }
    return {
      campusId: CAMPUS_ID,
      schoolName: safeName,
      academicYear: safeYear,
      semester: safeSemester,
      currentWeek: safeWeek,
      buildings: safeBuildings,
      updatedBy: safeUid,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `schoolSettings/${CAMPUS_ID}`);
  }
}

export async function createTimetableSlot(
  uid: string,
  input: ParsedTimetableImportRow,
  customId?: string,
  termMeta?: { academicYear?: string; semester?: SemesterType }
): Promise<string> {
  const docId = customId
    ? sanitizeId(customId, 'tt')
    : sanitizeId(`tt-d${input.dayOfWeek}-p${input.period}-${input.roomNumber}-${Date.now().toString(36)}`, 'tt');
  const path = `timetables/${docId}`;
  const payload: Record<string, unknown> = {
    campusId: CAMPUS_ID,
    dayOfWeek: clampInt(input.dayOfWeek, 1, 5),
    period: clampInt(input.period, 1, 8),
    building: clampString(input.building, 40, '行政教學大樓'),
    floor: clampString(input.floor, 20, '1F'),
    roomNumber: clampString(input.roomNumber, 20, '101'),
    className: clampString(input.className, 30, '未命名班級'),
    grade: clampString(input.grade, 20, '一年級'),
    subject: clampString(input.subject, 50, '國語'),
    teacherName: clampString(input.teacherName, 40, '授課教師'),
    expectedCount: 0,
    isRelocated: Boolean(input.isRelocated),
    locationNote: clampString(input.locationNote, 100, ''),
    roster: [],
    createdBy: clampString(uid, 128),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (termMeta?.academicYear?.trim()) {
    payload.academicYear = clampString(termMeta.academicYear, 10, '115');
  }
  if (termMeta?.semester) {
    payload.semester = termMeta.semester === '第二學期' ? '第二學期' : '第一學期';
  }
  try {
    await setDoc(doc(db, 'timetables', docId), payload);
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function batchImportTimetableSlots(
  uid: string,
  rows: ParsedTimetableImportRow[],
  options?: {
    replaceSlotIds?: string[];
    academicYear?: string;
    semester?: SemesterType;
  }
): Promise<number> {
  const CHUNK_SIZE = 200;
  const replaceIds = options?.replaceSlotIds ?? [];
  const safeYear = options?.academicYear?.trim()
    ? clampString(options.academicYear, 10, '115')
    : undefined;
  const safeSemester: SemesterType | undefined = options?.semester
    ? options.semester === '第二學期'
      ? '第二學期'
      : '第一學期'
    : undefined;

  // 1. Delete existing slots for replaced classes in safe chunks first
  for (let i = 0; i < replaceIds.length; i += CHUNK_SIZE) {
    const delChunk = replaceIds.slice(i, i + CHUNK_SIZE);
    const delBatch = writeBatch(db);
    delChunk.forEach((rawId) => {
      const safeId = sanitizeId(rawId, 'tt');
      delBatch.delete(doc(db, 'timetables', safeId));
    });
    try {
      await delBatch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'timetables');
    }
  }

  // 2. Create fresh timetable slots with collision-free IDs so Firestore always treats as create
  const batchToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  let imported = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((row, idx) => {
      const slotId = sanitizeId(
        `tt-d${row.dayOfWeek}-p${row.period}-${batchToken}-${(i + idx).toString(36)}`,
        'tt'
      );
      const payload: Record<string, unknown> = {
        campusId: CAMPUS_ID,
        dayOfWeek: clampInt(row.dayOfWeek, 1, 5),
        period: clampInt(row.period, 1, 8),
        building: clampString(row.building, 40, '行政教學大樓'),
        floor: clampString(row.floor, 20, '1F'),
        roomNumber: clampString(row.roomNumber, 20, '101'),
        className: clampString(row.className, 30, '未命名班級'),
        grade: clampString(row.grade, 20, '一年級'),
        subject: clampString(row.subject, 50, '國語'),
        teacherName: clampString(row.teacherName, 40, '授課教師'),
        expectedCount: 0,
        isRelocated: Boolean(row.isRelocated),
        locationNote: clampString(row.locationNote, 100, ''),
        roster: [],
        createdBy: clampString(uid, 128),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (safeYear) payload.academicYear = safeYear;
      if (safeSemester) payload.semester = safeSemester;
      batch.set(doc(db, 'timetables', slotId), payload);
    });
    try {
      await batch.commit();
      imported += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'timetables');
    }
  }
  return imported;
}

export async function updateTimetableSlot(
  timetableId: string,
  updates: {
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
): Promise<void> {
  const safeId = sanitizeId(timetableId, 'tt');
  const path = `timetables/${safeId}`;
  try {
    await updateDoc(doc(db, 'timetables', safeId), {
      building: clampString(updates.building, 40, '行政教學大樓'),
      floor: clampString(updates.floor, 20, '1F'),
      roomNumber: clampString(updates.roomNumber, 20, '101'),
      className: clampString(updates.className, 30, '未命名班級'),
      grade: clampString(updates.grade, 20, '一年級'),
      subject: clampString(updates.subject, 50, '國語'),
      teacherName: clampString(updates.teacherName, 40, '授課教師'),
      isRelocated: Boolean(updates.isRelocated),
      locationNote: clampString(updates.locationNote, 100, ''),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteTimetableSlot(timetableId: string): Promise<void> {
  const safeId = sanitizeId(timetableId, 'tt');
  try {
    await deleteDoc(doc(db, 'timetables', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `timetables/${safeId}`);
  }
}

export async function batchDeleteTimetableSlots(timetableIds: string[]): Promise<number> {
  const CHUNK_SIZE = 200;
  let deleted = 0;
  for (let i = 0; i < timetableIds.length; i += CHUNK_SIZE) {
    const chunk = timetableIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((rawId) => {
      batch.delete(doc(db, 'timetables', sanitizeId(rawId, 'tt')));
    });
    try {
      await batch.commit();
      deleted += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'timetables');
    }
  }
  return deleted;
}

export async function savePatrolLog(params: {
  inspectorId: string;
  inspectorName: string;
  date: string;
  slot: TimetableSlot;
  checklist: PatrolCheckItem[];
  status: PatrolStatus;
  note: string;
  existingOwnLog?: PatrolLog | null;
}): Promise<string> {
  const {
    inspectorId,
    inspectorName,
    date,
    slot,
    checklist,
    status,
    note,
    existingOwnLog,
  } = params;

  const safeChecklist = sanitizeChecklist(checklist);
  const teacherPresent = !safeChecklist.includes('teacher_late');
  const safeGrade = clampString(slot.grade || '', 20, '');

  if (existingOwnLog && existingOwnLog.inspectorId === inspectorId) {
    const path = `patrolLogs/${existingOwnLog.id}`;
    try {
      await updateDoc(doc(db, 'patrolLogs', existingOwnLog.id), {
        teacherPresent,
        actualCount: 0,
        status,
        checklist: safeChecklist,
        grade: safeGrade,
        note: clampString(note, 500, ''),
        updatedAt: serverTimestamp(),
      });
      return existingOwnLog.id;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  const docId = sanitizeId(
    `log-${date}-p${slot.period}-${slot.roomNumber}-${Date.now().toString(36)}`,
    'log'
  );
  const path = `patrolLogs/${docId}`;
  try {
    await setDoc(doc(db, 'patrolLogs', docId), {
      campusId: CAMPUS_ID,
      date: sanitizeDate(date),
      dayOfWeek: clampInt(slot.dayOfWeek, 1, 5),
      period: clampInt(slot.period, 1, 8),
      timetableId: sanitizeId(slot.id, 'tt'),
      building: clampString(slot.building, 40, '行政教學大樓'),
      roomNumber: clampString(slot.roomNumber, 20, '101'),
      className: clampString(slot.className, 30, '未命名班級'),
      grade: safeGrade,
      subject: clampString(slot.subject, 50, '國語'),
      teacherName: clampString(slot.teacherName, 40, '授課教師'),
      teacherPresent,
      expectedCount: 0,
      actualCount: 0,
      status,
      checklist: safeChecklist,
      note: clampString(note, 500, ''),
      inspectorId: clampString(inspectorId, 128),
      inspectorName: clampString(inspectorName, 60, '巡堂人員'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createIncidentReport(params: {
  reporterId: string;
  reporterName: string;
  date: string;
  period: number;
  timetableId?: string;
  location: string;
  className?: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  title: string;
  description: string;
}): Promise<string> {
  const docId = sanitizeId(
    `inc-${params.date}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    'inc'
  );
  const path = `incidents/${docId}`;
  try {
    await setDoc(doc(db, 'incidents', docId), {
      campusId: CAMPUS_ID,
      date: sanitizeDate(params.date),
      period: clampInt(params.period, 1, 8),
      timetableId: params.timetableId ? sanitizeId(params.timetableId, 'tt') : '',
      location: clampString(params.location, 80, '校園公共區域'),
      className: clampString(params.className || '', 30, ''),
      category: params.category,
      severity: params.severity,
      title: clampString(params.title, 120, '巡堂異常通報'),
      description: clampString(params.description, 1000, '巡堂發現異常事件'),
      status: 'open',
      reporterId: clampString(params.reporterId, 128),
      reporterName: clampString(params.reporterName, 60, '巡堂人員'),
      handlerId: '',
      handlerName: '',
      resolutionNote: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function transitionIncidentStatus(params: {
  incident: IncidentReport;
  nextStatus: IncidentStatus;
  handlerId: string;
  handlerName: string;
  resolutionNote: string;
}): Promise<void> {
  const safeId = sanitizeId(params.incident.id, 'inc');
  const path = `incidents/${safeId}`;
  try {
    const payload: Record<string, unknown> = {
      handlerId: clampString(params.handlerId, 128),
      handlerName: clampString(params.handlerName, 60, '處理人員'),
      resolutionNote: clampString(params.resolutionNote, 1000, ''),
      updatedAt: serverTimestamp(),
    };
    if (params.nextStatus !== params.incident.status) {
      payload.status = params.nextStatus;
    }
    await updateDoc(doc(db, 'incidents', safeId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteIncidentReport(incidentId: string): Promise<void> {
  const safeId = sanitizeId(incidentId, 'inc');
  try {
    await deleteDoc(doc(db, 'incidents', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `incidents/${safeId}`);
  }
}

export async function batchDeletePatrolLogs(logIds: string[]): Promise<number> {
  const CHUNK_SIZE = 200;
  let deleted = 0;
  for (let i = 0; i < logIds.length; i += CHUNK_SIZE) {
    const chunk = logIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((rawId) => {
      batch.delete(doc(db, 'patrolLogs', sanitizeId(rawId, 'log')));
    });
    try {
      await batch.commit();
      deleted += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'patrolLogs');
    }
  }
  return deleted;
}

export async function batchDeleteIncidents(incidentIds: string[]): Promise<number> {
  const CHUNK_SIZE = 200;
  let deleted = 0;
  for (let i = 0; i < incidentIds.length; i += CHUNK_SIZE) {
    const chunk = incidentIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((rawId) => {
      batch.delete(doc(db, 'incidents', sanitizeId(rawId, 'inc')));
    });
    try {
      await batch.commit();
      deleted += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'incidents');
    }
  }
  return deleted;
}

/**
 * Archives the current active timetables into an immutable snapshot under
 * /timetableArchives/{archiveId} + /timetableArchives/{archiveId}/slots/{slotId}.
 * Optionally clears active timetables and advances schoolSettings to the next academic term.
 */
export async function archiveCurrentTimetables(params: {
  uid: string;
  actorName: string;
  schoolSettings: SchoolSettings;
  timetables: TimetableSlot[];
  archiveAcademicYear: string;
  archiveSemester: SemesterType;
  label: string;
  note: string;
  clearActiveAfterArchive: boolean;
  switchToNewTerm?: {
    academicYear: string;
    semester: SemesterType;
    currentWeek: number;
  };
}): Promise<{ archiveId: string; archivedSlotCount: number; clearedSlotCount: number }> {
  const {
    uid,
    actorName,
    schoolSettings,
    timetables,
    archiveAcademicYear,
    archiveSemester,
    label,
    note,
    clearActiveAfterArchive,
    switchToNewTerm,
  } = params;

  const safeUid = sanitizeId(uid, 'admin');
  const safeYear = clampString(archiveAcademicYear, 10, schoolSettings.academicYear || '115');
  const safeSemester: SemesterType = archiveSemester === '第二學期' ? '第二學期' : '第一學期';
  const safeLabel = clampString(
    label,
    80,
    `${safeYear} 學年度${safeSemester}課表`
  );
  const safeNote = clampString(note, 300, '');
  const safeActorName = clampString(actorName, 60, '系統管理者');

  const uniqueClasses = Array.from(
    new Set(timetables.map((t) => clampString(t.className, 30, '未命名班級')))
  ).sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  const archiveId = sanitizeId(
    `arc-${safeYear}-${safeSemester === '第二學期' ? 's2' : 's1'}-${Date.now().toString(36)}`,
    'arc'
  );

  // Step 1: Create parent archive header doc FIRST (required by subcollection exists() rule!)
  const archiveRef = doc(db, 'timetableArchives', archiveId);
  try {
    await setDoc(archiveRef, {
      campusId: CAMPUS_ID,
      academicYear: safeYear,
      semester: safeSemester,
      label: safeLabel,
      note: safeNote,
      classCount: clampInt(uniqueClasses.length, 0, 200),
      slotCount: clampInt(timetables.length, 0, 2000),
      classNames: uniqueClasses.slice(0, 60),
      archivedBy: safeUid,
      archivedByName: safeActorName,
      archivedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `timetableArchives/${archiveId}`);
  }

  // Step 2: Copy all timetable slots into /timetableArchives/{archiveId}/slots/{slotId}
  const CHUNK_SIZE = 200;
  let archivedSlotCount = 0;
  for (let i = 0; i < timetables.length; i += CHUNK_SIZE) {
    const chunk = timetables.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((slot, idx) => {
      const slotId = sanitizeId(`as-d${slot.dayOfWeek}-p${slot.period}-${(i + idx).toString(36)}`, 'as');
      batch.set(doc(db, 'timetableArchives', archiveId, 'slots', slotId), {
        campusId: CAMPUS_ID,
        archiveId,
        dayOfWeek: clampInt(slot.dayOfWeek, 1, 5),
        period: clampInt(slot.period, 1, 8),
        building: clampString(slot.building, 40, '行政教學大樓'),
        floor: clampString(slot.floor, 20, '1F'),
        roomNumber: clampString(slot.roomNumber, 20, '101'),
        className: clampString(slot.className, 30, '未命名班級'),
        grade: clampString(slot.grade, 20, '一年級'),
        subject: clampString(slot.subject, 50, '國語'),
        teacherName: clampString(slot.teacherName, 40, '授課教師'),
        isRelocated: Boolean(slot.isRelocated),
        locationNote: clampString(slot.locationNote, 100, ''),
        archivedBy: safeUid,
        archivedAt: serverTimestamp(),
      });
    });
    try {
      await batch.commit();
      archivedSlotCount += chunk.length;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `timetableArchives/${archiveId}/slots`);
    }
  }

  // Step 3: Optionally clear active /timetables so the new term starts clean
  let clearedSlotCount = 0;
  if (clearActiveAfterArchive && timetables.length > 0) {
    clearedSlotCount = await batchDeleteTimetableSlots(timetables.map((t) => t.id));
  }

  // Step 4: Optionally advance schoolSettings to the new academic year/semester
  if (switchToNewTerm) {
    await saveSchoolSettings(safeUid, {
      schoolName: schoolSettings.schoolName,
      academicYear: switchToNewTerm.academicYear,
      semester: switchToNewTerm.semester,
      currentWeek: switchToNewTerm.currentWeek,
      buildings: schoolSettings.buildings,
    });
  }

  return { archiveId, archivedSlotCount, clearedSlotCount };
}

export async function fetchArchivedTimetableSlots(
  archiveId: string
): Promise<ArchivedTimetableSlot[]> {
  const safeArchiveId = sanitizeId(archiveId, 'arc');
  const slotsRef = collection(db, 'timetableArchives', safeArchiveId, 'slots');
  const qSlots = query(slotsRef, where('campusId', '==', CAMPUS_ID));
  try {
    const snap = await getDocs(qSlots);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ArchivedTimetableSlot, 'id'>),
    }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `timetableArchives/${safeArchiveId}/slots`);
  }
}

export async function restoreArchivedTimetable(params: {
  uid: string;
  archive: TimetableArchive;
  slots: ArchivedTimetableSlot[];
  existingTimetableIds: string[];
  replaceActive: boolean;
  updateSchoolTerm?: {
    schoolSettings: SchoolSettings;
  };
}): Promise<number> {
  const { uid, archive, slots, existingTimetableIds, replaceActive, updateSchoolTerm } = params;
  const rows: ParsedTimetableImportRow[] = slots.map((s) => ({
    dayOfWeek: s.dayOfWeek,
    period: s.period,
    building: s.building,
    floor: s.floor,
    roomNumber: s.roomNumber,
    className: s.className,
    grade: s.grade,
    subject: s.subject,
    teacherName: s.teacherName,
    isRelocated: s.isRelocated,
    locationNote: s.locationNote,
  }));

  const restored = await batchImportTimetableSlots(uid, rows, {
    replaceSlotIds: replaceActive ? existingTimetableIds : [],
    academicYear: archive.academicYear,
    semester: archive.semester,
  });

  if (updateSchoolTerm) {
    await saveSchoolSettings(uid, {
      schoolName: updateSchoolTerm.schoolSettings.schoolName,
      academicYear: archive.academicYear,
      semester: archive.semester,
      currentWeek: 1,
      buildings: updateSchoolTerm.schoolSettings.buildings,
    });
  }

  return restored;
}

export async function deleteTimetableArchive(archiveId: string): Promise<void> {
  const safeArchiveId = sanitizeId(archiveId, 'arc');
  const slotsRef = collection(db, 'timetableArchives', safeArchiveId, 'slots');
  const qSlots = query(slotsRef, where('campusId', '==', CAMPUS_ID));

  let slotDocIds: string[] = [];
  try {
    const snap = await getDocs(qSlots);
    slotDocIds = snap.docs.map((d) => d.id);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `timetableArchives/${safeArchiveId}/slots`);
  }

  // Delete subcollection slots first in 200-doc chunks
  const CHUNK_SIZE = 200;
  for (let i = 0; i < slotDocIds.length; i += CHUNK_SIZE) {
    const chunk = slotDocIds.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((slotId) => {
      batch.delete(doc(db, 'timetableArchives', safeArchiveId, 'slots', slotId));
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `timetableArchives/${safeArchiveId}/slots`);
    }
  }

  // Then delete parent archive metadata doc
  try {
    await deleteDoc(doc(db, 'timetableArchives', safeArchiveId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `timetableArchives/${safeArchiveId}`);
  }
}

export const collectionRefs = {
  schoolSettings: () => collection(db, 'schoolSettings'),
  allowedAccounts: () => collection(db, 'allowedAccounts'),
  staffProfiles: () => collection(db, 'staffProfiles'),
  timetables: () => collection(db, 'timetables'),
  timetableArchives: () => collection(db, 'timetableArchives'),
  patrolLogs: () => collection(db, 'patrolLogs'),
  incidents: () => collection(db, 'incidents'),
};
