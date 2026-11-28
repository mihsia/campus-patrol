import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';
import firebaseConfig from '../../firebase-applet-config.json';

export const ACCOUNT_HUB_APP_NAME = 'ltps-account-hub';
export const ACCOUNT_HUB_URL =
  import.meta.env.VITE_ACCOUNT_HUB_URL || 'https://ltps-account-hub.mihsia.workers.dev';

const existingApps = getApps();
const app: FirebaseApp =
  existingApps.find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

function createFirestoreInstance(targetApp: FirebaseApp, databaseId?: string): Firestore {
  try {
    return initializeFirestore(
      targetApp,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      databaseId
    );
  } catch (error) {
    // Graceful fallback when IndexedDB is unavailable (e.g. private browsing) or during HMR re-init
    console.warn('Firestore persistent cache unavailable, falling back to default cache:', error);
    return databaseId ? getFirestore(targetApp, databaseId) : getFirestore(targetApp);
  }
}

// CRITICAL: Bind business operational database to the provisioned named Firestore database ID
export const db = createFirestoreInstance(app, firebaseConfig.firestoreDatabaseId);
export const auth: Auth = getAuth(app);

// 方案 B：第二個具名 Firebase App，連接獨立的校級帳號管理中心（ltps-account-hub）
const hubFirebaseConfig = {
  apiKey: import.meta.env.VITE_ACCOUNT_HUB_API_KEY || '',
  authDomain: import.meta.env.VITE_ACCOUNT_HUB_AUTH_DOMAIN || 'ltps-account-hub.firebaseapp.com',
  projectId: import.meta.env.VITE_ACCOUNT_HUB_PROJECT_ID || 'ltps-account-hub',
  appId: import.meta.env.VITE_ACCOUNT_HUB_APP_ID || '',
};

export const isAccountHubConfigured = Boolean(
  hubFirebaseConfig.apiKey &&
    hubFirebaseConfig.authDomain &&
    hubFirebaseConfig.projectId &&
    hubFirebaseConfig.appId
);

const hubApp: FirebaseApp | null = isAccountHubConfigured
  ? existingApps.find((a) => a.name === ACCOUNT_HUB_APP_NAME) ||
    initializeApp(hubFirebaseConfig, ACCOUNT_HUB_APP_NAME)
  : null;

export const hubAuth: Auth | null = hubApp ? getAuth(hubApp) : null;
export const hubDb: Firestore | null = hubApp ? getFirestore(hubApp) : null;
export const hubFunctions: Functions | null = hubApp ? getFunctions(hubApp) : null;

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const activeUser = auth.currentUser || hubAuth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: activeUser?.uid,
      email: hubAuth?.currentUser?.email || auth.currentUser?.email,
      emailVerified: hubAuth?.currentUser?.emailVerified ?? auth.currentUser?.emailVerified,
      isAnonymous: activeUser?.isAnonymous,
      tenantId: activeUser?.tenantId,
      providerInfo:
        activeUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
