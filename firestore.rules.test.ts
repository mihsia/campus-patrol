/**
 * Phase 0 Security TDD Test Suite for CampusPatrol Two-Tier Google-Only RBAC
 * Verifies all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  actor: {
    uid: string;
    email: string;
    email_verified: boolean;
    sign_in_provider: 'google.com' | 'password';
    allowlistRole?: 'admin' | 'user' | null;
    allowlistStatus?: 'active' | 'disabled' | null;
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Non-Google provider spoof rejected',
    actor: { uid: 'u1', email: 'mihsia@gmail.com', email_verified: true, sign_in_provider: 'password' },
    operation: 'get',
    path: '/timetables/tt-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unauthorized Google stranger blocked from campus data',
    actor: { uid: 'u2', email: 'stranger@gmail.com', email_verified: true, sign_in_provider: 'google.com', allowlistRole: null },
    operation: 'list',
    path: '/patrolLogs',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Disabled Google account immediately blocked',
    actor: { uid: 'u3', email: 'disabled@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'disabled' },
    operation: 'create',
    path: '/patrolLogs/log-1',
    payload: { campusId: 'main-campus', timetableId: 'tt-1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Regular user cannot escalate own role in allowedAccounts',
    actor: { uid: 'u4', email: 'teacher@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'active' },
    operation: 'update',
    path: '/allowedAccounts/teacher_tmail_ilc_edu_tw',
    payload: { role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Disabled user cannot re-enable own account',
    actor: { uid: 'u3', email: 'disabled@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'disabled' },
    operation: 'update',
    path: '/allowedAccounts/disabled_tmail_ilc_edu_tw',
    payload: { status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Regular user cannot list allowedAccounts PII',
    actor: { uid: 'u4', email: 'teacher@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'active' },
    operation: 'list',
    path: '/allowedAccounts',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Shadow ghost field rejected on allowedAccounts',
    actor: { uid: 'admin1', email: 'mihsia@gmail.com', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'admin', allowlistStatus: 'active' },
    operation: 'create',
    path: '/allowedAccounts/new_tmail_ilc_edu_tw',
    payload: { campusId: 'main-campus', email: 'new@tmail.ilc.edu.tw', isSuperAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Regular user cannot create or delete school timetables',
    actor: { uid: 'u4', email: 'teacher@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'active' },
    operation: 'create',
    path: '/timetables/tt-rogue',
    payload: { campusId: 'main-campus', className: '高一忠' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Bootstrap admin mihsia@gmail.com cannot be disabled or deleted',
    actor: { uid: 'admin2', email: 'vice@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'admin', allowlistStatus: 'active' },
    operation: 'delete',
    path: '/allowedAccounts/mihsia_gmail_com',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Path ID mismatch / poisoning rejected on allowedAccounts',
    actor: { uid: 'admin1', email: 'mihsia@gmail.com', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'admin', allowlistStatus: 'active' },
    operation: 'create',
    path: '/allowedAccounts/wrong_key',
    payload: { campusId: 'main-campus', email: 'real@tmail.ilc.edu.tw', role: 'user', status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Orphaned patrol log referencing missing timetable rejected',
    actor: { uid: 'u4', email: 'teacher@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'active' },
    operation: 'create',
    path: '/patrolLogs/log-orphan',
    payload: { campusId: 'main-campus', timetableId: 'nonexistent-tt' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Non-admin cannot mutate resolved incident (terminal lock)',
    actor: { uid: 'u4', email: 'teacher@tmail.ilc.edu.tw', email_verified: true, sign_in_provider: 'google.com', allowlistRole: 'user', allowlistStatus: 'active' },
    operation: 'update',
    path: '/incidents/inc-resolved',
    payload: { status: 'open' },
    expected: 'PERMISSION_DENIED',
  },
];
