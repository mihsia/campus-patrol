import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  Lock,
  Plus,
  Send,
  Volume2,
  X,
} from 'lucide-react';
import type {
  IncidentCategory,
  IncidentReport,
  IncidentSeverity,
  IncidentStatus,
  NotificationPreferences,
  SchoolSettings,
  StaffProfile,
  TimetableSlot,
} from '../types/patrol';
import {
  ACTIVE_INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUS_LABELS,
} from '../types/patrol';
import { createIncidentReport, transitionIncidentStatus } from '../lib/firestoreOps';
import {
  getBrowserNotificationPermission,
  getIncidentElapsedMinutes,
  isIncidentOverdueEscalation,
  playUrgentAlertChime,
  requestBrowserNotificationPermission,
  triggerBrowserPushNotification,
} from '../lib/notifications';

interface IncidentsViewProps {
  profile: StaffProfile;
  isAdmin: boolean;
  schoolSettings: SchoolSettings;
  selectedDate: string;
  selectedPeriod: number;
  timetables: TimetableSlot[];
  incidents: IncidentReport[];
  notifPrefs: NotificationPreferences;
  onUpdateNotifPrefs: (next: NotificationPreferences) => void;
  onActionFeedback: (message: string) => void;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  profile,
  isAdmin,
  schoolSettings,
  selectedDate,
  selectedPeriod,
  timetables,
  incidents,
  notifPrefs,
  onUpdateNotifPrefs,
  onActionFeedback,
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | IncidentSeverity>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<IncidentReport | null>(null);
  const [browserPerm, setBrowserPerm] = useState(getBrowserNotificationPermission());

  const buildings = useMemo(() => {
    const ordered = [...schoolSettings.buildings];
    timetables.forEach((t) => {
      if (t.building && !ordered.includes(t.building)) {
        ordered.push(t.building);
      }
    });
    return ['ALL', ...ordered];
  }, [schoolSettings.buildings, timetables]);

