import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  ClipboardCheck,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Users,
  X,
} from 'lucide-react';
import {
  CAMPUS_ID,
  detectCurrentPeriod,
  getTodayDateString,
  INCIDENT_SEVERITY_LABELS,
  type AbsenceRecord,
  type IncidentReport,
  type LeaveRecord,
  type NavSection,
  type NotificationPreferences,
  type PatrolLog,
  type StaffProfile,
  type TimetableSlot,
} from './types/patrol';
import {
  auth,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './lib/firebase';
import { collectionRefs, ensureUserAccountDocs } from './lib/firestoreOps';
import { seedCampusDemoDataset } from './lib/seedData';
import {
  loadNotificationPrefs,
  playUrgentAlertChime,
  saveNotificationPrefs,
  shouldDispatchNotification,
  triggerBrowserPushNotification,
} from './lib/notifications';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SignInScreen } from './components/SignInScreen';
import { DashboardView } from './components/DashboardView';
import { PatrolWorkspaceView } from './components/PatrolWorkspaceView';
import { IncidentsView } from './components/IncidentsView';
import { TimetableTruancyView } from './components/TimetableTruancyView';
import { ReportsView } from './components/ReportsView';
import { StaffView } from './components/StaffView';

interface NavItemConfig {
  id: NavSection;
  label: string;
  mobileLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: '即時巡堂儀表板', mobileLabel: '儀表板', icon: LayoutDashboard },
  { id: 'patrol', label: '行動巡堂作業', mobileLabel: '巡堂', icon: ClipboardCheck },
  { id: 'incidents', label: '異常事件通報', mobileLabel: '通報', icon: Bell },
  { id: 'timetable', label: '課表與自動缺曠', mobileLabel: '缺曠', icon: BookOpen },
  { id: 'reports', label: 'PDF／Excel 報表', mobileLabel: '報表', icon: FileSpreadsheet },
  { id: 'staff', label: '帳號與人員管理', mobileLabel: '帳號', icon: Users },
];

