import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS, normalizeSettings } from './shared.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const dashboardRef = doc(db, 'expenseDashboard', 'main');

const defaultState = {
  categories: DEFAULT_CATEGORIES,
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  expenses: [],
  settings: normalizeSettings(),
  updatedAt: null
};

export async function ensureRemoteState() {
  const snap = await getDoc(dashboardRef);
  if (!snap.exists()) {
    await setDoc(dashboardRef, { ...defaultState, updatedAt: serverTimestamp() });
    return;
  }

  const data = snap.data();
  const patch = {};
  if (!Array.isArray(data.categories) || !data.categories.length) patch.categories = DEFAULT_CATEGORIES;
  if (!Array.isArray(data.paymentMethods) || !data.paymentMethods.length) patch.paymentMethods = DEFAULT_PAYMENT_METHODS;
  if (!Array.isArray(data.expenses)) patch.expenses = [];
  if (!data.settings) patch.settings = normalizeSettings();

  if (Object.keys(patch).length) {
    await updateDoc(dashboardRef, { ...patch, updatedAt: serverTimestamp() });
  }
}

export function subscribeDashboard(callback, onError) {
  return onSnapshot(
    dashboardRef,
    (snap) => {
      const data = snap.exists() ? snap.data() : defaultState;
      callback({
        categories: data.categories || defaultState.categories,
        paymentMethods: data.paymentMethods || defaultState.paymentMethods,
        expenses: data.expenses || [],
        settings: normalizeSettings(data.settings),
        updatedAt: data.updatedAt || null
      });
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function saveDashboardState(partialState) {
  await updateDoc(dashboardRef, {
    ...partialState,
    updatedAt: serverTimestamp()
  });
}

export async function uploadReceiptImage(expenseId, file) {
  const extension = (file.name?.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'jpg';
  const safeType = file.type || 'image/jpeg';
  const storagePath = `expense-receipts/${expenseId}-${Date.now()}.${extension}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file, {
    contentType: safeType,
    cacheControl: 'public,max-age=31536000'
  });

  const downloadUrl = await getDownloadURL(storageRef);
  return { storagePath, downloadUrl };
}

export async function deleteReceiptImage(storagePath) {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (error) {
    if (error?.code === 'storage/object-not-found') return;
    throw error;
  }
}
