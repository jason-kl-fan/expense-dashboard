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
  formatDateOnly,
  formatDateTime,
  formatTimeOnly
} from './shared.js';

const connectionIndicator = document.getElementById('connectionIndicator');
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
const editExpenseModal = document.getElementById('editExpenseModal');
const closeEditExpenseModalBtn = document.getElementById('closeEditExpenseModalBtn');
const cancelEditExpenseBtn = document.getElementById('cancelEditExpenseBtn');
const saveEditExpenseBtn = document.getElementById('saveEditExpenseBtn');
const editExpenseAmountInput = document.getElementById('editExpenseAmountInput');
const editExpenseCategorySelect = document.getElementById('editExpenseCategorySelect');
const editExpensePaymentMethodSelect = document.getElementById('editExpensePaymentMethodSelect');
const editExpenseDateInput = document.getElementById('editExpenseDateInput');
const editExpenseTimeInput = document.getElementById('editExpenseTimeInput');
const editExpenseNoteInput = document.getElementById('editExpenseNoteInput');

let dashboardState = { categories: [], paymentMethods: [], expenses: [], settings: {} };
let editingExpenseId = null;

function setConnectionStatus(status, text, title = text) {
  connectionIndicator.classList.remove('connection-indicator--connected', 'connection-indicator--error', 'connection-indicator--connecting');
  connectionIndicator.classList.add(`connection-indicator--${status}`);
  connectionIndicator.title = title;
  connectionIndicator.querySelector('.connection-text').textContent = text;
}

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
        <div class="record-meta">${item.paymentMethod} ・ ${formatDateTime(item.expenseDate)}</div>
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

function renderEditExpenseSelectors(selectedCategory = '', selectedPaymentMethod = '') {
  editExpenseCategorySelect.innerHTML = dashboardState.categories
    .map((item) => `<option value="${item}">${item}</option>`)
    .join('');

  editExpensePaymentMethodSelect.innerHTML = dashboardState.paymentMethods
    .map((item) => `<option value="${item}">${item}</option>`)
    .join('');

  if (dashboardState.categories.includes(selectedCategory)) {
    editExpenseCategorySelect.value = selectedCategory;
  }
  if (dashboardState.paymentMethods.includes(selectedPaymentMethod)) {
    editExpensePaymentMethodSelect.value = selectedPaymentMethod;
  }
}

function openEditExpenseModal(expense) {
  const currentExpenseDate = new Date(expense.expenseDate);
  const dateDefault = `${currentExpenseDate.getFullYear()}-${String(currentExpenseDate.getMonth() + 1).padStart(2, '0')}-${String(currentExpenseDate.getDate()).padStart(2, '0')}`;
  const timeDefault = `${String(currentExpenseDate.getHours()).padStart(2, '0')}:${String(currentExpenseDate.getMinutes()).padStart(2, '0')}`;

  editingExpenseId = expense.id;
  renderEditExpenseSelectors(expense.category, expense.paymentMethod);
  editExpenseAmountInput.value = expense.amount;
  editExpenseDateInput.value = dateDefault;
  editExpenseTimeInput.value = timeDefault;
  editExpenseNoteInput.value = expense.note || '';
  editExpenseModal.classList.remove('hidden');
}

function closeEditExpenseModal() {
  editingExpenseId = null;
  editExpenseModal.classList.add('hidden');
}

async function persistState(partialState) {
  try {
    setConnectionStatus('connecting', '同步中', '資料儲存中');
    await saveDashboardState(partialState);
  } catch (error) {
    console.error(error);
    setConnectionStatus('error', '失敗', `寫入失敗：${error.message}`);
    alert(`資料儲存失敗：${error.message}`);
    throw error;
  }
}

