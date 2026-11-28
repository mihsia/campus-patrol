import React, { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Database,
  MapPin,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  IncidentReport,
  NavSection,
  PatrolLog,
  SchoolSettings,
  TimetableSlot,
} from '../types/patrol';
import {
  ALL_PATROL_CHECKLIST_ITEMS,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
  PATROL_CHECKLIST_LABELS,
  PATROL_ISSUE_ITEMS,
  PATROL_STATUS_LABELS,
  PERIOD_SCHEDULE,
  getCalendarDayOfWeek,
  getDayOfWeekLabel,
  getEffectiveChecklist,
  getLatestSchoolDateString,
  getTodayDateString,
  isWeekendDate,
} from '../types/patrol';
import { getIncidentElapsedMinutes, isIncidentOverdueEscalation } from '../lib/notifications';

interface DashboardViewProps {
  schoolSettings: SchoolSettings;
  selectedDate: string;
  selectedPeriod: number;
  selectedBuilding: string;
  onChangeDate: (date: string) => void;
  onChangePeriod: (period: number) => void;
  onChangeBuilding: (building: string) => void;
  timetables: TimetableSlot[];
  patrolLogs: PatrolLog[];
  incidents: IncidentReport[];
  onOpenQuickPatrol: (slot: TimetableSlot) => void;
  onNavigate: (section: NavSection) => void;
  onSeedDemoData: () => Promise<void>;
  seeding: boolean;
  isAdmin: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  schoolSettings,
  selectedDate,
  selectedPeriod,
  selectedBuilding,
  onChangeDate,
  onChangePeriod,
  onChangeBuilding,
  timetables,
  patrolLogs,
  incidents,
  onOpenQuickPatrol,
  onNavigate,
  onSeedDemoData,
  seeding,
  isAdmin,
}) => {
  const calendarDayOfWeek = getCalendarDayOfWeek(selectedDate);
  const selectedWeekdayLabel = getDayOfWeekLabel(selectedDate);
  const isWeekend = isWeekendDate(selectedDate);
  const todayStr = getTodayDateString();
  const latestSchoolDate = getLatestSchoolDateString(selectedDate);

  const buildings = useMemo(() => {
    const ordered = [...schoolSettings.buildings];
    timetables.forEach((t) => {
      if (t.building && !ordered.includes(t.building)) {
        ordered.push(t.building);
      }
    });
    return ['ALL', ...ordered];
  }, [schoolSettings.buildings, timetables]);

  const periodSlots = useMemo(() => {
    return timetables
      .filter((t) => t.dayOfWeek === calendarDayOfWeek && t.period === selectedPeriod)
      .filter((t) => selectedBuilding === 'ALL' || t.building === selectedBuilding)
      .sort(
        (a, b) =>
          a.building.localeCompare(b.building, 'zh-Hant') ||
          a.roomNumber.localeCompare(b.roomNumber)
      );
  }, [timetables, calendarDayOfWeek, selectedPeriod, selectedBuilding]);

  const todayLogs = useMemo(
    () =>
      patrolLogs.filter(
        (l) =>
          l.date === selectedDate &&
          (selectedBuilding === 'ALL' || l.building === selectedBuilding)
      ),
    [patrolLogs, selectedDate, selectedBuilding]
  );

  const periodLogsBySlot = useMemo(() => {
    const map = new Map<string, PatrolLog>();
    todayLogs
      .filter((l) => l.period === selectedPeriod)
      .forEach((log) => {
        const existing = map.get(log.timetableId);
        const t1 = log.updatedAt?.toMillis?.() ?? 0;
        const t2 = existing?.updatedAt?.toMillis?.() ?? 0;
        if (!existing || t1 >= t2) {
          map.set(log.timetableId, log);
        }
      });
    return map;
  }, [todayLogs, selectedPeriod]);

  // KPI Metrics (Focused 100% on Teaching Patrol Observations — No Student Attendance)
  const kpis = useMemo(() => {
    const totalClasses = periodSlots.length;
    const patrolledCount = periodSlots.filter((s) => periodLogsBySlot.has(s.id)).length;
    const coveragePct = totalClasses > 0 ? Math.round((patrolledCount / totalClasses) * 100) : 0;

    let normalOrRelocated = 0;
    periodSlots.forEach((s) => {
      const log = periodLogsBySlot.get(s.id);
      if (log && (log.status === 'normal' || log.status === 'empty_relocated')) {
        normalOrRelocated += 1;
      }
    });
    const normalRate =
      patrolledCount > 0 ? Math.round((normalOrRelocated / patrolledCount) * 1000) / 10 : 100;

    const activeIncidents = incidents.filter((i) => i.status !== 'resolved');
    const highActiveCount = activeIncidents.filter((i) => i.severity === 'high').length;

    const issueKeys = new Set(PATROL_ISSUE_ITEMS.map((i) => i.key));
    let todayIssueChecks = 0;
    let todayPositiveChecks = 0;
    todayLogs.forEach((log) => {
      const list = getEffectiveChecklist(log);
      list.forEach((k) => {
        if (issueKeys.has(k)) todayIssueChecks += 1;
        else todayPositiveChecks += 1;
      });
    });

    return {
      totalClasses,
      patrolledCount,
      coveragePct,
      normalRate,
      activeIncidentCount: activeIncidents.length,
      highActiveCount,
      todayTotalLogs: todayLogs.length,
      todayPositiveChecks,
      todayIssueChecks,
    };
  }, [periodSlots, periodLogsBySlot, incidents, todayLogs]);

  // Chart 1: Today's 8-Item Patrol Checklist Distribution
  const checklistChartData = useMemo(() => {
    const counts = new Map<string, number>();
    todayLogs.forEach((log) => {
      getEffectiveChecklist(log).forEach((key) => {
        counts.set(key, (counts.get(key) || 0) + 1);
      });
    });

    return ALL_PATROL_CHECKLIST_ITEMS.map((item) => ({
      name: item.label,
      次數: counts.get(item.key) || 0,
      group: item.group,
    }));
  }, [todayLogs]);

  // Chart 2: Period-by-period patrol progress & issue trend across Periods 1-8
  const periodTrendData = useMemo(() => {
    return PERIOD_SCHEDULE.map((p) => {
      const slotsCount = timetables.filter(
        (t) =>
          t.dayOfWeek === calendarDayOfWeek &&
          t.period === p.period &&
          (selectedBuilding === 'ALL' || t.building === selectedBuilding)
      ).length;
      const logsForP = todayLogs.filter((l) => l.period === p.period);
      const uniquePatrolled = new Set(logsForP.map((l) => l.timetableId)).size;
      const issueCount = logsForP.filter(
        (l) => l.status === 'minor_issue' || l.status === 'urgent_issue'
      ).length;

      return {
        name: `第${p.period}節`,
        應巡班數: slotsCount,
        已巡班數: uniquePatrolled,
        待改善異常: issueCount,
      };
    });
  }, [timetables, calendarDayOfWeek, selectedBuilding, todayLogs]);

  const activeIncidentsList = useMemo(() => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return incidents
      .filter((i) => i.status !== 'resolved')
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 6);
  }, [incidents]);

  // Empty initial workspace prompt
  if (timetables.length === 0) {
    return (
      <div className="bg-white border border-[#E5E1D8] rounded-2xl p-6 sm:p-10 max-w-3xl mx-auto mt-4 space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[#1E5C4B]">初次啟用設定</p>
          <h2 className="text-xl sm:text-2xl font-bold text-[#1F2421]">
            尚未建立 {schoolSettings.schoolName} 班級課表資料
          </h2>
          <p className="text-sm text-[#5C615C] leading-relaxed">
            請先於「基本資料」設定學校名稱與各棟樓名稱，並匯入班級課表，系統即可自動對應各節次班別、授課領域與教師姓名，開始巡堂勾選並產出 Word／PDF 巡堂紀錄表。
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
              {seeding ? '正在建立範例課表與巡堂資料...' : '一鍵匯入範例課表（一～六年級）與巡堂情境'}
            </button>
            <button
              type="button"
              onClick={() => onNavigate('basic_data')}
              className="min-h-[44px] px-5 py-2.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-sm font-medium rounded-xl transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              前往基本資料設定
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <p className="text-xs text-[#9A5B13] bg-[#FBF0E2] border border-[#EBD5B8] rounded-xl px-4 py-3">
            學校基本資料與班級課表由「管理者」統一維護，請聯繫系統管理者建立課表後即可開始巡堂作業。
          </p>
        )}
      </div>
    );
  }

  const currentPeriodBell = PERIOD_SCHEDULE.find((p) => p.period === selectedPeriod);

  return (
    <div className="space-y-6">
      {/* Filter & Time Context Bar */}
      <section className="bg-white border border-[#E5E1D8] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-[#3A3F3B]">
              <span className="text-xs font-medium text-[#7C7A72] whitespace-nowrap">巡堂日期</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => e.target.value && onChangeDate(e.target.value)}
                className="min-h-[40px] px-3 py-1.5 text-sm font-mono-num bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl text-[#1F2421] focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
              />
            </label>
            {selectedDate !== todayStr && (
              <button
                type="button"
                onClick={() => onChangeDate(todayStr)}
                className="min-h-[36px] px-3 py-1 text-xs font-semibold rounded-xl bg-[#E5F2EE] hover:bg-[#D5EAE3] text-[#1E5C4B] whitespace-nowrap cursor-pointer transition-colors"
              >
                回到今日
              </button>
            )}
            <div className="text-xs text-[#7C7A72] flex items-center gap-2">
              <span
                className={`font-semibold ${isWeekend ? 'text-[#9A5B13]' : 'text-[#1F2421]'}`}
              >
                {selectedWeekdayLabel}
              </span>
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
                className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
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

        {isWeekend && (
          <div className="bg-[#FDF4E6] border border-[#E9D1AE] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#8F5312]">
            <span>
              {selectedDate}（{selectedWeekdayLabel}）為週末非上課日，當日無表定排課。如需查閱平日巡堂狀況，請選擇週一至週五日期或切換至最近上課日。
            </span>
            <button
              type="button"
              onClick={() => onChangeDate(latestSchoolDate)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-[#9A5B13] hover:bg-[#7D490E] text-white font-semibold cursor-pointer transition-colors"
            >
              跳至最近上課日（{latestSchoolDate}）
            </button>
          </div>
        )}
      </section>

      {/* 4-Column KPI Summary Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
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
            尚有{' '}
            <span className="font-mono-num font-semibold text-[#1F2421]">
              {Math.max(0, kpis.totalClasses - kpis.patrolledCount)}
            </span>{' '}
            個班級待巡查
          </p>
        </div>

        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">本節教學正常率</span>
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
            依據本節已巡查{' '}
            <span className="font-mono-num font-semibold text-[#1F2421]">{kpis.patrolledCount}</span>{' '}
            個班級即時計算
          </p>
        </div>

        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">待處理異常事件</span>
            <span className="w-8 h-8 rounded-lg bg-[#FCEBE7] text-[#B8432E] flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-2xl font-bold font-mono-num ${
                kpis.activeIncidentCount > 0 ? 'text-[#B8432E]' : 'text-[#1F2421]'
              }`}
            >
              {kpis.activeIncidentCount}
            </span>
            <span className="text-xs text-[#7C7A72]">
              含緊急{' '}
              <span className="font-mono-num font-semibold text-[#B8432E]">
                {kpis.highActiveCount}
              </span>{' '}
              件
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

        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-[#7C7A72]">
            <span className="font-semibold">今日巡堂紀錄統計</span>
            <span className="w-8 h-8 rounded-lg bg-[#E9ECF7] text-[#354488] flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[#1F2421] font-mono-num">
              {kpis.todayTotalLogs}
            </span>
            <span className="text-xs text-[#7C7A72]">
              正常勾選{' '}
              <span className="font-mono-num font-semibold text-[#1E5C4B]">
                {kpis.todayPositiveChecks}
              </span>{' '}
              · 異常{' '}
              <span className="font-mono-num font-semibold text-[#B8432E]">
                {kpis.todayIssueChecks}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 pt-1 cursor-pointer"
          >
            匯出 Word／PDF 巡堂紀錄表
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </section>

      {/* Charts Row */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Chart 1: 8-Item Patrol Checklist Distribution */}
        <div className="xl:col-span-7 bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-[#1F2421]">今日巡堂 8 項檢核結果統計</h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                {selectedDate} · {selectedWeekdayLabel}（綠色為教學正常指標、紅橘色為待改善指標）
              </p>
            </div>
            <span className="text-xs text-[#7C7A72] font-mono-num">
              累計 {todayLogs.length} 筆巡堂
            </span>
          </div>

          {todayLogs.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-[#7C7A72] border border-dashed border-[#DDD8CD] rounded-xl">
              本日尚無巡堂紀錄，請至「行動巡堂作業」勾選紀錄
            </div>
          ) : (
            <div className="h-[290px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={checklistChartData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#EAE5DC" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#7C7A72' }}
                    axisLine={{ stroke: '#DDD8CD' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={148}
                    tick={{ fontSize: 11, fill: '#3A3F3B' }}
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
                  <Bar dataKey="次數" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {checklistChartData.map((entry, idx) => (
                      <Cell
                        key={`cell-${idx}`}
                        fill={entry.group === 'positive' ? '#1E5C4B' : '#B8432E'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Chart 2: Period-by-Period Patrol Coverage & Issues */}
        <div className="xl:col-span-5 bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-4">
          <div>
            <h3 className="text-base font-bold text-[#1F2421]">今日各節次巡堂進度與異常趨勢</h3>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              第 1 節至第 8 節應巡班數、已完成巡堂與待改善情形
            </p>
          </div>
          <div className="h-[290px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={periodTrendData}
                margin={{ top: 8, right: 10, left: -16, bottom: 4 }}
              >
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
                <Bar dataKey="應巡班數" fill="#E5E1D8" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="已巡班數" fill="#1E5C4B" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Line
                  type="monotone"
                  dataKey="待改善異常"
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
        <div className="xl:col-span-7 bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#1F2421]">本節即時教室巡堂狀態</h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                點擊任一班級即可開啟巡堂檢核勾選單
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

          {periodSlots.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#7C7A72]">此節次目前無排課資料</div>
          ) : (
            <div className="divide-y divide-[#F0ECE3]">
              {periodSlots.map((slot) => {
                const log = periodLogsBySlot.get(slot.id);
                const checklist = getEffectiveChecklist(log);
                const statusColor = !log
                  ? 'text-[#9A968C]'
                  : log.status === 'urgent_issue'
                    ? 'text-[#B44326]'
                    : log.status === 'minor_issue'
                      ? 'text-[#9A5B13]'
                      : log.status === 'empty_relocated'
                        ? 'text-[#245A84]'
                        : 'text-[#1E5C4B]';

                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => onOpenQuickPatrol(slot)}
                    className="w-full min-h-[64px] px-5 py-3.5 text-left hover:bg-[#FAF9F5] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-sm font-bold text-[#1F2421]">
                        <span>{slot.className}</span>
                        <span className="text-[#D4CEC2] font-normal" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono-num text-[#1E5C4B] font-semibold">
                          {slot.roomNumber}
                        </span>
                        <span className="text-[#D4CEC2] font-normal" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#3A3F3B] font-medium truncate">{slot.subject}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#7C7A72]">
                        <span>{slot.building}</span>
                        <span aria-hidden="true">/</span>
                        <span>授課：{slot.teacherName}</span>
                        {slot.isRelocated && slot.locationNote && (
                          <>
                            <span aria-hidden="true">/</span>
                            <span className="text-[#245A84] inline-flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {slot.locationNote}
                            </span>
                          </>
                        )}
                      </div>
                      {log && checklist.length > 0 && (
                        <p className="text-[11px] text-[#5C615C] truncate pt-0.5">
                          {checklist.map((k) => `☑ ${PATROL_CHECKLIST_LABELS[k]}`).join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-end gap-3 shrink-0">
                      <div
                        className={`text-xs font-semibold flex items-center gap-1.5 min-w-[84px] justify-end ${statusColor}`}
                      >
                        {log ? (
                          log.status === 'urgent_issue' || log.status === 'minor_issue' ? (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          )
                        ) : (
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{log ? PATROL_STATUS_LABELS[log.status] : '尚未巡查'}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Abnormal Incidents List */}
        <div className="xl:col-span-5 bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#1F2421]">異常事件即時追蹤列表</h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">待處理與處理中之通報（依嚴重度排序）</p>
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
              <CheckCircle2 className="w-7 h-7 text-[#1E5C4B] mx-auto" />
              <p className="text-sm font-medium text-[#1F2421]">目前無待處理異常事件</p>
              <p className="text-xs text-[#7C7A72]">所有通報事件均已結案歸檔</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F0ECE3]">
              {activeIncidentsList.map((inc) => {
                const overdue = isIncidentOverdueEscalation(inc);
                const elapsed = getIncidentElapsedMinutes(inc);
                const sevColor =
                  inc.severity === 'high'
                    ? 'text-[#B44326]'
                    : inc.severity === 'medium'
                      ? 'text-[#9A5B13]'
                      : 'text-[#5C615C]';

                return (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => onNavigate('incidents')}
                    className="w-full px-5 py-4 text-left hover:bg-[#FAF9F5] transition-colors space-y-1.5 cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-semibold inline-flex items-center gap-1 ${sevColor}`}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {INCIDENT_SEVERITY_LABELS[inc.severity]}
                        <span className="text-[#D4CEC2] font-normal" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[#5C615C] font-normal">
                          {INCIDENT_CATEGORY_LABELS[inc.category]}
                        </span>
                      </span>
                      <span className="text-[#7C7A72] font-mono-num shrink-0">
                        {INCIDENT_STATUS_LABELS[inc.status]}
                        {elapsed > 0 ? ` · ${elapsed} 分前` : ' · 剛剛'}
                      </span>
                    </div>

                    <p className="text-sm font-semibold text-[#1F2421] line-clamp-1">{inc.title}</p>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#7C7A72]">
                      <span>
                        {inc.location} · 通報人：{inc.reporterName}
                      </span>
                      {overdue && (
                        <span className="text-[#B44326] font-semibold">
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
