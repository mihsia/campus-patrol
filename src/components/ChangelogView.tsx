import React, { useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import {
  CHANGELOG_CATEGORY_LABELS,
  CHANGELOG_ENTRIES,
  CURRENT_APP_DATE,
  CURRENT_APP_VERSION,
  type ChangelogCategory,
} from '../data/changelog';

const CARD_PALETTES = [
  'bg-[#FDF6EC] border-[#EFE3D1]',
  'bg-[#F5F1FA] border-[#E7E0F2]',
  'bg-[#EEF7F4] border-[#DCECE6]',
  'bg-[#FCF1F1] border-[#F2DFDF]',
  'bg-[#F4F6EE] border-[#E3E8D8]',
];

export const ChangelogView: React.FC = () => {
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ChangelogCategory>('ALL');
  const [keyword, setKeyword] = useState('');

  const filteredEntries = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return CHANGELOG_ENTRIES.filter((entry) => {
      if (categoryFilter !== 'ALL' && entry.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const inHighlights = (entry.highlights || []).some((h) => h.toLowerCase().includes(q));
      return (
        entry.version.toLowerCase().includes(q) ||
        entry.date.includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        inHighlights
      );
    });
  }, [categoryFilter, keyword]);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#1E5C4B]">
            <History className="w-4 h-4" />
            <span>版本演進紀錄</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1F2421]">系統日誌</h1>
          <p className="text-sm text-[#7C7A72]">
            目前系統版本{' '}
            <span className="font-mono-num font-semibold text-[#1E5C4B]">
              {CURRENT_APP_VERSION}
            </span>{' '}
            · 更新日期 <span className="font-mono-num">{CURRENT_APP_DATE}</span> · 共收錄{' '}
            <span className="font-mono-num font-semibold text-[#1F2421]">
              {CHANGELOG_ENTRIES.length}
            </span>{' '}
            筆由新到舊版本紀錄
          </p>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-[#E5E1D8] rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl overflow-x-auto">
          {(['ALL', 'feature', 'fix', 'perf', 'infra'] as const).map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`min-h-[34px] px-3 py-1 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#1E5C4B] text-white shadow-xs'
                    : 'text-[#5C615C] hover:text-[#1F2421]'
                }`}
              >
                {cat === 'ALL' ? '全部紀錄' : CHANGELOG_CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-[#9A968C] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜尋版本號、功能或關鍵字..."
            className="w-full min-h-[38px] pl-9 pr-3 py-1.5 text-sm bg-[#FAF9F5] border border-[#E5E1D8] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
          />
        </div>
      </div>

      {/* Changelog Cards (Newest to Oldest, matching reference layout) */}
      {filteredEntries.length === 0 ? (
        <div className="bg-white border border-[#E5E1D8] rounded-2xl p-10 text-center text-sm text-[#7C7A72]">
          找不到符合條件的系統日誌紀錄
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEntries.map((entry, index) => {
            const palette = CARD_PALETTES[index % CARD_PALETTES.length];
            return (
              <article
                key={entry.version}
                className={`border rounded-2xl p-5 sm:p-6 transition-shadow hover:shadow-xs ${palette}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-5">
                  {/* Left Green Version Pill */}
                  <div className="shrink-0 flex items-center sm:flex-col sm:items-start gap-2">
                    <span className="inline-flex items-center justify-center min-w-[68px] px-3.5 py-2 rounded-xl bg-[#1E5C4B] text-white font-mono-num text-sm font-bold tracking-tight shadow-xs">
                      {entry.version}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/80 border border-[#E5E1D8] text-[11px] font-semibold text-[#5C615C]">
                      {CHANGELOG_CATEGORY_LABELS[entry.category]}
                    </span>
                  </div>

                  {/* Right Content */}
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#7C7A72] font-mono-num">
                      <span>{entry.date}</span>
                      {index === 0 && categoryFilter === 'ALL' && !keyword.trim() && (
                        <span className="px-2 py-0.5 rounded-full bg-[#1E5C4B]/12 text-[#1E5C4B] font-sans font-semibold text-[11px]">
                          最新版本
                        </span>
                      )}
                    </div>

                    <h2 className="text-base font-bold text-[#1F2421] leading-snug">
                      {entry.title}
                    </h2>

                    <p className="text-sm text-[#3A3F3B] leading-relaxed">{entry.summary}</p>

                    {entry.highlights && entry.highlights.length > 0 && (
                      <ul className="pt-1.5 space-y-1.5 text-sm text-[#3A3F3B] list-disc pl-5">
                        {entry.highlights.map((item, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
