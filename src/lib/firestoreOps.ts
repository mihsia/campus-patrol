import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import type {
  AbsenceRecord,
  AccountStatus,
  AllowedAccount,
  AutoAbsenceStatus,
  IncidentCategory,
  IncidentReport,
  IncidentSeverity,
  IncidentStatus,
  LeaveRecord,
  LeaveType,
  ObservedAbsenceType,
  PatrolLog,
  PatrolStatus,
  RiskLevel,
  StaffProfile,
  StaffRole,
  TimetableSlot,
} from '../types/patrol';
import { BOOTSTRAP_ADMIN_EMAIL, CAMPUS_ID, normalizeStaffRole } from '../types/patrol';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  clampInt,
  clampString,
  emailToAccountId,
  isValidEmailFormat,
  normalizeEmail,
  sanitizeDate,
  sanitizeId,
  sanitizePeriods,
  sanitizeRoster,
} from './validation';
import type { ParsedTimetableImportRow } from './exportReports';

export type GoogleAccountAuthResult =
  | {
      status: 'authorized';
      profile: StaffProfile;
      account: AllowedAccount;
      isAdmin: boolean;
    }
  | {
      status: 'unauthorized';
      email: string;
    }
  | {
      status: 'disabled';
      email: string;
      displayName: string;
      department: string;
    };

