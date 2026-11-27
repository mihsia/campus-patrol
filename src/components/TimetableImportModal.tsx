import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  FileText,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { SchoolSettings, TimetableSlot } from '../types/patrol';
import {
  DAY_OF_WEEK_LABELS,
  DAY_OF_WEEK_SHORT,
  PERIOD_SCHEDULE,
  STANDARD_GRADES,
} from '../types/patrol';
import {
  convertParsedClassesToImportRows,
  createSampleLizeClassTimetable,
  downloadSampleTimetableDocx,
  parseHtmlOrPastedTimetable,
  parseTimetableFiles,
  type ParsedClassTimetable,
  type ParsedPeriodSlot,
} from '../lib/timetableParser';
import { downloadTimetableCsvTemplate } from '../lib/exportReports';
import { batchImportTimetableSlots } from '../lib/firestoreOps';

interface TimetableImportModalProps {
  uid: string;
  schoolSettings: SchoolSettings;
  existingTimetables: TimetableSlot[];
  onClose: () => void;
  onImported: (summary: {
    importedCount: number;
    replacedCount: number;
    classNames: string[];
  }) => void;
}

export const TimetableImportModal: React.FC<TimetableImportModalProps> = ({
  uid,
  schoolSettings,
  existingTimetables,
  onClose,
  onImported,
}) => {
  const defaultBuilding = schoolSettings.buildings[0] || '行政教學大樓';

  const [step, setStep] = useState<'source' | 'review'>('source');
  const [sourceTab, setSourceTab] = useState<'file' | 'paste'>('file');
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  const [parsedClasses, setParsedClasses] = useState<ParsedClassTimetable[]>([]);
  const [activeClassIdx, setActiveClassIdx] = useState(0);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [showTeacherPanel, setShowTeacherPanel] = useState(false);
  const [editingCell, setEditingCell] = useState<{ dayOfWeek: number; period: number } | null>(
    null
  );
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeClass = parsedClasses[activeClassIdx] ?? null;

  const totalSlotsCount = useMemo(
    () => parsedClasses.reduce((sum, c) => sum + c.slots.length, 0),
    [parsedClasses]
  );

  const missingTeacherTotal = useMemo(
    () =>
      parsedClasses.reduce(
        (sum, c) => sum + c.slots.filter((s) => !s.teacherName.trim() && !c.homeroomTeacher.trim()).length,
        0
      ),
    [parsedClasses]
  );

  const existingIdsToReplace = useMemo(() => {
    if (!replaceExisting || parsedClasses.length === 0) return [];
    const incomingClassNames = new Set(parsedClasses.map((c) => c.className.trim()).filter(Boolean));
    return existingTimetables
      .filter((t) => incomingClassNames.has(t.className.trim()))
      .map((t) => t.id);
  }, [replaceExisting, parsedClasses, existingTimetables]);

  const maxDisplayPeriod = useMemo(() => {
    if (!activeClass) return 7;
    const maxP = activeClass.slots.reduce((m, s) => Math.max(m, s.period), 7);
    return Math.min(8, Math.max(7, maxP));
  }, [activeClass]);

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;
    setParsing(true);
    setParseErrors([]);
    try {
      const res = await parseTimetableFiles(files, defaultBuilding);
      setParseErrors(res.errors);
      if (res.classes.length > 0) {
        setParsedClasses((prev) => {
          const next = step === 'review' ? [...prev, ...res.classes] : res.classes;
          setActiveClassIdx(step === 'review' ? prev.length : 0);
          return next;
        });
        setEditingCell(null);
        setStep('review');
      }
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePasteEvent = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html && /<table/i.test(html)) {
      e.preventDefault();
      const res = parseHtmlOrPastedTimetable({
        html,
        plainText: text,
        sourceLabel: '貼上課表',
        defaultBuilding,
      });
      setParseErrors(res.errors);
      if (res.classes.length > 0) {
        setParsedClasses(res.classes);
        setActiveClassIdx(0);
        setEditingCell(null);
        setStep('review');
      } else {
        setPasteText(text);
      }
    }
  };

  const handleParseManualPaste = () => {
    const res = parseHtmlOrPastedTimetable({
      plainText: pasteText,
      sourceLabel: '貼上課表',
      defaultBuilding,
    });
    setParseErrors(res.errors);
    if (res.classes.length > 0) {
      setParsedClasses(res.classes);
      setActiveClassIdx(0);
      setEditingCell(null);
      setStep('review');
    }
  };

  const handleLoadSample = () => {
    const sample = createSampleLizeClassTimetable(
      defaultBuilding,
      schoolSettings.schoolName || '利澤國小',
      schoolSettings.academicYear || '115'
    );
    setParseErrors([]);
    setParsedClasses([sample]);
    setActiveClassIdx(0);
    setEditingCell(null);
    setStep('review');
  };

  const handleDownloadSampleDocx = async () => {
    setDownloadingDocx(true);
    try {
      await downloadSampleTimetableDocx(
        schoolSettings.schoolName || '利澤國小',
        schoolSettings.academicYear || '115'
      );
    } finally {
      setDownloadingDocx(false);
    }
  };

  const updateActiveClass = (updater: (cls: ParsedClassTimetable) => ParsedClassTimetable) => {
    setParsedClasses((prev) =>
      prev.map((cls, idx) => (idx === activeClassIdx ? updater(cls) : cls))
    );
  };

  const removeActiveClass = (idxToRemove: number) => {
    setParsedClasses((prev) => {
      const next = prev.filter((_, idx) => idx !== idxToRemove);
      if (next.length === 0) {
        setStep('source');
        setActiveClassIdx(0);
      } else {
        setActiveClassIdx(Math.min(activeClassIdx, next.length - 1));
      }
      return next;
    });
    setEditingCell(null);
  };

  const handleUpsertCell = (
    dayOfWeek: number,
    period: number,
    data: {
      subject: string;
      teacherName: string;
      isRelocated: boolean;
      locationNote: string;
    }
  ) => {
    updateActiveClass((cls) => {
      const trimmedSub = data.subject.trim();
      const filtered = cls.slots.filter(
        (s) => !(s.dayOfWeek === dayOfWeek && s.period === period)
      );
      if (!trimmedSub) {
        return { ...cls, slots: filtered };
      }
      const existing = cls.slots.find((s) => s.dayOfWeek === dayOfWeek && s.period === period);
      const nextSlot: ParsedPeriodSlot = {
        id: existing?.id || `slot-d${dayOfWeek}-p${period}`,
        dayOfWeek,
        period,
        rawText: existing?.rawText || trimmedSub,
        subject: trimmedSub,
        teacherName: data.teacherName.trim() || cls.homeroomTeacher || '',
        isSpecialist:
          Boolean(cls.homeroomTeacher) &&
          Boolean(data.teacherName.trim()) &&
          data.teacherName.trim() !== cls.homeroomTeacher,
        isRelocated: data.isRelocated,
        locationNote: data.locationNote.trim(),
        isSplitCourse: existing?.isSplitCourse ?? false,
        matchStatus: data.teacherName.trim() ? 'matched' : 'missing_teacher',
      };
      return {
        ...cls,
        slots: [...filtered, nextSlot].sort(
          (a, b) => a.period - b.period || a.dayOfWeek - b.dayOfWeek
        ),
      };
    });
    setEditingCell(null);
  };

  const handleDeleteCell = (dayOfWeek: number, period: number) => {
    updateActiveClass((cls) => ({
      ...cls,
      slots: cls.slots.filter((s) => !(s.dayOfWeek === dayOfWeek && s.period === period)),
    }));
    setEditingCell(null);
  };

  const handleUpdateMappingTeacher = (mappingIdx: number, nextTeacher: string) => {
    updateActiveClass((cls) => {
      const target = cls.teacherMappings[mappingIdx];
      if (!target) return cls;
      const oldTeacher = target.teacherName;
      const nextMappings = cls.teacherMappings.map((m, idx) =>
        idx === mappingIdx ? { ...m, teacherName: nextTeacher } : m
      );
      const nextSlots = cls.slots.map((slot) => {
        if (
          slot.subject === target.subject ||
          slot.subject.includes(`(${target.subject})`) ||
          (oldTeacher && slot.teacherName === oldTeacher && slot.subject.includes(target.subject))
        ) {
          return {
            ...slot,
            teacherName: nextTeacher.trim(),
            matchStatus: nextTeacher.trim() ? ('matched' as const) : ('missing_teacher' as const),
          };
        }
        return slot;
      });
      return { ...cls, teacherMappings: nextMappings, slots: nextSlots };
    });
  };

  const handleCommitImport = async () => {
    setCommitError(null);
    const importRows = convertParsedClassesToImportRows(parsedClasses);
    if (importRows.length === 0) {
      setCommitError('目前沒有可匯入的有效節次資料');
      return;
    }

    setCommitting(true);
    try {
      const importedCount = await batchImportTimetableSlots(uid, importRows, {
        replaceSlotIds: existingIdsToReplace,
      });
      onImported({
        importedCount,
        replacedCount: existingIdsToReplace.length,
        classNames: parsedClasses.map((c) => c.className),
      });
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : '匯入寫入資料庫時發生錯誤');
    } finally {
      setCommitting(false);
    }
  };

  const activeSlotBeingEdited = useMemo(() => {
    if (!activeClass || !editingCell) return null;
    return (
      activeClass.slots.find(
        (s) => s.dayOfWeek === editingCell.dayOfWeek && s.period === editingCell.period
      ) ?? null
    );
  }, [activeClass, editingCell]);

  const buildingsList = useMemo(() => {
    const list = [...schoolSettings.buildings];
    if (activeClass?.building && !list.includes(activeClass.building)) {
      list.push(activeClass.building);
    }
    return list;
  }, [schoolSettings.buildings, activeClass?.building]);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full sm:max-w-5xl max-h-[94vh] rounded-t-3xl sm:rounded-2xl border border-[#E5E1D8] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-[#E5E1D8] flex items-center justify-between gap-3 bg-[#FAF9F5]">
          <div className="flex items-center gap-3 min-w-0">
            {step === 'review' && (
              <button
                type="button"
                onClick={() => {
                  setStep('source');
                  setEditingCell(null);
                }}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl border border-[#DDD8CD] bg-white text-[#3A3F3B] hover:bg-[#F2EFE9] cursor-pointer shrink-0"
                aria-label="返回選擇檔案"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-[#1F2421] truncate">
                {step === 'source' ? '讀取學校班級課表並轉入巡堂系統' : '核對班級課表並指定教室樓棟'}
              </h2>
              <p className="text-xs text-[#7C7A72] mt-0.5 truncate">
                {step === 'source'
                  ? '自動解析 PDF／Word (.docx)／Excel (.xlsx) 日課表，對應每週授課教師並過濾午休／整潔等非授課時段'
                  : '確認星期一～五各節科目與授課教師無誤後，即可一鍵寫入作為每日巡堂名單'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-[#7C7A72] hover:text-[#1F2421] rounded-xl hover:bg-[#EFECE4] cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden multi-file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf,.docx,.doc,.xlsx,.xls,.csv,.htm,.html"
          onChange={(e) => {
            if (e.target.files) {
              void handleFilesSelected(e.target.files);
            }
          }}
          className="hidden"
        />

        {/* Step 1: Source Selection */}
        {step === 'source' && (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
            {/* Source Mode Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-xl">
                <button
                  type="button"
                  onClick={() => setSourceTab('file')}
                  className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    sourceTab === 'file'
                      ? 'bg-[#1E5C4B] text-white shadow-xs'
                      : 'text-[#5C615C] hover:text-[#1F2421]'
                  }`}
                >
                  <Upload className="w-3.5 h-3.5" />
                  上傳 PDF / Word / Excel / CSV
                </button>
                <button
                  type="button"
                  onClick={() => setSourceTab('paste')}
                  className={`min-h-[38px] px-4 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                    sourceTab === 'paste'
                      ? 'bg-[#1E5C4B] text-white shadow-xs'
                      : 'text-[#5C615C] hover:text-[#1F2421]'
                  }`}
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  從 Word / Excel 複製貼上
                </button>
              </div>

              <button
                type="button"
                onClick={handleLoadSample}
                className="min-h-[38px] px-3.5 py-1.5 bg-[#FBF0E2] hover:bg-[#F5E3CC] text-[#8A4F0F] border border-[#EBD4B4] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                載入「一年忠班」範例日課表試算
              </button>
            </div>

            {sourceTab === 'file' ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files?.length) {
                    void handleFilesSelected(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition-colors cursor-pointer ${
                  dragging
                    ? 'border-[#1E5C4B] bg-[#E5F2EE]/60'
                    : 'border-[#D8D3C8] bg-[#FAF9F5] hover:border-[#1E5C4B] hover:bg-[#F4F1EA]'
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-[#E5F2EE] text-[#1E5C4B] flex items-center justify-center mx-auto mb-3">
                  <FileText className="w-6 h-6" />
                </div>
                <p className="text-base font-bold text-[#1F2421]">
                  {parsing ? '正在解析課表與授課教師對照...' : '點擊選擇課表檔案，或拖曳至此處'}
                </p>
                <p className="text-xs text-[#7C7A72] mt-1.5 max-w-lg mx-auto leading-relaxed">
                  支援 <span className="font-semibold text-[#1F2421]">PDF (.pdf，含多頁全校課表)</span>、
                  <span className="font-semibold text-[#1F2421]">Word (.docx)</span>、
                  <span className="font-semibold text-[#1F2421]">Excel (.xlsx / .xls)</span>、
                  <span className="font-semibold text-[#1F2421]">網頁 (.htm)</span> 與{' '}
                  <span className="font-semibold text-[#1F2421]">CSV</span>，可一次選取多個班級檔案批次解析。
                </p>
                <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#1E5C4B] text-white text-xs font-semibold rounded-xl">
                  <Upload className="w-3.5 h-3.5" />
                  選擇班級課表檔案
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[#5C615C] leading-relaxed">
                  若學校課表為舊版 <span className="font-semibold">.doc</span>、Google 文件或網頁課表，請在 Word／Excel
                  中選取整張日課表按 <span className="font-mono-num font-semibold">Ctrl+C</span>（Mac 為{' '}
                  <span className="font-mono-num font-semibold">⌘+C</span>），再於下方框內直接貼上即可自動解析：
                </p>
                <textarea
                  rows={8}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  onPaste={handlePasteEvent}
                  placeholder="點此後直接按 Ctrl+V / ⌘+V 貼上整張班級日課表（保留表格格式將自動解析）..."
                  className="w-full p-4 text-xs sm:text-sm bg-[#FAF9F5] border border-[#DDD8CD] rounded-2xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#1E5C4B]/15 focus:border-[#1E5C4B]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleParseManualPaste}
                    disabled={!pasteText.trim()}
                    className="min-h-[40px] px-4 py-2 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-50 text-white text-xs font-semibold rounded-xl cursor-pointer"
                  >
                    解析貼上內容
                  </button>
                </div>
              </div>
            )}

            {/* Parse Error Notice */}
            {parseErrors.length > 0 && (
              <div className="p-4 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#7A2716] space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  解析提醒
                </p>
                {parseErrors.map((err, i) => (
                  <p key={i}>• {err}</p>
                ))}
              </div>
            )}

            {/* Supported Smart Parsing Features + Downloadable Templates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="p-4 rounded-2xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-2">
                <p className="text-xs font-bold text-[#1F2421]">自動智慧轉換機制</p>
                <ul className="text-xs text-[#5C615C] space-y-1.5 leading-relaxed">
                  <li>• 自動辨識標題中的年級與班別（例如：一年忠班、三甲）</li>
                  <li>• 自動對應右側「每週各科授課教師及節數」與「級任老師」</li>
                  <li>• 支援括號簡稱（如 生活(表演)、健康與體育(體)、生(美)、彈(閱)）</li>
                  <li>• 自動偵測同節分割課程並跳過導師時間、課間、午餐、午休、整潔活動</li>
                </ul>
              </div>

              <div className="p-4 rounded-2xl bg-[#FAF9F5] border border-[#E5E1D8] flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-[#1F2421]">下載範例檔案與範本</p>
                  <p className="text-xs text-[#7C7A72] mt-1 leading-relaxed">
                    可下載與貴校日課表相同結構的 Word (.docx) 範例檔，或標準清單 CSV 範本。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadSampleDocx}
                    disabled={downloadingDocx}
                    className="min-h-[38px] px-3 py-1.5 bg-white hover:bg-[#F2EFE9] text-[#1F2421] border border-[#DDD8CD] text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#1E5C4B]" />
                    {downloadingDocx ? '產生中...' : '下載 Word 日課表範本 (.docx)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadTimetableCsvTemplate(schoolSettings.buildings)}
                    className="min-h-[38px] px-3 py-1.5 bg-white hover:bg-[#F2EFE9] text-[#5C615C] border border-[#DDD8CD] text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    下載 CSV 範本
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Interactive Preview & Classroom Binding */}
        {step === 'review' && activeClass && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Multi-class Tabs + Add More Files */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {parsedClasses.map((cls, idx) => {
                  const active = idx === activeClassIdx;
                  return (
                    <div
                      key={cls.id}
                      className={`inline-flex items-center rounded-xl border transition-colors ${
                        active
                          ? 'bg-[#1E5C4B] text-white border-[#1E5C4B]'
                          : 'bg-[#FAF9F5] text-[#3A3F3B] border-[#E5E1D8] hover:bg-[#F2EFE9]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveClassIdx(idx);
                          setEditingCell(null);
                        }}
                        className="min-h-[36px] px-3 py-1 text-xs font-semibold whitespace-nowrap cursor-pointer"
                      >
                        {cls.className}{' '}
                        <span className="font-mono-num opacity-80">({cls.slots.length}節)</span>
                      </button>
                      {parsedClasses.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeActiveClass(idx)}
                          aria-label={`移除 ${cls.className}`}
                          className={`pr-2 pl-0.5 py-1 cursor-pointer ${
                            active ? 'text-white/75 hover:text-white' : 'text-[#9A968C] hover:text-[#B44326]'
                          }`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[36px] px-3 py-1.5 bg-white hover:bg-[#FAF9F5] text-[#1E5C4B] border border-[#1E5C4B]/30 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                再加入其他班級檔案
              </button>
            </div>

            {parseErrors.length > 0 && (
              <div className="p-3 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#7A2716]">
                {parseErrors.join('；')}
              </div>
            )}

            {/* Class Basic Info & Building/Room Assignment */}
            <div className="p-4 rounded-2xl bg-[#FAF9F5] border border-[#E5E1D8] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#1F2421]">
                  班級基本設定與巡堂教室定位（來源：{activeClass.sourceLabel}）
                </p>
                {activeClass.teacherMappings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowTeacherPanel((v) => !v)}
                    className="text-xs font-semibold text-[#1E5C4B] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Users className="w-3.5 h-3.5" />
                    {showTeacherPanel
                      ? '收合各科教師對照表'
                      : `檢視／批次調整各科教師（${activeClass.teacherMappings.length} 科）`}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
                <div>
                  <label className="font-semibold text-[#5C615C] block mb-1">年級</label>
                  <select
                    value={activeClass.grade}
                    onChange={(e) =>
                      updateActiveClass((cls) => ({ ...cls, grade: e.target.value }))
                    }
                    className="w-full min-h-[38px] px-2.5 bg-white border border-[#DDD8CD] rounded-xl text-[#1F2421]"
                  >
                    {STANDARD_GRADES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                    <option value="特教／資源班">特教／資源班</option>
                    <option value="其他">其他</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-[#5C615C] block mb-1">班別</label>
                  <input
                    value={activeClass.className}
                    maxLength={30}
                    onChange={(e) =>
                      updateActiveClass((cls) => ({ ...cls, className: e.target.value }))
                    }
                    className="w-full min-h-[38px] px-2.5 bg-white border border-[#DDD8CD] rounded-xl text-[#1F2421] font-semibold"
                  />
                </div>

                <div>
                  <label className="font-semibold text-[#5C615C] block mb-1">級任老師</label>
                  <input
                    value={activeClass.homeroomTeacher}
                    maxLength={40}
                    placeholder="選填"
                    onChange={(e) =>
                      updateActiveClass((cls) => ({ ...cls, homeroomTeacher: e.target.value }))
                    }
                    className="w-full min-h-[38px] px-2.5 bg-white border border-[#DDD8CD] rounded-xl text-[#1F2421]"
                  />
                </div>

                <div>
                  <label className="font-semibold text-[#5C615C] block mb-1">所屬樓棟</label>
                  <select
                    value={activeClass.building}
                    onChange={(e) =>
                      updateActiveClass((cls) => ({ ...cls, building: e.target.value }))
                    }
                    className="w-full min-h-[38px] px-2.5 bg-white border border-[#DDD8CD] rounded-xl text-[#1F2421]"
                  >
                    {buildingsList.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-[#5C615C] block mb-1">樓層</label>
                  <input
                    value={activeClass.floor}
                    maxLength={20}
                    onChange={(e) =>
                      updateActiveClass((cls) => ({ ...cls, floor: e.target.value }))
                    }
                    placeholder="1F"
                    className="w-full min-h-[38px] px-2.5 bg-white border border-[#DDD8CD] rounded-xl text-[#1F2421]"
                  />
                </div>

                <div>
                  <label className="font-semibold text-[#5C615C] block mb-1">教室編號</label>
                  <input
                    value={activeClass.roomNumber}
                    maxLength={20}
                    onChange={(e) =>
                      updateActiveClass((cls) => ({ ...cls, roomNumber: e.target.value }))
                    }
                    placeholder="101"
                    className="w-full min-h-[38px] px-2.5 bg-white border border-[#DDD8CD] rounded-xl text-[#1F2421] font-mono-num"
                  />
                </div>
              </div>

              {activeClass.warnings.length > 0 && (
                <div className="pt-1 text-xs text-[#8A4F0F] flex flex-wrap items-center gap-x-3 gap-y-1">
                  {activeClass.warnings.map((w, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#1E5C4B] shrink-0" />
                      {w}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Collapsible Extracted Subject-Teacher Mapping Table */}
            {showTeacherPanel && activeClass.teacherMappings.length > 0 && (
              <div className="p-4 rounded-2xl bg-white border border-[#E5E1D8] space-y-2.5">
                <p className="text-xs font-bold text-[#1F2421]">
                  各科授課教師對照表（修改教師姓名將即時套用至同科目節次）
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {activeClass.teacherMappings.map((m, idx) => (
                    <div
                      key={`${m.subject}-${idx}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#FAF9F5] border border-[#E5E1D8] text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-semibold text-[#1F2421]">{m.subject}</span>
                        {m.hours !== null && (
                          <span className="text-[#7C7A72] font-mono-num ml-1.5">
                            {m.hours}節
                          </span>
                        )}
                      </div>
                      <input
                        value={m.teacherName}
                        maxLength={40}
                        onChange={(e) => handleUpdateMappingTeacher(idx, e.target.value)}
                        className="w-24 px-2 py-1 text-xs bg-white border border-[#DDD8CD] rounded-lg text-[#1F2421]"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mon-Fri Weekly Timetable Interactive Matrix Preview */}
            <div className="bg-white border border-[#E5E1D8] rounded-2xl overflow-hidden">
              <div className="px-4 py-2.5 bg-[#FAF9F5] border-b border-[#E5E1D8] flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#1F2421]">
                  週一～週五 巡堂轉換預覽（點擊任一格可修改科目、教師或移地教室）
                </span>
                <div className="flex items-center gap-3 text-[11px] text-[#5C615C]">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#E5F2EE] border border-[#1E5C4B]/40" />
                    科任／移地
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-xs bg-[#FBF0E2] border border-[#C98A2E]/40" />
                    待確認教師
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAF9F5] border-b border-[#E5E1D8] text-[#5C615C]">
                      <th className="py-2.5 px-3 text-center font-semibold w-24 border-r border-[#E5E1D8]">
                        節次／時間
                      </th>
                      {[1, 2, 3, 4, 5].map((day) => (
                        <th
                          key={day}
                          className="py-2.5 px-2 text-center font-bold text-[#1F2421] border-r last:border-r-0 border-[#E5E1D8]"
                        >
                          星期{DAY_OF_WEEK_SHORT[day]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDE9E0]">
                    {PERIOD_SCHEDULE.slice(0, maxDisplayPeriod).map((pInfo) => (
                      <tr key={pInfo.period}>
                        <td className="py-2 px-2.5 text-center bg-[#FAF9F5]/70 border-r border-[#E5E1D8] whitespace-nowrap">
                          <div className="font-bold text-[#1F2421] font-mono-num">
                            {pInfo.label}
                          </div>
                          <div className="text-[10px] text-[#7C7A72] font-mono-num">
                            {pInfo.start}–{pInfo.end}
                          </div>
                        </td>
                        {[1, 2, 3, 4, 5].map((day) => {
                          const slot = activeClass.slots.find(
                            (s) => s.dayOfWeek === day && s.period === pInfo.period
                          );
                          const isSelected =
                            editingCell?.dayOfWeek === day &&
                            editingCell?.period === pInfo.period;
                          const missingTeacher =
                            slot && !slot.teacherName.trim() && !activeClass.homeroomTeacher.trim();

                          return (
                            <td
                              key={day}
                              className="p-1.5 border-r last:border-r-0 border-[#EDE9E0] align-top"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingCell({ dayOfWeek: day, period: pInfo.period })
                                }
                                className={`w-full min-h-[64px] p-2 rounded-xl border text-left transition-colors cursor-pointer flex flex-col justify-between ${
                                  isSelected
                                    ? 'border-[#1E5C4B] ring-2 ring-[#1E5C4B]/20 bg-[#E5F2EE]'
                                    : !slot
                                      ? 'border-dashed border-transparent hover:border-[#DDD8CD] hover:bg-[#FAF9F5] text-[#C2BDB2]'
                                      : missingTeacher
                                        ? 'bg-[#FBF0E2] border-[#E0B97C] hover:border-[#C98A2E]'
                                        : slot.isSpecialist || slot.isRelocated
                                          ? 'bg-[#EDF6F3] border-[#C5E0D7] hover:border-[#1E5C4B]'
                                          : 'bg-white border-[#E5E1D8] hover:border-[#1E5C4B]'
                                }`}
                              >
                                {slot ? (
                                  <>
                                    <div className="font-bold text-[#1F2421] leading-snug line-clamp-2">
                                      {slot.subject}
                                    </div>
                                    <div className="mt-1 space-y-0.5">
                                      <div
                                        className={`text-[11px] font-medium truncate ${
                                          missingTeacher ? 'text-[#B44326]' : 'text-[#5C615C]'
                                        }`}
                                      >
                                        {slot.teacherName || activeClass.homeroomTeacher || '未指派教師'}
                                      </div>
                                      {slot.isRelocated && (
                                        <div className="text-[10px] text-[#245A84] inline-flex items-center gap-0.5 truncate max-w-full">
                                          <MapPin className="w-2.5 h-2.5 shrink-0" />
                                          <span className="truncate">
                                            {slot.locationNote || '專科教室'}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="m-auto text-[11px]">＋ 新增</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Inline Selected Cell Editor */}
            {editingCell && (
              <CellInlineEditor
                key={`${activeClass.id}-${editingCell.dayOfWeek}-${editingCell.period}`}
                dayOfWeek={editingCell.dayOfWeek}
                period={editingCell.period}
                slot={activeSlotBeingEdited}
                homeroomTeacher={activeClass.homeroomTeacher}
                onSave={(data) =>
                  handleUpsertCell(editingCell.dayOfWeek, editingCell.period, data)
                }
                onDelete={
                  activeSlotBeingEdited
                    ? () => handleDeleteCell(editingCell.dayOfWeek, editingCell.period)
                    : undefined
                }
                onCancel={() => setEditingCell(null)}
              />
            )}

            {commitError && (
              <div className="p-3 rounded-xl bg-[#FCECE6] border border-[#EABEB0] text-xs text-[#7A2716]">
                {commitError}
              </div>
            )}
          </div>
        )}

        {/* Modal Footer */}
        {step === 'review' && (
          <div className="px-5 py-3.5 border-t border-[#E5E1D8] bg-[#FAF9F5] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-xs font-medium text-[#1F2421] cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="w-4 h-4 accent-[#1E5C4B]"
                />
                <span>
                  覆蓋同班級既有課表（避免重複排課
                  {existingIdsToReplace.length > 0
                    ? `，將替換既有 ${existingIdsToReplace.length} 筆`
                    : ''}
                  ）
                </span>
              </label>
              {missingTeacherTotal > 0 && (
                <p className="text-[11px] text-[#B44326]">
                  提醒：尚有 {missingTeacherTotal} 節未填入教師，若直接匯入將標記為「未指定教師」。
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-4 text-xs sm:text-sm font-medium text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCommitImport}
                disabled={committing || totalSlotsCount === 0}
                className="min-h-[42px] px-5 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                {committing
                  ? '正在轉入巡堂資料庫...'
                  : `確認轉入巡堂課表（${parsedClasses.length} 班・共 ${totalSlotsCount} 節）`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface CellInlineEditorProps {
  dayOfWeek: number;
  period: number;
  slot: ParsedPeriodSlot | null;
  homeroomTeacher: string;
  onSave: (data: {
    subject: string;
    teacherName: string;
    isRelocated: boolean;
    locationNote: string;
  }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

const CellInlineEditor: React.FC<CellInlineEditorProps> = ({
  dayOfWeek,
  period,
  slot,
  homeroomTeacher,
  onSave,
  onDelete,
  onCancel,
}) => {
  const [subject, setSubject] = useState(slot?.subject ?? '');
  const [teacherName, setTeacherName] = useState(slot?.teacherName || homeroomTeacher || '');
  const [isRelocated, setIsRelocated] = useState(slot?.isRelocated ?? false);
  const [locationNote, setLocationNote] = useState(slot?.locationNote ?? '');

  return (
    <div className="p-4 rounded-2xl bg-[#E5F2EE]/55 border border-[#1E5C4B]/30 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-[#144437]">
          編輯節次：{DAY_OF_WEEK_LABELS[dayOfWeek]} 第 {period} 節
          {slot?.rawText && slot.rawText !== slot.subject && (
            <span className="font-normal text-[#5C615C] ml-2">（原課表文字：{slot.rawText}）</span>
          )}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
        >
          關閉編輯
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div>
          <label className="font-semibold text-[#3A3F3B] block mb-1">授課領域／科目</label>
          <input
            value={subject}
            maxLength={50}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="例如：國語、生活(表演)"
            className="w-full min-h-[38px] px-3 bg-white border border-[#C5E0D7] rounded-xl text-[#1F2421]"
          />
        </div>
        <div>
          <label className="font-semibold text-[#3A3F3B] block mb-1">授課教師姓名</label>
          <input
            value={teacherName}
            maxLength={40}
            onChange={(e) => setTeacherName(e.target.value)}
            placeholder="例如：陳怡芬"
            className="w-full min-h-[38px] px-3 bg-white border border-[#C5E0D7] rounded-xl text-[#1F2421]"
          />
        </div>
        <div className="flex items-end pb-1.5">
          <label className="inline-flex items-center gap-2 text-xs text-[#1F2421] cursor-pointer">
            <input
              type="checkbox"
              checked={isRelocated}
              onChange={(e) => setIsRelocated(e.target.checked)}
              className="w-4 h-4 accent-[#1E5C4B]"
            />
            <span>移地／專科教室上課</span>
          </label>
        </div>
        <div>
          <label className="font-semibold text-[#3A3F3B] block mb-1">地點備註（選填）</label>
          <input
            value={locationNote}
            maxLength={100}
            onChange={(e) => setLocationNote(e.target.value)}
            placeholder="例如：音樂專科教室、戶外操場"
            className="w-full min-h-[38px] px-3 bg-white border border-[#C5E0D7] rounded-xl text-[#1F2421]"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="min-h-[36px] px-3 text-xs font-semibold text-[#B44326] hover:bg-[#FCECE6] rounded-xl inline-flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清除此節課
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[36px] px-3 text-xs text-[#5C615C] hover:text-[#1F2421] cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({ subject, teacherName, isRelocated, locationNote })
            }
            disabled={!subject.trim()}
            className="min-h-[36px] px-4 bg-[#1E5C4B] hover:bg-[#16473A] disabled:opacity-50 text-white text-xs font-semibold rounded-xl cursor-pointer"
          >
            套用變更
          </button>
        </div>
      </div>
    </div>
  );
};
