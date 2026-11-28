import React, { useState } from 'react';
import {
  Ban,
  BellRing,
  Check,
  ClipboardCheck,
  Copy,
  FileSpreadsheet,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface SignInScreenProps {
  onSignIn: () => Promise<void>;
  signingIn: boolean;
  errorMessage: string | null;
}

const HERO_IMAGE_PATH = '/src/assets/images/campus_corridor_hero_1795748402611.jpg';

export const SignInScreen: React.FC<SignInScreenProps> = ({
  onSignIn,
  signingIn,
  errorMessage,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F6F4EE] flex flex-col lg:grid lg:grid-cols-12">
      {/* Left Visual Column: Editorial Campus Corridor Photography */}
      <div className="relative lg:col-span-7 min-h-[260px] lg:min-h-screen bg-[#153F34] overflow-hidden flex flex-col justify-between">
        {!imgFailed ? (
          <img
            src={HERO_IMAGE_PATH}
            alt="校園教學大樓晨間走廊實景"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#12372D] via-[#1E5C4B] to-[#173E34]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#122620]/90 via-[#15352C]/45 to-[#122620]/30" />

        <div className="relative z-10 p-6 lg:p-10 flex items-center gap-3">
          <img
            src="/icon.svg"
            alt="校園即時巡堂系統圖示"
            className="w-10 h-10 rounded-xl border border-white/25 shrink-0 shadow-sm"
          />
          <span className="text-lg font-bold tracking-tight text-white">
            校園即時巡堂系統 CampusPatrol
          </span>
        </div>

        <div className="relative z-10 p-6 lg:p-10 max-w-2xl space-y-4">
          <h1
            className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight tracking-tight"
            style={{ textWrap: 'balance' }}
          >
            跨裝置即時巡堂、自動缺曠判別與異常事件推播平台
          </h1>
          <p className="text-sm sm:text-base text-[#E6EFEA] leading-relaxed max-w-xl">
            整合全校課表資料庫與核准假單，協助各處室與巡堂人員於手機與桌機同步完成巡堂檢核、即時掌握班級出缺席狀態，一鍵匯出正式 PDF 與 Excel 報表。
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#CFE1D9]">
            <span>Google 授權帳號控管</span>
            <span aria-hidden="true">·</span>
            <span>管理者／使用者二層次權限</span>
            <span aria-hidden="true">·</span>
            <span>即時推播異常警示</span>
            <span aria-hidden="true">·</span>
            <span>Excel／PDF 正式報表</span>
          </div>
        </div>
      </div>

      {/* Right Sign-In Column */}
      <div className="lg:col-span-5 flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-[#FAF9F5]">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#1E5C4B]">Google 授權帳號登入</p>
            <h2 className="text-2xl font-bold text-[#1F2421] tracking-tight">
              登入巡堂管理工作台
            </h2>
            <p className="text-sm text-[#5C615C] leading-relaxed">
              本系統僅開放經系統管理者授權之 Google 帳號登入使用，並依「管理者」與「使用者」二層次權限進行存取控管。
            </p>
          </div>

          <div className="space-y-3.5">
            <button
              type="button"
              onClick={onSignIn}
              disabled={signingIn}
              className="w-full min-h-[48px] px-5 py-3 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-3 cursor-pointer"
            >
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <span>{signingIn ? '正在驗證 Google 帳號...' : '使用 Google 帳號登入系統'}</span>
            </button>

            <PWAInstallButton variant="banner" />

            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#B44326] leading-relaxed break-all">
                {errorMessage}
              </div>
            )}
          </div>

          <div className="border-t border-[#E5E1D8] pt-6 space-y-3.5">
            <p className="text-xs font-semibold text-[#7C7A72]">系統核心功能</p>
            <ul className="space-y-3 text-sm text-[#5C615C]">
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-lg bg-[#E5F2EE] text-[#1E5C4B] flex items-center justify-center shrink-0 mt-0.5">
                  <Smartphone className="w-4 h-4" />
                </span>
                <span>桌機儀表板與手機行動巡堂雙介面，走動巡視單手即可完成登錄</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-lg bg-[#FBF0E2] text-[#9A5B13] flex items-center justify-center shrink-0 mt-0.5">
                  <ClipboardCheck className="w-4 h-4" />
                </span>
                <span>整合學校課表與假單資料，自動判別疑似曠課與連續缺課高風險</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-lg bg-[#FCEBE7] text-[#B8432E] flex items-center justify-center shrink-0 mt-0.5">
                  <BellRing className="w-4 h-4" />
                </span>
                <span>緊急異常即時推播與分級派發，完整追蹤接手至結案歷程</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-lg bg-[#E9ECF7] text-[#354488] flex items-center justify-center shrink-0 mt-0.5">
                  <FileSpreadsheet className="w-4 h-4" />
                </span>
                <span>一鍵匯出多工作表 Excel（.xlsx）、CSV 與含核章欄之 A4 PDF 報表</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

interface AccessBlockedScreenProps {
  reason: 'unauthorized' | 'disabled';
  email: string;
  displayName?: string;
  department?: string;
  detailMessage?: string | null;
  hubUrl?: string;
  onSignOut: () => Promise<void>;
  onSwitchAccount: () => Promise<void>;
}

export const AccessBlockedScreen: React.FC<AccessBlockedScreenProps> = ({
  reason,
  email,
  displayName,
  department,
  detailMessage,
  hubUrl,
  onSignOut,
  onSwitchAccount,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const isDisabled = reason === 'disabled';

  return (
    <div className="min-h-screen bg-[#F6F4EE] flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white border border-[#E5E1D8] rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              isDisabled ? 'bg-[#FCECE6] text-[#B44326]' : 'bg-[#FBF0E2] text-[#9A5B13]'
            }`}
          >
            {isDisabled ? <Ban className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[#7C7A72]">
              校園即時巡堂系統 CampusPatrol · 全校統一帳號權限控管
            </p>
            <h1 className="text-xl font-bold text-[#1F2421]">
              {isDisabled ? '此帳號之巡堂系統權限已停用' : '此帳號尚未開通巡堂系統權限'}
            </h1>
            <p className="text-sm text-[#5C615C] leading-relaxed">
              {detailMessage ||
                (isDisabled
                  ? '系統管理者已於全校帳號管理中心停用您的存取權限，目前無法檢視或操作校務資料。如需重新啟用，請聯繫學校系統管理者。'
                  : '本系統已整合全校統一帳號管理中心，僅限已開通「校園巡堂」權限的教職員登入。請將下列帳號提供給管理者開通權限後再重新登入。')}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[#7C7A72]">目前登入之 Google 帳號</span>
            <button
              type="button"
              onClick={handleCopyEmail}
              className="text-xs font-semibold text-[#1E5C4B] hover:text-[#16473A] inline-flex items-center gap-1 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '已複製帳號' : '複製帳號'}
            </button>
          </div>
          <p className="font-mono-num font-semibold text-[#1F2421] break-all">{email}</p>
          {(displayName || department) && (
            <p className="text-xs text-[#7C7A72] pt-1">
              {displayName}
              {department ? ` · ${department}` : ''}
              {isDisabled && (
                <>
                  <span aria-hidden="true"> · </span>
                  <span className="text-[#B44326] font-semibold">狀態：已停用</span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-1">
          <button
            type="button"
            onClick={onSwitchAccount}
            className="flex-1 min-h-[44px] px-4 py-2.5 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
          >
            切換其他 Google 帳號
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="min-h-[44px] px-4 py-2.5 bg-white hover:bg-[#FAF9F5] text-[#3A3F3B] border border-[#DDD8CD] text-sm font-medium rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            登出系統
          </button>
        </div>

        {hubUrl && (
          <p className="text-center text-xs text-[#7C7A72]">
            管理者請前往{' '}
            <a
              href={hubUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#1E5C4B] underline underline-offset-2"
            >
              全校統一帳號管理中心
            </a>{' '}
            為此帳號指派「校園巡堂」權限。
          </p>
        )}
      </div>
    </div>
  );
};

export const HubConfigMissingScreen: React.FC = () => (
  <div className="min-h-screen bg-[#F6F4EE] flex items-center justify-center p-6">
    <div className="w-full max-w-xl bg-white border border-[#E5E1D8] rounded-2xl p-6 sm:p-8 space-y-5">
      <div className="flex items-start gap-3.5">
        <div className="w-11 h-11 rounded-xl bg-[#FBF0E2] text-[#9A5B13] flex items-center justify-center shrink-0">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[#7C7A72]">
            校園即時巡堂系統 CampusPatrol · 系統初始化提醒
          </p>
          <h1 className="text-xl font-bold text-[#1F2421]">
            尚未設定全校統一帳號管理中心連線參數
          </h1>
          <p className="text-sm text-[#5C615C] leading-relaxed">
            本系統已升級為跨專案統一帳號架構（方案 B），請於 Cloudflare Workers 的 Build Variables
            或本機 <code className="font-mono-num text-xs bg-[#F2EFE9] px-1.5 py-0.5 rounded">.env</code>{' '}
            設定下列帳號中心環境變數後重新建置部署：
          </p>
        </div>
      </div>

      <pre className="p-4 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] text-xs font-mono-num text-[#1F2421] overflow-x-auto leading-relaxed">
{`VITE_ACCOUNT_HUB_API_KEY=<ltps-account-hub Web API Key>
VITE_ACCOUNT_HUB_AUTH_DOMAIN=ltps-account-hub.firebaseapp.com
VITE_ACCOUNT_HUB_PROJECT_ID=ltps-account-hub
VITE_ACCOUNT_HUB_APP_ID=<ltps-account-hub Web App ID>
VITE_ACCOUNT_HUB_URL=https://ltps-account-hub.mihsia.workers.dev`}
      </pre>
    </div>
  </div>
);
