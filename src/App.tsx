import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  createAccountHubClient,
  mapAuthError,
  type HubAccountRecord,
} from '@ltps/account-sdk/core';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Building2,
  ClipboardCheck,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  UserRound,
  X,
} from 'lucide-react';
import {
  BOOTSTRAP_ADMIN_EMAIL,
  CAMPUS_ID,
  DEFAULT_SCHOOL_SETTINGS,
  detectCurrentPeriod,
  getDayOfWeekLabel,
  getTodayDateString,
  INCIDENT_SEVERITY_LABELS,
  normalizeStaffRole,
  STAFF_ROLE_LABELS,
  type IncidentReport,
  type NavSection,
  type NotificationPreferences,
  type PatrolLog,
  type SchoolSettings,
  type StaffProfile,
  type TimetableArchive,
  type TimetableSlot,
} from './types/patrol';
import { CURRENT_APP_DATE, CURRENT_APP_VERSION } from './data/changelog';
import {
  ACCOUNT_HUB_URL,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  hubAuth,
  hubDb,
  hubFunctions,
  isAccountHubConfigured,
  OperationType,
} from './lib/firebase';
import { adaptHubAccountToPatrol, PATROL_APP_ID } from './lib/accountHubAdapter';
import { collectionRefs, syncStaffProfileFromHub } from './lib/firestoreOps';
import { seedCampusDemoDataset } from './lib/seedData';
import {
  loadNotificationPrefs,
  playUrgentAlertChime,
  saveNotificationPrefs,
  shouldDispatchNotification,
  triggerBrowserPushNotification,
} from './lib/notifications';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  AccessBlockedScreen,
  HubConfigMissingScreen,
  SignInScreen,
} from './components/SignInScreen';
import { OfflineBanner, PWAInstallButton } from './components/PWAInstallButton';
import type { PatrolAccountStats } from './components/OverviewDashboardView';