function CampusPatrolApp() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Navigation & Shared Time Context
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDateString);
  const [selectedPeriod, setSelectedPeriod] = useState<number>(detectCurrentPeriod);
  const [selectedBuilding, setSelectedBuilding] = useState<string>('ALL');
  const [quickPatrolSlot, setQuickPatrolSlot] = useState<TimetableSlot | null>(null);

  // Real-time Firestore Collections
  const [timetables, setTimetables] = useState<TimetableSlot[]>([]);
  const [leaveRecords, setLeaveRecords] = useState<LeaveRecord[]>([]);
  const [patrolLogs, setPatrolLogs] = useState<PatrolLog[]>([]);
  const [absences, setAbsences] = useState<AbsenceRecord[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [staffList, setStaffList] = useState<StaffProfile[]>([]);

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

  // 1. Auth Listener & Profile Bootstrap
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setIsAdmin(false);
        setAuthReady(true);
        incidentsHydratedRef.current = false;
        return;
      }

      if (!user.emailVerified) {
        setAuthError('您的 Google 帳號 Email 尚未完成驗證，為維護校園資料安全，請先完成驗證後再登入。');
        setAuthReady(true);
        return;
      }

      try {
        const { profile: resolvedProfile, isAdmin: adminFlag } = await ensureUserAccountDocs({
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || '',
        });
        setProfile(resolvedProfile);
        setIsAdmin(adminFlag);
        setAuthError(null);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : '初始化個人巡堂檔案失敗');
      } finally {
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  // 2. Real-time Firestore Listeners (strictly after auth is verified)
  useEffect(() => {
    if (!authReady || !firebaseUser || !firebaseUser.emailVerified || !profile) {
      return;
    }

    const qTimetables = query(collectionRefs.timetables(), where('campusId', '==', CAMPUS_ID));
    const qLeaves = query(collectionRefs.leaveRecords(), where('campusId', '==', CAMPUS_ID));
    const qPatrols = query(collectionRefs.patrolLogs(), where('campusId', '==', CAMPUS_ID));
    const qAbsences = query(collectionRefs.absences(), where('campusId', '==', CAMPUS_ID));
    const qIncidents = query(collectionRefs.incidents(), where('campusId', '==', CAMPUS_ID));
    const qStaff = query(collectionRefs.staffProfiles(), where('campusId', '==', CAMPUS_ID));

    const unsubTimetables = onSnapshot(
      qTimetables,
      (snap) => {
        setTimetables(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TimetableSlot, 'id'>) }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'timetables')
    );

    const unsubLeaves = onSnapshot(
      qLeaves,
      (snap) => {
        setLeaveRecords(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LeaveRecord, 'id'>) }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'leaveRecords')
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

    const unsubAbsences = onSnapshot(
      qAbsences,
      (snap) => {
        setAbsences(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AbsenceRecord, 'id'>) }))
        );
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'absences')
    );

    const unsubIncidents = onSnapshot(
      qIncidents,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<IncidentReport, 'id'>),
        }));
        setIncidents(list);

        // Dispatch real-time push notification for newly added open incidents after initial hydration
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
        const members = snap.docs.map((d) => d.data() as StaffProfile);
        setStaffList(members);
        const me = members.find((m) => m.uid === firebaseUser.uid);
        if (me) {
          setProfile(me);
        }
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'staffProfiles')
    );

    return () => {
      unsubTimetables();
      unsubLeaves();
      unsubPatrols();
      unsubAbsences();
      unsubIncidents();
      unsubStaff();
    };
  }, [authReady, firebaseUser, profile?.uid]);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登入失敗，請重試';
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError(`Google 登入未完成：${msg}`);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleSeedDemoData = async () => {
    if (!profile) return;
    setSeeding(true);
    try {
      const res = await seedCampusDemoDataset({
        uid: profile.uid,
        displayName: profile.displayName,
      });
      setSelectedPeriod(1);
      showFeedback(
        `已匯入 ${res.timetableCount} 筆學校課表、${res.patrolCount} 筆巡堂紀錄、${res.absenceCount} 筆缺曠測試資料與 ${res.incidentCount} 件異常通報`
      );
    } finally {
      setSeeding(false);
    }
  };

  const handleUpdateNotifPrefs = (next: NotificationPreferences) => {
    setNotifPrefs(next);
    saveNotificationPrefs(next);
  };

  const openHighIncidentCount = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved' && i.severity === 'high').length,
    [incidents]
  );

  const openTotalIncidentCount = useMemo(
    () => incidents.filter((i) => i.status !== 'resolved').length,
    [incidents]
  );

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-slate-600">正在連線校園巡堂資料庫...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return (
      <SignInScreen
        onSignIn={handleSignIn}
        signingIn={signingIn}
        errorMessage={authError}
      />
    );
  }

  const currentNavMeta = NAV_ITEMS.find((n) => n.id === activeNav) ?? NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar (252px) */}
      <aside className="no-print hidden lg:flex lg:flex-col lg:w-[252px] lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
            CampusPatrol 巡堂通
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`w-full min-h-[42px] px-3.5 py-2 rounded-lg text-sm font-medium flex items-center justify-between transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'incidents' && openTotalIncidentCount > 0 && (
                  <span
                    className={`text-xs font-mono-num font-semibold ${
                      active ? 'text-teal-100' : 'text-red-700'
                    }`}
                  >
                    {openTotalIncidentCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{profile.displayName}</p>
            <p className="text-xs text-slate-500 truncate">
              {profile.department} · {profile.jobTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            登出帳號
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-[252px] flex flex-col min-w-0">
        {/* Compact Top Header (52px on mobile to honor <=15% sticky cap; 64px on desktop) */}
        <header className="no-print sticky top-0 z-20 h-[52px] lg:h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="lg:hidden text-sm font-bold text-teal-800 whitespace-nowrap shrink-0">
              巡堂通
            </span>
            <span className="lg:hidden text-slate-300" aria-hidden="true">/</span>
            <h1 className="text-sm lg:text-base font-semibold text-slate-900 truncate">
              {currentNavMeta.label}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {openHighIncidentCount > 0 && activeNav !== 'incidents' && (
              <button
                type="button"
                onClick={() => setActiveNav('incidents')}
                className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>緊急異常 {openHighIncidentCount}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveNav('patrol')}
              className="min-h-[38px] px-3.5 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              開始巡堂
            </button>
          </div>
        </header>

        {/* Live Push Notification Toast for Newly Triggered Incidents */}
        {liveAlertToast && (
          <div className="no-print px-4 sm:px-6 pt-4">
            <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                <div className="text-xs sm:text-sm">
                  <p className="font-semibold text-red-900">
                    即時推播通知｜{INCIDENT_SEVERITY_LABELS[liveAlertToast.severity]}：{liveAlertToast.title}
                  </p>
                  <p className="text-red-800 mt-0.5">
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
                  className="min-h-[36px] px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                >
                  前往處理
                </button>
                <button
                  type="button"
                  onClick={() => setLiveAlertToast(null)}
                  aria-label="關閉推播提示"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-red-700 hover:bg-red-100 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action Feedback Toast */}
        {feedbackBanner && (
          <div className="no-print px-4 sm:px-6 pt-3">
            <div className="bg-slate-900 text-white text-xs sm:text-sm px-4 py-3 rounded-xl flex items-center justify-between gap-3">
              <span>{feedbackBanner}</span>
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
                aria-label="關閉提示"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Active View Viewport (bottom padding on mobile clears fixed bottom tab bar) */}
        <main className="flex-1 p-4 sm:p-6 pb-20 lg:pb-8 max-w-[1440px] w-full mx-auto">
          {activeNav === 'dashboard' && (
            <DashboardView
              selectedDate={selectedDate}
              selectedPeriod={selectedPeriod}
              selectedBuilding={selectedBuilding}
              onChangeDate={setSelectedDate}
              onChangePeriod={setSelectedPeriod}
              onChangeBuilding={setSelectedBuilding}
              timetables={timetables}
              patrolLogs={patrolLogs}
              absences={absences}
              leaveRecords={leaveRecords}
              incidents={incidents}
              onOpenQuickPatrol={(slot) => {
                setQuickPatrolSlot(slot);
                setActiveNav('patrol');
              }}
              onNavigate={setActiveNav}
              onSeedDemoData={handleSeedDemoData}
              seeding={seeding}
            />
          )}

          {activeNav === 'patrol' && (
            <PatrolWorkspaceView
              profile={profile}
              selectedDate={selectedDate}
              selectedPeriod={selectedPeriod}
              onChangePeriod={setSelectedPeriod}
              timetables={timetables}
              patrolLogs={patrolLogs}
              absences={absences}
              leaveRecords={leaveRecords}
              activeSlot={quickPatrolSlot}
              onSelectSlot={setQuickPatrolSlot}
              onActionFeedback={showFeedback}
            />
          )}

          {activeNav === 'incidents' && (
            <IncidentsView
              profile={profile}
              isAdmin={isAdmin}
              selectedDate={selectedDate}
              selectedPeriod={selectedPeriod}
              timetables={timetables}
              incidents={incidents}
              notifPrefs={notifPrefs}
              onUpdateNotifPrefs={handleUpdateNotifPrefs}
              onActionFeedback={showFeedback}
            />
          )}

          {activeNav === 'timetable' && (
            <TimetableTruancyView
              profile={profile}
              isAdmin={isAdmin}
              selectedDate={selectedDate}
              timetables={timetables}
              absences={absences}
              leaveRecords={leaveRecords}
              onSeedDemoData={handleSeedDemoData}
              seeding={seeding}
              onActionFeedback={showFeedback}
            />
          )}

          {activeNav === 'reports' && (
            <ReportsView
              selectedDate={selectedDate}
              timetables={timetables}
              patrolLogs={patrolLogs}
              absences={absences}
              leaveRecords={leaveRecords}
              incidents={incidents}
              onActionFeedback={showFeedback}
            />
          )}

          {activeNav === 'staff' && (
            <StaffView
              profile={profile}
              userEmail={firebaseUser.email || ''}
              isAdmin={isAdmin}
              staffList={staffList}
              onActionFeedback={showFeedback}
            />
          )}
        </main>
      </div>

      {/* Mobile Fixed Bottom Tab Bar (56px height + 52px top bar = 108px < 15% of 812px viewport) */}
      <nav
        aria-label="行動巡堂主選單"
        className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-6 h-14">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 relative cursor-pointer ${
                  active ? 'text-teal-700 font-semibold' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight whitespace-nowrap">
                  {item.mobileLabel}
                </span>
                {item.id === 'incidents' && openTotalIncidentCount > 0 && (
                  <span className="absolute top-1 right-2.5 text-[10px] font-mono-num font-bold text-red-700">
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
