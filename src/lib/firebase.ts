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
import firebaseAppletConfig from '../../firebase-applet-config.json';

export const ACCOUNT_HUB_APP_NAME = 'ltps-account-hub';
export const ACCOUNT_HUB_URL =
  import.meta.env.VITE_ACCOUNT_HUB_URL || 'https://ltps-account-hub.mihsia.workers.dev';

// 若已設定獨立 Firebase 專案環境變數（如 ltps-campus-patrol），優先使用並預設連線 (default) 資料庫；
// 未設定時自動沿用既有 firebase-applet-config.json（零停機平滑遷移）。
const useStandaloneFirebase = Boolean(
  import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_API_KEY
);

const firebaseConfig = useStandaloneFirebase
  ? {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain:
        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
        `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket:
        import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
        `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
    }
  : firebaseAppletConfig;

const targetDatabaseId = useStandaloneFirebase
  ? import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)'
  : firebaseAppletConfig.firestoreDatabaseId;

const existingApps = getApps();
const app: FirebaseApp =
  existingApps.find((a) => a.name === '[DEFAULT]') || initializeApp(firebaseConfig);

function createFirestoreInstance(targetApp: FirebaseApp, databaseId?: string): Firestore {
  const namedDb = databaseId && databaseId !== '(default)' ? databaseId : undefined;
  try {
    return initializeFirestore(
      targetApp,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      namedDb
    );
  } catch (error) {
    // Graceful fallback when IndexedDB is unavailable (e.g. private browsing) or during HMR re-init
    console.warn('Firestore persistent cache unavailable, falling back to default cache:', error);
    return namedDb ? getFirestore(targetApp, namedDb) : getFirestore(targetApp);
  }
}

export const db = createFirestoreInstance(app, targetDatabaseId);
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