const OverviewDashboardView = lazy(() =>
  import('./components/OverviewDashboardView').then((m) => ({
    default: m.OverviewDashboardView,
  }))
);
const DashboardView = lazy(() =>
  import('./components/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const PatrolWorkspaceView = lazy(() =>
  import('./components/PatrolWorkspaceView').then((m) => ({ default: m.PatrolWorkspaceView }))
);
const IncidentsView = lazy(() =>
  import('./components/IncidentsView').then((m) => ({ default: m.IncidentsView }))
);
const BasicDataView = lazy(() =>
  import('./components/BasicDataView').then((m) => ({ default: m.BasicDataView }))
);
const TimetableTruancyView = lazy(() =>
  import('./components/TimetableTruancyView').then((m) => ({ default: m.TimetableTruancyView }))
);
const ReportsView = lazy(() =>
  import('./components/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const StaffView = lazy(() =>
  import('./components/StaffView').then((m) => ({ default: m.StaffView }))
);
const ManualView = lazy(() =>
  import('./components/ManualView').then((m) => ({ default: m.ManualView }))
);
const ChangelogView = lazy(() =>
  import('./components/ChangelogView').then((m) => ({ default: m.ChangelogView }))
);

interface SidebarNavItem {
  key: string;
  nav: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeBg: string;
  badgeText: string;
  activeRowBg: string;
  activeText: string;
  activeBadgeBg: string;
}

interface SidebarNavGroup {
  title: string;
  items: SidebarNavItem[];
}

interface MobileNavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

type AccessState = 'loading' | 'signed_out' | 'authorized' | 'unauthorized' | 'disabled';

interface BlockedInfo {
  email: string;
  displayName?: string;
  department?: string;
  reason?: string;
}

function getQuickPeriodsWindow(current: number): number[] {
  if (current <= 1) return [1, 2, 3];
  if (current >= 8) return [6, 7, 8];
  return [current - 1, current, current + 1];
}

function CampusPatrolApp() {
  const [accessState, setAccessState] = useState<AccessState>(() =>
    isAccountHubConfigured ? 'loading' : 'signed_out'
  );
  const [blockedInfo, setBlockedInfo] = useState<BlockedInfo | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const hubClient = useMemo(
    () => (hubFunctions ? createAccountHubClient(hubFunctions) : null),
    []
  );

  // Navigation & Shared Time Context (always defaults to live current date & period)
  const [activeNav, setActiveNav] = useState<NavSection>('overview');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(detectCurrentPeriod);
  const [selectedBuilding, setSelectedBuilding] = useState<string>('ALL');
  const [quickPatrolSlot, setQuickPatrolSlot] = useState<TimetableSlot | null>(null);
  const datePinnedByUserRef = useRef(false);

  const handleSelectDate = useCallback((nextDate: string) => {
    if (!nextDate) return;
    setSelectedDate(nextDate);
    datePinnedByUserRef.current = nextDate !== getTodayDateString();
  }, []);

  // Automatically keep patrol date synced with the real system clock across midnight or tab wake-up
  useEffect(() => {
    const syncLiveDateIfUnpinned = () => {
      if (datePinnedByUserRef.current) return;
      const latestToday = getTodayDateString();
      setSelectedDate((prev) => (prev === latestToday ? prev : latestToday));
    };
    const interval = window.setInterval(syncLiveDateIfUnpinned, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        syncLiveDateIfUnpinned();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Real-time Firestore Collections
  const [schoolSettings, setSchoolSettings] = useState<SchoolSettings>(DEFAULT_SCHOOL_SETTINGS);
  const [timetables, setTimetables] = useState<TimetableSlot[]>([]);
  const [timetableArchives, setTimetableArchives] = useState<TimetableArchive[]>([]);
  const [patrolLogs, setPatrolLogs] = useState<PatrolLog[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);
  const [accountStats, setAccountStats] = useState<PatrolAccountStats | null>(null);

  // Push Notification & Toast Feedback State
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(loadNotificationPrefs);
  const [liveAlertToast, setLiveAlertToast] = useState<IncidentReport | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const incidentsHydratedRef = useRef(false);
  const notifPrefsRef = useRef(notifPrefs);
  notifPrefsRef.current = notifPrefs;

  const showFeedback = useCallback((msg: string) => {
    setFeedbackBanner(msg);
  }, []);

  useEffect(() => {
    if (!feedbackBanner) return;
    const timer = window.setTimeout(() => setFeedbackBanner(null), 4200);
    return () => window.clearTimeout(timer);
  }, [feedbackBanner]);

  const clearOperationalData = useCallback(() => {
    setSchoolSettings(DEFAULT_SCHOOL_SETTINGS);
    setTimetables([]);
    setTimetableArchives([]);
    setPatrolLogs([]);
    setIncidents([]);
    setStaffList([]);
    setAccountStats(null);
    incidentsHydratedRef.current = false;
  }, []);

  // 1. Plan B Cross-Project Auth Listener:
  //    hubAuth (ltps-account-hub) -> live /accounts/{uid} -> issueAppToken('patrol') -> signInWithCustomToken(auth)
  useEffect(() => {
    if (!isAccountHubConfigured || !hubAuth || !hubDb || !hubClient) {
      setAccessState('signed_out');
      return;
    }

    const activeHubAuth = hubAuth;
    const activeHubDb = hubDb;
    let stopped = false;
    let generation = 0;
    let accountUnsubscribe: (() => void) | null = null;

    const signOutBusinessApp = () => {
      if (auth.currentUser) {
        void signOut(auth).catch(() => {});
      }
    };

    const unsubAuth = onAuthStateChanged(activeHubAuth, (hubUser) => {
      if (stopped) return;
      const listenerGeneration = ++generation;
      accountUnsubscribe?.();
      accountUnsubscribe = null;

      setFirebaseUser(hubUser);
      setAvatarFailed(false);

      if (!hubUser) {
        signOutBusinessApp();
        setProfile(null);
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setBlockedInfo(null);
        clearOperationalData();
        setAccessState('signed_out');
        return;
      }

      setAccessState('loading');
      let syncedClaimsVersion: number | null = null;
      let bootstrapRequested = false;
      const accountRef = doc(activeHubDb, 'accounts', hubUser.uid);

      accountUnsubscribe = onSnapshot(
        accountRef,
        (snap) => {
          if (stopped || listenerGeneration !== generation) return;

          if (!snap.exists()) {
            const isBootstrapEmail =
              (hubUser.email || '').trim().toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
            if (isBootstrapEmail && !bootstrapRequested) {
              bootstrapRequested = true;
              void hubClient.getMyAccess(PATROL_APP_ID).catch((err) => {
                if (stopped || listenerGeneration !== generation) return;
                setAuthError(
                  err instanceof Error ? err.message : '初始化校級管理者帳號失敗，請重新登入。'
                );
                signOutBusinessApp();
                setAccessState('signed_out');
              });
              return;
            }

            signOutBusinessApp();
            setProfile(null);
            setIsAdmin(false);
            setIsSuperAdmin(false);
            clearOperationalData();
            setBlockedInfo({
              email: hubUser.email || '',
              displayName: hubUser.displayName || undefined,
              reason: '找不到此帳號於全校帳號管理中心的授權資料，請聯繫學校系統管理者。',
            });
            setAccessState('unauthorized');
            return;
          }

          const rawAccount: HubAccountRecord = {
            uid: hubUser.uid,
            ...(snap.data() as Omit<HubAccountRecord, 'uid'>),
          };
          const adapted = adaptHubAccountToPatrol(rawAccount, {
            fallbackEmail: hubUser.email || '',
            fallbackDisplayName: hubUser.displayName || '',
          });

          if (adapted.status !== 'authorized') {
            signOutBusinessApp();
            setProfile(null);
            setIsAdmin(false);
            setIsSuperAdmin(false);
            clearOperationalData();
            setBlockedInfo({
              email: adapted.email || hubUser.email || '',
              displayName: adapted.displayName,
              department: adapted.department,
              reason: adapted.reason,
            });
            setAccessState(adapted.status);
            return;
          }

          const needsTokenExchange =
            syncedClaimsVersion !== adapted.claimsVersion || !auth.currentUser;

          if (needsTokenExchange) {
            syncedClaimsVersion = adapted.claimsVersion;
            void (async () => {
              try {
                const brokerRes = await hubClient.issueAppToken(PATROL_APP_ID);
                if (stopped || listenerGeneration !== generation) return;
                await signInWithCustomToken(auth, brokerRes.customToken);
                if (stopped || listenerGeneration !== generation) return;

                const finalAdapted = adaptHubAccountToPatrol(rawAccount, {
                  fallbackEmail: hubUser.email || '',
                  fallbackDisplayName: hubUser.displayName || '',
                  targetUid: brokerRes.uid,
                });
                if (finalAdapted.status !== 'authorized') return;

                void syncStaffProfileFromHub(finalAdapted.profile);
                setProfile(finalAdapted.profile);
                setIsAdmin(finalAdapted.isAdmin);
                setIsSuperAdmin(finalAdapted.isSuperAdmin);
                setBlockedInfo(null);
                setAuthError(null);
                setAccessState('authorized');
              } catch (err) {
                if (stopped || listenerGeneration !== generation) return;
                syncedClaimsVersion = null;
                signOutBusinessApp();
                setProfile(null);
                setIsAdmin(false);
                setIsSuperAdmin(false);
                clearOperationalData();
                const errCode = (err as { code?: string })?.code || '';
                const errMsg =
                  err instanceof Error ? err.message : '換發校園巡堂系統登入憑證失敗，請稍後再試。';
                if (errCode.includes('permission-denied')) {
                  setBlockedInfo({
                    email: hubUser.email || '',
                    displayName: rawAccount.name,
                    department: rawAccount.dept,
                    reason: errMsg,
                  });
                  setAccessState('unauthorized');
                } else {
                  setAuthError(errMsg);
                  setAccessState('signed_out');
                }
              }
            })();
            return;
          }

          // Profile metadata updated without claimsVersion change
          const currentTargetUid = auth.currentUser?.uid || adapted.profile.uid;
          const syncedProfile: StaffProfile = {
            ...adapted.profile,
            uid: currentTargetUid,
          };
          void syncStaffProfileFromHub(syncedProfile);
          setProfile(syncedProfile);
          setIsAdmin(adapted.isAdmin);
          setIsSuperAdmin(adapted.isSuperAdmin);
          setBlockedInfo(null);
          setAuthError(null);
          setAccessState('authorized');
        },
        (err) => {
          if (stopped || listenerGeneration !== generation) return;
          signOutBusinessApp();
          setProfile(null);
          setIsAdmin(false);
          setIsSuperAdmin(false);
          clearOperationalData();
          setAuthError(
            err instanceof Error ? `讀取帳號中心權限失敗：${err.message}` : '讀取帳號中心權限失敗'
          );
          setAccessState('signed_out');
        }
      );
    });

    return () => {
      stopped = true;
      generation += 1;
      accountUnsubscribe?.();
      unsubAuth();
    };
  }, [clearOperationalData, hubClient]);

  // 3. Real-time Operational Firestore Listeners (Strictly after Authorized)
  useEffect(() => {
    if (accessState !== 'authorized' || !firebaseUser || !profile) {
      return;
    }

    const settingsDocRef = doc(db, 'schoolSettings', CAMPUS_ID);
    const qTimetables = query(collectionRefs.timetables(), where('campusId', '==', CAMPUS_ID));
    const qArchives = query(collectionRefs.timetableArchives(), where('campusId', '==', CAMPUS_ID));
    const qPatrols = query(collectionRefs.patrolLogs(), where('campusId', '==', CAMPUS_ID));
    const qIncidents = query(collectionRefs.incidents(), where('campusId', '==', CAMPUS_ID));
    const qStaff = query(collectionRefs.staffProfiles(), where('campusId', '==', CAMPUS_ID));

    const unsubSettings = onSnapshot(
      settingsDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<SchoolSettings>;
          setSchoolSettings({
            campusId: CAMPUS_ID,
            schoolName: data.schoolName || DEFAULT_SCHOOL_SETTINGS.schoolName,
            academicYear: data.academicYear || DEFAULT_SCHOOL_SETTINGS.academicYear,
            semester: data.semester === '第二學期' ? '第二學期' : '第一學期',
            currentWeek:
              typeof data.currentWeek === 'number' && data.currentWeek >= 1
                ? data.currentWeek
                : DEFAULT_SCHOOL_SETTINGS.currentWeek,
            buildings:
              Array.isArray(data.buildings) && data.buildings.length > 0
                ? data.buildings
                : DEFAULT_SCHOOL_SETTINGS.buildings,
            updatedBy: data.updatedBy,
            updatedAt: data.updatedAt,
          });
        } else {
          setSchoolSettings(DEFAULT_SCHOOL_SETTINGS);
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, `schoolSettings/${CAMPUS_ID}`)
    );

    const unsubTimetables = onSnapshot(
      qTimetables,
      (snap) => {
        setTimetables(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TimetableSlot, 'id'>) }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'timetables')
    );

    const unsubArchives = onSnapshot(
      qArchives,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<TimetableArchive, 'id'>) }))
          .sort((a, b) => {
            const ta = a.archivedAt?.toMillis?.() ?? 0;
            const tb = b.archivedAt?.toMillis?.() ?? 0;
            return tb - ta;
          });
        setTimetableArchives(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'timetableArchives')
    );

    const unsubPatrols = onSnapshot(
      qPatrols,
      (snap) => {
        setPatrolLogs(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PatrolLog, 'id'>) }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'patrolLogs')
    );

    const unsubIncidents = onSnapshot(
      qIncidents,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<IncidentReport, 'id'>),
        }));
        setIncidents(list);

        if (incidentsHydratedRef.current) {
          snap.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const inc: IncidentReport = {
                id: change.doc.id,
                ...(change.doc.data() as Omit<IncidentReport, 'id'>),
              };
              if (inc.status === 'open' && shouldDispatchNotification(inc, notifPrefsRef.current)) {
                setLiveAlertToast(inc);
                if (notifPrefsRef.current.soundEnabled) {
                  playUrgentAlertChime(inc.severity);
                }
                if (notifPrefsRef.current.browserPushEnabled) {
                  triggerBrowserPushNotification(inc);
                }
              }
            }
          });
        } else {
          incidentsHydratedRef.current = true;
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'incidents')
    );

    const unsubStaff = onSnapshot(
      qStaff,
      (snap) => {
        const members = snap.docs.map((d) => {
          const data = d.data() as StaffProfile;
          return { ...data, role: normalizeStaffRole(data.role) };
        });
        setStaffList(members);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'staffProfiles')
    );

    return () => {
      unsubSettings();
      unsubTimetables();
      unsubArchives();
      unsubPatrols();
      unsubIncidents();
      unsubStaff();
    };
  }, [accessState, firebaseUser, profile?.uid]);

  // 4. Admin-Only Summary Fetch from Central Account Hub (for Overview Dashboard KPI)
  useEffect(() => {
    if (accessState !== 'authorized' || !isAdmin || !hubClient) {
      setAccountStats(null);
      return;
    }

    let cancelled = false;
    void hubClient
      .listAppAccounts(PATROL_APP_ID)
      .then((res) => {
        if (cancelled) return;
        let active = 0;
        let disabled = 0;
        for (const acc of res.accounts || []) {
          const isEffectiveActive =
            acc.globalStatus === 'active' &&
            (acc.isSuperAdmin || acc.appAccess?.status === 'active');
          if (isEffectiveActive) active += 1;
          else disabled += 1;
        }
        setAccountStats({ active, disabled });
      })
      .catch(() => {
        // Non-fatal: OverviewDashboardView falls back to staffList.length when offline
      });

    return () => {
      cancelled = true;
    };
  }, [accessState, isAdmin, hubClient, activeNav]);

  const handleSignIn = async () => {
    if (!hubAuth) {
      setAuthError('尚未設定全校統一帳號管理中心環境變數，無法進行登入。');
      return;
    }
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(hubAuth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const mapped = mapAuthError(code);
      if (mapped) {
        setAuthError(mapped);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await Promise.all([
      hubAuth ? signOut(hubAuth).catch(() => {}) : Promise.resolve(),
      signOut(auth).catch(() => {}),
    ]);
  };

  const handleSwitchAccount = async () => {
    await handleSignOut();
    await handleSignIn();
  };

  const handleSeedDemoData = async () => {
    if (!profile || !isAdmin) return;
    setSeeding(true);
    try {
      const res = await seedCampusDemoDataset({
        uid: profile.uid,
        displayName: profile.displayName,
        schoolSettings,
      });
      setSelectedPeriod(1);
      showFeedback(
        `已匯入 ${res.timetableCount} 筆班級課表、${res.patrolCount} 筆巡堂檢核紀錄與 ${res.incidentCount} 件異常通報`
      );
    } finally {
      setSeeding(false);
    }
  };

  const handleUpdateNotifPrefs = (next: NotificationPreferences) => {
    setNotifPrefs(next);
    saveNotificationPrefs(next);
  };

  const sidebarGroups: SidebarNavGroup[] = useMemo(
    () => [
      {
        title: '總覽',
        items: [
          {
            key: 'overview',
            nav: 'overview',
            label: '總覽儀表',
            icon: LayoutDashboard,
            badgeBg: 'bg-[#E5F2EE]',
            badgeText: 'text-[#1E5C4B]',
            activeRowBg: 'bg-[#E5F2EE]',
            activeText: 'text-[#1E5C4B]',
            activeBadgeBg: 'bg-[#1E5C4B]',
          },
        ],
      },
      {
        title: '巡堂與即時',
        items: [
          {
            key: 'dashboard',
            nav: 'dashboard',
            label: '即時巡堂',
            icon: Activity,
            badgeBg: 'bg-[#EEEAF8]',
            badgeText: 'text-[#4D358A]',
            activeRowBg: 'bg-[#EEEAF8]',
            activeText: 'text-[#4D358A]',
            activeBadgeBg: 'bg-[#4D358A]',
          },
          {
            key: 'patrol',
            nav: 'patrol',
            label: '行動巡堂',
            icon: ClipboardCheck,
            badgeBg: 'bg-[#E5F2EE]',
            badgeText: 'text-[#1E5C4B]',
            activeRowBg: 'bg-[#E5F2EE]',
            activeText: 'text-[#1E5C4B]',
            activeBadgeBg: 'bg-[#1E5C4B]',
          },
          {
            key: 'incidents',
            nav: 'incidents',
            label: '異常通報',
            icon: Bell,
            badgeBg: 'bg-[#FCEBE7]',
            badgeText: 'text-[#B8432E]',
            activeRowBg: 'bg-[#FCEBE7]',
            activeText: 'text-[#B8432E]',
            activeBadgeBg: 'bg-[#B8432E]',
          },
        ],
      },
      {
        title: '基本資料',
        items: [
          {
            key: 'basic_data',
            nav: 'basic_data',
            label: '學校設定',
            icon: Building2,
            badgeBg: 'bg-[#FBF0E2]',
            badgeText: 'text-[#9A5B13]',
            activeRowBg: 'bg-[#FBF0E2]',
            activeText: 'text-[#9A5B13]',
            activeBadgeBg: 'bg-[#9A5B13]',
          },
          {
            key: 'timetable',
            nav: 'timetable',
            label: '班級課表',
            icon: BookOpen,
            badgeBg: 'bg-[#E7F0F8]',
            badgeText: 'text-[#245A84]',
            activeRowBg: 'bg-[#E7F0F8]',
            activeText: 'text-[#245A84]',
            activeBadgeBg: 'bg-[#245A84]',
          },
        ],
      },
      {
        title: '報表與管理',
        items: [
          {
            key: 'reports',
            nav: 'reports',
            label: '報表匯出',
            icon: FileText,
            badgeBg: 'bg-[#E9ECF7]',
            badgeText: 'text-[#354488]',
            activeRowBg: 'bg-[#E9ECF7]',
            activeText: 'text-[#354488]',
            activeBadgeBg: 'bg-[#354488]',
          },
          {
            key: 'staff',
            nav: 'staff',
            label: isAdmin ? '帳號管理' : '個人帳號',
            icon: UserRound,
            badgeBg: 'bg-[#F6E8EC]',
            badgeText: 'text-[#5F2230]',
            activeRowBg: 'bg-[#F6E8EC]',
            activeText: 'text-[#5F2230]',
            activeBadgeBg: 'bg-[#5F2230]',
          },
          {
            key: 'manual',
            nav: 'manual',
            label: '操作手冊',
            icon: HelpCircle,
            badgeBg: 'bg-[#E5F2EE]',
            badgeText: 'text-[#1E5C4B]',
            activeRowBg: 'bg-[#E5F2EE]',
            activeText: 'text-[#1E5C4B]',
            activeBadgeBg: 'bg-[#1E5C4B]',
          },
          {
            key: 'changelog',
            nav: 'changelog',
            label: '系統日誌',
            icon: History,
            badgeBg: 'bg-[#EFECE6]',
            badgeText: 'text-[#4C4B46]',
            activeRowBg: 'bg-[#EFECE6]',
            activeText: 'text-[#2F2E2A]',
            activeBadgeBg: 'bg-[#4C4B46]',
          },
        ],
      },
    ],
    [isAdmin]
  );

  const mobileNavItems: MobileNavItem[] = useMemo(
    () => [
      { id: 'overview', label: '總覽', icon: LayoutDashboard },
      { id: 'dashboard', label: '即時', icon: Activity },
      { id: 'patrol', label: '巡堂', icon: ClipboardCheck },
      { id: 'incidents', label: '通報', icon: Bell },
      { id: 'reports', label: '報表', icon: FileText },
      { id: 'staff', label: '帳號', icon: UserRound },
    ],
    []
  );

  const openHighIncidentCount = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved' && i.severity === 'high').length,
    [incidents]
  );

  const openTotalIncidentCount = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved').length,
    [incidents]
  );

  const quickPeriods = useMemo(() => getQuickPeriodsWindow(selectedPeriod), [selectedPeriod]);
  const selectedDayLabel = getDayOfWeekLabel(selectedDate);

  if (!isAccountHubConfigured) {
    return <HubConfigMissingScreen />;
  }

  if (accessState === 'loading') {
    return (
      <div className="min-h-screen bg-[#F6F4EE] flex items-center justify-center p-6">
        <div className="text-center space-y-2.5">
          <div className="w-8 h-8 border-2 border-[#1E5C4B] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[#5C615C]">正在驗證全校統一帳號與校園巡堂憑證...</p>
        </div>
      </div>
    );
  }

  if (accessState === 'unauthorized' || accessState === 'disabled') {
    return (
      <AccessBlockedScreen
        reason={accessState}
        email={blockedInfo?.email || firebaseUser?.email || ''}
        displayName={blockedInfo?.displayName}
        department={blockedInfo?.department}
        detailMessage={blockedInfo?.reason}
        hubUrl={ACCOUNT_HUB_URL}
        onSignOut={handleSignOut}
        onSwitchAccount={handleSwitchAccount}
      />
    );
  }

  if (accessState === 'signed_out' || !firebaseUser || !profile) {
    return (
      <SignInScreen
        onSignIn={handleSignIn}
        signingIn={signingIn}
        errorMessage={authError}
      />
    );
  }

  const userInitial = (profile.displayName || '師').trim().slice(0, 1);

  return (
    <div className="min-h-screen bg-[#F6F4EE] text-[#1F2421] flex flex-col">
      {/* Unified Full-Width Top Header Bar */}
      <header className="no-print sticky top-0 z-30 pt-safe min-h-[56px] lg:h-[68px] bg-white border-b border-[#E5E1D8] px-3.5 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Emblem + School System Title + Contextual Status */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={() => setActiveNav('overview')}
            className="flex items-center gap-2.5 sm:gap-3 text-left group cursor-pointer shrink-0"
          >
            <img
              src="/icon.svg"
              alt={`${schoolSettings.schoolName}教學巡堂系統圖示`}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl shrink-0 shadow-xs"
            />
            <span className="text-[15px] sm:text-lg font-bold tracking-tight text-[#1F2421] group-hover:text-[#1E5C4B] transition-colors whitespace-nowrap">
              {schoolSettings.schoolName}教學巡堂系統
            </span>
          </button>

          {openHighIncidentCount > 0 ? (
            <button
              type="button"
              onClick={() => setActiveNav('incidents')}
              className="hidden md:inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 rounded-lg bg-[#FCECE6] hover:bg-[#F8DFD6] text-[#B44326] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                緊急異常待處理：<span className="font-mono-num">{openHighIncidentCount}</span> 件 · 前往處置
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveNav('basic_data')}
              title="前往學校設定管理學年度與課表歷史歸檔"
              className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg hover:bg-[#F2EFE9] text-xs text-[#5C615C] hover:text-[#1E5C4B] font-mono-num whitespace-nowrap cursor-pointer transition-colors"
            >
              <span className="font-semibold">
                {schoolSettings.academicYear}學年度{schoolSettings.semester}
              </span>
              <span aria-hidden="true">·</span>
              <span>第{schoolSettings.currentWeek}週</span>
              <span aria-hidden="true">·</span>
              <span>
                {selectedDate}（{selectedDayLabel}）
              </span>
            </button>
          )}
        </div>

        {/* Right: Quick-Period Segmented Switcher + PWA Install + User Profile & Logout */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <div
            role="group"
            aria-label="快速切換巡堂節次"
            className="hidden md:inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl"
          >
            {quickPeriods.map((periodNum) => {
              const isSelected = selectedPeriod === periodNum;
              return (
                <button
                  key={periodNum}
                  type="button"
                  onClick={() => setSelectedPeriod(periodNum)}
                  className={`min-h-[34px] px-3.5 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer font-mono-num ${
                    isSelected
                      ? 'bg-[#1E5C4B] text-white shadow-xs'
                      : 'text-[#5C615C] hover:text-[#1F2421]'
                  }`}
                >
                  第{periodNum}節
                </button>
              );
            })}
          </div>

          <div className="lg:hidden">
            <PWAInstallButton variant="compact" />
          </div>

          {openHighIncidentCount > 0 && activeNav !== 'incidents' && (
            <button
              type="button"
              onClick={() => setActiveNav('incidents')}
              aria-label={`有 ${openHighIncidentCount} 件緊急異常待處理`}
              className="md:hidden min-h-[36px] px-2.5 py-1 text-xs font-semibold text-[#B44326] bg-[#FCECE6] rounded-lg inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono-num">{openHighIncidentCount}</span>
            </button>
          )}

          {/* User Avatar + Name + Role · Logout */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveNav('staff')}
              aria-label="檢視個人帳號設定"
              className="w-9 h-9 rounded-full overflow-hidden bg-[#1E5C4B] text-[#FAF9F5] font-bold text-xs flex items-center justify-center shrink-0 border border-[#E5E1D8] cursor-pointer"
            >
              {firebaseUser.photoURL && !avatarFailed ? (
                <img
                  src={firebaseUser.photoURL}
                  alt={profile.displayName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{userInitial}</span>
              )}
            </button>

            <div className="hidden sm:block text-left leading-tight">
              <p className="text-sm font-bold text-[#1F2421] whitespace-nowrap max-w-[132px] truncate">
                {profile.displayName}
              </p>
              <div className="flex items-center gap-1.5 text-xs text-[#7C7A72] mt-0.5 whitespace-nowrap">
                <span>{STAFF_ROLE_LABELS[isAdmin ? 'admin' : 'user']}</span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="hover:text-[#B44326] transition-colors cursor-pointer"
                >
                  登出
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Body Layout: Warm Ivory Grouped Left Sidebar + Warm Linen Workspace */}
      <div className="flex-1 flex min-w-0">
        {/* Desktop Grouped Sidebar */}
        <aside className="no-print hidden lg:flex lg:flex-col lg:w-[248px] lg:fixed lg:top-[68px] lg:bottom-0 lg:left-0 bg-[#FAF9F5] border-r border-[#E5E1D8] z-20">
          <nav aria-label="主功能選單" className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
            {sidebarGroups.map((group) => (
              <div key={group.title} className="space-y-1">
                <p className="px-3 pb-1 text-xs font-medium text-[#9A968C]">{group.title}</p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeNav === item.nav;

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveNav(item.nav)}
                      className={`w-full min-h-[42px] px-2.5 py-1.5 rounded-xl text-[14px] flex items-center justify-between gap-2 transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? `${item.activeRowBg} ${item.activeText} font-bold`
                          : 'text-[#3A3F3B] font-medium hover:bg-[#F2EFE9]'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-colors ${
                            active
                              ? `${item.activeBadgeBg} text-white`
                              : `${item.badgeBg} ${item.badgeText}`
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="truncate">{item.label}</span>
                      </span>

                      {item.key === 'incidents' && openTotalIncidentCount > 0 && (
                        <span
                          className={`text-xs font-mono-num font-bold pr-1 ${
                            active ? item.activeText : 'text-[#B8432E]'
                          }`}
                        >
                          {openTotalIncidentCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Quiet Sidebar Footer with PWA Install & System Version */}
          <div className="px-4 py-3.5 border-t border-[#E5E1D8] space-y-2">
            <PWAInstallButton variant="sidebar" />
            <button
              type="button"
              onClick={() => setActiveNav('changelog')}
              className="w-full text-center text-xs text-[#9A968C] hover:text-[#1E5C4B] transition-colors cursor-pointer font-mono-num"
              title="點擊檢視系統日誌"
            >
              系統版本 {CURRENT_APP_VERSION} · {CURRENT_APP_DATE}
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 lg:pl-[248px] flex flex-col min-w-0 print:pl-0">
          {liveAlertToast && (
            <div className="no-print px-4 sm:px-6 pt-4">
              <div className="bg-[#FCECE6] border border-[#EABEB0] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-[#B44326] shrink-0 mt-0.5" />
                  <div className="text-xs sm:text-sm">
                    <p className="font-semibold text-[#7A2716]">
                      即時推播通知｜{INCIDENT_SEVERITY_LABELS[liveAlertToast.severity]}：
                      {liveAlertToast.title}
                    </p>
                    <p className="text-[#9E351E] mt-0.5">
                      {liveAlertToast.location} · 通報人：{liveAlertToast.reporterName}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setLiveAlertToast(null);
                      setActiveNav('incidents');
                    }}
                    className="min-h-[36px] px-3 py-1.5 bg-[#B44326] hover:bg-[#93341C] text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    前往處理
                  </button>
                  <button
                    type="button"
                    onClick={() => setLiveAlertToast(null)}
                    aria-label="關閉推播提示"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#B44326] hover:bg-[#F8DFD6] rounded-lg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {feedbackBanner && (
            <div className="no-print px-4 sm:px-6 pt-3">
              <div className="bg-[#1E5C4B] text-[#FAF9F5] text-xs sm:text-sm px-4 py-3 rounded-xl flex items-center justify-between gap-3">
                <span>{feedbackBanner}</span>
                <button
                  type="button"
                  onClick={() => setFeedbackBanner(null)}
                  className="text-[#C8DFD7] hover:text-white cursor-pointer"
                  aria-label="關閉提示"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <main className="flex-1 p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1360px] w-full mx-auto print:p-0 print:max-w-none">
            <Suspense
              fallback={
                <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-[#5A5F5A]">
                  <div className="w-7 h-7 border-2 border-[#1E5C4B] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-medium">正在載入頁面模組…</p>
                </div>
              }
            >
            {activeNav === 'overview' && (
              <OverviewDashboardView
                profile={profile}
                isAdmin={isAdmin}
                schoolSettings={schoolSettings}
                timetables={timetables}
                timetableArchives={timetableArchives}
                patrolLogs={patrolLogs}
                incidents={incidents}
                accountStats={accountStats}
                staffList={staffList}
                onNavigate={setActiveNav}
                onJumpToBuildingLive={(building, targetDate) => {
                  setSelectedBuilding(building);
                  if (targetDate) {
                    handleSelectDate(targetDate);
                  }
                  setActiveNav('dashboard');
                }}
              />
            )}

            {activeNav === 'dashboard' && (
              <DashboardView
                schoolSettings={schoolSettings}
                selectedDate={selectedDate}
                selectedPeriod={selectedPeriod}
                selectedBuilding={selectedBuilding}
                onChangeDate={handleSelectDate}
                onChangePeriod={setSelectedPeriod}
                onChangeBuilding={setSelectedBuilding}
                timetables={timetables}
                patrolLogs={patrolLogs}
                incidents={incidents}
                onOpenQuickPatrol={(slot) => {
                  setQuickPatrolSlot(slot);
                  setActiveNav('patrol');
                }}
                onNavigate={setActiveNav}
                onSeedDemoData={handleSeedDemoData}
                seeding={seeding}
                isAdmin={isAdmin}
              />
            )}

            {activeNav === 'patrol' && (
              <PatrolWorkspaceView
                profile={profile}
                schoolSettings={schoolSettings}
                selectedDate={selectedDate}
                selectedPeriod={selectedPeriod}
                onChangeDate={handleSelectDate}
                onChangePeriod={setSelectedPeriod}
                timetables={timetables}
                patrolLogs={patrolLogs}
                activeSlot={quickPatrolSlot}
                onSelectSlot={setQuickPatrolSlot}
                onActionFeedback={showFeedback}
              />
            )}

            {activeNav === 'incidents' && (
              <IncidentsView
                profile={profile}
                isAdmin={isAdmin}
                schoolSettings={schoolSettings}
                selectedDate={selectedDate}
                selectedPeriod={selectedPeriod}
                timetables={timetables}
                incidents={incidents}
                notifPrefs={notifPrefs}
                onUpdateNotifPrefs={handleUpdateNotifPrefs}
                onActionFeedback={showFeedback}
              />
            )}

            {activeNav === 'basic_data' && (
              <BasicDataView
                profile={profile}
                isAdmin={isAdmin}
                schoolSettings={schoolSettings}
                timetables={timetables}
                timetableArchives={timetableArchives}
                patrolLogs={patrolLogs}
                onGoToTimetable={() => setActiveNav('timetable')}
                onActionFeedback={showFeedback}
              />
            )}

            {activeNav === 'timetable' && (
              <TimetableTruancyView
                profile={profile}
                isAdmin={isAdmin}
                schoolSettings={schoolSettings}
                timetables={timetables}
                patrolLogs={patrolLogs}
                incidents={incidents}
                onGoToBasicData={() => setActiveNav('basic_data')}
                onJumpToPatrol={(targetDayOfWeek, targetPeriod, slot) => {
                  const parts = selectedDate.split('-').map(Number);
                  const base =
                    parts.length === 3 && !parts.some(Number.isNaN)
                      ? new Date(parts[0], parts[1] - 1, parts[2])
                      : new Date();
                  const jsDay = base.getDay();
                  const offsetToMon = jsDay === 0 ? -6 : 1 - jsDay;
                  const targetDate = new Date(
                    base.getFullYear(),
                    base.getMonth(),
                    base.getDate() + offsetToMon + (targetDayOfWeek - 1)
                  );
                  const y = targetDate.getFullYear();
                  const m = String(targetDate.getMonth() + 1).padStart(2, '0');
                  const d = String(targetDate.getDate()).padStart(2, '0');
                  handleSelectDate(`${y}-${m}-${d}`);
                  setSelectedPeriod(targetPeriod);
                  setQuickPatrolSlot(slot ?? null);
                  setActiveNav('patrol');
                }}
                onSeedDemoData={handleSeedDemoData}
                seeding={seeding}
                onActionFeedback={showFeedback}
              />
            )}

            {activeNav === 'reports' && (
              <ReportsView
                schoolSettings={schoolSettings}
                selectedDate={selectedDate}
                timetables={timetables}
                patrolLogs={patrolLogs}
                incidents={incidents}
                onActionFeedback={showFeedback}
              />
            )}

            {activeNav === 'staff' && (
              <StaffView
                profile={profile}
                userEmail={firebaseUser.email || ''}
                hubUserUid={firebaseUser.uid}
                isAdmin={isAdmin}
                isSuperAdmin={isSuperAdmin}
                staffList={staffList}
                onSignOut={handleSignOut}
              />
            )}

            {activeNav === 'manual' && (
              <ManualView schoolSettings={schoolSettings} onNavigate={setActiveNav} />
            )}

            {activeNav === 'changelog' && <ChangelogView />}
            </Suspense>
          </main>
        </div>
      </div>

      <OfflineBanner />

      {/* Mobile Fixed Bottom Tab Bar */}
      <nav
        aria-label="行動巡堂主選單"
        className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#FAF9F5]/95 backdrop-blur-md border-t border-[#E5E1D8] pb-safe"
      >
        <div className="grid grid-cols-6 h-14">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active =
              activeNav === item.id ||
              (item.id === 'basic_data' && activeNav === 'timetable');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 relative cursor-pointer transition-colors ${
                  active ? 'text-[#1E5C4B] font-bold' : 'text-[#7C7A72]'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight whitespace-nowrap">{item.label}</span>
                {item.id === 'incidents' && openTotalIncidentCount > 0 && (
                  <span className="absolute top-1 right-2.5 text-[10px] font-mono-num font-bold text-[#B8432E]">
                    {openTotalIncidentCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <CampusPatrolApp />
    </ErrorBoundary>
  );
}
