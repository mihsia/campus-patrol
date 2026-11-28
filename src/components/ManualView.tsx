import React from 'react';
import { AlertTriangle, ArrowUp, CheckCircle2, Download, History } from 'lucide-react';
import type { NavSection, SchoolSettings } from '../types/patrol';
import { CURRENT_APP_DATE, CURRENT_APP_VERSION } from '../data/changelog';
import {
  MANUAL_SECTIONS,
  MANUAL_UPDATED_DATE,
  MANUAL_VERIFIED_VERSION,
} from '../data/manual';

interface ManualViewProps {
  schoolSettings: SchoolSettings;
  onNavigate: (section: NavSection) => void;
}

export const ManualView: React.FC<ManualViewProps> = ({ schoolSettings, onNavigate }) => {
  const isOutdated = MANUAL_VERIFIED_VERSION !== CURRENT_APP_VERSION;

  const handleDownloadPdf = () => {
    window.print();
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(`manual-section-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div id="manual-top" className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Page Title & Version Subtitle */}
      <header className="space-y-1.5">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1F2421]">操作手冊</h1>
        <p className="text-sm text-[#7C7A72] font-mono-num">
          {schoolSettings.schoolName}教學巡堂系統 · 適用系統版本 {CURRENT_APP_VERSION} ·{' '}
          {CURRENT_APP_DATE}
        </p>
      </header>

      {/* Version Sync Banner (mirrors reference manual alert style) */}
      {isOutdated ? (
        <div className="bg-[#FDF4E6] border border-[#E9D1AE] rounded-2xl px-5 py-4 text-sm text-[#8F5312] leading-relaxed flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            本手冊內容最後確認對應版本為{' '}
            <span className="font-mono-num font-semibold">{MANUAL_VERIFIED_VERSION}</span>
            ，系統目前已更新至{' '}
            <span className="font-mono-num font-semibold">{CURRENT_APP_VERSION}</span>
            ，部分新功能可能尚未收錄，請一併參考左側選單的「
            <button
              type="button"
              onClick={() => onNavigate('changelog')}
              className="underline font-semibold hover:text-[#6E3D0A] cursor-pointer"
            >
              系統日誌
            </button>
            」。
          </p>
        </div>
      ) : (
        <div className="bg-[#EEF7F4] border border-[#CFE5DC] rounded-2xl px-5 py-4 text-sm text-[#1E5C4B] leading-relaxed flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            本手冊內容已與最新系統版本{' '}
            <span className="font-mono-num font-semibold">{MANUAL_VERIFIED_VERSION}</span>（
            <span className="font-mono-num">{MANUAL_UPDATED_DATE}</span>
            ）同步確認。欲查看歷次新增功能與問題修正明細，請參考左側選單的「
            <button
              type="button"
              onClick={() => onNavigate('changelog')}
              className="underline font-semibold hover:text-[#143F33] cursor-pointer"
            >
              系統日誌
            </button>
            」。
          </p>
        </div>
      )}

      {/* Primary PDF Action Button */}
      <div className="no-print flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleDownloadPdf}
          className="min-h-[44px] px-5 py-2.5 bg-[#1E5C4B] hover:bg-[#16473A] text-white text-sm font-semibold rounded-xl inline-flex items-center gap-2 shadow-xs transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          下載 PDF 手冊
        </button>
        <button
          type="button"
          onClick={() => onNavigate('changelog')}
          className="min-h-[44px] px-4 py-2.5 bg-white hover:bg-[#FAF9F5] border border-[#DDD8CD] text-[#3A3F3B] text-sm font-medium rounded-xl inline-flex items-center gap-2 transition-colors cursor-pointer"
        >
          <History className="w-4 h-4 text-[#1E5C4B]" />
          檢視系統日誌
        </button>
      </div>

      {/* Table of Contents Card (mirrors reference TOC card) */}
      <nav
        aria-label="操作手冊目錄"
        className="bg-white border border-[#E5E1D8] rounded-2xl p-6 max-w-xl space-y-3"
      >
        <h2 className="text-sm font-bold text-[#1F2421]">目錄</h2>
        <ul className="space-y-2">
          {MANUAL_SECTIONS.map((section) => (
            <li key={section.id} className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => scrollToSection(section.id)}
                className="text-sm font-medium text-[#1E5C4B] hover:text-[#143F33] hover:underline text-left cursor-pointer"
              >
                {section.title}
              </button>
              {section.adminOnly && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#F6E8EC] text-[#8F2D47] text-[11px] font-semibold">
                  管理者專屬
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* Manual Sections */}
      <div className="space-y-8 pt-2">
        {MANUAL_SECTIONS.map((section) => (
          <section
            key={section.id}
            id={`manual-section-${section.id}`}
            className="scroll-mt-24 space-y-3.5 pb-6 border-b border-[#E5E1D8] last:border-b-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-[#1F2421]">{section.title}</h2>
                {section.adminOnly && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-[#F6E8EC] text-[#8F2D47] text-xs font-semibold">
                    管理者專屬
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  document.getElementById('manual-top')?.scrollIntoView({ behavior: 'smooth' })
                }
                className="no-print text-xs text-[#7C7A72] hover:text-[#1E5C4B] inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowUp className="w-3.5 h-3.5" />
                回到目錄
              </button>
            </div>

            <div className="space-y-2.5 text-[15px] text-[#3A3F3B] leading-7">
              {section.paragraphs.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>

            {section.steps && section.steps.length > 0 && (
              <ol className="list-decimal pl-6 space-y-2 text-sm text-[#3A3F3B] leading-relaxed bg-white border border-[#E5E1D8] rounded-xl p-4 sm:p-5">
                {section.steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            )}

            {section.table && (
              <div className="overflow-x-auto bg-white border border-[#E5E1D8] rounded-xl">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[#FAF9F5] border-b border-[#E5E1D8] text-xs text-[#5C615C]">
                    <tr>
                      {section.table.headers.map((h) => (
                        <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0ECE3] text-[#3A3F3B]">
                    {section.table.rows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`px-4 py-2.5 ${
                              cIdx < 2 ? 'font-semibold whitespace-nowrap text-[#1F2421]' : ''
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {section.tips && section.tips.length > 0 && (
              <div className="bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl px-4 py-3.5 space-y-1.5">
                <p className="text-xs font-bold text-[#1E5C4B]">操作小提醒</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-[#5C615C] leading-relaxed">
                  {section.tips.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {section.id === 'changelog' && (
              <div className="no-print pt-1">
                <button
                  type="button"
                  onClick={() => onNavigate('changelog')}
                  className="min-h-[38px] px-4 py-2 bg-[#E5F2EE] hover:bg-[#D5EAE3] text-[#1E5C4B] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <History className="w-3.5 h-3.5" />
                  立即前往系統日誌
                </button>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
};
