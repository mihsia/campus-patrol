import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  Power,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { AccountStatus, AllowedAccount, StaffProfile, StaffRole } from '../types/patrol';
import {
  ACCOUNT_STATUS_LABELS,
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_DEPARTMENTS,
  STAFF_ROLE_LABELS,
  normalizeStaffRole,
} from '../types/patrol';
import {
  adminCreateAllowedAccount,
  adminDeleteAllowedAccount,
  adminToggleAllowedAccountStatus,
  adminUpdateAllowedAccount,
  updateOwnStaffProfile,
} from '../lib/firestoreOps';
import { isValidEmailFormat } from '../lib/validation';

interface StaffViewProps {
  profile: StaffProfile;
  userEmail: string;
  isAdmin: boolean;
  allowedAccounts: AllowedAccount[];
  staffList: StaffProfile[];
  onActionFeedback: (message: string) => void;
}

type AccountFilter = 'all' | 'admin' | 'user' | 'disabled';

export const StaffView: React.FC<StaffViewProps> = ({
  profile,
  userEmail,
  isAdmin,
  allowedAccounts,
  staffList,
  onActionFeedback,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<AccountFilter>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AllowedAccount | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<AllowedAccount | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showProfilePanel, setShowProfilePanel] = useState(false);

  // Personal Profile Editor State
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [department, setDepartment] = useState(profile.department);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle);
  const [savingProfile, setSavingProfile] = useState(false);

  const handleSaveOwnProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSavingProfile(true);
    try {
      await updateOwnStaffProfile(profile.uid, userEmail, {
        displayName,
        department,
        jobTitle,
      });
      onActionFeedback('已更新個人帳號顯示資料');
      setShowProfilePanel(false);
    } finally {
      setSavingProfile(false);
    }
  };

  // Counts for Admin Segmented Filter
  const counts = useMemo(() => {
    const total = allowedAccounts.length;
    const admins = allowedAccounts.filter((a) => a.role === 'admin' && a.status === 'active').length;
    const users = allowedAccounts.filter((a) => a.role === 'user' && a.status === 'active').length;
    const disabled = allowedAccounts.filter((a) => a.status === 'disabled').length;
    return { total, admins, users, disabled };
  }, [allowedAccounts]);

  // Filter & Group Accounts by Department (處室)
  const groupedDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = allowedAccounts.filter((acc) => {
      if (filterMode === 'admin' && (acc.role !== 'admin' || acc.status !== 'active')) return false;
      if (filterMode === 'user' && (acc.role !== 'user' || acc.status !== 'active')) return false;
      if (filterMode === 'disabled' && acc.status !== 'disabled') return false;
      if (!q) return true;
      return (
        acc.displayName.toLowerCase().includes(q) ||
        acc.email.toLowerCase().includes(q) ||
        acc.department.toLowerCase().includes(q) ||
        acc.jobTitle.toLowerCase().includes(q)
      );
    });

    const deptOrder = new Map<string, number>();
    DEFAULT_DEPARTMENTS.forEach((d, idx) => deptOrder.set(d, idx));

    const map = new Map<string, AllowedAccount[]>();
    filtered.forEach((acc) => {
      const dept = acc.department || '未分類處室';
      const arr = map.get(dept) ?? [];
      arr.push(acc);
      map.set(dept, arr);
    });

    return Array.from(map.entries())
      .map(([dept, items]) => ({
        department: dept,
        accounts: items.sort((a, b) => {
          // Bootstrap admin first, then admins before users, then active before disabled, then name
          const aBoot = a.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() ? 0 : 1;
          const bBoot = b.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() ? 0 : 1;
          if (aBoot !== bBoot) return aBoot - bBoot;
          if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return a.displayName.localeCompare(b.displayName, 'zh-Hant');
        }),
      }))
      .sort((a, b) => {
        const oa = deptOrder.has(a.department) ? deptOrder.get(a.department)! : 99;
        const ob = deptOrder.has(b.department) ? deptOrder.get(b.department)! : 99;
        if (oa !== ob) return oa - ob;
        return a.department.localeCompare(b.department, 'zh-Hant');
      });
  }, [allowedAccounts, searchQuery, filterMode]);

  const handleToggleStatus = async (acc: AllowedAccount) => {
    setBusyId(acc.id);
    try {
      const nextStatus = await adminToggleAllowedAccountStatus(acc);
      onActionFeedback(
        `已將 ${acc.displayName}（${acc.email}）狀態變更為「${ACCOUNT_STATUS_LABELS[nextStatus]}」`
      );
    } catch (err) {
      onActionFeedback(err instanceof Error ? err.message : '變更帳號狀態失敗');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteAccount) return;
    setBusyId(confirmDeleteAccount.id);
    try {
      await adminDeleteAllowedAccount(confirmDeleteAccount);
      onActionFeedback(`已從授權名單移除 ${confirmDeleteAccount.displayName}（${confirmDeleteAccount.email}）`);
      setConfirmDeleteAccount(null);
    } catch (err) {
      onActionFeedback(err instanceof Error ? err.message : '刪除授權帳號失敗');
    } finally {
      setBusyId(null);
    }
  };

  // =========================================================================
  // VIEW A: REGULAR USER (使用者) — Own Profile + Two-Tier Permission Summary
  // =========================================================================
  if (!isAdmin) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <UserCog className="w-5 h-5 text-teal-700" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">個人帳號與權限資料</h2>
              <p className="text-xs text-slate-500">
                本系統採用 Google 授權帳號登入，巡堂紀錄與異常通報將自動署名您的姓名
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">授權登入 Google 帳號</span>
              <span className="font-semibold text-emerald-700">使用中</span>
            </div>
            <p className="font-mono-num text-sm font-semibold text-slate-900 break-all">{userEmail}</p>
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
              <span className="text-slate-500">系統權限層級</span>
              <span className="font-semibold text-slate-900">
                {STAFF_ROLE_LABELS[normalizeStaffRole(profile.role)]}
              </span>
            </div>
          </div>

          <form onSubmit={handleSaveOwnProfile} className="space-y-4 text-sm">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">顯示姓名</label>
              <input
                type="text"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">所屬處室</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 block">職稱</label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg bg-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="w-full min-h-[44px] px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {savingProfile ? '儲存中...' : '儲存個人顯示資料'}
            </button>
          </form>
        </div>

        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Shield className="w-5 h-5 text-slate-500" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">系統二層次權限說明</h2>
                <p className="text-xs text-slate-500">如需調整權限層級，請聯繫學校系統管理者</p>
              </div>
            </div>

            <div className="divide-y divide-slate-100 text-xs sm:text-sm">
              <div className="py-3 space-y-1">
                <p className="font-semibold text-slate-900">使用者（您目前的權限）</p>
                <p className="text-slate-600 leading-relaxed">
                  可檢視即時巡堂儀表板、執行行動巡堂與點名缺曠、登錄與核銷學生核准假單、通報並接手處理異常事件，以及匯出 PDF／Excel 報表。
                </p>
              </div>
              <div className="py-3 space-y-1">
                <p className="font-semibold text-teal-800">管理者</p>
                <p className="text-slate-600 leading-relaxed">
                  擁有完整使用者功能，並額外負責 Google 授權帳號控管（新增、編輯、停用／啟用帳號與指派角色）、全校課表資料庫匯入維護，以及異常結案覆核與刪除權限。
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-900">
                  已登入協作人員（<span className="font-mono-num">{staffList.length}</span> 人）
                </h3>
              </div>
              <span className="text-xs text-slate-500">不含個人 Email 隱私</span>
            </div>
            <div className="divide-y divide-slate-100">
              {staffList.map((member) => (
                <div
                  key={member.uid}
                  className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {member.displayName}
                      {member.uid === profile.uid && (
                        <span className="text-xs text-teal-700 ml-1.5">（目前登入）</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {member.department} · {member.jobTitle}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      normalizeStaffRole(member.role) === 'admin' ? 'text-teal-800' : 'text-slate-600'
                    }`}
                  >
                    {STAFF_ROLE_LABELS[normalizeStaffRole(member.role)]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW B: SYSTEM ADMIN (管理者) — Department-Grouped Google Account Console
  // =========================================================================
  return (
    <div className="space-y-6">
      {/* Header & Primary Action */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">帳號管理</h2>
          <p className="text-sm text-slate-600">
            帳號依「處室」分類管理，僅限授權之 Google 帳號登入使用（二層次權限：管理者／使用者）
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowProfilePanel((prev) => !prev)}
            className="min-h-[42px] px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 text-xs sm:text-sm font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <UserCog className="w-4 h-4" />
            個人顯示設定
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="min-h-[42px] px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            新增授權 Google 帳號
          </button>
        </div>
      </div>

      {/* Optional Collapsible Own Profile Settings for Admin */}
      {showProfilePanel && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">個人顯示資料設定</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                目前登入：<span className="font-mono-num text-slate-700">{userEmail}</span> · 權限：管理者
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowProfilePanel(false)}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="收合個人資料設定"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveOwnProfile} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end text-sm">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">顯示姓名</label>
              <input
                type="text"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">所屬處室</label>
              <input
                type="text"
                required
                maxLength={60}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">職稱</label>
              <input
                type="text"
                required
                maxLength={60}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-slate-200 rounded-lg bg-white"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="min-h-[40px] px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap"
            >
              {savingProfile ? '儲存中...' : '儲存個人資料'}
            </button>
          </form>
        </div>
      )}

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            [
              ['all', `全部帳號（${counts.total}）`],
              ['admin', `管理者（${counts.admins}）`],
              ['user', `使用者（${counts.users}）`],
              ['disabled', `已停用（${counts.disabled}）`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilterMode(id)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                filterMode === id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜尋姓名、Google 帳號或處室..."
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
          />
        </div>
      </div>

      {/* Department-Grouped Account Tables */}
      {groupedDepartments.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-medium text-slate-900">目前沒有符合篩選條件的授權帳號</p>
          <p className="text-xs text-slate-500">
            點擊右上方「新增授權 Google 帳號」即可指派各處室教職員的系統權限
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedDepartments.map((group) => (
            <section key={group.department} className="space-y-2.5">
              <div className="flex items-baseline gap-2.5 px-1">
                <h3 className="text-sm font-bold text-teal-800">{group.department}</h3>
                <span className="text-xs text-slate-500 font-mono-num">
                  {group.accounts.length} 位帳號
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-500">
                        <th className="py-3 px-4 w-[22%]">姓名／職稱</th>
                        <th className="py-3 px-4 w-[32%]">Google 帳號</th>
                        <th className="py-3 px-4 w-[14%]">權限</th>
                        <th className="py-3 px-4 w-[14%]">狀態</th>
                        <th className="py-3 px-4 text-right w-[18%]">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.accounts.map((acc) => {
                        const isBootstrap =
                          acc.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
                        const isSelf = acc.email.toLowerCase() === userEmail.toLowerCase();
                        const isBusy = busyId === acc.id;

                        return (
                          <tr
                            key={acc.id}
                            className={`transition-colors ${
                              acc.status === 'disabled' ? 'bg-slate-50/70' : 'hover:bg-slate-50/60'
                            }`}
                          >
                            <td className="py-3.5 px-4 align-middle">
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5 flex-wrap">
                                <span>{acc.displayName}</span>
                                {isSelf && (
                                  <span className="text-xs font-normal text-teal-700">（目前登入）</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">{acc.jobTitle}</p>
                            </td>

                            <td className="py-3.5 px-4 align-middle">
                              <div className="font-mono-num text-xs sm:text-sm text-slate-700 break-all">
                                {acc.email}
                              </div>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {acc.uid ? '已完成 Google 登入綁定' : '預先授權・尚未初次登入'}
                              </p>
                            </td>

                            <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                              <span
                                className={`text-xs sm:text-sm font-semibold ${
                                  acc.role === 'admin' ? 'text-teal-800' : 'text-slate-700'
                                }`}
                              >
                                {STAFF_ROLE_LABELS[acc.role]}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                              <span
                                className={`text-xs sm:text-sm font-semibold ${
                                  acc.status === 'active' ? 'text-emerald-700' : 'text-red-700'
                                }`}
                              >
                                {ACCOUNT_STATUS_LABELS[acc.status]}
                              </span>
                            </td>

                            <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                              {isBootstrap ? (
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setEditingAccount(acc)}
                                    className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    編輯
                                  </button>
                                  <span className="text-xs text-slate-400 px-1">主管理者</span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => setEditingAccount(acc)}
                                    className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                    編輯
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isBusy || isSelf}
                                    onClick={() => handleToggleStatus(acc)}
                                    title={isSelf ? '無法停用目前登入中的自己' : undefined}
                                    className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg border inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 ${
                                      acc.status === 'active'
                                        ? 'text-slate-700 bg-slate-50 hover:bg-red-50 hover:text-red-700 hover:border-red-200 border-slate-200'
                                        : 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                                    }`}
                                  >
                                    <Power className="w-3.5 h-3.5" />
                                    {acc.status === 'active' ? '停用' : '啟用'}
                                  </button>
                                  {!isSelf && (
                                    <button
                                      type="button"
                                      disabled={isBusy}
                                      onClick={() => setConfirmDeleteAccount(acc)}
                                      aria-label={`刪除 ${acc.displayName}`}
                                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Two-Tier Permission Reference Footer */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <p className="font-semibold text-teal-800 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            管理者權限範圍
          </p>
          <p className="text-slate-600 leading-relaxed">
            可管理全校 Google 授權帳號（新增、編輯、停用／啟用與分派權限）、維護與匯入全校課表資料庫、重新開啟或刪除異常通報紀錄，並具備完整巡堂作業與報表匯出功能。
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-slate-900 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            使用者權限範圍
          </p>
          <p className="text-slate-600 leading-relaxed">
            僅限使用經授權且狀態為「使用中」的 Google 帳號登入，可操作即時儀表板、行動巡堂登錄、缺曠覆核與核准假單登錄、異常事件通報接手結案，以及 PDF／Excel 報表匯出。
          </p>
        </div>
      </div>

      {/* Add Authorized Account Modal */}
      {showAddModal && (
        <AccountFormModal
          mode="create"
          actorUid={profile.uid}
          onClose={() => setShowAddModal(false)}
          onSaved={(msg) => {
            setShowAddModal(false);
            onActionFeedback(msg);
          }}
        />
      )}

      {/* Edit Authorized Account Modal */}
      {editingAccount && (
        <AccountFormModal
          mode="edit"
          actorUid={profile.uid}
          account={editingAccount}
          isSelf={editingAccount.email.toLowerCase() === userEmail.toLowerCase()}
          onClose={() => setEditingAccount(null)}
          onSaved={(msg) => {
            setEditingAccount(null);
            onActionFeedback(msg);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteAccount && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 p-6 space-y-5">
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900">確認移除授權帳號？</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                移除後，<span className="font-semibold text-slate-900">{confirmDeleteAccount.displayName}</span>（
                <span className="font-mono-num">{confirmDeleteAccount.email}</span>）將立即失去系統存取權限。若僅需暫時限制登入，建議改用「停用」功能。
              </p>
            </div>
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmDeleteAccount(null)}
                className="min-h-[42px] px-4 text-sm text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busyId === confirmDeleteAccount.id}
                onClick={handleConfirmDelete}
                className="min-h-[42px] px-5 bg-red-700 hover:bg-red-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg cursor-pointer"
              >
                {busyId === confirmDeleteAccount.id ? '移除中...' : '確認移除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =========================================================================
// Add / Edit Authorized Google Account Modal
// =========================================================================
const AccountFormModal: React.FC<{
  mode: 'create' | 'edit';
  actorUid: string;
  account?: AllowedAccount;
  isSelf?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}> = ({ mode, actorUid, account, isSelf = false, onClose, onSaved }) => {
  const isBootstrap =
    account?.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();

  const initialDept = account?.department || '學務處';
  const isPresetDept = (DEFAULT_DEPARTMENTS as readonly string[]).includes(initialDept);

  const [email, setEmail] = useState(account?.email || '');
  const [displayName, setDisplayName] = useState(account?.displayName || '');
  const [deptChoice, setDeptChoice] = useState(isPresetDept ? initialDept : '__custom__');
  const [customDept, setCustomDept] = useState(isPresetDept ? '' : initialDept);
  const [jobTitle, setJobTitle] = useState(account?.jobTitle || '巡堂教師');
  const [role, setRole] = useState<StaffRole>(account?.role || 'user');
  const [status, setStatus] = useState<AccountStatus>(account?.status || 'active');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resolvedDepartment = deptChoice === '__custom__' ? customDept.trim() : deptChoice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'create' && !isValidEmailFormat(email)) {
      setError('請輸入正確的 Google 帳號 Email 格式（例如：name@tmail.ilc.edu.tw 或 name@gmail.com）');
      return;
    }
    if (!displayName.trim()) {
      setError('請輸入教職員姓名');
      return;
    }
    if (!resolvedDepartment) {
      setError('請選擇或輸入所屬處室名稱');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        await adminCreateAllowedAccount(actorUid, {
          email,
          displayName,
          department: resolvedDepartment,
          jobTitle: jobTitle.trim() || (role === 'admin' ? '系統管理者' : '巡堂使用者'),
          role,
        });
        onSaved(`已新增授權帳號：${displayName.trim()}（${email.trim().toLowerCase()} · ${STAFF_ROLE_LABELS[role]}）`);
      } else if (account) {
        await adminUpdateAllowedAccount(account, {
          displayName,
          department: resolvedDepartment,
          jobTitle: jobTitle.trim() || (role === 'admin' ? '系統管理者' : '巡堂使用者'),
          role,
          status,
        });
        onSaved(`已更新 ${displayName.trim()} 的帳號資料與權限設定`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '儲存帳號失敗，請重試');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              {mode === 'create' ? '新增授權 Google 帳號' : '編輯帳號與權限'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              僅限透過 Google 帳號驗證登入，不需另設密碼
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-slate-900 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-sm">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 block">
              Google 帳號（Email）
            </label>
            <input
              type="email"
              required
              maxLength={120}
              disabled={mode === 'edit'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="例如：eric@tmail.ilc.edu.tw 或 teacher@gmail.com"
              className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg font-mono-num disabled:bg-slate-100 disabled:text-slate-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">姓名</label>
              <input
                type="text"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例如：夏明義"
                className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 block">職稱</label>
              <input
                type="text"
                required
                maxLength={60}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="例如：生教組長、值日教師"
                className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 block">所屬處室</label>
            <select
              value={deptChoice}
              onChange={(e) => setDeptChoice(e.target.value)}
              className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg bg-white"
            >
              {DEFAULT_DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
              <option value="__custom__">其他自訂處室...</option>
            </select>
            {deptChoice === '__custom__' && (
              <input
                type="text"
                required
                maxLength={60}
                value={customDept}
                onChange={(e) => setCustomDept(e.target.value)}
                placeholder="輸入處室名稱，例如：圖書館、特教組"
                className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg"
              />
            )}
          </div>

          {/* Two-Tier Role Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 block">
              系統權限（二層次）
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  {
                    value: 'user' as StaffRole,
                    title: '使用者',
                    desc: '巡堂登錄、缺曠假單、異常通報與匯出報表',
                  },
                  {
                    value: 'admin' as StaffRole,
                    title: '管理者',
                    desc: '含全部功能，並管理授權帳號與全校課表',
                  },
                ] as const
              ).map((opt) => {
                const locked = isBootstrap || (isSelf && opt.value !== role);
                const selected = role === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={locked}
                    onClick={() => setRole(opt.value)}
                    className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      selected
                        ? 'border-teal-700 bg-teal-50/70'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        selected ? 'text-teal-900' : 'text-slate-900'
                      }`}
                    >
                      {opt.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
            {(isBootstrap || isSelf) && (
              <p className="text-xs text-slate-500">
                {isBootstrap
                  ? '主管理者帳號固定為「管理者」權限且不可停用。'
                  : '為避免誤鎖定管理權限，無法自行降級目前登入中的帳號。'}
              </p>
            )}
          </div>

          {/* Account Status on Edit */}
          {mode === 'edit' && !isBootstrap && !isSelf && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 block">帳號狀態</label>
              <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    ['active', '使用中'],
                    ['disabled', '已停用'],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStatus(val)}
                    className={`min-h-[36px] px-4 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                      status === val ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] px-5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-semibold rounded-lg cursor-pointer"
            >
              {saving ? '儲存中...' : mode === 'create' ? '確認新增帳號' : '儲存變更'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
