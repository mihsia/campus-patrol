import React, { useState } from 'react';
import { CheckCircle2, Shield, UserCog, Users } from 'lucide-react';
import type { StaffProfile, StaffRole } from '../types/patrol';
import { STAFF_ROLE_LABELS } from '../types/patrol';
import { adminUpdateStaffRole, updateOwnStaffProfile } from '../lib/firestoreOps';

interface StaffViewProps {
  profile: StaffProfile;
  userEmail: string;
  isAdmin: boolean;
  staffList: StaffProfile[];
  onActionFeedback: (message: string) => void;
}

export const StaffView: React.FC<StaffViewProps> = ({
  profile,
  userEmail,
  isAdmin,
  staffList,
  onActionFeedback,
}) => {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [department, setDepartment] = useState(profile.department);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle);
  const [savingProfile, setSavingProfile] = useState(false);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setSavingProfile(true);
    try {
      await updateOwnStaffProfile(profile.uid, {
        displayName,
        department,
        jobTitle,
      });
      onActionFeedback('已更新個人巡堂檔案資訊');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleRoleChange = async (target: StaffProfile, nextRole: StaffRole) => {
    if (!isAdmin || target.uid === profile.uid) return;
    setUpdatingUid(target.uid);
    try {
      await adminUpdateStaffRole(profile.uid, target.uid, nextRole);
      onActionFeedback(`已將 ${target.displayName} 的系統角色變更為「${STAFF_ROLE_LABELS[nextRole]}」`);
    } finally {
      setUpdatingUid(null);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Personal Account Profile */}
      <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        <div className="flex items-center gap-2.5">
          <UserCog className="w-5 h-5 text-teal-700" />
          <div>
            <h2 className="text-base font-semibold text-slate-900">個人巡堂帳號設定</h2>
            <p className="text-xs text-slate-500">所有巡堂紀錄與通報單將自動署名您的顯示姓名與職稱</p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4 text-sm">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1 text-xs">
            <p className="text-slate-500">登入帳號（個人隱私隔離儲存，不對外公開）</p>
            <p className="font-mono-num text-slate-900 font-medium">{userEmail}</p>
            <p className="text-teal-800 font-semibold pt-1">
              目前系統角色：{STAFF_ROLE_LABELS[profile.role]}
            </p>
          </div>

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

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700 block">所屬處室／組別</label>
            <input
              type="text"
              required
              maxLength={60}
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="例如：學務處生教組、教務處"
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
              placeholder="例如：值日巡堂教師、生教組長"
              className="w-full min-h-[42px] px-3 border border-slate-200 rounded-lg bg-white"
            />
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="w-full min-h-[44px] px-4 py-2.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {savingProfile ? '儲存變更中...' : '儲存個人資料'}
          </button>
        </form>
      </div>

      {/* Campus Staff Directory & Role Management */}
      <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-slate-500" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                全校巡堂協作人員名冊（<span className="font-mono-num">{staffList.length}</span> 人）
              </h2>
              <p className="text-xs text-slate-500">
                每位教職員使用個別 Google 帳號登入即可加入協作；僅系統管理員可調整權限角色
              </p>
            </div>
          </div>
          {isAdmin && (
            <span className="text-xs font-semibold text-teal-800 inline-flex items-center gap-1 whitespace-nowrap">
              <Shield className="w-3.5 h-3.5" />
              管理員權限
            </span>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {staffList.map((member) => (
            <div
              key={member.uid}
              className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
            >
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span>{member.displayName}</span>
                  {member.uid === profile.uid && (
                    <span className="text-xs font-normal text-teal-700">（目前登入帳號）</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {member.department} · {member.jobTitle}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isAdmin && member.uid !== profile.uid ? (
                  <select
                    value={member.role}
                    disabled={updatingUid === member.uid}
                    onChange={(e) => handleRoleChange(member, e.target.value as StaffRole)}
                    className="min-h-[38px] px-3 text-xs border border-slate-200 rounded-lg bg-slate-50"
                  >
                    <option value="inspector">巡堂人員</option>
                    <option value="admin">系統管理員</option>
                    <option value="viewer">檢視人員</option>
                  </select>
                ) : (
                  <span className="text-xs font-medium text-slate-700">
                    {STAFF_ROLE_LABELS[member.role]}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
