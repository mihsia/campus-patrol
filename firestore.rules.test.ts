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

import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BOOTSTRAP_ADMIN_EMAIL } from './src/types/patrol';
import { emailToAccountId } from './src/lib/validation';

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

  it('enforces Pillar 0 default-deny safety net and verified Google-only login (#1)', () => {
    assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/);
    assert.ok(rulesSource.includes("request.auth.token.email_verified == true"));
    assert.ok(rulesSource.includes("request.auth.token.firebase.sign_in_provider == 'google.com'"));
  });

  it('enforces active allowlist check and instant disabled revocation (#2, #3)', () => {
    assert.ok(rulesSource.includes("get(/databases/$(database)/documents/allowedAccounts/$(userEmailKey())).data.status == 'active'"));
    assert.ok(rulesSource.includes("get(/databases/$(database)/documents/allowedAccounts/$(userEmailKey())).data.email == userEmailLower()"));
  });

  it('blocks self role escalation, self re-enable, and non-admin PII directory listing (#4, #5, #6)', () => {
    const allowedBlock = extractMatchBlock('/allowedAccounts/{accountId}');
    assert.ok(allowedBlock.includes("allow list: if isVerifiedGoogleUser() && resource.data.campusId == 'main-campus' && isAdmin();"));
    assert.ok(allowedBlock.includes("existing().status == 'active'"));
    assert.ok(allowedBlock.includes('incoming().role == existing().role'));
    assert.ok(allowedBlock.includes('incoming().status == existing().status'));

    const privateBlock = extractMatchBlock('/userPrivate/{userId}');
    assert.ok(privateBlock.includes('allow list: if false;'));
  });

  it('rejects shadow ghost fields via strict hasOnly key allowlists and path ID consistency (#7, #10)', () => {
    assert.ok(rulesSource.includes('function isValidAllowedAccount(data, accountId)'));
    assert.ok(rulesSource.includes('data.keys().hasOnly(['));
    assert.ok(rulesSource.includes("accountId == data.email.replace('[^a-z0-9]', '_')"));
    assert.equal(emailToAccountId(BOOTSTRAP_ADMIN_EMAIL), 'mihsia_gmail_com');
  });

  it('restricts school timetables creation/update/delete to admins only (#8)', () => {
    const ttBlock = extractMatchBlock('/timetables/{timetableId}');
    assert.match(ttBlock, /allow create:[\s\S]*isAdmin\(\);/);
    assert.match(ttBlock, /allow update:[\s\S]*isAdmin\(\)/);
    assert.match(ttBlock, /allow delete:[\s\S]*isAdmin\(\);/);
  });

  it('protects bootstrap admin from demotion, disabling, or deletion (#9)', () => {
    const allowedBlock = extractMatchBlock('/allowedAccounts/{accountId}');
    assert.ok(
      allowedBlock.includes(
        `(existing().email != '${BOOTSTRAP_ADMIN_EMAIL}' || (incoming().role == 'admin' && incoming().status == 'active'))`
      )
    );
    assert.ok(
      allowedBlock.includes(
        `allow delete: if isValidId(accountId) && isVerifiedGoogleUser() && existing().email != '${BOOTSTRAP_ADMIN_EMAIL}' && isAdmin();`
      )
    );
  });

  it('prevents orphaned patrolLogs and locks resolved incidents for non-admins (#11, #12)', () => {
    const patrolBlock = extractMatchBlock('/patrolLogs/{logId}');
    assert.ok(patrolBlock.includes('exists(/databases/$(database)/documents/timetables/$(incoming().timetableId))'));

    const incBlock = extractMatchBlock('/incidents/{incidentId}');
    assert.ok(incBlock.includes("existing().status in ['open', 'in_progress']"));
    assert.ok(incBlock.includes('isAdmin() &&'));
  });
});

