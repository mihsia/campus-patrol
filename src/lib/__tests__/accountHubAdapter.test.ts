import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { HubAccountRecord } from '@ltps/account-sdk/core';
import { adaptHubAccountToPatrol } from '../accountHubAdapter';

function makeAccount(overrides: Partial<HubAccountRecord> = {}): HubAccountRecord {
  return {
    uid: 'hub-uid-1',
    email: 'teacher@tmail.ilc.edu.tw',
    name: '陳老師',
    dept: '教務處',
    jobTitle: '教學組長',
    globalStatus: 'active',
    isSuperAdmin: false,
    claimsVersion: 2,
    apps: {
      patrol: { status: 'active', role: 'user', modules: [] },
    },
    ...overrides,
  };
}

describe('adaptHubAccountToPatrol', () => {
  it('grants user access for active patrol user and applies targetUid override', () => {
    const res = adaptHubAccountToPatrol(makeAccount(), { targetUid: 'target-uid-99' });
    assert.equal(res.status, 'authorized');
    if (res.status !== 'authorized') return;
    assert.equal(res.isAdmin, false);
    assert.equal(res.isSuperAdmin, false);
    assert.equal(res.claimsVersion, 2);
    assert.equal(res.profile.uid, 'target-uid-99');
    assert.equal(res.profile.displayName, '陳老師');
    assert.equal(res.profile.department, '教務處');
    assert.equal(res.profile.jobTitle, '教學組長');
    assert.equal(res.profile.role, 'user');
  });

  it('grants admin access for active patrol admin', () => {
    const res = adaptHubAccountToPatrol(
      makeAccount({
        apps: { patrol: { status: 'active', role: 'admin', modules: [] } },
      })
    );
    assert.equal(res.status, 'authorized');
    if (res.status !== 'authorized') return;
    assert.equal(res.isAdmin, true);
    assert.equal(res.isSuperAdmin, false);
    assert.equal(res.profile.role, 'admin');
  });

  it('grants admin access to school Super Admin even without explicit patrol app entry', () => {
    const res = adaptHubAccountToPatrol(
      makeAccount({
        isSuperAdmin: true,
        apps: {},
      })
    );
    assert.equal(res.status, 'authorized');
    if (res.status !== 'authorized') return;
    assert.equal(res.isAdmin, true);
    assert.equal(res.isSuperAdmin, true);
    assert.equal(res.profile.role, 'admin');
  });

  it('denies access as unauthorized when user has other apps but not patrol', () => {
    const res = adaptHubAccountToPatrol(
      makeAccount({
        apps: { finance: { status: 'active', role: 'editor', modules: ['basic'] } },
      })
    );
    assert.equal(res.status, 'unauthorized');
    if (res.status !== 'unauthorized') return;
    assert.equal(res.email, 'teacher@tmail.ilc.edu.tw');
    assert.ok(res.reason.length > 0);
  });

  it('blocks access as disabled when patrol app status is disabled', () => {
    const res = adaptHubAccountToPatrol(
      makeAccount({
        apps: { patrol: { status: 'disabled', role: 'user', modules: [] } },
      })
    );
    assert.equal(res.status, 'disabled');
  });

  it('blocks access as disabled when globalStatus is disabled even if patrol app is active', () => {
    const res = adaptHubAccountToPatrol(
      makeAccount({
        globalStatus: 'disabled',
        isSuperAdmin: true,
        apps: { patrol: { status: 'active', role: 'admin', modules: [] } },
      })
    );
    assert.equal(res.status, 'disabled');
  });
});
