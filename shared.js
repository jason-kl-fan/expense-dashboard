export const CHART_PALETTE = [
  'rgba(255, 138, 161, 0.78)',
  'rgba(138, 168, 255, 0.78)',
  'rgba(255, 216, 140, 0.84)',
  'rgba(146, 220, 189, 0.84)',
  'rgba(191, 160, 255, 0.84)',
  'rgba(255, 170, 120, 0.84)',
  'rgba(120, 200, 255, 0.84)',
  'rgba(255, 120, 210, 0.78)'
];

export const DEFAULT_CATEGORIES = ['飲食', '交通', '生活用品', '娛樂', '醫療', '住宿', '其他'];
export const DEFAULT_PAYMENT_METHODS = ['現金', '信用卡', '簽帳金融卡', 'Line Pay', 'Apple Pay', '轉帳', '其他'];
export const ADMIN_SESSION_KEY = 'expense-dashboard-admin-auth';
export const ADMIN_PASSWORD_MIN_LENGTH = 6;
export const APP_LOCALE = 'en-US';
export const APP_CURRENCY = 'USD';

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeSettings(rawSettings = {}) {
  return {
    adminPassword: rawSettings?.adminPassword || '',
    adminUpdatedAt: rawSettings?.adminUpdatedAt || null,
    lastSecurityNote: rawSettings?.lastSecurityNote || '這是快速展示版本，正式上線建議改為 Firebase Authentication。'
  };
}

export function formatDateTime(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(APP_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

export function formatDateOnly(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(APP_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

export function formatTimeOnly(dateString) {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat(APP_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

export function formatCurrency(value) {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: 'currency',
    currency: APP_CURRENCY,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function startOfMonth(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfYear(date) {
  const d = new Date(date.getFullYear(), 0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getRangeStart(range, date = new Date()) {
  if (range === 'day') return startOfDay(date);
  if (range === 'week') return startOfWeek(date);
  if (range === 'month') return startOfMonth(date);
  if (range === 'year') return startOfYear(date);
  return startOfDay(date);
}

export function aggregateByCategory(records, categories) {
  return categories.map((category) =>
    records
      .filter((record) => record.category === category)
      .reduce((sum, record) => sum + Number(record.amount || 0), 0)
  );
}

export function createSessionToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function saveAdminSession() {
  localStorage.setItem(ADMIN_SESSION_KEY, createSessionToken());
}

export function clearAdminSession() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

export function hasAdminSession() {
  return Boolean(localStorage.getItem(ADMIN_SESSION_KEY));
}

export function verifyAdminPassword(settings, password) {
  const normalized = normalizeSettings(settings);
  if (!normalized.adminPassword) return { ok: false, reason: '尚未設定後台密碼。' };
  if (normalized.adminPassword !== password) return { ok: false, reason: '管理密碼錯誤。' };
  return { ok: true };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
