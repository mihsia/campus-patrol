import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Timestamp } from 'firebase/firestore';
import type { IncidentReport, NotificationPreferences } from '../../types/patrol';
import {
  getIncidentElapsedMinutes,
  isIncidentOverdueEscalation,
  shouldDispatchNotification,
} from '../notifications';

function makeIncident(overrides: Partial<IncidentReport> = {}): IncidentReport {
  return {
    id: 'inc-1',
    campusId: 'main-campus',
    date: '2026-11-27',
    period: 2,
    timetableId: 'tt-1',
    location: '忠孝樓 201（二甲）',
    className: '二甲',
    category: 'classroom_order',
    severity: 'medium',
    title: '班級秩序異常',
    description: '課堂秩序需協助',
    status: 'open',
    reporterId: 'u1',
    reporterName: '林老師',
    handlerId: '',
    handlerName: '',
    resolutionNote: '',
    createdAt: null,
    ...overrides,
  };
}

function fakeTimestampMinutesAgo(minutesAgo: number): Timestamp {
  const targetMs = Date.now() - minutesAgo * 60_000 - 5_000;
  return { toMillis: () => targetMs } as Timestamp;
}

describe('notifications dispatch & escalation rules', () => {
  const basePrefs: NotificationPreferences = {
    browserPushEnabled: true,
    soundEnabled: true,
    minSeverity: 'medium',
    subscribedBuilding: 'ALL',
  };

  it('respects minimum severity threshold', () => {
    assert.equal(shouldDispatchNotification(makeIncident({ severity: 'low' }), basePrefs), false);
    assert.equal(shouldDispatchNotification(makeIncident({ severity: 'medium' }), basePrefs), true);
    assert.equal(shouldDispatchNotification(makeIncident({ severity: 'high' }), basePrefs), true);
  });

  it('filters by subscribed building except campus-wide high-severity safety/medical alerts', () => {
    const buildingPrefs: NotificationPreferences = {
      ...basePrefs,
      subscribedBuilding: '行政教學大樓',
    };

    assert.equal(
      shouldDispatchNotification(makeIncident({ location: '忠孝樓 201', severity: 'medium' }), buildingPrefs),
      false
    );
    assert.equal(
      shouldDispatchNotification(makeIncident({ location: '行政教學大樓 102', severity: 'medium' }), buildingPrefs),
      true
    );
    assert.equal(
      shouldDispatchNotification(
        makeIncident({ location: '操場', severity: 'high', category: 'safety_medical' }),
        buildingPrefs
      ),
      true
    );
    assert.equal(
      shouldDispatchNotification(
        makeIncident({ location: '忠孝樓 201', severity: 'high', category: 'facility_issue' }),
        buildingPrefs
      ),
      false
    );
  });

  it('computes elapsed minutes and overdue escalation thresholds', () => {
    assert.equal(getIncidentElapsedMinutes(makeIncident({ createdAt: null })), 0);

    const highOpen6Min = makeIncident({
      severity: 'high',
      status: 'open',
      createdAt: fakeTimestampMinutesAgo(6),
    });
    assert.ok(getIncidentElapsedMinutes(highOpen6Min) >= 5);
    assert.equal(isIncidentOverdueEscalation(highOpen6Min), true);

    const highOpen2Min = makeIncident({
      severity: 'high',
      status: 'open',
      createdAt: fakeTimestampMinutesAgo(2),
    });
    assert.equal(isIncidentOverdueEscalation(highOpen2Min), false);

    const mediumOpen16Min = makeIncident({
      severity: 'medium',
      status: 'open',
      createdAt: fakeTimestampMinutesAgo(16),
    });
    assert.equal(isIncidentOverdueEscalation(mediumOpen16Min), true);

    const mediumResolved20Min = makeIncident({
      severity: 'medium',
      status: 'resolved',
      createdAt: fakeTimestampMinutesAgo(20),
    });
    assert.equal(isIncidentOverdueEscalation(mediumResolved20Min), false);

    const lowOpen60Min = makeIncident({
      severity: 'low',
      status: 'open',
      createdAt: fakeTimestampMinutesAgo(60),
    });
    assert.equal(isIncidentOverdueEscalation(lowOpen60Min), false);
  });
});