  const filteredIncidents = useMemo(() => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    const stOrder = { open: 0, in_progress: 1, resolved: 2 };
    return incidents
      .filter((i) => statusFilter === 'all' || i.status === statusFilter)
      .filter((i) => severityFilter === 'all' || i.severity === severityFilter)
      .sort((a, b) => {
        if (stOrder[a.status] !== stOrder[b.status]) return stOrder[a.status] - stOrder[b.status];
        if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
        return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
      });
  }, [incidents, statusFilter, severityFilter]);

  const overdueIncidents = useMemo(
    () => incidents.filter(isIncidentOverdueEscalation),
    [incidents]
  );

  const handleEnableBrowserPush = async () => {
    const result = await requestBrowserNotificationPermission();
    setBrowserPerm(result);
    if (result === 'granted') {
      onUpdateNotifPrefs({ ...notifPrefs, browserPushEnabled: true });
      onActionFeedback('已啟用瀏覽器即時系統推播通知');
    } else if (result === 'unsupported') {
      onActionFeedback('目前瀏覽器不支援原生系統推播，將改以頁內即時警示通知');
    } else {
      onUpdateNotifPrefs({ ...notifPrefs, browserPushEnabled: false });
      onActionFeedback('瀏覽器通知權限未允許，請於網址列權限設定開啟');
    }
  };

  const handleTestPush = () => {
    if (notifPrefs.soundEnabled) {
      playUrgentAlertChime('high');
    }
    const fakeIncident: IncidentReport = {
      id: 'test-push',
      campusId: 'main-campus',
      date: selectedDate,
      period: selectedPeriod,
      timetableId: '',
      location: `${schoolSettings.buildings[0] || '行政教學大樓'} 101 · 一甲`,
      className: '一甲',
      category: 'teacher_absent',
      severity: 'high',
      title: '系統推播測試：緊急巡堂異常警示',
      description: '這是一則測試推播通知，確認您的裝置可即時接收異常事件派發。',
      status: 'open',
      reporterId: profile.uid,
      reporterName: profile.displayName,
      handlerId: '',
      handlerName: '',
      resolutionNote: '',
    };
    const pushed = notifPrefs.browserPushEnabled ? triggerBrowserPushNotification(fakeIncident) : false;
    onActionFeedback(
      pushed
        ? '已發送瀏覽器系統推播與警示音測試'
        : '已觸發頁內即時警示與音效測試（開啟瀏覽器權限後可於背景收到系統推播）'
    );
  };

  return (
    <div className="space-y-6">
      {/* Overdue Escalation Banner */}
      {overdueIncidents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-red-900">
                有 {overdueIncidents.length} 件異常通報超過標準回應時限尚未接手
              </p>
              <p className="text-xs text-red-700">
                依推播升級機制：緊急通報逾 5 分鐘／中度異常逾 15 分鐘未接手，將自動提醒學務主任與全區巡堂人員。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedIncident(overdueIncidents[0])}
            className="min-h-[40px] px-4 py-2 bg-red-700 hover:bg-red-800 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            立即接手最緊急案件
          </button>
        </div>
      )}

      {/* Main Layout: Left Incidents List + Right Push Notification Dispatch Engine */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Incidents Table / Cards */}
        <div className="xl:col-span-8 bg-white border border-[#E5E1D8] rounded-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-[#E5E1D8] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#1F2421]">
                  異常事件通報與處置清冊
                </h2>
                <p className="text-xs text-[#7C7A72] mt-0.5">
                  即時跨裝置同步通報紀錄；已結案事件自動鎖定狀態以確保稽核完整性
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                新增異常通報
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl overflow-x-auto">
                {(
                  [
                    ['all', '全部狀態'],
                    ['open', '待處理'],
                    ['in_progress', '處理中'],
                    ['resolved', '已結案'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStatusFilter(k)}
                    className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      statusFilter === k ? 'bg-[#1E5C4B] text-white shadow-xs' : 'text-[#5C615C] hover:text-[#1F2421]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl overflow-x-auto">
                {(
                  [
                    ['all', '全部等級'],
                    ['high', '緊急通報'],
                    ['medium', '中度異常'],
                    ['low', '一般提醒'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSeverityFilter(k)}
                    className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      severityFilter === k ? 'bg-[#1E5C4B] text-white shadow-xs' : 'text-[#5C615C] hover:text-[#1F2421]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredIncidents.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
              <p className="text-sm font-medium text-slate-900">目前篩選條件下無異常事件</p>
              <p className="text-xs text-slate-500">可點擊右上角「新增異常通報」建立新通報單</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredIncidents.map((inc) => {
                const overdue = isIncidentOverdueEscalation(inc);
                const elapsed = getIncidentElapsedMinutes(inc);
                const sevClass =
                  inc.severity === 'high'
                    ? 'text-red-700'
                    : inc.severity === 'medium'
                      ? 'text-amber-700'
                      : 'text-slate-600';

                return (
                  <div
                    key={inc.id}
                    className="p-4 sm:px-5 hover:bg-slate-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className={`font-semibold inline-flex items-center gap-1 ${sevClass}`}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {INCIDENT_SEVERITY_LABELS[inc.severity]}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-slate-700 font-medium">
                          {INCIDENT_CATEGORY_LABELS[inc.category]}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono-num text-slate-500">
                          {inc.date} 第 {inc.period} 節
                        </span>
                        {overdue && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">·</span>
                            <span className="text-red-700 font-semibold">逾時升級提醒（{elapsed} 分未接手）</span>
                          </>
                        )}
                      </div>

                      <h3 className="text-sm font-semibold text-slate-900">{inc.title}</h3>
                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {inc.description}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 pt-0.5">
                        <span>地點：{inc.location}</span>
                        <span aria-hidden="true">/</span>
                        <span>通報：{inc.reporterName}</span>
                        {inc.handlerName && (
                          <>
                            <span aria-hidden="true">/</span>
                            <span className="text-[#1E5C4B] font-semibold">承辦：{inc.handlerName}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                      <span
                        className={`text-xs font-semibold inline-flex items-center gap-1 ${
                          inc.status === 'resolved'
                            ? 'text-emerald-700'
                            : inc.status === 'in_progress'
                              ? 'text-blue-700'
                              : 'text-red-700'
                        }`}
                      >
                        {inc.status === 'resolved' ? (
                          <Lock className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        {INCIDENT_STATUS_LABELS[inc.status]}
                      </span>

                      <button
                        type="button"
                        onClick={() => setSelectedIncident(inc)}
                        className="min-h-[38px] px-3.5 py-1.5 text-xs font-medium border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg whitespace-nowrap cursor-pointer"
                      >
                        {inc.status === 'resolved' ? '檢視結案紀錄' : inc.status === 'open' ? '接手／處置' : '更新／結案'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Push Notification Dispatch Logic & Personal Preferences */}
        <div className="xl:col-span-4 space-y-5">
          <div className="bg-white border border-[#E5E1D8] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg bg-[#FCEBE7] text-[#B8432E] flex items-center justify-center">
                  <BellRing className="w-4 h-4" />
                </span>
                <h3 className="text-sm font-bold text-[#1F2421]">即時推播通知設定</h3>
              </div>
              <button
                type="button"
                onClick={handleTestPush}
                className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] cursor-pointer whitespace-nowrap"
              >
                測試推播
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3 py-2 border-b border-[#F0ECE3]">
                <div>
                  <p className="font-semibold text-[#1F2421]">瀏覽器系統推播</p>
                  <p className="text-[#7C7A72] mt-0.5">
                    權限狀態：{browserPerm === 'granted' ? '已核准' : browserPerm === 'denied' ? '已封鎖' : browserPerm === 'unsupported' ? '不支援' : '尚未設定'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (notifPrefs.browserPushEnabled) {
                      onUpdateNotifPrefs({ ...notifPrefs, browserPushEnabled: false });
                    } else {
                      void handleEnableBrowserPush();
                    }
                  }}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                    notifPrefs.browserPushEnabled && browserPerm === 'granted'
                      ? 'bg-[#1E5C4B] text-white'
                      : 'bg-[#F2EFE9] text-[#3A3F3B] hover:bg-[#E5E1D8]'
                  }`}
                >
                  {notifPrefs.browserPushEnabled && browserPerm === 'granted' ? '已開啟' : '開啟推播'}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-slate-400" />
                  <div>
                    <p className="font-medium text-slate-900">緊急異常警示音</p>
                    <p className="text-slate-500">收到高／中風險通報時播放提示音</p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={notifPrefs.soundEnabled}
                  onChange={(e) => onUpdateNotifPrefs({ ...notifPrefs, soundEnabled: e.target.checked })}
                  className="w-4 h-4 accent-teal-700 cursor-pointer"
                />
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="font-medium text-slate-700 block">推播觸發最低嚴重度</label>
                <select
                  value={notifPrefs.minSeverity}
                  onChange={(e) =>
                    onUpdateNotifPrefs({
                      ...notifPrefs,
                      minSeverity: e.target.value as IncidentSeverity,
                    })
                  }
                  className="w-full min-h-[40px] px-3 text-xs border border-slate-200 rounded-lg bg-slate-50"
                >
                  <option value="high">僅接收「緊急通報」</option>
                  <option value="medium">接收「中度異常」與「緊急通報」（建議）</option>
                  <option value="low">接收全部事件（含一般提醒）</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-medium text-slate-700 block">關注巡查樓棟範圍</label>
                <select
                  value={notifPrefs.subscribedBuilding}
                  onChange={(e) =>
                    onUpdateNotifPrefs({
                      ...notifPrefs,
                      subscribedBuilding: e.target.value,
                    })
                  }
                  className="w-full min-h-[40px] px-3 text-xs border border-slate-200 rounded-lg bg-slate-50"
                >
                  {buildings.map((b) => (
                    <option key={b} value={b}>
                      {b === 'ALL' ? '全校所有樓棟' : `僅接收 ${b}（安全傷病仍全校廣播）`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Push Dispatch Rule Architecture Reference Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900">分級推播派發與升級邏輯</h3>
            </div>
            <div className="space-y-3 text-xs text-slate-600 divide-y divide-slate-100">
              <div className="pt-1 space-y-1">
                <p className="font-semibold text-red-700">第一級・緊急通報（教師未準時／未按課表／安全傷病）</p>
                <p>即時觸發全校管理員與巡堂人員瀏覽器推播、警示音與頂部常駐警示列；逾 5 分鐘未接手自動標記升級提醒。</p>
              </div>
              <div className="pt-2.5 space-y-1">
                <p className="font-semibold text-amber-700">第二級・中度異常（班級秩序欠佳／學習狀況異常）</p>
                <p>派發至對應樓棟巡堂人員與教務處即時通知彈窗；逾 15 分鐘未處理進入逾時追蹤清單。</p>
              </div>
              <div className="pt-2.5 space-y-1">
                <p className="font-semibold text-slate-700">第三級・一般提醒（教室設備修繕／單次紀錄）</p>
                <p>靜默寫入通報中心與總務報修清冊，不中斷走動巡堂操作。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Create Incident Modal */}
      {showCreateModal && (
        <CreateIncidentModal
          profile={profile}
          selectedDate={selectedDate}
          selectedPeriod={selectedPeriod}
          timetables={timetables}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            onActionFeedback('已送出異常事件通報並即時推播至相關人員');
          }}
        />
      )}

      {/* Incident Detail / Workflow Action Modal */}
      {selectedIncident && (
        <IncidentWorkflowModal
          incident={selectedIncident}
          profile={profile}
          isAdmin={isAdmin}
          onClose={() => setSelectedIncident(null)}
          onUpdated={(msg) => {
            setSelectedIncident(null);
            onActionFeedback(msg);
          }}
        />
      )}
    </div>
  );
};

interface CreateIncidentModalProps {
  profile: StaffProfile;
  selectedDate: string;
  selectedPeriod: number;
  timetables: TimetableSlot[];
  onClose: () => void;
  onCreated: () => void;
}

const CreateIncidentModal: React.FC<CreateIncidentModalProps> = ({
  profile,
  selectedDate,
  selectedPeriod,
  timetables,
  onClose,
  onCreated,
}) => {
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<IncidentCategory>('classroom_order');
  const [severity, setSeverity] = useState<IncidentSeverity>('high');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const uniqueClassSlots = useMemo(() => {
    const seen = new Set<string>();
    return timetables.filter((t) => {
      if (t.period !== selectedPeriod) return false;
      const key = `${t.className}-${t.roomNumber}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [timetables, selectedPeriod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      const slot = timetables.find((t) => t.id === selectedSlotId);
      const finalLocation =
        location.trim() ||
        (slot ? `${slot.building} ${slot.roomNumber} · ${slot.className}` : '校園公共區域');
      await createIncidentReport({
        reporterId: profile.uid,
        reporterName: profile.displayName,
        date: selectedDate,
        period: selectedPeriod,
        timetableId: slot ? slot.id : '',
        location: finalLocation,
        className: slot ? slot.className : '',
        category,
        severity,
        title: title.trim(),
        description: description.trim(),
      });
      onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">建立即時異常事件通報</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">事件類別</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as IncidentCategory)}
                className="w-full min-h-[42px] px-3 text-sm border border-slate-200 rounded-lg bg-white"
              >
                {ACTIVE_INCIDENT_CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {INCIDENT_CATEGORY_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">嚴重等級（決定推播方式）</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                className="w-full min-h-[42px] px-3 text-sm border border-slate-200 rounded-lg bg-white"
              >
                <option value="high">緊急通報（即刻推播＋警示音）</option>
                <option value="medium">中度異常（即時通知）</option>
                <option value="low">一般提醒（靜默登錄）</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">關聯教室課表（選填）</label>
            <select
              value={selectedSlotId}
              onChange={(e) => {
                setSelectedSlotId(e.target.value);
                const found = timetables.find((t) => t.id === e.target.value);
                if (found) {
                  setLocation(`${found.building} ${found.roomNumber} · ${found.className}`);
                }
              }}
              className="w-full min-h-[42px] px-3 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="">不關聯特定課表（校園公共區域）</option>
              {uniqueClassSlots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.building} {s.roomNumber} · {s.className}（{s.subject} / {s.teacherName}）
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">發生地點</label>
            <input
              type="text"
              required
              maxLength={80}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="例如：行政教學大樓 101 · 一甲"
              className="w-full min-h-[42px] px-3 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">事件標題</label>
            <input
              type="text"
              required
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="簡述異常狀況，例如：任課教師遲到逾10分鐘"
              className="w-full min-h-[42px] px-3 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">詳細情形與現場處置</label>
            <textarea
              required
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="請詳述時間、涉及人員及需要協助支援的單位..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 text-sm text-slate-600 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-5 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              {submitting ? '傳送中...' : '立即送出通報'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface IncidentWorkflowModalProps {
  incident: IncidentReport;
  profile: StaffProfile;
  isAdmin: boolean;
  onClose: () => void;
  onUpdated: (msg: string) => void;
}

const IncidentWorkflowModal: React.FC<IncidentWorkflowModalProps> = ({
  incident,
  profile,
  isAdmin,
  onClose,
  onUpdated,
}) => {
  const [resolutionNote, setResolutionNote] = useState(incident.resolutionNote || '');
  const [saving, setSaving] = useState(false);

  const isLocked = incident.status === 'resolved' && !isAdmin;

  const handleTransition = async (nextStatus: IncidentStatus, label: string) => {
    setSaving(true);
    try {
      await transitionIncidentStatus({
        incident,
        nextStatus,
        handlerId: profile.uid,
        handlerName: profile.displayName,
        resolutionNote,
      });
      onUpdated(`事件「${incident.title}」已${label}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-slate-500">
              {INCIDENT_SEVERITY_LABELS[incident.severity]} · {INCIDENT_CATEGORY_LABELS[incident.category]}
            </p>
            <h3 className="text-base font-bold text-slate-900">{incident.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs text-slate-600 space-y-1 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <p>
              <strong className="text-slate-800">地點與節次：</strong>
              {incident.location}（{incident.date} 第 {incident.period} 節）
            </p>
            <p>
              <strong className="text-slate-800">通報人員：</strong>
              {incident.reporterName}
            </p>
            <p>
              <strong className="text-slate-800">目前狀態：</strong>
              {INCIDENT_STATUS_LABELS[incident.status]}
              {incident.handlerName ? `（承辦人：${incident.handlerName}）` : ''}
            </p>
            <p className="pt-1 text-slate-800 leading-relaxed">{incident.description}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 block">
              處置進度與結案紀錄
            </label>
            <textarea
              rows={3}
              maxLength={1000}
              disabled={isLocked}
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              placeholder="請填寫聯絡教務處／導師、現場排除情形或後續追蹤事項..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>

          {isLocked ? (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <Lock className="w-4 h-4 shrink-0" />
              <span>此事件已正式結案並鎖定紀錄（僅系統管理員具權限重啟更正）。</span>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              {incident.status === 'open' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleTransition('in_progress', '接手處理中')}
                  className="min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-medium rounded-lg cursor-pointer"
                >
                  接手處理
                </button>
              )}
              {incident.status === 'in_progress' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleTransition('in_progress', '更新處置紀錄')}
                  className="min-h-[42px] px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-medium rounded-lg cursor-pointer"
                >
                  儲存處理進度
                </button>
              )}
              {incident.status !== 'resolved' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleTransition('resolved', '正式結案歸檔')}
                  className="min-h-[42px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl cursor-pointer"
                >
                  確認結案並鎖定
                </button>
              )}
              {incident.status === 'resolved' && isAdmin && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => handleTransition('in_progress', '由管理員重新開啟')}
                  className="min-h-[42px] px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs sm:text-sm font-medium rounded-lg cursor-pointer"
                >
                  管理員覆寫重啟
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
