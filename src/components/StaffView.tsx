import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  LayoutGrid,
  List,
  LogOut,
  Power,
  Search,
  Shield,
  Trash2,
  Upload,
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
import { isValidEmailFormat, normalizeEmail } from '../lib/validation';

interface StaffViewProps {
  profile: StaffProfile;
  userEmail: string;
  isAdmin: boolean;
  allowedAccounts: AllowedAccount[];
  staffList: StaffProfile[];
  onSignOut: () => Promise<void>;
  onActionFeedback: (message: string) => void;
}

type AccountFilter = 'all' | 'admin' | 'user' | 'disabled';
type AccountViewMode = 'compact' | 'grouped';

export const StaffView: React.FC<StaffViewProps> = ({
  profile,
  userEmail,
  isAdmin,
  allowedAccounts,
  staffList,
  onSignOut,
  onActionFeedback,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<AccountFilter>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<AccountViewMode>('compact');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
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

  // Available department pills ordered by school convention
  const departmentTabs = useMemo(() => {
    const deptOrder = new Map<string, number>();
    DEFAULT_DEPARTMENTS.forEach((d, idx) => deptOrder.set(d, idx));
    const countMap = new Map<string, number>();
    allowedAccounts.forEach((acc) => {
      const dept = acc.department || '未分類處室';
      countMap.set(dept, (countMap.get(dept) || 0) + 1);
    });
    return Array.from(countMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        const oa = deptOrder.has(a.name) ? deptOrder.get(a.name)! : 99;
        const ob = deptOrder.has(b.name) ? deptOrder.get(b.name)! : 99;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name, 'zh-Hant');
      });
  }, [allowedAccounts]);

  // Flat filtered & sorted accounts list
  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const deptOrder = new Map<string, number>();
    DEFAULT_DEPARTMENTS.forEach((d, idx) => deptOrder.set(d, idx));

    return allowedAccounts
      .filter((acc) => {
        if (filterMode === 'admin' && (acc.role !== 'admin' || acc.status !== 'active')) return false;
        if (filterMode === 'user' && (acc.role !== 'user' || acc.status !== 'active')) return false;
        if (filterMode === 'disabled' && acc.status !== 'disabled') return false;
        if (departmentFilter !== 'ALL' && (acc.department || '未分類處室') !== departmentFilter) {
          return false;
        }
        if (!q) return true;
        return (
          acc.displayName.toLowerCase().includes(q) ||
          acc.email.toLowerCase().includes(q) ||
          acc.department.toLowerCase().includes(q) ||
          acc.jobTitle.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aBoot = a.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() ? 0 : 1;
        const bBoot = b.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() ? 0 : 1;
        if (aBoot !== bBoot) return aBoot - bBoot;
        const da = deptOrder.has(a.department) ? deptOrder.get(a.department)! : 99;
        const db = deptOrder.has(b.department) ? deptOrder.get(b.department)! : 99;
        if (da !== db) return da - db;
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        return a.displayName.localeCompare(b.displayName, 'zh-Hant');
      });
  }, [allowedAccounts, searchQuery, filterMode, departmentFilter]);

  // Grouped by Department (處室)
  const groupedDepartments = useMemo(() => {
    const deptOrder = new Map<string, number>();
    DEFAULT_DEPARTMENTS.forEach((d, idx) => deptOrder.set(d, idx));

    const map = new Map<string, AllowedAccount[]>();
    filteredAccounts.forEach((acc) => {
      const dept = acc.department || '未分類處室';
      const arr = map.get(dept) ?? [];
      arr.push(acc);
      map.set(dept, arr);
    });

    return Array.from(map.entries())
      .map(([dept, items]) => ({
        department: dept,
        accounts: items,
      }))
      .sort((a, b) => {
        const oa = deptOrder.has(a.department) ? deptOrder.get(a.department)! : 99;
        const ob = deptOrder.has(b.department) ? deptOrder.get(b.department)! : 99;
        if (oa !== ob) return oa - ob;
        return a.department.localeCompare(b.department, 'zh-Hant');
      });
  }, [filteredAccounts]);

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

  const handleInlineToggleRole = async (acc: AllowedAccount) => {
    const nextRole: StaffRole = acc.role === 'admin' ? 'user' : 'admin';
    setBusyId(acc.id);
    try {
      await adminUpdateAllowedAccount(acc, {
        displayName: acc.displayName,
        department: acc.department,
        jobTitle: acc.jobTitle,
        role: nextRole,
        status: acc.status,
      });
      onActionFeedback(
        `已將 ${acc.displayName} 權限切換為「${STAFF_ROLE_LABELS[nextRole]}」`
      );
    } catch (err) {
      onActionFeedback(err instanceof Error ? err.message : '切換角色失敗');
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
        <div className="lg:col-span-6 bg-white border border-[#E5E1D8] rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-[#F6E8EC] text-[#5F2230] flex items-center justify-center shrink-0">
              <UserCog className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-[#1F2421]">個人帳號與權限資料</h2>
              <p className="text-xs text-[#7C7A72]">
                本系統採用 Google 授權帳號登入，巡堂紀錄與異常通報將自動署名您的姓名
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#7C7A72]">授權登入 Google 帳號</span>
              <span className="font-semibold text-[#1E5C4B]">使用中</span>
            </div>
            <p className="font-mono-num text-sm font-semibold text-[#1F2421] break-all">{userEmail}</p>
            <div className="pt-2 border-t border-[#E5E1D8] flex items-center justify-between">
              <span className="text-[#7C7A72]">系統權限層級</span>
              <span className="font-semibold text-[#1F2421]">
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
              className="w-full min-h-[44px] px-4 py-2.5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {savingProfile ? '儲存中...' : '儲存個人顯示資料'}
            </button>

            <button
              type="button"
              onClick={onSignOut}
              className="lg:hidden w-full min-h-[44px] px-4 py-2.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              登出目前 Google 帳號
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
                  可檢視總覽儀表與即時巡堂、執行行動巡堂快速打卡、通報並接手處理異常事件，以及匯出 Word／Excel／PDF 巡堂報表與班級日課表。
                </p>
              </div>
              <div className="py-3 space-y-1">
                <p className="font-semibold text-[#1E5C4B]">管理者</p>
                <p className="text-[#5C615C] leading-relaxed">
                  擁有完整使用者功能，並額外負責 Google 授權帳號控管（新增、批次匯入、編輯、停用／啟用與分派角色）、學校設定與班級課表匯入歸檔，以及異常結案覆核與刪除權限。
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E5E1D8] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#7C7A72]" />
                <h3 className="text-sm font-semibold text-[#1F2421]">
                  已登入協作人員（<span className="font-mono-num">{staffList.length}</span> 人）
                </h3>
              </div>
              <span className="text-xs text-[#7C7A72]">不含個人 Email 隱私</span>
            </div>
            <div className="divide-y divide-[#F0ECE3]">
              {staffList.map((member) => (
                <div
                  key={member.uid}
                  className="px-5 py-3 flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-[#1F2421]">
                      {member.displayName}
                      {member.uid === profile.uid && (
                        <span className="text-xs text-[#1E5C4B] ml-1.5">（目前登入）</span>
                      )}
                    </p>
                    <p className="text-xs text-[#7C7A72]">
                      {member.department} · {member.jobTitle}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold ${
                      normalizeStaffRole(member.role) === 'admin' ? 'text-[#1E5C4B]' : 'text-[#5C615C]'
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

  // Reusable Account Table Renderer (used in both Compact Single Table & Department-Grouped Modes)
  const renderAccountTable = (accounts: AllowedAccount[], showDepartmentBadge: boolean) => (
    <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
      {/* Mobile Touch Card View (< md) */}
      <div className="md:hidden divide-y divide-[#F0ECE3]">
        {accounts.map((acc) => {
          const isBootstrap =
            acc.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
          const isSelf = acc.email.toLowerCase() === userEmail.toLowerCase();
          const isBusy = busyId === acc.id;
          const canMutateRoleOrStatus = !isBootstrap && !isSelf && !isBusy;

          return (
            <div
              key={acc.id}
              className={`p-4 space-y-3 ${acc.status === 'disabled' ? 'bg-[#FAF9F5]/80 opacity-80' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#1F2421] flex items-center gap-1.5 flex-wrap">
                    <span>{acc.displayName}</span>
                    {showDepartmentBadge && (
                      <span className="px-2 py-0.5 rounded-md bg-[#F2EFE9] text-[#5C615C] text-[11px] font-medium">
                        {acc.department}
                      </span>
                    )}
                    {isSelf && (
                      <span className="text-xs font-normal text-[#1E5C4B]">（目前登入）</span>
                    )}
                  </div>
                  <p className="text-xs text-[#7C7A72] mt-0.5">{acc.jobTitle}</p>
                </div>

                {/* Inline Role Pill */}
                <button
                  type="button"
                  disabled={!canMutateRoleOrStatus}
                  onClick={() => handleInlineToggleRole(acc)}
                  title={
                    isBootstrap
                      ? '系統主管理者權限受保護'
                      : isSelf
                        ? '無法降級自己'
                        : '點擊切換管理者／使用者權限'
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors shrink-0 ${
                    acc.role === 'admin'
                      ? 'bg-[#E5F2EE] text-[#1E5C4B] border-[#C6DFD7]'
                      : 'bg-[#FAF9F5] text-[#5C615C] border-[#E5E1D8]'
                  } ${canMutateRoleOrStatus ? 'cursor-pointer hover:opacity-85' : 'opacity-75 cursor-default'}`}
                >
                  {STAFF_ROLE_LABELS[acc.role]}
                </button>
              </div>

              <div className="text-xs font-mono-num text-[#3A3F3B] break-all">
                {acc.email}
                <span className="ml-2 font-sans text-[11px] text-[#9A968C]">
                  · {acc.uid ? '已綁定登入' : '待首次登入'}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setEditingAccount(acc)}
                  className="flex-1 min-h-[40px] px-3 py-1.5 text-xs font-medium text-[#3A3F3B] bg-white hover:bg-[#FAF9F5] border border-[#DDD8CD] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  編輯
                </button>
                {isBootstrap ? (
                  <span className="text-xs text-[#9A968C] px-2">主管理者</span>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isBusy || isSelf}
                      onClick={() => handleToggleStatus(acc)}
                      className={`flex-1 min-h-[40px] px-3 py-1.5 text-xs font-semibold rounded-xl border inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 ${
                        acc.status === 'active'
                          ? 'text-[#3A3F3B] bg-[#FAF9F5] border-[#DDD8CD]'
                          : 'text-[#1E5C4B] bg-[#E5F2EE] border-[#C6DFD7]'
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
                        className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-[#9A968C] hover:text-[#B44326] border border-[#DDD8CD] rounded-xl cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop & Tablet Compact Table View (>= md) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#E5E1D8] bg-[#FAF9F5] text-xs font-semibold text-[#7C7A72]">
              <th className="py-3 px-4">姓名／處室職稱</th>
              <th className="py-3 px-4">Google 帳號</th>
              <th className="py-3 px-4 w-[130px]">權限（點擊切換）</th>
              <th className="py-3 px-4 w-[125px]">啟用狀態</th>
              <th className="py-3 px-4 text-right w-[130px]">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0ECE3]">
            {accounts.map((acc) => {
              const isBootstrap =
                acc.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
              const isSelf = acc.email.toLowerCase() === userEmail.toLowerCase();
              const isBusy = busyId === acc.id;
              const canMutateRoleOrStatus = !isBootstrap && !isSelf && !isBusy;

              return (
                <tr
                  key={acc.id}
                  className={`transition-colors ${
                    acc.status === 'disabled'
                      ? 'bg-[#FAF9F5]/80 text-[#7C7A72]'
                      : 'hover:bg-[#FAF9F5]/70'
                  }`}
                >
                  <td className="py-3 px-4 align-middle">
                    <div className="font-semibold text-[#1F2421] flex items-center gap-1.5 flex-wrap">
                      <span>{acc.displayName}</span>
                      {showDepartmentBadge && (
                        <span className="px-2 py-0.5 rounded-md bg-[#F2EFE9] text-[#5C615C] text-[11px] font-medium">
                          {acc.department}
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-xs font-normal text-[#1E5C4B]">（目前登入）</span>
                      )}
                    </div>
                    <p className="text-xs text-[#7C7A72] mt-0.5">{acc.jobTitle}</p>
                  </td>

                  <td className="py-3 px-4 align-middle">
                    <div className="font-mono-num text-xs sm:text-sm text-[#3A3F3B] break-all">
                      {acc.email}
                    </div>
                    <p className="text-[11px] text-[#9A968C] mt-0.5">
                      {acc.uid ? '已完成 Google 登入綁定' : '預先授權・尚未初次登入'}
                    </p>
                  </td>

                  <td className="py-3 px-4 align-middle whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!canMutateRoleOrStatus}
                      onClick={() => handleInlineToggleRole(acc)}
                      title={
                        isBootstrap
                          ? '主管理者角色受保護'
                          : isSelf
                            ? '無法變更自己權限'
                            : '點擊原地切換管理者／使用者'
                      }
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                        acc.role === 'admin'
                          ? 'bg-[#E5F2EE] text-[#1E5C4B] border-[#C6DFD7]'
                          : 'bg-[#FAF9F5] text-[#5C615C] border-[#E5E1D8]'
                      } ${
                        canMutateRoleOrStatus
                          ? 'cursor-pointer hover:border-[#1E5C4B]'
                          : 'cursor-default opacity-80'
                      }`}
                    >
                      {STAFF_ROLE_LABELS[acc.role]}
                    </button>
                  </td>

                  <td className="py-3 px-4 align-middle whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={acc.status === 'active'}
                        aria-label={`切換 ${acc.displayName} 啟用狀態`}
                        disabled={!canMutateRoleOrStatus}
                        onClick={() => handleToggleStatus(acc)}
                        title={
                          isBootstrap
                            ? '主管理者不可停用'
                            : isSelf
                              ? '無法停用自己'
                              : acc.status === 'active'
                                ? '點擊立即停用帳號'
                                : '點擊重新啟用帳號'
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          acc.status === 'active' ? 'bg-[#1E5C4B]' : 'bg-[#D4CEC2]'
                        } ${canMutateRoleOrStatus ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            acc.status === 'active' ? 'translate-x-4.5' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <span
                        className={`text-xs font-semibold ${
                          acc.status === 'active' ? 'text-[#1E5C4B]' : 'text-[#B44326]'
                        }`}
                      >
                        {ACCOUNT_STATUS_LABELS[acc.status]}
                      </span>
                    </div>
                  </td>

                  <td className="py-3 px-4 align-middle text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setEditingAccount(acc)}
                        className="min-h-[34px] px-2.5 py-1 text-xs font-medium text-[#3A3F3B] bg-white hover:bg-[#FAF9F5] border border-[#DDD8CD] rounded-lg inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        編輯
                      </button>
                      {isBootstrap ? (
                        <span className="text-[11px] text-[#9A968C] px-1">主管理者</span>
                      ) : (
                        !isSelf && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmDeleteAccount(acc)}
                            aria-label={`刪除 ${acc.displayName}`}
                            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-[#9A968C] hover:text-[#B44326] hover:bg-[#FCEBE7] rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // =========================================================================
  // VIEW B: SYSTEM ADMIN (管理者) — Streamlined Account Console
  // =========================================================================
  return (
    <div className="space-y-5">
      {/* Header & Primary Actions */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-[#1F2421] tracking-tight">帳號管理</h2>
          <p className="text-sm text-[#5C615C]">
            僅限白名單內「使用中」之 Google 帳號登入，可原地點擊切換權限與啟用狀態，或批次匯入教職員名單
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowProfilePanel((prev) => !prev)}
            className="min-h-[40px] px-3.5 py-2 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <UserCog className="w-4 h-4" />
            個人設定
          </button>
          <button
            type="button"
            onClick={() => setShowBatchImportModal(true)}
            className="min-h-[40px] px-3.5 py-2 bg-[#E5F2EE] hover:bg-[#D5EAE3] text-[#1E5C4B] border border-[#C6DFD7] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <Upload className="w-4 h-4" />
            批次匯入名單
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="min-h-[40px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            新增授權帳號
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="lg:hidden min-h-[40px] px-3 py-2 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-xs font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            登出
          </button>
        </div>
      </div>

      {/* Optional Collapsible Own Profile Settings for Admin */}
      {showProfilePanel && (
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[#1F2421]">個人顯示資料設定</h3>
              <p className="text-xs text-[#7C7A72] mt-0.5">
                目前登入：<span className="font-mono-num text-[#3A3F3B]">{userEmail}</span> · 權限：管理者
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowProfilePanel(false)}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#9A968C] hover:text-[#1F2421] cursor-pointer"
              aria-label="收合個人資料設定"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSaveOwnProfile} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end text-sm">
            <div>
              <label className="text-xs font-semibold text-[#3A3F3B] block mb-1">顯示姓名</label>
              <input
                type="text"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#3A3F3B] block mb-1">所屬處室</label>
              <input
                type="text"
                required
                maxLength={60}
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5]"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#3A3F3B] block mb-1">職稱</label>
              <input
                type="text"
                required
                maxLength={60}
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-[#E5E1D8] rounded-lg bg-[#FAF9F5]"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="min-h-[40px] px-4 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap"
            >
              {savingProfile ? '儲存中...' : '儲存個人資料'}
            </button>
          </form>
        </div>
      )}

      {/* Unified Filter, Department Pills, View Mode & Search Toolbar */}
      <div className="bg-white border border-[#E5E1D8] rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl overflow-x-auto">
              {(
                [
                  ['all', `全部（${counts.total}）`],
                  ['admin', `管理者（${counts.admins}）`],
                  ['user', `使用者（${counts.users}）`],
                  ['disabled', `已停用（${counts.disabled}）`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilterMode(id)}
                  className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    filterMode === id
                      ? 'bg-[#1E5C4B] text-white shadow-xs'
                      : 'text-[#5C615C] hover:text-[#1F2421]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Compact vs Grouped View Switcher */}
            <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('compact')}
                className={`min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'compact'
                    ? 'bg-white text-[#1F2421] shadow-xs'
                    : 'text-[#5C615C] hover:text-[#1F2421]'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                緊湊清單
              </button>
              <button
                type="button"
                onClick={() => setViewMode('grouped')}
                className={`min-h-[34px] px-2.5 py-1 text-xs font-semibold rounded-lg inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  viewMode === 'grouped'
                    ? 'bg-white text-[#1F2421] shadow-xs'
                    : 'text-[#5C615C] hover:text-[#1F2421]'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                處室分組
              </button>
            </div>
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-[#9A968C] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋姓名、Google 帳號或處室..."
              className="w-full min-h-[38px] pl-9 pr-3 py-1.5 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
            />
          </div>
        </div>

        {/* Department Filter Pills */}
        {departmentTabs.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-[#F0ECE3]">
            <button
              type="button"
              onClick={() => setDepartmentFilter('ALL')}
              className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                departmentFilter === 'ALL'
                  ? 'bg-[#1F2421] text-white'
                  : 'bg-[#FAF9F5] text-[#5C615C] hover:bg-[#F2EFE9]'
              }`}
            >
              全部處室（{allowedAccounts.length}）
            </button>
            {departmentTabs.map((dept) => (
              <button
                key={dept.name}
                type="button"
                onClick={() => setDepartmentFilter(dept.name)}
                className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                  departmentFilter === dept.name
                    ? 'bg-[#1F2421] text-white'
                    : 'bg-[#FAF9F5] text-[#5C615C] hover:bg-[#F2EFE9]'
                }`}
              >
                {dept.name}（{dept.count}）
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Account Listing (Compact Single Table OR Department-Grouped Tables) */}
      {filteredAccounts.length === 0 ? (
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-10 text-center space-y-3">
          <Users className="w-8 h-8 text-[#9A968C] mx-auto" />
          <p className="text-sm font-semibold text-[#1F2421]">目前沒有符合篩選條件的授權帳號</p>
          <p className="text-xs text-[#7C7A72]">
            點擊右上方「新增授權帳號」或「批次匯入名單」即可指派各處室教職員的系統權限
          </p>
        </div>
      ) : viewMode === 'compact' ? (
        renderAccountTable(filteredAccounts, true)
      ) : (
        <div className="space-y-5">
          {groupedDepartments.map((group) => (
            <section key={group.department} className="space-y-2">
              <div className="flex items-baseline gap-2.5 px-1">
                <h3 className="text-sm font-bold text-[#1E5C4B]">{group.department}</h3>
                <span className="text-xs text-[#7C7A72] font-mono-num">
                  {group.accounts.length} 位帳號
                </span>
              </div>
              {renderAccountTable(group.accounts, false)}
            </section>
          ))}
        </div>
      )}

      {/* Two-Tier Permission Reference Footer (Updated to match current CampusPatrol modules) */}
      <div className="bg-white border border-[#E5E1D8] rounded-2xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <p className="font-semibold text-[#1E5C4B] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            管理者權限範圍
          </p>
          <p className="text-[#5C615C] leading-relaxed">
            可管理全校 Google 授權帳號（單筆新增、批次匯入、原地切換權限與啟用狀態）、維護學校設定與班級課表資料庫／學年度歸檔、覆核或刪除異常通報紀錄，並具備完整巡堂與報表匯出功能。
          </p>
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-[#1F2421] flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            使用者權限範圍
          </p>
          <p className="text-[#5C615C] leading-relaxed">
            僅限使用經授權且狀態為「使用中」的 Google 帳號登入，可檢視總覽儀表與即時巡堂、執行行動巡堂快速打卡、通報並接手結案異常事件，以及下載 Word／Excel／PDF 巡堂報表與班級日課表。
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

      {/* Batch Import Accounts Modal */}
      {showBatchImportModal && (
        <BatchImportAccountsModal
          actorUid={profile.uid}
          existingEmails={allowedAccounts.map((a) => a.email.toLowerCase())}
          onClose={() => setShowBatchImportModal(false)}
          onImported={(msg) => {
            setShowBatchImportModal(false);
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
                        ? 'border-[#1E5C4B] bg-[#E5F2EE]/60'
                        : 'border-[#E5E1D8] bg-white hover:bg-[#FAF9F5]'
                    }`}
                  >
                    <p
                      className={`text-sm font-semibold ${
                        selected ? 'text-[#1E5C4B]' : 'text-[#1F2421]'
                      }`}
                    >
                      {opt.title}
                    </p>
                    <p className="text-xs text-[#7C7A72] mt-1 leading-relaxed">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
            {(isBootstrap || isSelf) && (
              <p className="text-xs text-[#7C7A72]">
                {isBootstrap
                  ? '主管理者帳號固定為「管理者」權限且不可停用。'
                  : '為避免誤鎖定管理權限，無法自行降級目前登入中的帳號。'}
              </p>
            )}
          </div>

          {/* Account Status on Edit */}
          {mode === 'edit' && !isBootstrap && !isSelf && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#5C615C] block">帳號狀態</label>
              <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl">
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
                    className={`min-h-[36px] px-4 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
                      status === val ? 'bg-[#1E5C4B] text-white shadow-xs' : 'text-[#5C615C]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#B44326]">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-4 text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] px-5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white font-semibold rounded-xl cursor-pointer transition-colors"
            >
              {saving ? '儲存中...' : mode === 'create' ? '確認新增帳號' : '儲存變更'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =========================================================================
// Batch Paste Import Authorized Google Accounts Modal
// =========================================================================
interface ParsedBatchAccount {
  lineNo: number;
  displayName: string;
  email: string;
  department: string;
  jobTitle: string;
  role: StaffRole;
  status: 'valid' | 'duplicate' | 'invalid';
  reason?: string;
}

const BatchImportAccountsModal: React.FC<{
  actorUid: string;
  existingEmails: string[];
  onClose: () => void;
  onImported: (message: string) => void;
}> = ({ actorUid, existingEmails, onClose, onImported }) => {
  const [rawText, setRawText] = useState('');
  const [defaultDepartment, setDefaultDepartment] = useState('教務處');
  const [defaultRole, setDefaultRole] = useState<StaffRole>('user');
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsedRows = useMemo<ParsedBatchAccount[]>(() => {
    const existingSet = new Set(existingEmails.map((e) => e.toLowerCase()));
    const seenInBatch = new Set<string>();
    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    return lines.map((line, idx) => {
      const cols = line
        .split(line.includes('\t') ? '\t' : /[,，]/)
        .map((c) => c.trim());

      // Detect whether first or second column is email (allows either "姓名, Email" or "Email, 姓名")
      let displayName = cols[0] || '';
      let rawEmail = cols[1] || '';
      if (displayName.includes('@') && !rawEmail.includes('@')) {
        [displayName, rawEmail] = [rawEmail || displayName.split('@')[0], displayName];
      }

      const email = normalizeEmail(rawEmail);
      const department = cols[2] || defaultDepartment;
      const jobTitle = cols[3] || '巡堂人員';
      const roleCol = (cols[4] || '').toLowerCase();
      const role: StaffRole =
        roleCol === 'admin' || roleCol === '管理者'
          ? 'admin'
          : roleCol === 'user' || roleCol === '使用者'
            ? 'user'
            : defaultRole;

      if (!displayName || !isValidEmailFormat(email)) {
        return {
          lineNo: idx + 1,
          displayName: displayName || '(未填姓名)',
          email: rawEmail || '(未填 Email)',
          department,
          jobTitle,
          role,
          status: 'invalid',
          reason: '格式錯誤（需含姓名與有效 Email）',
        };
      }
      if (existingSet.has(email) || seenInBatch.has(email)) {
        return {
          lineNo: idx + 1,
          displayName,
          email,
          department,
          jobTitle,
          role,
          status: 'duplicate',
          reason: existingSet.has(email) ? '已存在於授權名單' : '貼上清單內重複',
        };
      }

      seenInBatch.add(email);
      return {
        lineNo: idx + 1,
        displayName,
        email,
        department,
        jobTitle,
        role,
        status: 'valid',
      };
    });
  }, [rawText, defaultDepartment, defaultRole, existingEmails]);

  const validRows = useMemo(() => parsedRows.filter((r) => r.status === 'valid'), [parsedRows]);
  const skippedCount = parsedRows.length - validRows.length;

  const handleBatchSubmit = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    setErrorMsg(null);
    let created = 0;
    const failedEmails: string[] = [];
    try {
      for (const row of validRows) {
        try {
          await adminCreateAllowedAccount(actorUid, {
            email: row.email,
            displayName: row.displayName,
            department: row.department,
            jobTitle: row.jobTitle,
            role: row.role,
          });
          created += 1;
        } catch {
          failedEmails.push(row.email);
        }
      }
      if (created > 0) {
        onImported(
          `已批次匯入 ${created} 筆授權 Google 帳號${
            failedEmails.length > 0 ? `（${failedEmails.length} 筆失敗）` : ''
          }`
        );
      } else {
        setErrorMsg('批次匯入失敗，請確認帳號資料格式與管理者權限');
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full sm:max-w-2xl max-h-[90vh] rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#1F2421]">批次匯入授權 Google 帳號</h3>
            <p className="text-xs text-[#7C7A72] mt-0.5">
              支援直接從 Excel／Google 試算表複製貼上，每行一筆：姓名, Google Email, 處室, 職稱, 角色
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#9A968C] hover:text-[#1F2421] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-sm">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-[#FCEBE7] border border-[#EABEB0] text-xs text-[#9E351E]">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="font-semibold text-[#5C615C] block mb-1">
                未填處室時預設處室
              </label>
              <select
                value={defaultDepartment}
                onChange={(e) => setDefaultDepartment(e.target.value)}
                className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-xl bg-[#FAF9F5]"
              >
                {DEFAULT_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="font-semibold text-[#5C615C] block mb-1">
                未填角色時預設權限
              </label>
              <select
                value={defaultRole}
                onChange={(e) => setDefaultRole(e.target.value as StaffRole)}
                className="w-full min-h-[38px] px-3 border border-[#E5E1D8] rounded-xl bg-[#FAF9F5]"
              >
                <option value="user">使用者（巡堂與報表權限）</option>
                <option value="admin">管理者（完整管理權限）</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#3A3F3B] block">
              貼上名單（逗號或 Tab 分隔，前兩欄必填，其餘可省略）
            </label>
            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`範例：\n陳淑芬, teacher1@tmail.ilc.edu.tw, 教務處, 教學組長, 使用者\n王小明, teacher2@tmail.ilc.edu.tw, 學務處, 生教組長`}
              className="w-full px-3.5 py-2.5 text-xs font-mono-num border border-[#E5E1D8] rounded-xl bg-[#FAF9F5] focus:bg-white focus:outline-none focus:border-[#1E5C4B]"
            />
          </div>

          {parsedRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#1F2421]">
                  解析預覽：可匯入{' '}
                  <span className="font-mono-num text-[#1E5C4B]">{validRows.length}</span> 筆
                  {skippedCount > 0 && (
                    <span className="text-[#9A5B13] ml-1.5">（略過 {skippedCount} 筆）</span>
                  )}
                </span>
              </div>
              <div className="max-h-48 overflow-y-auto border border-[#E5E1D8] rounded-xl divide-y divide-[#F0ECE3] text-xs">
                {parsedRows.map((r) => (
                  <div
                    key={r.lineNo}
                    className={`px-3 py-2 flex items-center justify-between gap-2 ${
                      r.status === 'valid' ? 'bg-white' : 'bg-[#FAF9F5] text-[#7C7A72]'
                    }`}
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-semibold text-[#1F2421]">{r.displayName}</span>
                      <span className="font-mono-num ml-2">{r.email}</span>
                      <span className="ml-2 text-[#7C7A72]">
                        {r.department} · {r.jobTitle} · {STAFF_ROLE_LABELS[r.role]}
                      </span>
                    </div>
                    <span
                      className={`shrink-0 font-semibold ${
                        r.status === 'valid'
                          ? 'text-[#1E5C4B]'
                          : r.status === 'duplicate'
                            ? 'text-[#9A5B13]'
                            : 'text-[#B44326]'
                      }`}
                    >
                      {r.status === 'valid' ? '可匯入' : r.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[#E5E1D8] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 text-sm text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            disabled={importing || validRows.length === 0}
            onClick={handleBatchSubmit}
            className="min-h-[40px] px-5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-50 text-white text-sm font-semibold rounded-xl cursor-pointer transition-colors"
          >
            {importing ? '匯入中...' : `確認匯入 ${validRows.length} 筆帳號`}
          </button>
        </div>
      </div>
    </div>
  );
};
