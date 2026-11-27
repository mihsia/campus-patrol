import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Database,
  MapPin,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
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
  AbsenceRecord,
  IncidentReport,
  LeaveRecord,
  NavSection,
  PatrolLog,
  TimetableSlot,
} from '../types/patrol';
import {
  DAY_OF_WEEK_LABELS,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  PATROL_STATUS_LABELS,
  PERIOD_SCHEDULE,
  getDayOfWeekFromDate,
} from '../types/patrol';
import { computeClassAttendanceStats } from '../lib/truancyEngine';
import { getIncidentElapsedMinutes, isIncidentOverdueEscalation } from '../lib/notifications';

interface DashboardViewProps {
  selectedDate: string;
  selectedPeriod: number;
  selectedBuilding: string;
  onChangeDate: (date: string) => void;
  onChangePeriod: (period: number) => void;
  onChangeBuilding: (building: string) => void;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  absences: AbsenceRecord[];
  leaveRecords: LeaveRecord[];
  incidents: IncidentReport[];
  onOpenQuickPatrol: (slot: TimetableSlot) => void;
  onNavigate: (section: NavSection) => void;
  onSeedDemoData: () => Promise<void>;
  seeding: boolean;
  isAdmin: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  selectedDate,
  selectedPeriod,
  selectedBuilding,
  onChangeDate,
  onChangePeriod,
  onChangeBuilding,
  timetables,
  patrolLogs,
  absences,
  leaveRecords,
  incidents,
  onOpenQuickPatrol,
  onNavigate,
  onSeedDemoData,
  seeding,
  isAdmin,
}) => {
  const dayOfWeek = getDayOfWeekFromDate(selectedDate);

  const buildings = useMemo(() => {
    const set = new Set<string>();
    timetables.forEach((t) => set.add(t.building));
    return ['ALL', ...Array.from(set).sort()];
  }, [timetables]);

  const periodSlots = useMemo(() => {
    return timetables
      .filter((t) => t.dayOfWeek === dayOfWeek && t.period === selectedPeriod)
      .filter((t) => selectedBuilding === 'ALL' || t.building === selectedBuilding)
      .sort((a, b) => a.building.localeCompare(b.building) || a.roomNumber.localeCompare(b.roomNumber));
  }, [timetables, dayOfWeek, selectedPeriod, selectedBuilding]);

  const todayLogs = useMemo(
    () => patrolLogs.filter((l) => l.date === selectedDate),
    [patrolLogs, selectedDate]
  );

  const periodLogs = useMemo(
    () => todayLogs.filter((l) => l.period === selectedPeriod),
    [todayLogs, selectedPeriod]
  );

  const todayAbsences = useMemo(
    () => absences.filter((a) => a.date === selectedDate),
    [absences, selectedDate]
  );

  const periodAbsences = useMemo(
    () => todayAbsences.filter((a) => a.period === selectedPeriod),
    [todayAbsences, selectedPeriod]
  );

  const classStats = useMemo(
    () =>
      computeClassAttendanceStats({
        periodSlots,
        periodPatrolLogs: periodLogs,
        periodAbsences,
        leaveRecords,
        date: selectedDate,
        period: selectedPeriod,
      }),
    [periodSlots, periodLogs, periodAbsences, leaveRecords, selectedDate, selectedPeriod]
  );

  // KPI Metrics
  const kpis = useMemo(() => {
    const totalClasses = classStats.length;
    const patrolledCount = classStats.filter((c) => c.patrolled).length;
    const coveragePct = totalClasses > 0 ? Math.round((patrolledCount / totalClasses) * 100) : 0;

    const normalOrRelocated = classStats.filter(
      (c) => c.patrolStatus === 'normal' || c.patrolStatus === 'empty_relocated'
    ).length;
    const normalRate =
      patrolledCount > 0 ? Math.round((normalOrRelocated / patrolledCount) * 1000) / 10 : 100;

    const activeIncidents = incidents.filter((i) => i.status !== 'resolved');
    const highActiveCount = activeIncidents.filter((i) => i.severity === 'high').length;

    const todayTruantCount = todayAbsences.filter((a) => a.autoStatus === 'truant').length;
    const todayExcusedCount = todayAbsences.filter((a) => a.autoStatus === 'excused_leave').length;

    return {
      totalClasses,
      patrolledCount,
      coveragePct,
      normalRate,
      activeIncidentCount: activeIncidents.length,
      highActiveCount,
      todayAbsenceTotal: todayAbsences.length,
      todayTruantCount,
      todayExcusedCount,
    };
  }, [classStats, incidents, todayAbsences]);

  // Dynamic Chart 2: Period-by-period trend across Periods 1-8 for selectedDate
  const periodTrendData = useMemo(() => {
    return PERIOD_SCHEDULE.map((p) => {
      const slotsCount = timetables.filter(
        (t) =>
          t.dayOfWeek === dayOfWeek &&
          t.period === p.period &&
          (selectedBuilding === 'ALL' || t.building === selectedBuilding)
      ).length;
      const logsForP = todayLogs.filter(
        (l) =>
          l.period === p.period &&
          (selectedBuilding === 'ALL' || l.building === selectedBuilding)
      );
      const uniquePatrolled = new Set(logsForP.map((l) => l.timetableId)).size;
      const issueCount = logsForP.filter(
        (l) => l.status === 'minor_issue' || l.status === 'urgent_issue'
      ).length;
      const absCount = todayAbsences.filter(
        (a) => a.period === p.period && a.autoStatus !== 'excused_leave'
      ).length;

      return {
        name: `第${p.period}節`,
        已巡班數: uniquePatrolled,
        應巡班數: slotsCount,
        巡堂異常: issueCount,
        缺曠人次: absCount,
      };
    });
  }, [timetables, dayOfWeek, selectedBuilding, todayLogs, todayAbsences]);

  const activeIncidentsList = useMemo(() => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return incidents
      .filter((i) => i.status !== 'resolved')
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 6);
  }, [incidents]);

  const slotMap = useMemo(() => {
    const m = new Map<string, TimetableSlot>();
    periodSlots.forEach((s) => m.set(s.id, s));
    return m;
  }, [periodSlots]);

  // Empty initial workspace prompt
  if (timetables.length === 0) {
    return (
      <div className="bg-white border border-[#E5E1D8] rounded-xl p-6 sm:p-10 max-w-3xl mx-auto mt-4 space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#1E5C4B]">初次啟用設定</p>
          <h2 className="text-xl sm:text-2xl font-bold text-[#1F2421]">
            尚未匯入學校課表資料庫
          </h2>
          <p className="text-sm text-[#5C615C] leading-relaxed">
            校園即時巡堂系統需先連結學校課表，方能自動對應各節次教室、任課教師與應到人數，並啟動缺曠課自動判別演算法。您可以立即匯入內建的完整範例課表與今日巡堂情境，或上傳貴校的 CSV 課表檔案。
          </p>
        </div>

        {isAdmin ? (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onSeedDemoData}
              disabled={seeding}
              className="min-h-[44px] px-5 py-2.5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Database className="w-4 h-4" />
              {seeding ? '正在建立範例課表與巡堂資料...' : '一鍵匯入範例全校課表與今日巡堂情境'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('timetable')}
              className="min-h-[44px] px-5 py-2.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-sm font-medium rounded-xl transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              前往手動匯入 CSV 課表
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#9A5B13] bg-[#FBF0E2] border border-[#EBD5B8] rounded-xl px-4 py-3">
            全校課表資料庫由「管理者」統一匯入維護，請聯繫系統管理者建立課表後即可開始巡堂作業。
          </p>
        )}
      </div>
    );
  }

  const currentPeriodBell = PERIOD_SCHEDULE.find((p) => p.period === selectedPeriod);

  return (
    <div className="space-y-6">
      {/* Filter & Time Context Bar */}
      <section className="bg-white border border-[#E5E1D8] rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[#3A3F3B]">
              <span className="text-xs font-medium text-[#7C7A72] whitespace-nowrap">巡堂日期</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => onChangeDate(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-sm font-mono-num bg-[#FAF9F5] border border-[#E5E1D8] rounded-lg text-[#1F2421] focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
              />
            </label>
            <div className="text-xs text-[#7C7A72] flex items-center gap-2">
              <span className="font-semibold text-[#1F2421]">{DAY_OF_WEEK_LABELS[dayOfWeek]}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">
                {currentPeriodBell?.label}（{currentPeriodBell?.start}–{currentPeriodBell?.end}）
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl">
              {buildings.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => onChangeBuilding(b)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedBuilding === b
                      ? 'bg-[#1E5C4B] text-white shadow-xs'
                      : 'text-[#5C615C] hover:text-[#1F2421]'
                  }`}
                >
                  {b === 'ALL' ? '全校樓棟' : b}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Period Segmented Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {PERIOD_SCHEDULE.map((p) => {
            const active = p.period === selectedPeriod;
            return (
              <button
                key={p.period}
                type="button"
                onClick={() => onChangePeriod(p.period)}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                  active
                    ? 'bg-[#1E5C4B] text-white border-[#1E5C4B]'
                    : 'bg-[#FAF9F5] text-[#5C615C] border-[#E5E1D8] hover:bg-[#F2EFE9] hover:text-[#1F2421]'
                }`}
              >
                <span className="font-mono-num">{p.label}</span>
                <span className={`ml-1.5 font-mono-num ${active ? 'text-[#C6E2D8]' : 'text-[#9A968C]'}`}>
                  {p.start}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4-Column KPI Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">本節巡堂進度</span>
            <span className="w-8 h-8 rounded-lg bg-[#E5F2EE] text-[#1E5C4B] flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
              {kpis.patrolledCount} / {kpis.totalClasses}
            </span>
            <span className="text-xs font-semibold text-[#1E5C4B] font-mono-num">
              {kpis.coveragePct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#F2EFE9] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#1E5C4B] rounded-full transition-all duration-300"
              style={{ width: `${kpis.coveragePct}%` }}
            />
          </div>
          <p className="text-xs text-[#7C7A72]">
            尚有 <span className="font-mono-num font-semibold text-[#1F2421]">{Math.max(0, kpis.totalClasses - kpis.patrolledCount)}</span> 個班級待巡查
          </p>
        </div>

        <div className="bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">本節課堂正常率</span>
            <span className="w-8 h-8 rounded-lg bg-[#EBF4E8] text-[#2E6B32] flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
              {kpis.normalRate}%
            </span>
            <span className="text-xs text-[#2E6B32] font-semibold">正常／移地</span>
          </div>
          <p className="text-xs text-[#7C7A72] pt-2">
            依據本節已巡查 <span className="font-mono-num font-semibold text-[#1F2421]">{kpis.patrolledCount}</span> 間教室即時計算
          </p>
        </div>

        <div className="bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">待處理異常事件</span>
            <span className="w-8 h-8 rounded-lg bg-[#FCEBE7] text-[#B8432E] flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold font-mono-num ${kpis.activeIncidentCount > 0 ? 'text-[#B8432E]' : 'text-[#1F2421]'}`}>
              {kpis.activeIncidentCount}
            </span>
            <span className="text-xs text-[#7C7A72]">
              含緊急 <span className="font-mono-num font-semibold text-[#B8432E]">{kpis.highActiveCount}</span> 件
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 pt-1 cursor-pointer"
          >
            前往異常通報中心處理
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">今日累計缺曠人次</span>
            <span className="w-8 h-8 rounded-lg bg-[#FBF0E2] text-[#9A5B13] flex items-center justify-center">
              <Users className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
              {kpis.todayAbsenceTotal}
            </span>
            <span className="text-xs text-[#7C7A72]">
              疑似曠課 <span className="font-mono-num font-semibold text-[#9A5B13]">{kpis.todayTruantCount}</span> · 已核假 <span className="font-mono-num font-semibold text-[#245A84]">{kpis.todayExcusedCount}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('timetable')}
            className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 pt-1 cursor-pointer"
          >
            檢視自動缺曠判別明細
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* Dynamic Real-Time Charts Row */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Chart 1: Per-Class Real-Time Attendance Stacked Bar Chart */}
        <div className="xl:col-span-7 bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#1F2421]">
                各班級出缺席即時動態統計
              </h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                {selectedDate} · {DAY_OF_WEEK_LABELS[dayOfWeek]} · {currentPeriodBell?.label}（同步課表與假單核銷狀態）
              </p>
            </div>
            <span className="text-xs text-[#7C7A72] font-mono-num">
              共 {classStats.length} 班
            </span>
          </div>

          {classStats.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-[#7C7A72] border border-dashed border-[#DDD8CD] rounded-lg">
              本節次於目前篩選樓棟無排定課程
            </div>
          ) : (
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={classStats.map((c) => ({
                    name: c.className,
                    實到人數: c.actualCount,
                    已核假: c.excusedCount,
                    遲到: c.lateCount,
                    疑似曠課: c.truantCount,
                  }))}
                  margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#EAE5DC" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 12, fill: '#5C615C' }}
                    axisLine={{ stroke: '#DDD8CD' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#7C7A72' }}
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
                  <Bar dataKey="實到人數" stackId="a" fill="#1E5C4B" radius={[0, 0, 0, 0]} maxBarSize={38} />
                  <Bar dataKey="已核假" stackId="a" fill="#2A6496" maxBarSize={38} />
                  <Bar dataKey="遲到" stackId="a" fill="#C98A2E" maxBarSize={38} />
                  <Bar dataKey="疑似曠課" stackId="a" fill="#B8432E" radius={[4, 4, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Chart 2: Period-by-Period Patrol Coverage & Absence Trend */}
        <div className="xl:col-span-5 bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-[#1F2421]">
              今日各節次巡堂與缺曠趨勢
            </h3>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              第 1 節至第 8 節已巡查班數、課堂異常與缺曠人次動態
            </p>
          </div>
          <div className="h-[290px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={periodTrendData} margin={{ top: 8, right: 10, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAE5DC" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#5C615C' }}
                  axisLine={{ stroke: '#DDD8CD' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#7C7A72' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
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
                <Bar dataKey="已巡班數" fill="#1E5C4B" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="巡堂異常" fill="#C98A2E" radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line
                  type="monotone"
                  dataKey="缺曠人次"
                  stroke="#B8432E"
                  strokeWidth={2}
                  dot={{ r: 3.5, fill: '#B8432E' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Bottom Split: Live Classroom Status Matrix + Unresolved Incidents Feed */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Live Classroom Matrix */}
        <div className="xl:col-span-7 bg-white border border-[#E5E1D8] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[#1F2421]">
                本節即時教室巡堂狀態
              </h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                點擊任一班級即可開啟快速巡堂登錄與點名缺曠作業
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('patrol')}
              className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1"
            >
              行動巡堂模式
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {classStats.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              此節次目前無排課資料
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {classStats.map((item) => {
                const slot = slotMap.get(item.timetableId);
                const statusColor =
                  item.patrolStatus === 'urgent_issue'
                    ? 'text-red-700'
                    : item.patrolStatus === 'minor_issue'
                      ? 'text-amber-700'
                      : item.patrolStatus === 'normal'
                        ? 'text-emerald-700'
                        : item.patrolStatus === 'empty_relocated'
                          ? 'text-blue-700'
                          : 'text-slate-400';

                const statusText =
                  item.patrolStatus === 'unpatrolled'
                    ? '尚未巡查'
                    : PATROL_STATUS_LABELS[item.patrolStatus];

                return (
                  <button
                    key={item.timetableId}
                    type="button"
                    onClick={() => slot && onOpenQuickPatrol(slot)}
                    className="w-full min-h-[60px] px-5 py-3.5 text-left hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <span>{item.className}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono-num text-slate-600 font-medium">{item.roomNumber}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-slate-700 font-medium truncate">{item.subject}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span>{item.building}</span>
                        <span aria-hidden="true">/</span>
                        <span>任課：{item.teacherName}</span>
                        {slot?.isRelocated && slot.locationNote && (
                          <>
                            <span aria-hidden="true">/</span>
                            <span className="text-blue-700 inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {slot.locationNote}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-5 shrink-0">
                      <div className="text-right">
                        <div className="text-xs font-mono-num text-slate-700 font-medium">
                          實到 {item.actualCount} / {item.expectedCount}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono-num">
                          {item.truantCount > 0 ? (
                            <span className="text-red-700 font-medium">曠課 {item.truantCount}</span>
                          ) : (
                            <span>無曠課</span>
                          )}
                          {item.excusedCount > 0 && ` · 核假 ${item.excusedCount}`}
                        </div>
                      </div>
                      <div className={`text-xs font-semibold flex items-center gap-1.5 min-w-[82px] justify-end ${statusColor}`}>
                        {item.patrolStatus === 'urgent_issue' && <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                        {item.patrolStatus === 'normal' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                        {item.patrolStatus === 'unpatrolled' && <Clock className="w-3.5 h-3.5 shrink-0" />}
                        <span>{statusText}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Abnormal Incidents List */}
        <div className="xl:col-span-5 bg-white border border-[#E5E1D8] rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-[#1F2421]">
                異常事件即時追蹤列表
              </h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                待處理與處理中之通報（依嚴重度優先排序）
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('incidents')}
              className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1"
            >
              全部通報
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {activeIncidentsList.length === 0 ? (
            <div className="p-8 text-center space-y-2 my-auto">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
              <p className="text-sm font-medium text-slate-900">目前無待處理異常事件</p>
              <p className="text-xs text-slate-500">所有通報事件均已結案歸檔</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeIncidentsList.map((inc) => {
                const overdue = isIncidentOverdueEscalation(inc);
                const elapsed = getIncidentElapsedMinutes(inc);
                const sevColor =
                  inc.severity === 'high'
                    ? 'text-red-700'
                    : inc.severity === 'medium'
                      ? 'text-amber-700'
                      : 'text-slate-600';

                return (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => onNavigate('incidents')}
                    className="w-full px-5 py-4 text-left hover:bg-slate-50 transition-colors space-y-1.5 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-semibold inline-flex items-center gap-1 ${sevColor}`}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {INCIDENT_SEVERITY_LABELS[inc.severity]}
                        <span className="text-slate-300 font-normal" aria-hidden="true">·</span>
                        <span className="text-slate-600 font-normal">
                          {INCIDENT_CATEGORY_LABELS[inc.category]}
                        </span>
                      </span>
                      <span className="text-slate-500 font-mono-num shrink-0">
                        {INCIDENT_STATUS_LABELS[inc.status]}
                        {elapsed > 0 ? ` · ${elapsed} 分前` : ' · 剛剛'}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-slate-900 line-clamp-1">
                      {inc.title}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>
                        {inc.location} · 通報人：{inc.reporterName}
                      </span>
                      {overdue && (
                        <span className="text-red-700 font-semibold">
                          逾時未接手・需升級提醒
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
