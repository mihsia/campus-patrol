/**
 * Security Rules Verification Suite (Phase 0 TDD — Dirty Dozen)
 *
 * Designed to run against the Firestore Emulator with @firebase/rules-unit-testing
 * to verify all 12 adversarial payloads in security_spec.md return PERMISSION_DENIED.
 */

export interface AdversarialPayloadCase {
  id: number;
  name: string;
  collection: string;
  docId: string;
  operation: 'get' | 'create' | 'update' | 'list';
  actor: {
    uid: string;
    email: string;
    email_verified: boolean;
  };
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: AdversarialPayloadCase[] = [
  {
    id: 1,
    name: 'Unverified Admin Email Spoof',
    collection: 'admins',
    docId: 'attacker-uid',
    operation: 'create',
    actor: { uid: 'attacker-uid', email: 'mihsia@gmail.com', email_verified: false },
    payload: { uid: 'attacker-uid', grantedBy: 'attacker-uid' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Self-Assigned Admin Role on Profile Create',
    collection: 'staffProfiles',
    docId: 'user-a',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: {
      uid: 'user-a',
      campusId: 'main-campus',
      displayName: '張老師',
      department: '學務處',
      jobTitle: '巡堂教師',
      role: 'admin',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Role Escalation via Profile Update',
    collection: 'staffProfiles',
    docId: 'user-a',
    operation: 'update',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { role: 'admin' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-User PII Read',
    collection: 'userPrivate',
    docId: 'user-b',
    operation: 'get',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Ghost / Shadow Field Injection on Patrol Log',
    collection: 'patrolLogs',
    docId: 'log-ghost-1',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: {
      campusId: 'main-campus',
      date: '2026-11-26',
      dayOfWeek: 4,
      period: 1,
      timetableId: 'tt-thu-p1-101',
      isVerifiedByPrincipal: true,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Client Timestamp Backdating',
    collection: 'patrolLogs',
    docId: 'log-backdate-1',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Orphaned Patrol Log Referencing Nonexistent Timetable',
    collection: 'patrolLogs',
    docId: 'log-orphan-1',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { timetableId: 'nonexistent-slot-999' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Path ID Poisoning',
    collection: 'timetables',
    docId: 'invalid id with spaces!@#',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { campusId: 'main-campus' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Identity Spoofing on Incident Creation',
    collection: 'incidents',
    docId: 'inc-spoof-1',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { reporterId: 'user-b', status: 'open' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Terminal State Tampering on Resolved Incident',
    collection: 'incidents',
    docId: 'inc-resolved-1',
    operation: 'update',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { status: 'open' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value Poisoning with Oversized Resolution Note',
    collection: 'incidents',
    docId: 'inc-poison-1',
    operation: 'update',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { resolutionNote: 'X'.repeat(50000) },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unbounded Roster Array Denial-of-Wallet',
    collection: 'timetables',
    docId: 'tt-dos-1',
    operation: 'create',
    actor: { uid: 'user-a', email: 'teacher@school.edu.tw', email_verified: true },
    payload: { roster: Array.from({ length: 200 }, (_, i) => `${i + 1} 學生`) },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