export async function verifyAndBootstrapGoogleUser(params: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<GoogleAccountAuthResult> {
  const { uid, email, displayName } = params;
  const normalizedEmail = normalizeEmail(email);
  const safeUid = sanitizeId(uid, 'user');
  const accountId = emailToAccountId(normalizedEmail);
  const isBootstrapAdmin = normalizedEmail === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

  const allowedRef = doc(db, 'allowedAccounts', accountId);
  const profileRef = doc(db, 'staffProfiles', safeUid);
  const privateRef = doc(db, 'userPrivate', safeUid);

  // 1. Check authoritative Google allowlist document
  let accSnap;
  try {
    accSnap = await getDoc(allowedRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `allowedAccounts/${accountId}`);
  }

  let account: AllowedAccount;

  if (!accSnap.exists()) {
    if (!isBootstrapAdmin) {
      return { status: 'unauthorized', email: normalizedEmail };
    }

    // Auto-bootstrap primary system administrator record on first sign-in
    const bootstrapPayload = {
      campusId: CAMPUS_ID,
      email: normalizedEmail,
      displayName: clampString(displayName || '系統管理員', 60, '系統管理員'),
      department: '校長室',
      jobTitle: '系統管理者',
      role: 'admin' as StaffRole,
      status: 'active' as AccountStatus,
      uid: safeUid,
      createdBy: safeUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(allowedRef, bootstrapPayload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `allowedAccounts/${accountId}`);
    }
    account = {
      id: accountId,
      campusId: CAMPUS_ID,
      email: normalizedEmail,
      displayName: bootstrapPayload.displayName,
      department: bootstrapPayload.department,
      jobTitle: bootstrapPayload.jobTitle,
      role: 'admin',
      status: 'active',
      uid: safeUid,
      createdBy: safeUid,
    };
  } else {
    const raw = accSnap.data() as Omit<AllowedAccount, 'id'>;
    if (!isBootstrapAdmin && raw.status !== 'active') {
      return {
        status: 'disabled',
        email: normalizedEmail,
        displayName: raw.displayName || displayName || normalizedEmail,
        department: raw.department || '未指定處室',
      };
    }

    const resolvedRole: StaffRole = isBootstrapAdmin ? 'admin' : normalizeStaffRole(raw.role);
    const resolvedStatus: AccountStatus = isBootstrapAdmin ? 'active' : raw.status;

    // Bind Firebase Auth UID on first Google sign-in (or UID update)
    if (raw.uid !== safeUid) {
      try {
        await updateDoc(allowedRef, {
          uid: safeUid,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `allowedAccounts/${accountId}`);
      }
    }

    account = {
      id: accountId,
      campusId: CAMPUS_ID,
      email: raw.email,
      displayName: raw.displayName,
      department: raw.department,
      jobTitle: raw.jobTitle,
      role: resolvedRole,
      status: resolvedStatus,
      uid: safeUid,
      createdBy: raw.createdBy,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  const isAdmin = isBootstrapAdmin || account.role === 'admin';
  const resolvedRole: StaffRole = isAdmin ? 'admin' : 'user';

  // 2. Ensure isolated PII doc exists / updated
  try {
    const privSnap = await getDoc(privateRef);
    if (!privSnap.exists()) {
      await setDoc(privateRef, {
        uid: safeUid,
        email: normalizedEmail,
        updatedAt: serverTimestamp(),
      });
    } else if (privSnap.data()?.email !== normalizedEmail) {
      await updateDoc(privateRef, {
        email: normalizedEmail,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `userPrivate/${safeUid}`);
  }

  // 3. Synchronize non-PII staff profile with authoritative allowedAccount
  try {
    const profSnap = await getDoc(profileRef);
    const desiredName = clampString(account.displayName || displayName || '使用者', 60, '使用者');
    const desiredDept = clampString(account.department || '學務處', 60, '學務處');
    const desiredTitle = clampString(account.jobTitle || (isAdmin ? '系統管理者' : '巡堂使用者'), 60, '巡堂使用者');

    if (!profSnap.exists()) {
      const initialProfile: Omit<StaffProfile, 'createdAt' | 'updatedAt'> = {
        uid: safeUid,
        campusId: CAMPUS_ID,
        displayName: desiredName,
        department: desiredDept,
        jobTitle: desiredTitle,
        role: resolvedRole,
      };
      await setDoc(profileRef, {
        ...initialProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { status: 'authorized', profile: initialProfile, account, isAdmin };
    }

    const existingProf = profSnap.data() as StaffProfile;
    const normalizedExistingRole = normalizeStaffRole(existingProf.role);
    if (
      existingProf.displayName !== desiredName ||
      existingProf.department !== desiredDept ||
      existingProf.jobTitle !== desiredTitle ||
      normalizedExistingRole !== resolvedRole ||
      (existingProf.role as string) !== resolvedRole
    ) {
      await updateDoc(profileRef, {
        displayName: desiredName,
        department: desiredDept,
        jobTitle: desiredTitle,
        role: resolvedRole,
        updatedAt: serverTimestamp(),
      });
    }

    return {
      status: 'authorized',
      profile: {
        uid: safeUid,
        campusId: CAMPUS_ID,
        displayName: desiredName,
        department: desiredDept,
        jobTitle: desiredTitle,
        role: resolvedRole,
        createdAt: existingProf.createdAt,
        updatedAt: existingProf.updatedAt,
      },
      account,
      isAdmin,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `staffProfiles/${safeUid}`);
  }
}

export async function updateOwnStaffProfile(
  uid: string,
  email: string,
  updates: { displayName: string; department: string; jobTitle: string }
): Promise<void> {
  const safeUid = sanitizeId(uid, 'user');
  const accountId = emailToAccountId(email);
  const safeName = clampString(updates.displayName, 60, '巡堂教師');
  const safeDept = clampString(updates.department, 60, '學務處');
  const safeTitle = clampString(updates.jobTitle, 60, '巡堂人員');

  try {
    await updateDoc(doc(db, 'staffProfiles', safeUid), {
      displayName: safeName,
      department: safeDept,
      jobTitle: safeTitle,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `staffProfiles/${safeUid}`);
  }

  try {
    await updateDoc(doc(db, 'allowedAccounts', accountId), {
      displayName: safeName,
      department: safeDept,
      jobTitle: safeTitle,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `allowedAccounts/${accountId}`);
  }
}

export async function adminCreateAllowedAccount(
  actorUid: string,
  input: {
    email: string;
    displayName: string;
    department: string;
    jobTitle: string;
    role: StaffRole;
  }
): Promise<string> {
  const normalizedEmail = normalizeEmail(input.email);
  if (!isValidEmailFormat(normalizedEmail)) {
    throw new Error('請輸入有效的 Google 帳號 Email 格式');
  }
  const accountId = emailToAccountId(normalizedEmail);
  const accRef = doc(db, 'allowedAccounts', accountId);

  try {
    const existing = await getDoc(accRef);
    if (existing.exists()) {
      throw new Error(`此 Google 帳號（${normalizedEmail}）已存在於授權名單中`);
    }
    await setDoc(accRef, {
      campusId: CAMPUS_ID,
      email: normalizedEmail,
      displayName: clampString(input.displayName, 60, normalizedEmail.split('@')[0] || '使用者'),
      department: clampString(input.department, 60, '學務處'),
      jobTitle: clampString(input.jobTitle, 60, input.role === 'admin' ? '系統管理者' : '巡堂使用者'),
      role: input.role,
      status: 'active',
      uid: '',
      createdBy: sanitizeId(actorUid, 'admin'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return accountId;
  } catch (err) {
    if (err instanceof Error && err.message.includes('已存在於授權名單')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `allowedAccounts/${accountId}`);
  }
}

export async function adminUpdateAllowedAccount(
  account: AllowedAccount,
  updates: {
    displayName: string;
    department: string;
    jobTitle: string;
    role: StaffRole;
    status: AccountStatus;
  }
): Promise<void> {
  const isBootstrap = account.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const nextRole: StaffRole = isBootstrap ? 'admin' : updates.role;
  const nextStatus: AccountStatus = isBootstrap ? 'active' : updates.status;
  const safeName = clampString(updates.displayName, 60, account.displayName);
  const safeDept = clampString(updates.department, 60, account.department);
  const safeTitle = clampString(updates.jobTitle, 60, account.jobTitle);

  try {
    await updateDoc(doc(db, 'allowedAccounts', account.id), {
      displayName: safeName,
      department: safeDept,
      jobTitle: safeTitle,
      role: nextRole,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `allowedAccounts/${account.id}`);
  }

  // Mirror display/role updates to staffProfiles if the user has already signed in
  if (account.uid) {
    const safeUid = sanitizeId(account.uid, 'user');
    try {
      const profRef = doc(db, 'staffProfiles', safeUid);
      const profSnap = await getDoc(profRef);
      if (profSnap.exists()) {
        await updateDoc(profRef, {
          displayName: safeName,
          department: safeDept,
          jobTitle: safeTitle,
          role: nextRole,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `staffProfiles/${safeUid}`);
    }
  }
}

export async function adminToggleAllowedAccountStatus(account: AllowedAccount): Promise<AccountStatus> {
  if (account.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('系統主管理者帳號不可停用');
  }
  const nextStatus: AccountStatus = account.status === 'active' ? 'disabled' : 'active';
  try {
    await updateDoc(doc(db, 'allowedAccounts', account.id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    return nextStatus;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `allowedAccounts/${account.id}`);
  }
}

export async function adminDeleteAllowedAccount(account: AllowedAccount): Promise<void> {
  if (account.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    throw new Error('系統主管理者帳號不可刪除');
  }
  try {
    await deleteDoc(doc(db, 'allowedAccounts', account.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `allowedAccounts/${account.id}`);
  }
}

export async function createTimetableSlot(
  uid: string,
  input: ParsedTimetableImportRow,
  customId?: string
): Promise<string> {
  const docId = customId
    ? sanitizeId(customId, 'tt')
    : sanitizeId(`tt-d${input.dayOfWeek}-p${input.period}-${input.roomNumber}-${Date.now().toString(36)}`, 'tt');
  const path = `timetables/${docId}`;
  try {
    await setDoc(doc(db, 'timetables', docId), {
      campusId: CAMPUS_ID,
      dayOfWeek: clampInt(input.dayOfWeek, 1, 5),
      period: clampInt(input.period, 1, 8),
      building: clampString(input.building, 40, '教學A棟'),
      floor: clampString(input.floor, 20, '1F'),
      roomNumber: clampString(input.roomNumber, 20, 'A101'),
      className: clampString(input.className, 30, '未命名班級'),
      grade: clampString(input.grade, 20, '高一'),
      subject: clampString(input.subject, 50, '一般課程'),
      teacherName: clampString(input.teacherName, 40, '任課教師'),
      expectedCount: clampInt(input.expectedCount, 1, 120),
      isRelocated: Boolean(input.isRelocated),
      locationNote: clampString(input.locationNote, 100, ''),
      roster: sanitizeRoster(input.roster),
      createdBy: clampString(uid, 128),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function batchImportTimetableSlots(
  uid: string,
  rows: ParsedTimetableImportRow[]
): Promise<number> {
  const CHUNK_SIZE = 200;
  let imported = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((row, idx) => {
      const slotId = sanitizeId(
        `tt-d${row.dayOfWeek}-p${row.period}-${row.roomNumber}-${(i + idx).toString(36)}`,
        'tt'
      );
      batch.set(doc(db, 'timetables', slotId), {
        campusId: CAMPUS_ID,
        dayOfWeek: clampInt(row.dayOfWeek, 1, 5),
        period: clampInt(row.period, 1, 8),
        building: clampString(row.building, 40, '教學A棟'),
        floor: clampString(row.floor, 20, '1F'),
        roomNumber: clampString(row.roomNumber, 20, 'A101'),
        className: clampString(row.className, 30, '未命名班級'),
        grade: clampString(row.grade, 20, '高一'),
        subject: clampString(row.subject, 50, '一般課程'),
        teacherName: clampString(row.teacherName, 40, '任課教師'),
        expectedCount: clampInt(row.expectedCount, 1, 120),
        isRelocated: Boolean(row.isRelocated),
        locationNote: clampString(row.locationNote, 100, ''),
        roster: sanitizeRoster(row.roster),
        createdBy: clampString(uid, 128),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
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

export async function deleteTimetableSlot(timetableId: string): Promise<void> {
  const safeId = sanitizeId(timetableId, 'tt');
  try {
    await deleteDoc(doc(db, 'timetables', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `timetables/${safeId}`);
  }
}

export async function createLeaveRecord(
  uid: string,
  input: {
    date: string;
    className: string;
    seatNumber: string;
    studentName: string;
    leaveType: LeaveType;
    periods: number[];
    reason: string;
    approvedBy: string;
  }
): Promise<string> {
  const docId = sanitizeId(`lv-${input.date}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, 'lv');
  try {
    await setDoc(doc(db, 'leaveRecords', docId), {
      campusId: CAMPUS_ID,
      date: sanitizeDate(input.date),
      className: clampString(input.className, 30, '未指定班級'),
      seatNumber: clampString(input.seatNumber, 10, '01'),
      studentName: clampString(input.studentName, 40, '學生'),
      leaveType: input.leaveType,
      periods: sanitizePeriods(input.periods),
      reason: clampString(input.reason, 200, ''),
      approvedBy: clampString(input.approvedBy, 60, '學務處'),
      createdBy: clampString(uid, 128),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `leaveRecords/${docId}`);
  }
}

export async function deleteLeaveRecord(leaveId: string): Promise<void> {
  const safeId = sanitizeId(leaveId, 'lv');
  try {
    await deleteDoc(doc(db, 'leaveRecords', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `leaveRecords/${safeId}`);
  }
}

export async function savePatrolLog(params: {
  inspectorId: string;
  inspectorName: string;
  date: string;
  slot: TimetableSlot;
  teacherPresent: boolean;
  actualCount: number;
  status: PatrolStatus;
  note: string;
  existingOwnLog?: PatrolLog | null;
}): Promise<string> {
  const {
    inspectorId,
    inspectorName,
    date,
    slot,
    teacherPresent,
    actualCount,
    status,
    note,
    existingOwnLog,
  } = params;

  // If the current user already created a patrol log for this slot today, update it in place
  if (existingOwnLog && existingOwnLog.inspectorId === inspectorId) {
    const path = `patrolLogs/${existingOwnLog.id}`;
    try {
      await updateDoc(doc(db, 'patrolLogs', existingOwnLog.id), {
        teacherPresent: Boolean(teacherPresent),
        actualCount: clampInt(actualCount, 0, 120),
        status,
        note: clampString(note, 500, ''),
        updatedAt: serverTimestamp(),
      });
      return existingOwnLog.id;
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  // Otherwise create a new patrol log document owned by this inspector
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
      building: clampString(slot.building, 40, '教學大樓'),
      roomNumber: clampString(slot.roomNumber, 20, 'A101'),
      className: clampString(slot.className, 30, '未命名班級'),
      subject: clampString(slot.subject, 50, '課程'),
      teacherName: clampString(slot.teacherName, 40, '教師'),
      teacherPresent: Boolean(teacherPresent),
      expectedCount: clampInt(slot.expectedCount, 0, 120),
      actualCount: clampInt(actualCount, 0, 120),
      status,
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

export async function createAbsenceRecord(params: {
  recordedBy: string;
  recordedByName: string;
  date: string;
  slot: TimetableSlot;
  seatNumber: string;
  studentName: string;
  observedType: ObservedAbsenceType;
  autoStatus: AutoAbsenceStatus;
  riskLevel: RiskLevel;
  note: string;
}): Promise<string> {
  const docId = sanitizeId(
    `abs-${params.date}-p${params.slot.period}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    'abs'
  );
  const path = `absences/${docId}`;
  try {
    await setDoc(doc(db, 'absences', docId), {
      campusId: CAMPUS_ID,
      date: sanitizeDate(params.date),
      period: clampInt(params.slot.period, 1, 8),
      timetableId: sanitizeId(params.slot.id, 'tt'),
      className: clampString(params.slot.className, 30, '未指定班級'),
      subject: clampString(params.slot.subject, 50, '課程'),
      teacherName: clampString(params.slot.teacherName, 40, '教師'),
      seatNumber: clampString(params.seatNumber, 10, '01'),
      studentName: clampString(params.studentName, 40, '學生'),
      observedType: params.observedType,
      autoStatus: params.autoStatus,
      riskLevel: params.riskLevel,
      verified: false,
      note: clampString(params.note, 300, ''),
      recordedBy: clampString(params.recordedBy, 128),
      recordedByName: clampString(params.recordedByName, 60, '巡堂人員'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateAbsenceVerification(
  absenceId: string,
  updates: {
    autoStatus: AutoAbsenceStatus;
    riskLevel: RiskLevel;
    verified: boolean;
    note: string;
  }
): Promise<void> {
  const safeId = sanitizeId(absenceId, 'abs');
  try {
    await updateDoc(doc(db, 'absences', safeId), {
      autoStatus: updates.autoStatus,
      riskLevel: updates.riskLevel,
      verified: Boolean(updates.verified),
      note: clampString(updates.note, 300, ''),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `absences/${safeId}`);
  }
}

export async function deleteAbsenceRecord(absenceId: string): Promise<void> {
  const safeId = sanitizeId(absenceId, 'abs');
  try {
    await deleteDoc(doc(db, 'absences', safeId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `absences/${safeId}`);
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

export const collectionRefs = {
  allowedAccounts: () => collection(db, 'allowedAccounts'),
  staffProfiles: () => collection(db, 'staffProfiles'),
  timetables: () => collection(db, 'timetables'),
  leaveRecords: () => collection(db, 'leaveRecords'),
  patrolLogs: () => collection(db, 'patrolLogs'),
  absences: () => collection(db, 'absences'),
  incidents: () => collection(db, 'incidents'),
};
