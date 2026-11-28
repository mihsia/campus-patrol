import { evaluateAppAccessFromAccount, type HubAccountRecord } from '@ltps/account-sdk/core';
import { CAMPUS_ID, type StaffProfile, type StaffRole } from '../types/patrol';
import { clampString, sanitizeId } from './validation';

export const PATROL_APP_ID = 'patrol' as const;

export type PatrolHubAccessResult =
  | {
      status: 'authorized';
      profile: StaffProfile;
      isAdmin: boolean;
      isSuperAdmin: boolean;
      claimsVersion: number;
    }
  | {
      status: 'unauthorized';
      email: string;
      displayName?: string;
      department?: string;
      reason: string;
    }
  | {
      status: 'disabled';
      email: string;
      displayName?: string;
      department?: string;
      reason: string;
    };

/**
 * 將校級帳號管理中心（ltps-account-hub）的 `/accounts/{uid}` 權限文件
 * 轉換為校園即時巡堂系統（patrol）的存取判別結果與 StaffProfile。
 */
export function adaptHubAccountToPatrol(
  account: HubAccountRecord | null | undefined,
  options?: {
    fallbackEmail?: string;
    fallbackDisplayName?: string;
    targetUid?: string;
  }
): PatrolHubAccessResult {
  const email = (account?.email || options?.fallbackEmail || '').trim().toLowerCase();

  if (!account) {
    return {
      status: 'unauthorized',
      email,
      reason: '找不到此帳號於全校帳號管理中心的權限資料，請聯絡學校系統管理者開通權限。',
    };
  }

  const hubAccess = evaluateAppAccessFromAccount({
    profileState: 'ready',
    account,
    appId: PATROL_APP_ID,
  });

  if (!hubAccess.allowed) {
    const isDisabled =
      hubAccess.code === 'global-disabled' || hubAccess.code === 'app-disabled';
    return {
      status: isDisabled ? 'disabled' : 'unauthorized',
      email,
      displayName: account.name || options?.fallbackDisplayName,
      department: account.dept,
      reason:
        hubAccess.reason ||
        (isDisabled
          ? '此帳號之校園巡堂系統權限已停用，請聯絡系統管理者。'
          : '此帳號尚未開通「校園即時巡堂系統」使用權限，請聯絡系統管理者。'),
    };
  }

  const isAdmin = Boolean(hubAccess.isSuperAdmin || hubAccess.isAppAdmin);
  const role: StaffRole = isAdmin ? 'admin' : 'user';
  const uid = sanitizeId(options?.targetUid || account.uid, 'user');
  const displayName = clampString(
    account.name || options?.fallbackDisplayName || email.split('@')[0] || '使用者',
    60,
    '使用者'
  );
  const department = clampString(account.dept || '教務處', 60, '教務處');
  const jobTitle = clampString(
    account.jobTitle || (isAdmin ? '系統管理者' : '巡堂人員'),
    60,
    isAdmin ? '系統管理者' : '巡堂人員'
  );

  return {
    status: 'authorized',
    profile: {
      uid,
      campusId: CAMPUS_ID,
      displayName,
      department,
      jobTitle,
      role,
    },
    isAdmin,
    isSuperAdmin: Boolean(hubAccess.isSuperAdmin),
    claimsVersion: Number.isInteger(account.claimsVersion) && account.claimsVersion >= 1
      ? account.claimsVersion
      : 1,
  };
}
