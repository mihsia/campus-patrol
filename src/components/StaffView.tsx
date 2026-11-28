import React, { useMemo } from 'react';
import * as XLSX from 'xlsx';
import { createAccountHubClient } from '@ltps/account-sdk/core';
import { LtpsAccountManager } from '@ltps/account-sdk/react';
import '@ltps/account-sdk/styles.css';
import { ExternalLink, LogOut, Shield, UserCog, Users } from 'lucide-react';
import { ACCOUNT_HUB_URL, hubFunctions, isAccountHubConfigured } from '../lib/firebase';
import { PATROL_APP_ID } from '../lib/accountHubAdapter';
import type { StaffProfile } from '../types/patrol';
import { STAFF_ROLE_LABELS, normalizeStaffRole } from '../types/patrol';

interface StaffViewProps {
  profile: StaffProfile;
  userEmail: string;
  hubUserUid: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  staffList: StaffProfile[];
  onSignOut: () => Promise<void>;
}

export const StaffView: React.FC<StaffViewProps> = ({
  profile,
  userEmail,
  hubUserUid,
  isAdmin,
  isSuperAdmin,
  staffList,
  onSignOut,
}) => {
  const hubClient = useMemo(() => {
    if (!isAccountHubConfigured || !hubFunctions) return null;
    return createAccountHubClient(hubFunctions);
  }, []);

  // =========================================================================
  // VIEW A: REGULAR USER (巡堂人員) — Personal Account Info + Permission Summary
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
                已整合全校統一帳號管理中心，巡堂紀錄與異常通報將自動署名您的姓名
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#7C7A72]">校級統一登入 Google 帳號</span>
              <span className="font-semibold text-[#1E5C4B]">使用中</span>
            </div>
            <p className="font-mono-num text-sm font-semibold text-[#1F2421] break-all">
              {userEmail}
            </p>
            <div className="pt-2.5 border-t border-[#E5E1D8] grid grid-cols-2 gap-3">
              <div>
                <span className="text-[#7C7A72] block">顯示姓名</span>
                <span className="font-semibold text-[#1F2421] text-sm">{profile.displayName}</span>
              </div>
              <div>
                <span className="text-[#7C7A72] block">校園巡堂權限</span>
                <span className="font-semibold text-[#1E5C4B] text-sm">
                  {STAFF_ROLE_LABELS[normalizeStaffRole(profile.role)]}
                </span>
              </div>
              <div>
                <span className="text-[#7C7A72] block">所屬處室</span>
                <span className="font-medium text-[#1F2421] text-sm">{profile.department}</span>
              </div>
              <div>
                <span className="text-[#7C7A72] block">職稱</span>
                <span className="font-medium text-[#1F2421] text-sm">{profile.jobTitle}</span>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-[#E5F2EE]/60 border border-[#C6DFD7] text-xs text-[#1E5C4B] leading-relaxed space-y-2">
            <p>
              您的姓名、處室、職稱與各校務系統權限皆由「全校統一帳號管理中心」集中維護。如需更正基本資料或申請開通其他系統，請聯繫學校系統管理者。
            </p>
            <a
              href={ACCOUNT_HUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-[#154236]"
            >
              前往全校統一帳號管理中心檢視我的跨系統權限
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="lg:hidden w-full min-h-[44px] px-4 py-2.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            登出目前 Google 帳號
          </button>
        </div>

        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Shield className="w-5 h-5 text-slate-500" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">系統權限層級說明</h2>
                <p className="text-xs text-slate-500">
                  由全校統一帳號管理中心透過 Custom Claims 即時同步授權
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100 text-xs sm:text-sm">
              <div className="py-3 space-y-1">
                <p className="font-semibold text-slate-900">巡堂人員／使用者（您目前的權限）</p>
                <p className="text-slate-600 leading-relaxed">
                  可檢視總覽儀表與即時巡堂、執行行動巡堂快速打卡、通報並接手處理異常事件，以及匯出
                  Word／Excel／PDF 巡堂報表與班級日課表。
                </p>
              </div>
              <div className="py-3 space-y-1">
                <p className="font-semibold text-[#1E5C4B]">系統管理員</p>
                <p className="text-[#5C615C] leading-relaxed">
                  擁有完整使用者功能，並額外負責本系統之帳號授權管理（新增、批次匯入、編輯、停用／啟用與分派角色）、學校設定與班級課表匯入歸檔，以及異常結案覆核與刪除權限。
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
                      normalizeStaffRole(member.role) === 'admin'
                        ? 'text-[#1E5C4B]'
                        : 'text-[#5C615C]'
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
  // VIEW B: ADMIN / SUPER ADMIN — Embedded @ltps/account-sdk Manager
  // =========================================================================
  return (
    <div className="space-y-4">
      <LtpsAccountManager
        mode="app"
        appId={PATROL_APP_ID}
        client={hubClient}
        currentUid={hubUserUid}
        hubUrl={ACCOUNT_HUB_URL}
        xlsxModule={XLSX}
        title="帳號管理"
        subtitle={
          isSuperAdmin
            ? '由全校統一帳號管理中心提供；您具備校級超級管理員身分，本頁異動僅影響校園巡堂系統權限，如需跨系統管理可點擊右上角前往全校帳號中心。'
            : '由全校統一帳號管理中心提供；本頁異動僅影響校園巡堂系統權限，不影響教職員在其他校務系統的登入。'
        }
      />

      <div className="lg:hidden pt-1">
        <button
          type="button"
          onClick={onSignOut}
          className="w-full min-h-[44px] px-4 py-2.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          登出目前 Google 帳號（{userEmail}）
        </button>
      </div>
    </div>
  );
};