async function setupAdminPassword() {
  const password = setupAdminPasswordInput.value.trim();
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    alert(`密碼至少要 ${ADMIN_PASSWORD_MIN_LENGTH} 碼`);
    return;
  }
  await persistState({
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
  await persistState({
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
  await persistState({ categories: [...dashboardState.categories, value] });
  newCategoryInput.value = '';
}

async function addPaymentMethod() {
  const value = newPaymentMethodInput.value.trim();
  if (!value) return;
  if (dashboardState.paymentMethods.includes(value)) {
    alert('付款方式已存在');
    return;
  }
  await persistState({ paymentMethods: [...dashboardState.paymentMethods, value] });
  newPaymentMethodInput.value = '';
}

window.removeCategory = async (name) => {
  if (!confirm(`確定刪除類別「${name}」？`)) return;
  const categories = dashboardState.categories.filter((item) => item !== name);
  const expenses = dashboardState.expenses.map((item) => item.category === name ? { ...item, category: '其他', updatedAt: new Date().toISOString() } : item);
  await persistState({ categories, expenses });
};

window.editCategory = async (name) => {
  const next = prompt('修改類別名稱', name)?.trim();
  if (!next || next === name) return;
  const categories = dashboardState.categories.map((item) => item === name ? next : item);
  const expenses = dashboardState.expenses.map((item) => item.category === name ? { ...item, category: next, updatedAt: new Date().toISOString() } : item);
  await persistState({ categories, expenses });
};

window.removePaymentMethod = async (name) => {
  if (!confirm(`確定刪除付款方式「${name}」？`)) return;
  const paymentMethods = dashboardState.paymentMethods.filter((item) => item !== name);
  const expenses = dashboardState.expenses.map((item) => item.paymentMethod === name ? { ...item, paymentMethod: '其他', updatedAt: new Date().toISOString() } : item);
  await persistState({ paymentMethods, expenses });
};

window.editPaymentMethod = async (name) => {
  const next = prompt('修改付款方式名稱', name)?.trim();
  if (!next || next === name) return;
  const paymentMethods = dashboardState.paymentMethods.map((item) => item === name ? next : item);
  const expenses = dashboardState.expenses.map((item) => item.paymentMethod === name ? { ...item, paymentMethod: next, updatedAt: new Date().toISOString() } : item);
  await persistState({ paymentMethods, expenses });
};

window.deleteExpense = async (id) => {
  if (!confirm('確定刪除這筆消費紀錄？')) return;
  await persistState({ expenses: dashboardState.expenses.filter((item) => item.id !== id) });
};

window.editExpense = async (id) => {
  const target = dashboardState.expenses.find((item) => item.id === id);
  if (!target) return;
  openEditExpenseModal(target);
};

async function saveEditedExpense() {
  if (!editingExpenseId) return;

  const amount = Number(editExpenseAmountInput.value);
  if (!amount || Number.isNaN(amount) || amount <= 0) {
    alert('請輸入正確金額');
    return;
  }

  if (!editExpenseCategorySelect.value) {
    alert('請選擇消費類別');
    return;
  }

  if (!editExpensePaymentMethodSelect.value) {
    alert('請選擇付款方式');
    return;
  }

  if (!editExpenseDateInput.value) {
    alert('請選擇消費日期');
    return;
  }

  if (!editExpenseTimeInput.value) {
    alert('請選擇消費時間');
    return;
  }

  const expenses = dashboardState.expenses.map((item) => item.id === editingExpenseId ? {
    ...item,
    amount,
    category: editExpenseCategorySelect.value,
    paymentMethod: editExpensePaymentMethodSelect.value,
    expenseDate: `${editExpenseDateInput.value}T${editExpenseTimeInput.value}:00`,
    note: editExpenseNoteInput.value.trim(),
    updatedAt: new Date().toISOString()
  } : item);
  await persistState({ expenses });
  closeEditExpenseModal();
}

function exportCsv() {
  const rows = [
    ['日期', '時間', '類別', '付款方式', '金額', '備註'],
    ...dashboardState.expenses.map((item) => [
      formatDateOnly(item.expenseDate),
      formatTimeOnly(item.expenseDate),
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
closeEditExpenseModalBtn.addEventListener('click', closeEditExpenseModal);
cancelEditExpenseBtn.addEventListener('click', closeEditExpenseModal);
saveEditExpenseBtn.addEventListener('click', saveEditedExpense);
editExpenseModal.addEventListener('click', (event) => {
  if (event.target === editExpenseModal) closeEditExpenseModal();
});

try {
  setConnectionStatus('connecting', '連線中', '資料庫連線初始化中');
  await ensureRemoteState();
  subscribeDashboard((state) => {
    dashboardState = state;
    setConnectionStatus('connected', '已連線', '資料庫連線正常');
    updateAuthUI();
    renderTags();
    renderExpenseList();
  }, (error) => {
    console.error(error);
    setConnectionStatus('error', '失敗', `同步失敗：${error.message}`);
    authStatus.textContent = `同步失敗：${error.message}`;
  });
} catch (error) {
  console.error(error);
  setConnectionStatus('error', '失敗', `初始化失敗：${error.message}`);
  authStatus.textContent = `初始化失敗：${error.message}`;
}
