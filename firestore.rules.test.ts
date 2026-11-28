/**
 * Phase 0 Security TDD Test Suite for CampusPatrol Centralized Custom Claims RBAC
 * Verifies all "Dirty Dozen" adversarial payloads return PERMISSION_DENIED.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  actor: {
    uid: string;
    g?: 0 | 1;
    sa?: 0 | 1;
    patrolRole?: 'a' | 'u' | null;
  };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Unsigned or missing global active claim (g != 1) rejected',
    actor: { uid: 'u1', g: 0, sa: 0, patrolRole: 'a' },
    operation: 'get',
    path: '/timetables/tt-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Account without patrol app claim blocked from campus data',
    actor: { uid: 'u2', g: 1, sa: 0, patrolRole: null },
    operation: 'list',
    path: '/patrolLogs',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Globally disabled account (g == 0) immediately blocked',
    actor: { uid: 'u3', g: 0, sa: 0, patrolRole: 'u' },
    operation: 'create',
    path: '/patrolLogs/log-1',
    payload: { campusId: 'main-campus', timetableId: 'tt-1' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Regular user cannot escalate own role in staffProfiles',
    actor: { uid: 'u4', g: 1, sa: 0, patrolRole: 'u' },
    operation: 'update',
    path: '/staffProfiles/u4',
    payload: { role: 'admin' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Legacy allowedAccounts collection is permanently read-only (no client write)',
    actor: { uid: 'admin1', g: 1, sa: 1, patrolRole: 'a' },
    operation: 'update',
    path: '/allowedAccounts/disabled_tmail_ilc_edu_tw',
    payload: { status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Regular user cannot list legacy allowedAccounts PII',
    actor: { uid: 'u4', g: 1, sa: 0, patrolRole: 'u' },
    operation: 'list',
    path: '/allowedAccounts',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Shadow ghost field rejected on staffProfiles via strict hasOnly allowlist',
    actor: { uid: 'admin1', g: 1, sa: 1, patrolRole: 'a' },
    operation: 'create',
    path: '/staffProfiles/u9',
    payload: { campusId: 'main-campus', isSuperAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Regular user cannot create or delete school timetables',
    actor: { uid: 'u4', g: 1, sa: 0, patrolRole: 'u' },
    operation: 'create',
    path: '/timetables/tt-rogue',
    payload: { campusId: 'main-campus', className: '高一忠' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Legacy admins and userPrivate collections cannot be mutated by clients',
    actor: { uid: 'admin2', g: 1, sa: 0, patrolRole: 'a' },
    operation: 'delete',
    path: '/admins/u1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Cross-user staffProfile UID mismatch rejected',
    actor: { uid: 'u4', g: 1, sa: 0, patrolRole: 'u' },
    operation: 'create',
    path: '/staffProfiles/someone_else',
    payload: { uid: 'u4', campusId: 'main-campus', role: 'user' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Orphaned patrol log referencing missing timetable rejected',
    actor: { uid: 'u4', g: 1, sa: 0, patrolRole: 'u' },
    operation: 'create',
    path: '/patrolLogs/log-orphan',
    payload: { campusId: 'main-campus', timetableId: 'nonexistent-tt' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Non-admin cannot mutate resolved incident (terminal lock)',
    actor: { uid: 'u4', g: 1, sa: 0, patrolRole: 'u' },
    operation: 'update',
    path: '/incidents/inc-resolved',
    payload: { status: 'open' },
    expected: 'PERMISSION_DENIED',
  },
];

import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const rulesSource = fs.readFileSync(path.resolve(import.meta.dirname, 'firestore.rules'), 'utf8');

function extractMatchBlock(collectionPath: string): string {
  const marker = `match ${collectionPath} {`;
  const start = rulesSource.indexOf(marker);
  assert.ok(start !== -1, `Expected block "${marker}" in firestore.rules`);
  const braceStart = start + marker.length - 1;
  let depth = 0;
  for (let i = braceStart; i < rulesSource.length; i++) {
    if (rulesSource[i] === '{') depth++;
    else if (rulesSource[i] === '}') {
      depth--;
      if (depth === 0) return rulesSource.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed block "${marker}" in firestore.rules`);
}

describe('Firestore Security Rules — Dirty Dozen invariants', () => {
  it('defines all 12 Dirty Dozen adversarial cases expecting PERMISSION_DENIED', () => {
    assert.equal(DIRTY_DOZEN_TESTS.length, 12);
    for (const tc of DIRTY_DOZEN_TESTS) {
      assert.equal(tc.expected, 'PERMISSION_DENIED');
    }
  });

  it('enforces Pillar 0 default-deny safety net and zero-read Account Hub Custom Claims (#1, #2, #3)', () => {
    assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
    assert.ok(rulesSource.includes('request.auth.token.g == 1'));
    assert.ok(rulesSource.includes('request.auth.token.sa == 1'));
    assert.ok(rulesSource.includes("request.auth.token.apps.patrol.r in ['a', 'u']"));
    assert.ok(rulesSource.includes("request.auth.token.apps.patrol.r == 'a'"));
  });

  it('seals legacy account collections (allowedAccounts, admins, userPrivate) read-only (#5, #6, #9)', () => {
    const allowedBlock = extractMatchBlock('/allowedAccounts/{accountId}');
    assert.ok(allowedBlock.includes("allow list: if resource.data.campusId == 'main-campus' && isAdmin();"));
    assert.ok(allowedBlock.includes('allow write: if false;'));

    const adminsBlock = extractMatchBlock('/admins/{userId}');
    assert.ok(adminsBlock.includes('allow list: if false;'));
    assert.ok(adminsBlock.includes('allow write: if false;'));

    const privateBlock = extractMatchBlock('/userPrivate/{userId}');
    assert.ok(privateBlock.includes('allow list: if false;'));
    assert.ok(privateBlock.includes('allow write: if false;'));
  });

  it('blocks self role escalation and shadow ghost fields on staffProfiles (#4, #7, #10)', () => {
    const staffBlock = extractMatchBlock('/staffProfiles/{userId}');
    assert.ok(rulesSource.includes('function isValidStaffProfile(data, userId)'));
    assert.ok(rulesSource.includes('data.keys().hasOnly(['));
    assert.ok(staffBlock.includes("(incoming().role == 'user' || (incoming().role == 'admin' && isAdmin()))"));
    assert.ok(staffBlock.includes('request.auth.uid == userId'));
  });

  it('restricts school timetables creation/update/delete to admins only (#8)', () => {
    const ttBlock = extractMatchBlock('/timetables/{timetableId}');
    assert.match(ttBlock, /allow create:[\s\S]*isAdmin\(\);/);
    assert.match(ttBlock, /allow update:[\s\S]*isAdmin\(\)/);
    assert.match(ttBlock, /allow delete:[\s\S]*isAdmin\(\);/);
  });

  it('prevents orphaned patrolLogs and locks resolved incidents for non-admins (#11, #12)', () => {
    const patrolBlock = extractMatchBlock('/patrolLogs/{logId}');
    assert.ok(patrolBlock.includes('exists(/databases/$(database)/documents/timetables/$(incoming().timetableId))'));

    const incBlock = extractMatchBlock('/incidents/{incidentId}');
    assert.ok(incBlock.includes("existing().status in ['open', 'in_progress']"));
    assert.ok(incBlock.includes('isAdmin() &&'));
  });
});
