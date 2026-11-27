import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { FirestoreErrorInfo } from '../lib/firebase';

interface State {
  hasError: boolean;
  message: string;
  details: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '', details: null };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = '系統發生未預期的錯誤，請重新整理頁面。';
    let details: string | null = error.message || null;

    try {
      const parsed = JSON.parse(error.message) as Partial<FirestoreErrorInfo>;
      if (parsed && parsed.operationType) {
        if (parsed.error?.includes('Quota exceeded')) {
          message = '資料庫免費每日讀取額度已達上限，額度將於明日自動重置。';
        } else if (parsed.error?.includes('Missing or insufficient permissions')) {
          message = `存取權限不足（操作：${parsed.operationType}，路徑：${parsed.path ?? '未指定'}）。請確認帳號已通過 Email 驗證或具備相應權限。`;
        } else {
          message = `資料庫同步異常（${parsed.operationType}）：${parsed.error}`;
        }
        details = JSON.stringify(parsed, null, 2);
      }
    } catch {
      // Plain error message
    }

    return { hasError: true, message, details };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Uncaught app error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-slate-900">系統連線或權限異常</h2>
                <p className="text-sm text-slate-600 leading-relaxed">{this.state.message}</p>
              </div>
            </div>
            {this.state.details && (
              <pre className="text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-600 max-h-48">
                {this.state.details}
              </pre>
            )}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-4 h-4" />
                重新載入系統
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
