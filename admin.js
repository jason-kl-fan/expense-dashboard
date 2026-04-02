import { ensureRemoteState, subscribeDashboard, saveDashboardState } from './firebase.js';
import {
  normalizeSettings,
  verifyAdminPassword,
  ADMIN_PASSWORD_MIN_LENGTH,
  hasAdminSession,
  saveAdminSession,
  clearAdminSession,
  downloadBlob,
  formatCurrency,
  formatDateOnly
} from './shared.js';

const adminAuthShell = document.getElementById('adminAuthShell');
const adminLoginPanel = document.getElementById('adminLoginPanel');
const adminSetupPanel = document.getElementById('adminSetupPanel');
const adminAppShell = document.getElementById('adminAppShell');
const authStatus = document.getElementById('authStatus');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const setupAdminPasswordInput = document.getElementById('setupAdminPasswordInput');
const setupAdminPasswordBtn = document.getElementById('setupAdminPasswordBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');
const newAdminPasswordInput = document.getElementById('newAdminPasswordInput');
const changeAdminPasswordBtn = document.getElementById('changeAdminPasswordBtn');
const newCategoryInput = document.getElementById('newCategoryInput');
const addCategoryBtn = document.getElementById('addCategoryBtn');
const categoryTags = document.getElementById('categoryTags');
const newPaymentMethodInput = document.getElementById('newPaymentMethodInput');
const addPaymentMethodBtn = document.getElementById('addPaymentMethodBtn');
const paymentMethodTags = document.getElementById('paymentMethodTags');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const adminExpenseList = document.getElementById('adminExpenseList');

let dashboardState = { categories: [], paymentMethods: [], expenses: [], settings: {} };

function isAdminUnlocked() {
  return hasAdminSession() && Boolean(normalizeSettings(dashboardState.settings).adminPassword);
}

function updateAuthUI() {
  const settings = normalizeSettings(dashboardState.settings);
  const hasPassword = Boolean(settings.adminPassword);
  const unlocked = isAdminUnlocked();

  adminSetupPanel.classList.toggle('hidden', hasPassword);
  adminLoginPanel.classList.toggle('hidden', !hasPassword || unlocked);
  adminAuthShell.classList.toggle('hidden', unlocked);
  adminAppShell.classList.toggle('hidden', !unlocked);
  authStatus.textContent = hasPassword ? '請輸入管理密碼。' : '尚未設定後台密碼。';
}

function renderTags() {
  categoryTags.innerHTML = dashboardState.categories.map((item) => `
    <span class="tag">
      <span class="tag-name">${item}</span>
      <button type="button" onclick="window.editCategory('${item.replace(/'/g, "\\'")}')">編輯</button>
      <button type="button" onclick="window.removeCategory('${item.replace(/'/g, "\\'")}')">刪除</button>
    </span>
  `).join('');

  paymentMethodTags.innerHTML = dashboardState.paymentMethods.map((item) => `
    <span class="tag">
      <span class="tag-name">${item}</span>
      <button type="button" onclick="window.editPaymentMethod('${item.replace(/'/g, "\\'")}')">編輯</button>
      <button type="button" onclick="window.removePaymentMethod('${item.replace(/'/g, "\\'")}')">刪除</button>
    </span>
  `).join('');
}

function renderExpenseList() {
  const sorted = [...dashboardState.expenses].sort((a, b) => new Date(b.expenseDate) - new Date(a.expenseDate));
  if (!sorted.length) {
    adminExpenseList.className = 'record-list empty-state';
    adminExpenseList.textContent = '目前沒有資料。';
    return;
  }

  adminExpenseList.className = 'record-list';
  adminExpenseList.innerHTML = sorted.map((item) => `
    <div class="record-item">
      <div>
        <strong>${item.category}</strong>
        <div class="record-meta">${item.paymentMethod} ・ ${formatDateOnly(item.expenseDate)}</div>
        <div class="record-time">${item.note || '無備註'}</div>
      </div>
      <div>
        <div class="record-amount">${formatCurrency(item.amount)}</div>
        <div class="record-actions button-row-wrap mt-12">
          <button type="button" onclick="window.editExpense('${item.id}')">編輯</button>
          <button type="button" onclick="window.deleteExpense('${item.id}')">刪除</button>
        </div>
      </div>
    </div>
  `).join('');
}

async function setupAdminPassword() {
  const password = setupAdminPasswordInput.value.trim();
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    alert(`密碼至少要 ${ADMIN_PASSWORD_MIN_LENGTH} 碼`);
    return;
  }
  await saveDashboardState({
    settings: {
      ...normalizeSettings(dashboardState.settings),
      adminPassword: password,
      adminUpdatedAt: new Date().toISOString()
    }
  });
  saveAdminSession();
}

function loginAdmin() {
  const result = verifyAdminPassword(dashboardState.settings, adminPasswordInput.value);
  if (!result.ok) {
    authStatus.textContent = result.reason;
    return;
  }
  saveAdminSession();
  updateAuthUI();
}

