import React, { useState } from 'react';
import { Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'sidebar' | 'banner';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // Automatically suppress when already running as an installed standalone PWA
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop Chrome & Edge native install prompt
  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={
          variant === 'sidebar'
            ? 'w-full min-h-[38px] px-3 py-1.5 text-xs font-semibold text-[#1E5C4B] bg-[#E5F2EE] hover:bg-[#D5EAE3] border border-[#C6DFD7] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors'
            : variant === 'banner'
              ? 'w-full min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#1E5C4B] bg-[#E5F2EE] hover:bg-[#D5EAE3] border border-[#C6DFD7] rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap transition-colors'
              : 'min-h-[36px] px-3 py-1.5 text-xs font-semibold text-[#1E5C4B] bg-[#E5F2EE] hover:bg-[#D5EAE3] border border-[#C6DFD7] rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors'
        }
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span>安裝巡堂 App</span>
      </button>
    );
  }

  // iOS Safari guided Add-to-Home-Screen flow
  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={
            variant === 'sidebar'
              ? 'w-full min-h-[38px] px-3 py-1.5 text-xs font-semibold text-[#1E5C4B] bg-[#E5F2EE] hover:bg-[#D5EAE3] border border-[#C6DFD7] rounded-xl inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors'
              : variant === 'banner'
                ? 'w-full min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#1E5C4B] bg-[#E5F2EE] hover:bg-[#D5EAE3] border border-[#C6DFD7] rounded-xl inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap transition-colors'
                : 'min-h-[36px] px-3 py-1.5 text-xs font-semibold text-[#1E5C4B] bg-[#E5F2EE] hover:bg-[#D5EAE3] border border-[#C6DFD7] rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors'
          }
        >
          <Smartphone className="w-3.5 h-3.5 shrink-0" />
          <span>加入主畫面</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 bg-[#1F2421]/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
            <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-[#1F2421]">在 iPhone／iPad 安裝巡堂通</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="關閉安裝說明"
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center text-[#7C7A72] hover:text-[#1F2421] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <ol className="space-y-3 text-sm text-[#5C615C] leading-relaxed">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num font-bold text-[#1E5C4B] shrink-0">1.</span>
                  <span>
                    點選 Safari 工具列下方的{' '}
                    <span className="inline-flex items-center gap-1 font-semibold text-[#1F2421]">
                      <Share className="w-3.5 h-3.5" />
                      分享
                    </span>{' '}
                    按鈕。
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num font-bold text-[#1E5C4B] shrink-0">2.</span>
                  <span>
                    向下捲動選單並點選 <strong className="text-[#1F2421]">「加入主畫面」</strong>。
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono-num font-bold text-[#1E5C4B] shrink-0">3.</span>
                  <span>
                    點擊右上角 <strong className="text-[#1F2421]">「新增」</strong>，即可由桌面全螢幕啟動巡堂系統。
                  </span>
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] bg-[#1E5C4B] hover:bg-[#16473A] text-white text-sm font-semibold rounded-xl cursor-pointer transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-16 lg:bottom-4 left-4 right-4 sm:right-auto z-40 bg-[#9A5B13] text-[#FAF9F5] px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2.5 text-xs sm:text-sm font-medium"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>離線模式｜目前無網路連線，已顯示本機快取畫面，連線恢復後將自動同步。</span>
    </div>
  );
};
