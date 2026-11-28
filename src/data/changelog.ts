export type ChangelogCategory = 'feature' | 'fix' | 'perf' | 'infra';

export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  category: ChangelogCategory;
  title: string;
  summary: string;
  highlights?: string[];
}

export const CURRENT_APP_VERSION = 'v1.11';
export const CURRENT_APP_DATE = '2026-11-28';

export const CHANGELOG_CATEGORY_LABELS: Record<ChangelogCategory, string> = {
  feature: '新增功能',
  fix: '問題修正',
  perf: '效能優化',
  infra: '架構與部署',
};

/**
 * 系統更新日誌（依版本由新到舊排列）
 * 每次系統修正或新增功能時，請於陣列最上方新增一筆紀錄並同步更新 CURRENT_APP_VERSION。
 */
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: 'v1.11',
    date: '2026-11-28',
    category: 'feature',
    title: '帳號管理改版、學年度週期、各班課表 Word/PDF 下載與行動巡堂一鍵快選',
    summary:
      '全面優化四大實務操作體驗：帳號管理改為單一緊湊表格（可切換處室分組）並支援原地角色切換、啟用開關與批次貼上匯入名單；學校基本資料與課表改以「學年度（本年 8/1 ～ 隔年 7/31）」為主軸並提供自動推算；班級課表與報表匯出雙入口皆支援單班／多班／全校日課表 Word（.docx）與 A4 PDF 下載；行動巡堂新增卡片一鍵快速打卡、常用備註快捷膠囊、樓層動線排序與「儲存並巡下一班」連續模式。',
    highlights: [
      '帳號管理：單一緊湊清單＋處室篩選膠囊、點擊切換管理者／使用者、啟用狀態開關與 Excel／文字批次貼上匯入名單，並修正底部過時權限說明。',
      '學年度週期：明確標示學年度適用期間（如 115 學年度：2026/08/01 ～ 2027/07/31），編輯設定可一鍵依今日自動帶入所屬學年度。',
      '各班級課表下載：於「班級課表」與「報表匯出」皆可下載單一班級或全校各班日課表 Word（.docx）與列印 A4 PDF（每班自動獨立分頁）。',
      '行動巡堂提速：班級卡片直接提供「✓ 正常／★ 優良／⚠ 詳填」一鍵打卡、依樓棟樓層動線排序、詳填抽屜新增常用備註膠囊與「儲存並巡下一班」連續巡堂。',
    ],
  },
  {
    version: 'v1.10',
    date: '2026-11-28',
    category: 'feature',
    title: '新增總覽儀表、操作手冊、系統日誌，並修正巡堂日期與星期顯示',
    summary:
      '左側選單全面調整為 4 字對稱名稱並於底部顯示系統版本；新增全校視角的「總覽儀表」呈現本週巡堂完成率、各樓棟進度、異常待辦與即時現況；新增含目錄跳轉與 PDF 列印匯出的「操作手冊」，以及由新到舊完整補齊歷史紀錄的「系統日誌」。同步修正巡堂日期於週末誤顯示為「星期一」的問題，改為自動抓取系統目前時間與真實星期，假日提供明確提示與一鍵切換最近上課日。',
    highlights: [
      '左側選單各模組統一為 4 字對稱名稱（總覽儀表、即時巡堂、行動巡堂、異常通報、學校設定、班級課表、報表匯出、帳號管理、操作手冊、系統日誌）。',
      '新增「總覽儀表」：彙整即時時間節次、本週巡堂覆蓋率、教學正常率、各樓棟進度、週趨勢圖、近期巡堂動態與管理者系統健康檢查。',
      '新增「操作手冊」與「系統日誌」：支援目錄導覽、管理者專屬標記、PDF 手冊列印匯出與歷次版本紀錄查詢。',
      '修正巡堂日期星期計算：2026/11/28 等週末日期正確顯示為「星期六／星期日」，並於跨日時自動同步最新日期與節次。',
      '啟用 Firestore IndexedDB 多分頁離線資料持久化（persistentLocalCache），於校園弱訊號或離線重整時仍可瀏覽快取課表與暫存巡堂紀錄，恢復連線自動同步。',
    ],
  },
  {
    version: 'v1.09',
    date: '2026-11-27',
    category: 'perf',
    title: '資源瘦身、前端路由分包優化與自動化測試補齊',
    summary:
      '移除未被引用的 11 MB 開發截圖與重複圖示，PWA 離線預快取體積縮減 70.5%（15.1 MB 降至 4.4 MB）；將 7 大頁面與 docx／xlsx／jszip 重型套件改為按需動態載入並設定 Rolldown 分包策略，主程式入口縮減 97.1%（2.31 MB 降至 68 kB）。同步建立 31 項自動化單元與 Firestore 安全規則不變量測試。',
    highlights: [
      '主程式 bundle 由 2,312 kB（gzip 684.6 kB）縮減至 68.0 kB（gzip 20.7 kB）。',
      '新增 bun run test 與 bun run lint:rules 腳本，涵蓋驗證工具、通知規則、CSV／課表解析與 12 項 Dirty Dozen 安全防線。',
      '修正 vite.config.ts 的 __dirname 警告，正式建置零警告通過。',
    ],
  },
  {
    version: 'v1.08',
    date: '2026-11-27',
    category: 'infra',
    title: '雲端開發環境自動建置與 Cloudflare PR Preview 預覽支援',
    summary:
      '建立 .agents/environment.json 自動化開發環境初始化設定（支援 Bun 1.4+ 與 lockfileVersion 2），並於 wrangler.jsonc 補上 previews 區塊，使每個 GitHub Pull Request 皆能自動部署獨立的 Cloudflare Preview 預覽站。',
  },
  {
    version: 'v1.07',
    date: '2026-11-27',
    category: 'feature',
    title: '學期課表歷史歸檔與學期標籤管理',
    summary:
      '新增 timetableArchives 與 archived slots 資料庫模型及 Firestore 安全規則，管理者可將現行班級課表一鍵快照封存、標記學年度與學期，並隨時查閱歷史學期課表、還原覆蓋現行課表或刪除歸檔紀錄。',
  },
  {
    version: 'v1.06',
    date: '2026-11-27',
    category: 'feature',
    title: '學校基本資料設定與多格式課表自動解析匯入引擎',
    summary:
      '新增「學校設定」模組集中管理校名、學年度、學期、週次與各棟樓清單；建立支援 Word（.docx）、Excel（.xlsx）、PDF、HTML 表格貼上與 CSV 的多格式日課表解析精靈，並支援分割併排課與科任移地教室辨識，同時升級正式 Word／Excel 巡堂紀錄表匯出。',
  },
  {
    version: 'v1.05',
    date: '2026-11-27',
    category: 'feature',
    title: '介面視覺主題重構與跨裝置導覽體驗優化',
    summary:
      '全面改採暖象牙底色與深林綠主題配色，重構桌面分組式側邊欄、頂部快速節次切換列與行動裝置固定底部導覽列，強化手機與平板現場巡堂操作流暢度。',
  },
  {
    version: 'v1.04',
    date: '2026-11-27',
    category: 'feature',
    title: 'Progressive Web App（PWA）離線快取與主畫面安裝',
    summary:
      '整合 vite-plugin-pwa 與 Workbox Service Worker，支援桌面與行動裝置一鍵安裝為獨立應用程式、版本自動更新機制與網路離線狀態提示橫幅。',
  },
  {
    version: 'v1.03',
    date: '2026-11-27',
    category: 'feature',
    title: '雙層 Google 專屬白名單權限控管（RBAC）與資安規則強化',
    summary:
      '實作僅限已驗證 Google 帳號登入與 allowedAccounts 白名單機制，區分「管理者」與「使用者」雙層權限；加入即時停權監聽、個人 PII 隔離、防孤兒紀錄驗證、已結案事件鎖定與 Bootstrap Admin 保護，並建立 12 項 Dirty Dozen 安全規格。',
  },
  {
    version: 'v1.02',
    date: '2026-11-27',
    category: 'infra',
    title: 'Cloudflare Workers 靜態託管與 SPA 路由部署設定',
    summary:
      '新增 wrangler.jsonc 與單頁應用程式（single-page-application）靜態資產設定，完成 GitHub 至 Cloudflare Workers 正式站的自動化建置與部署管線。',
  },
  {
    version: 'v1.01',
    date: '2026-11-27',
    category: 'feature',
    title: '校園即時巡堂系統核心架構上線',
    summary:
      '完成校園即時巡堂管理系統初代版本，包含即時巡堂儀表板、行動巡堂 8 項檢核表作業、異常事件通報與瀏覽器推播音效提醒、班級課表檢視維護、報表匯出與 Firebase Firestore 即時同步基礎設施。',
  },
];
