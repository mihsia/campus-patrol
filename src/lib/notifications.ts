import type { IncidentReport, IncidentSeverity, NotificationPreferences } from '../types/patrol';
import { INCIDENT_CATEGORY_LABELS, INCIDENT_SEVERITY_LABELS } from '../types/patrol';

const STORAGE_KEY = 'campus_patrol_notif_prefs_v1';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  browserPushEnabled: false,
  soundEnabled: true,
  minSeverity: 'medium',
  subscribedBuilding: 'ALL',
};

export function loadNotificationPrefs(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      browserPushEnabled: Boolean(parsed.browserPushEnabled),
      soundEnabled: parsed.soundEnabled !== false,
      minSeverity:
        parsed.minSeverity === 'low' || parsed.minSeverity === 'medium' || parsed.minSeverity === 'high'
          ? parsed.minSeverity
          : 'medium',
      subscribedBuilding: typeof parsed.subscribedBuilding === 'string' ? parsed.subscribedBuilding : 'ALL',
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveNotificationPrefs(prefs: NotificationPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage quota issues
  }
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function shouldDispatchNotification(
  incident: IncidentReport,
  prefs: NotificationPreferences
): boolean {
  if (SEVERITY_RANK[incident.severity] < SEVERITY_RANK[prefs.minSeverity]) {
    return false;
  }
  if (prefs.subscribedBuilding !== 'ALL' && !incident.location.includes(prefs.subscribedBuilding)) {
    // High severity campus-wide safety/medical alerts bypass building filter
    if (!(incident.severity === 'high' && incident.category === 'safety_medical')) {
      return false;
    }
  }
  return true;
}

export function playUrgentAlertChime(severity: IncidentSeverity): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const freqs = severity === 'high' ? [880, 660, 880] : [660, 784];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.12, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.13);
    });
  } catch {
    // Browser autoplay policy may block audio before user gesture
  }
}

export function triggerBrowserPushNotification(incident: IncidentReport): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const title = `[${INCIDENT_SEVERITY_LABELS[incident.severity]}] ${incident.title}`;
  const body = `${incident.location} · ${INCIDENT_CATEGORY_LABELS[incident.category]}（通報人：${incident.reporterName}）`;

  try {
    const n = new Notification(title, {
      body,
      tag: `incident-${incident.id}`,
      requireInteraction: incident.severity === 'high',
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function getIncidentElapsedMinutes(incident: IncidentReport): number {
  const createdMs = incident.createdAt?.toMillis?.();
  if (!createdMs) return 0;
  return Math.max(0, Math.floor((Date.now() - createdMs) / 60000));
}

export function isIncidentOverdueEscalation(incident: IncidentReport): boolean {
  if (incident.status !== 'open') return false;
  const elapsed = getIncidentElapsedMinutes(incident);
  if (incident.severity === 'high') return elapsed >= 5;
  if (incident.severity === 'medium') return elapsed >= 15;
  return false;
}