async function changeAdminPassword() {
  const password = newAdminPasswordInput.value.trim();
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    alert(`密碼至少要 ${ADMIN_PASSWORD_MIN_LENGTH} 碼`);
    return;
  }
  await saveDashboardState({
    settings: {
      ...normalizeSettings(dashboardState.settings),
      adminPassword: password,
      adminUpdatedAt: new Date().toISOString()
    }
  });
  newAdminPasswordInput.value = '';
  alert('管理密碼已更新');
}

async function addCategory() {
  const value = newCategoryInput.value.trim();
  if (!value) return;
  if (dashboardState.categories.includes(value)) {
    alert('類別已存在');
    return;
  }
  await saveDashboardState({ categories: [...dashboardState.categories, value] });
  newCategoryInput.value = '';
}

async function addPaymentMethod() {
  const value = newPaymentMethodInput.value.trim();
  if (!value) return;
  if (dashboardState.paymentMethods.includes(value)) {
    alert('付款方式已存在');
    return;
  }
  await saveDashboardState({ paymentMethods: [...dashboardState.paymentMethods, value] });
  newPaymentMethodInput.value = '';
}

window.removeCategory = async (name) => {
  if (!confirm(`確定刪除類別「${name}」？`)) return;
  const categories = dashboardState.categories.filter((item) => item !== name);
  const expenses = dashboardState.expenses.map((item) => item.category === name ? { ...item, category: '其他', updatedAt: new Date().toISOString() } : item);
  await saveDashboardState({ categories, expenses });
};

window.editCategory = async (name) => {
  const next = prompt('修改類別名稱', name)?.trim();
  if (!next || next === name) return;
  const categories = dashboardState.categories.map((item) => item === name ? next : item);
  const expenses = dashboardState.expenses.map((item) => item.category === name ? { ...item, category: next, updatedAt: new Date().toISOString() } : item);
  await saveDashboardState({ categories, expenses });
};

window.removePaymentMethod = async (name) => {
  if (!confirm(`確定刪除付款方式「${name}」？`)) return;
  const paymentMethods = dashboardState.paymentMethods.filter((item) => item !== name);
  const expenses = dashboardState.expenses.map((item) => item.paymentMethod === name ? { ...item, paymentMethod: '其他', updatedAt: new Date().toISOString() } : item);
  await saveDashboardState({ paymentMethods, expenses });
};

window.editPaymentMethod = async (name) => {
  const next = prompt('修改付款方式名稱', name)?.trim();
  if (!next || next === name) return;
  const paymentMethods = dashboardState.paymentMethods.map((item) => item === name ? next : item);
  const expenses = dashboardState.expenses.map((item) => item.paymentMethod === name ? { ...item, paymentMethod: next, updatedAt: new Date().toISOString() } : item);
  await saveDashboardState({ paymentMethods, expenses });
};

window.deleteExpense = async (id) => {
  if (!confirm('確定刪除這筆消費紀錄？')) return;
  await saveDashboardState({ expenses: dashboardState.expenses.filter((item) => item.id !== id) });
};

window.editExpense = async (id) => {
  const target = dashboardState.expenses.find((item) => item.id === id);
  if (!target) return;
  const amount = prompt('金額', target.amount);
  if (amount === null) return;
  const category = prompt('類別', target.category);
  if (!category) return;
  const paymentMethod = prompt('付款方式', target.paymentMethod);
  if (!paymentMethod) return;
  const note = prompt('備註', target.note || '') ?? '';
  const expenses = dashboardState.expenses.map((item) => item.id === id ? {
    ...item,
    amount: Number(amount),
    category,
    paymentMethod,
    note,
    updatedAt: new Date().toISOString()
  } : item);
  await saveDashboardState({ expenses });
};

function exportCsv() {
  const rows = [
    ['日期', '類別', '付款方式', '金額', '備註'],
    ...dashboardState.expenses.map((item) => [
      formatDateOnly(item.expenseDate),
      item.category,
      item.paymentMethod,
      item.amount,
      item.note || ''
    ])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadBlob('expense-records.csv', new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

adminLoginBtn.addEventListener('click', loginAdmin);
setupAdminPasswordBtn.addEventListener('click', setupAdminPassword);
adminLogoutBtn.addEventListener('click', () => {
  clearAdminSession();
  updateAuthUI();
});
changeAdminPasswordBtn.addEventListener('click', changeAdminPassword);
addCategoryBtn.addEventListener('click', addCategory);
addPaymentMethodBtn.addEventListener('click', addPaymentMethod);
exportCsvBtn.addEventListener('click', exportCsv);

try {
  await ensureRemoteState();
  subscribeDashboard((state) => {
    dashboardState = state;
    updateAuthUI();
    renderTags();
    renderExpenseList();
  }, (error) => {
    console.error(error);
    authStatus.textContent = `同步失敗：${error.message}`;
  });
} catch (error) {
  console.error(error);
  authStatus.textContent = `初始化失敗：${error.message}`;
}
