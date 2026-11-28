import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  HelpCircle,
  History,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AllowedAccount,
  IncidentReport,
  NavSection,
  PatrolLog,
  SchoolSettings,
  StaffProfile,
  TimetableArchive,
  TimetableSlot,
} from '../types/patrol';
import {
  DAY_OF_WEEK_SHORT,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  PATROL_STATUS_LABELS,
  PERIOD_SCHEDULE,
  getDayOfWeekLabel,
  getLatestSchoolDateString,
  getTodayDateString,
  getWeekDateRange,
  isWeekendDate,
} from '../types/patrol';
import { getIncidentElapsedMinutes, isIncidentOverdueEscalation } from '../lib/notifications';
import { CURRENT_APP_VERSION } from '../data/changelog';

interface OverviewDashboardViewProps {
  profile: StaffProfile;
  isAdmin: boolean;
  schoolSettings: SchoolSettings;
  timetables: TimetableSlot[];
  timetableArchives: TimetableArchive[];
  patrolLogs: PatrolLog[];
  incidents: IncidentReport[];
  allowedAccounts: AllowedAccount[];
  staffList: StaffProfile[];
  onNavigate: (section: NavSection) => void;
  onJumpToBuildingLive: (building: string, targetDate?: string) => void;
}

function getLiveBellStatus(now: Date): { label: string; isClassTime: boolean } {
  const day = now.getDay();
  if (day === 0 || day === 6) {
    return { label: '週末非上課日', isClassTime: false };
  }
  const minutes = now.getHours() * 60 + now.getMinutes();
  for (const slot of PERIOD_SCHEDULE) {
    const [sh, sm] = slot.start.split(':').map(Number);
    const [eh, em] = slot.end.split(':').map(Number);
    if (minutes >= sh * 60 + sm && minutes <= eh * 60 + em) {
      return {
        label: `目前上課中 · ${slot.label}（${slot.start}–${slot.end}）`,
        isClassTime: true,
      };
    }
  }
  if (minutes < 8 * 60 + 30) return { label: '晨間準備時段（尚未進入第 1 節）', isClassTime: false };
  if (minutes > 16 * 60 + 50) return { label: '今日課程已結束（放學時段）', isClassTime: false };
  return { label: '下課／午休轉堂時段', isClassTime: false };
}

export const OverviewDashboardView: React.FC<OverviewDashboardViewProps> = ({
  profile,
  isAdmin,
  schoolSettings,
  timetables,
  timetableArchives,
  patrolLogs,
  incidents,
  allowedAccounts,
  staffList,
  onNavigate,
  onJumpToBuildingLive,
}) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayStr = getTodayDateString();
  const todayWeekdayLabel = getDayOfWeekLabel(todayStr);
  const todayIsWeekend = isWeekendDate(todayStr);
  const latestSchoolDate = getLatestSchoolDateString(todayStr);
  const liveBell = getLiveBellStatus(now);
  const timeText = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Use the week containing today (or latest school week if weekend)
  const weekRange = useMemo(() => getWeekDateRange(latestSchoolDate), [latestSchoolDate]);

  const distinctClasses = useMemo(() => {
    const set = new Set<string>();
    timetables.forEach((t) => {
      if (t.className) set.add(t.className);
    });
    return Array.from(set);
  }, [timetables]);

  const weeklyLogs = useMemo(
    () => patrolLogs.filter((l) => l.date >= weekRange.monday && l.date <= weekRange.friday),
    [patrolLogs, weekRange]
  );

  const todayLogs = useMemo(
    () => patrolLogs.filter((l) => l.date === todayStr),
    [patrolLogs, todayStr]
  );

  const metrics = useMemo(() => {
    const patrolledClassSet = new Set(weeklyLogs.map((l) => l.className));
    const totalClassCount = distinctClasses.length;
    const patrolledClassCount = patrolledClassSet.size;
    const weeklyClassCoveragePct =
      totalClassCount > 0 ? Math.min(100, Math.round((patrolledClassCount / totalClassCount) * 100)) : 0;

    const normalLogs = weeklyLogs.filter(
      (l) => l.status === 'normal' || l.status === 'empty_relocated'
    ).length;
    const issueLogs = weeklyLogs.filter(
      (l) => l.status === 'minor_issue' || l.status === 'urgent_issue'
    ).length;
    const weeklyNormalRate =
      weeklyLogs.length > 0 ? Math.round((normalLogs / weeklyLogs.length) * 1000) / 10 : 100;

    const activeIncidents = incidents.filter((i) => i.status !== 'resolved');
    const highActiveCount = activeIncidents.filter((i) => i.severity === 'high').length;
    const overdueCount = activeIncidents.filter((i) => isIncidentOverdueEscalation(i)).length;

    const myWeeklyLogsCount = weeklyLogs.filter((l) => l.inspectorId === profile.uid).length;
    const myActiveIncidentsCount = activeIncidents.filter(
      (i) => i.reporterId === profile.uid || i.handlerId === profile.uid
    ).length;

    const activeAccountsCount = allowedAccounts.filter((a) => a.status === 'active').length;
    const disabledAccountsCount = allowedAccounts.filter((a) => a.status === 'disabled').length;

    return {
      totalClassCount,
      patrolledClassCount,
      weeklyClassCoveragePct,
      weeklyTotalLogs: weeklyLogs.length,
      todayTotalLogs: todayLogs.length,
      weeklyNormalRate,
      issueLogs,
      activeIncidentCount: activeIncidents.length,
      highActiveCount,
      overdueCount,
      myWeeklyLogsCount,
      myActiveIncidentsCount,
      activeAccountsCount,
      disabledAccountsCount,
    };
  }, [
    weeklyLogs,
    todayLogs,
    distinctClasses,
    incidents,
    profile.uid,
    allowedAccounts,
  ]);

  // Weekly 5-day (Mon–Fri) trend chart data
  const weeklyTrendData = useMemo(() => {
    return weekRange.dates.map((dateStr, idx) => {
      const dow = idx + 1;
      const dayLogs = weeklyLogs.filter((l) => l.date === dateStr);
      const normalCount = dayLogs.filter(
        (l) => l.status === 'normal' || l.status === 'empty_relocated'
      ).length;
      const issueCount = dayLogs.filter(
        (l) => l.status === 'minor_issue' || l.status === 'urgent_issue'
      ).length;
      const dayIncidents = incidents.filter((i) => i.date === dateStr).length;
      const shortDate = dateStr.slice(5).replace('-', '/');
      return {
        name: `週${DAY_OF_WEEK_SHORT[dow]} ${shortDate}`,
        教學正常: normalCount,
        待改善異常: issueCount,
        異常通報: dayIncidents,
      };
    });
  }, [weekRange, weeklyLogs, incidents]);

  // Building-level progress for this week
  const buildingSummary = useMemo(() => {
    const names = [...schoolSettings.buildings];
    timetables.forEach((t) => {
      if (t.building && !names.includes(t.building)) {
        names.push(t.building);
      }
    });

    return names.map((building) => {
      const classesInBuilding = new Set(
        timetables.filter((t) => t.building === building).map((t) => t.className)
      );
      const logsInBuilding = weeklyLogs.filter((l) => l.building === building);
      const patrolledClasses = new Set(logsInBuilding.map((l) => l.className));
      const issueCount = logsInBuilding.filter(
        (l) => l.status === 'minor_issue' || l.status === 'urgent_issue'
      ).length;
      const openIncidents = incidents.filter(
        (i) => i.status !== 'resolved' && i.location.includes(building)
      ).length;
      const totalClasses = classesInBuilding.size;
      const pct =
        totalClasses > 0 ? Math.min(100, Math.round((patrolledClasses.size / totalClasses) * 100)) : 0;

      return {
        building,
        totalClasses,
        patrolledClasses: patrolledClasses.size,
        logCount: logsInBuilding.length,
        issueCount,
        openIncidents,
        pct,
      };
    });
  }, [schoolSettings.buildings, timetables, weeklyLogs, incidents]);

  const recentLogs = useMemo(() => {
    return [...patrolLogs]
      .sort((a, b) => {
        const tA = a.updatedAt?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const tB = b.updatedAt?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        if (tB !== tA) return tB - tA;
        return b.date.localeCompare(a.date) || b.period - a.period;
      })
      .slice(0, 6);
  }, [patrolLogs]);

  const priorityIncidents = useMemo(() => {
    const rank = { high: 0, medium: 1, low: 2 };
    return incidents
      .filter((i) => i.status !== 'resolved')
      .sort((a, b) => rank[a.severity] - rank[b.severity])
      .slice(0, 5);
  }, [incidents]);

  const hasCurrentTermArchive = useMemo(
    () =>
      timetableArchives.some(
        (a) =>
          a.academicYear === schoolSettings.academicYear && a.semester === schoolSettings.semester
      ),
    [timetableArchives, schoolSettings]
  );

  return (
    <div className="space-y-6">
      {/* Live Status Hero Banner */}
      <section className="bg-white border border-[#E5E1D8] rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E5F2EE] text-[#1E5C4B] font-semibold">
              <CalendarDays className="w-3.5 h-3.5" />
              {schoolSettings.academicYear} 學年度{schoolSettings.semester} · 第{' '}
              {schoolSettings.currentWeek} 週
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF9F5] border border-[#E5E1D8] text-[#5C615C] font-mono-num">
              <Clock className="w-3.5 h-3.5 text-[#1E5C4B]" />
              {todayStr}（{todayWeekdayLabel}）{timeText}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full font-semibold ${
                liveBell.isClassTime
                  ? 'bg-[#EBF4E8] text-[#2E6B32]'
                  : 'bg-[#FBF0E2] text-[#9A5B13]'
              }`}
            >
              {liveBell.label}
            </span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-[#1F2421]">
            {schoolSettings.schoolName} · 巡堂系統總覽儀表
          </h1>
          <p className="text-sm text-[#5C615C]">
            歡迎回來，{profile.displayName}（{profile.department} ·{' '}
            {isAdmin ? '管理者視角' : '巡堂人員視角'}）。本週統計區間：
            <span className="font-mono-num font-medium text-[#1F2421]">
              {weekRange.monday} ～ {weekRange.friday}
            </span>
            。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {todayIsWeekend && (
            <button
              type="button"
              onClick={() => onJumpToBuildingLive('ALL', latestSchoolDate)}
              className="min-h-[42px] px-4 py-2 bg-[#FBF0E2] hover:bg-[#F5E3CC] text-[#9A5B13] border border-[#EBD5B8] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              檢視最近上課日（{latestSchoolDate}）
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate('patrol')}
            className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4" />
            開始行動巡堂
          </button>
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="min-h-[42px] px-4 py-2 bg-white hover:bg-[#FAF9F5] border border-[#DDD8CD] text-[#3A3F3B] text-sm font-medium rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            即時巡堂
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* 4 Core KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* KPI 1: Weekly Coverage */}
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">本週班級巡堂涵蓋率</span>
            <span className="w-8 h-8 rounded-lg bg-[#E5F2EE] text-[#1E5C4B] flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
              {metrics.weeklyClassCoveragePct}%
            </span>
            <span className="text-xs text-[#5C615C] font-mono-num">
              {metrics.patrolledClassCount} / {metrics.totalClassCount} 班
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#F2EFE9] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1E5C4B] rounded-full transition-all duration-300"
              style={{ width: `${metrics.weeklyClassCoveragePct}%` }}
            />
          </div>
          <p className="text-xs text-[#7C7A72]">
            本週累計 <span className="font-mono-num font-semibold text-[#1F2421]">{metrics.weeklyTotalLogs}</span> 筆（今日{' '}
            <span className="font-mono-num font-semibold text-[#1E5C4B]">{metrics.todayTotalLogs}</span> 筆）
          </p>
        </div>

        {/* KPI 2: Weekly Teaching Quality */}
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">本週教學正常率</span>
            <span className="w-8 h-8 rounded-lg bg-[#EBF4E8] text-[#2E6B32] flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
              {metrics.weeklyNormalRate}%
            </span>
            <span className="text-xs font-semibold text-[#2E6B32]">正常／移地</span>
          </div>
          <p className="text-xs text-[#7C7A72] pt-2">
            本週待改善或異常紀錄：
            <span
              className={`font-mono-num font-semibold ml-1 ${
                metrics.issueLogs > 0 ? 'text-[#B8432E]' : 'text-[#1E5C4B]'
              }`}
            >
              {metrics.issueLogs} 筆
            </span>
          </p>
        </div>

        {/* KPI 3: Unresolved Incidents */}
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">待處理異常通報</span>
            <span className="w-8 h-8 rounded-lg bg-[#FCEBE7] text-[#B8432E] flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono-num ${
                metrics.activeIncidentCount > 0 ? 'text-[#B8432E]' : 'text-[#1F2421]'
              }`}
            >
              {metrics.activeIncidentCount}
            </span>
            <span className="text-xs text-[#7C7A72]">
              緊急 <span className="font-mono-num font-semibold text-[#B8432E]">{metrics.highActiveCount}</span> 件
              {metrics.overdueCount > 0 && (
                <span className="ml-1.5 text-[#B44326] font-semibold">
                  · 逾時 {metrics.overdueCount}
                </span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 pt-1 cursor-pointer"
          >
            前往異常通報處理
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* KPI 4: Role-Aware Card (Admin System Readiness vs User Personal Contribution) */}
        {isAdmin ? (
          <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#7C7A72]">
              <span className="font-semibold">系統資料與授權現況</span>
              <span className="w-8 h-8 rounded-lg bg-[#EEEAF8] text-[#4D358A] flex items-center justify-center">
                <Users className="w-4 h-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
                {metrics.activeAccountsCount || staffList.length}
              </span>
              <span className="text-xs text-[#5C615C]">
                位使用中帳號 · <span className="font-mono-num font-semibold">{timetables.length}</span> 節課表
              </span>
            </div>
            <p className="text-xs text-[#7C7A72] pt-2">
              歷史歸檔 <span className="font-mono-num font-semibold text-[#1F2421]">{timetableArchives.length}</span> 份
              {metrics.disabledAccountsCount > 0 && (
                <span> · 已停用 {metrics.disabledAccountsCount} 帳號</span>
              )}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#7C7A72]">
              <span className="font-semibold">我的本週巡堂紀錄</span>
              <span className="w-8 h-8 rounded-lg bg-[#EEEAF8] text-[#4D358A] flex items-center justify-center">
                <ClipboardCheck className="w-4 h-4" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
                {metrics.myWeeklyLogsCount}
              </span>
              <span className="text-xs text-[#5C615C]">筆本週已完成</span>
            </div>
            <p className="text-xs text-[#7C7A72] pt-2">
              相關待追蹤異常：
              <span className="font-mono-num font-semibold text-[#1F2421] ml-1">
                {metrics.myActiveIncidentsCount} 件
              </span>
            </p>
          </div>
        )}
      </section>

      {/* Middle Analytics: Weekly Trend Chart + Building Breakdown */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Weekly 5-Day Patrol & Incident Trend */}
        <div className="xl:col-span-7 bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#1F2421]">本週每日巡堂與異常趨勢</h2>
              <p className="text-xs text-[#7C7A72] mt-0.5 font-mono-num">
                {weekRange.monday}（週一）至 {weekRange.friday}（週五）
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 cursor-pointer"
            >
              匯出本週報表
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weeklyTrendData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE5DC" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#5C615C' }}
                  axisLine={{ stroke: '#DDD8CD' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#7C7A72' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #E5E1D8',
                    borderRadius: '10px',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                <Bar dataKey="教學正常" fill="#1E5C4B" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="待改善異常" fill="#C98A2E" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Line
                  type="monotone"
                  dataKey="異常通報"
                  stroke="#B8432E"
                  strokeWidth={2}
                  dot={{ r: 3.5, fill: '#B8432E' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Building-by-Building Progress */}
        <div className="xl:col-span-5 bg-white border border-[#E5E1D8] rounded-2xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#1F2421]">各樓棟本週巡堂現況</h2>
                <p className="text-xs text-[#7C7A72] mt-0.5">點擊樓棟可檢視該區即時巡堂狀態</p>
              </div>
              <Building2 className="w-4 h-4 text-[#9A968C]" />
            </div>

            {buildingSummary.length === 0 ? (
              <div className="p-6 text-center text-sm text-[#7C7A72] border border-dashed border-[#DDD8CD] rounded-xl">
                尚未設定校內樓棟清單
              </div>
            ) : (
              <div className="space-y-3">
                {buildingSummary.map((item) => (
                  <button
                    key={item.building}
                    type="button"
                    onClick={() => onJumpToBuildingLive(item.building, latestSchoolDate)}
                    className="w-full text-left p-3.5 rounded-xl bg-[#FAF9F5] hover:bg-[#F2EFE9] border border-[#EAE5DC] transition-colors space-y-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-[#1F2421]">{item.building}</span>
                      <span className="font-mono-num text-[#5C615C]">
                        已巡 {item.patrolledClasses}/{item.totalClasses} 班（{item.pct}%）
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-[#E5E1D8] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#1E5C4B] rounded-full transition-all duration-300"
                        style={{ width: `${item.pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[#7C7A72]">
                      <span>本週巡堂 {item.logCount} 筆</span>
                      <span
                        className={
                          item.issueCount > 0 || item.openIncidents > 0
                            ? 'text-[#B8432E] font-semibold'
                            : 'text-[#1E5C4B]'
                        }
                      >
                        {item.openIncidents > 0
                          ? `未結案異常 ${item.openIncidents} 件`
                          : item.issueCount > 0
                            ? `待改善紀錄 ${item.issueCount} 筆`
                            : '巡堂狀況良好'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Bottom Split: Recent Patrol Activity + Priority Incidents & Admin Readiness */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Recent Patrol Feed */}
        <div className="xl:col-span-7 bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#1F2421]">最新巡堂動態</h2>
              <p className="text-xs text-[#7C7A72] mt-0.5">最近登錄的 6 筆巡堂檢核紀錄</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('patrol')}
              className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 cursor-pointer"
            >
              前往行動巡堂
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentLogs.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <ClipboardCheck className="w-7 h-7 text-[#9A968C] mx-auto" />
              <p className="text-sm font-medium text-[#1F2421]">尚無巡堂紀錄</p>
              <p className="text-xs text-[#7C7A72]">開始巡堂後，最新檢核動態將即時顯示於此</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0ECE3]">
              {recentLogs.map((log) => {
                const statusBadge =
                  log.status === 'urgent_issue'
                    ? 'bg-[#FCEBE7] text-[#B44326]'
                    : log.status === 'minor_issue'
                      ? 'bg-[#FBF0E2] text-[#9A5B13]'
                      : log.status === 'empty_relocated'
                        ? 'bg-[#E7F0F8] text-[#245A84]'
                        : 'bg-[#E5F2EE] text-[#1E5C4B]';

                return (
                  <div
                    key={log.id}
                    className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#1F2421]">
                        <span>{log.className}</span>
                        <span className="text-[#D4CEC2] font-normal">·</span>
                        <span className="font-medium text-[#3A3F3B]">{log.subject}</span>
                        <span className="text-xs font-normal text-[#7C7A72]">
                          （{log.teacherName}）
                        </span>
                      </div>
                      <p className="text-xs text-[#7C7A72] font-mono-num">
                        {log.date}（{getDayOfWeekLabel(log.date)}）第 {log.period} 節 ·{' '}
                        {log.building} {log.roomNumber} · 巡堂：{log.inspectorName}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold shrink-0 self-start sm:self-center ${statusBadge}`}
                    >
                      {PATROL_STATUS_LABELS[log.status]}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Priority Incidents + Admin System Health + Quick Links */}
        <div className="xl:col-span-5 space-y-6">
          {/* Priority Unresolved Incidents */}
          <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#1F2421]">待處理異常摘要</h2>
                <p className="text-xs text-[#7C7A72] mt-0.5">依嚴重度排序，優先掌握待處置案件</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('incidents')}
                className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 cursor-pointer"
              >
                全部通報
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {priorityIncidents.length === 0 ? (
              <div className="p-6 text-center space-y-1.5">
                <CheckCircle2 className="w-6 h-6 text-[#1E5C4B] mx-auto" />
                <p className="text-sm font-medium text-[#1F2421]">目前無未結案異常事件</p>
              </div>
            ) : (
              <div className="divide-y divide-[#F0ECE3]">
                {priorityIncidents.map((inc) => {
                  const overdue = isIncidentOverdueEscalation(inc);
                  const elapsed = getIncidentElapsedMinutes(inc);
                  return (
                    <button
                      key={inc.id}
                      type="button"
                      onClick={() => onNavigate('incidents')}
                      className="w-full px-5 py-3.5 text-left hover:bg-[#FAF9F5] transition-colors space-y-1 cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span
                          className={`font-semibold inline-flex items-center gap-1 ${
                            inc.severity === 'high'
                              ? 'text-[#B44326]'
                              : inc.severity === 'medium'
                                ? 'text-[#9A5B13]'
                                : 'text-[#5C615C]'
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {INCIDENT_SEVERITY_LABELS[inc.severity]} ·{' '}
                          {INCIDENT_CATEGORY_LABELS[inc.category]}
                        </span>
                        <span className="text-[#7C7A72] font-mono-num">
                          {INCIDENT_STATUS_LABELS[inc.status]}
                          {elapsed > 0 ? ` · ${elapsed}分前` : ''}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[#1F2421] line-clamp-1">
                        {inc.title}
                      </p>
                      <div className="flex items-center justify-between text-xs text-[#7C7A72]">
                        <span>{inc.location}</span>
                        {overdue && (
                          <span className="text-[#B44326] font-semibold">逾時未接手</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Admin System Health Checklist OR Quick Reference Links */}
          {isAdmin && (
            <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
              <h2 className="text-sm font-bold text-[#1F2421]">管理者系統整備檢查</h2>
              <div className="space-y-2 text-xs">
                <button
                  type="button"
                  onClick={() => onNavigate('timetable')}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#FAF9F5] hover:bg-[#F2EFE9] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2 text-[#3A3F3B] font-medium">
                    <BookOpen className="w-4 h-4 text-[#245A84]" />
                    班級課表建置
                  </span>
                  <span
                    className={`font-semibold font-mono-num ${
                      timetables.length > 0 ? 'text-[#1E5C4B]' : 'text-[#B8432E]'
                    }`}
                  >
                    {timetables.length > 0
                      ? `${metrics.totalClassCount} 班 / ${timetables.length} 節`
                      : '尚未建置'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('basic_data')}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#FAF9F5] hover:bg-[#F2EFE9] cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2 text-[#3A3F3B] font-medium">
                    <Archive className="w-4 h-4 text-[#9A5B13]" />
                    本學期課表歸檔備份
                  </span>
                  <span
                    className={`font-semibold ${
                      hasCurrentTermArchive ? 'text-[#1E5C4B]' : 'text-[#9A5B13]'
                    }`}
                  >
                    {hasCurrentTermArchive ? '已歸檔' : '尚未建立快照'}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Quick Documentation & Report Shortcuts */}
          <div className="grid grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="bg-white hover:bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl p-3 text-center space-y-1.5 transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4 text-[#354488] mx-auto" />
              <p className="text-xs font-semibold text-[#1F2421]">報表匯出</p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('manual')}
              className="bg-white hover:bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl p-3 text-center space-y-1.5 transition-colors cursor-pointer"
            >
              <HelpCircle className="w-4 h-4 text-[#1E5C4B] mx-auto" />
              <p className="text-xs font-semibold text-[#1F2421]">操作手冊</p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('changelog')}
              className="bg-white hover:bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl p-3 text-center space-y-1.5 transition-colors cursor-pointer"
            >
              <History className="w-4 h-4 text-[#5C615C] mx-auto" />
              <p className="text-xs font-semibold text-[#1F2421]">日誌 {CURRENT_APP_VERSION}</p>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};
