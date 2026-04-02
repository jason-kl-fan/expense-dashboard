import { ensureRemoteState, subscribeDashboard, saveDashboardState } from './firebase.js';
import {
  uid,
  formatCurrency,
  formatDateOnly,
  formatDateTime,
  getRangeStart,
  aggregateByCategory,
  CHART_PALETTE
} from './shared.js';

const liveClock = document.getElementById('liveClock');
const syncStatus = document.getElementById('syncStatus');
const amountDisplay = document.getElementById('amountDisplay');
const keypad = document.getElementById('keypad');
const backspaceBtn = document.getElementById('backspaceBtn');
const clearBtn = document.getElementById('clearBtn');
const categorySelect = document.getElementById('categorySelect');
const paymentMethodSelect = document.getElementById('paymentMethodSelect');
const expenseDateInput = document.getElementById('expenseDateInput');
const noteInput = document.getElementById('noteInput');
const addExpenseBtn = document.getElementById('addExpenseBtn');
const rangeSelect = document.getElementById('rangeSelect');
const customStartWrap = document.getElementById('customStartWrap');
const customEndWrap = document.getElementById('customEndWrap');
const customStartDateInput = document.getElementById('customStartDateInput');
const customEndDateInput = document.getElementById('customEndDateInput');
const summaryCards = document.getElementById('summaryCards');
const categoryBreakdown = document.getElementById('categoryBreakdown');
const expenseList = document.getElementById('expenseList');

let dashboardState = { categories: [], paymentMethods: [], expenses: [], settings: {} };
let categoryChart;
let amountValue = '0';

function tickClock() {
  liveClock.textContent = new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(new Date());
}

function setTodayDefault() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const value = `${year}-${month}-${day}`;
  expenseDateInput.value = value;
  if (!customStartDateInput.value) customStartDateInput.value = value;
  if (!customEndDateInput.value) customEndDateInput.value = value;
}

function renderSelectors() {
  categorySelect.innerHTML = dashboardState.categories.map((item) => `<option value="${item}">${item}</option>`).join('');
  paymentMethodSelect.innerHTML = dashboardState.paymentMethods.map((item) => `<option value="${item}">${item}</option>`).join('');
}

function updateAmountDisplay() {
  amountDisplay.value = amountValue;
}

function inputKey(key) {
  if (key === '.') {
    if (amountValue.includes('.')) return;
    amountValue += '.';
  } else if (amountValue === '0') {
    amountValue = key;
  } else {
    amountValue += key;
  }
  updateAmountDisplay();
}

function backspaceAmount() {
  amountValue = amountValue.length <= 1 ? '0' : amountValue.slice(0, -1);
  if (amountValue === '' || amountValue === '-') amountValue = '0';
  updateAmountDisplay();
}

function clearAmount() {
  amountValue = '0';
  updateAmountDisplay();
}

function getFilteredExpenses() {
  const range = rangeSelect.value;
  if (range === 'custom') {
    const start = customStartDateInput.value ? new Date(`${customStartDateInput.value}T00:00:00`) : null;
    const end = customEndDateInput.value ? new Date(`${customEndDateInput.value}T23:59:59`) : null;
    if (!start || !end || start > end) return [];
    return dashboardState.expenses.filter((item) => {
      const date = new Date(item.expenseDate);
      return date >= start && date <= end;
    });
  }

  const start = getRangeStart(range);
  return dashboardState.expenses.filter((item) => new Date(item.expenseDate) >= start);
}

function renderSummary(expenses) {
  const total = expenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const count = expenses.length;
  const average = count ? total / count : 0;
  const topCategoryEntry = Object.entries(expenses.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + Number(item.amount || 0);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0];

  summaryCards.innerHTML = [
    { label: '總支出', value: formatCurrency(total), sub: `${count} 筆紀錄` },
    { label: '平均每筆', value: formatCurrency(average), sub: '依目前篩選區間' },
    { label: '最高支出類別', value: topCategoryEntry ? topCategoryEntry[0] : '—', sub: topCategoryEntry ? formatCurrency(topCategoryEntry[1]) : '尚無資料' }
  ].map((card) => `<div class="summary-card"><div class="label">${card.label}</div><div class="value">${card.value}</div><div class="summary-sub">${card.sub}</div></div>`).join('');
}

function renderChart(expenses) {
  const categories = dashboardState.categories;
  const totals = aggregateByCategory(expenses, categories);
  const ctx = document.getElementById('categoryChart');
  if (categoryChart) categoryChart.destroy();

  categoryChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [{
        label: '支出金額',
        data: totals,
        backgroundColor: categories.map((_, index) => CHART_PALETTE[index % CHART_PALETTE.length]),
        borderRadius: 12
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });

  categoryBreakdown.innerHTML = categories.map((category, index) => `
    <div class="chart-stat-item">
      <div><span class="color-dot" style="background:${CHART_PALETTE[index % CHART_PALETTE.length]}"></span> ${category}</div>
      <strong>${formatCurrency(totals[index])}</strong>
    </div>
  `).join('');
}

function renderExpenseList(expenses) {
  const sorted = [...expenses].sort((a, b) => new Date(b.expenseDate) - new Date(a.expenseDate));
  if (!sorted.length) {
    expenseList.className = 'record-list empty-state';
    expenseList.textContent = '目前沒有資料。';
    return;
  }

  expenseList.className = 'record-list';
  expenseList.innerHTML = sorted.map((item) => `
    <div class="record-item">
      <div>
        <strong>${item.category}</strong>
        <div class="record-meta">${item.paymentMethod} ・ ${formatDateOnly(item.expenseDate)}</div>
        <div class="record-time">${item.note || '無備註'}</div>
      </div>
      <div class="record-amount">${formatCurrency(item.amount)}</div>
    </div>
  `).join('');
}

function refreshUI() {
  renderSelectors();
  const expenses = getFilteredExpenses();
  renderSummary(expenses);
  renderChart(expenses);
  renderExpenseList(expenses);
}

async function addExpense() {
  const amount = Number(amountValue);
  if (!amount || Number.isNaN(amount) || amount <= 0) {
    alert('請輸入正確金額');
    return;
  }

  const nextExpenses = [...dashboardState.expenses, {
    id: uid(),
    amount,
    category: categorySelect.value,
    paymentMethod: paymentMethodSelect.value,
    expenseDate: `${expenseDateInput.value}T12:00:00`,
    note: noteInput.value.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }];

  syncStatus.textContent = '資料儲存中…';
  await saveDashboardState({ expenses: nextExpenses });
  clearAmount();
  noteInput.value = '';
}

keypad.addEventListener('click', (event) => {
  const key = event.target.dataset.key;
  if (!key) return;
  inputKey(key);
});
backspaceBtn.addEventListener('click', backspaceAmount);
clearBtn.addEventListener('click', clearAmount);
addExpenseBtn.addEventListener('click', addExpense);
rangeSelect.addEventListener('change', () => {
  const isCustom = rangeSelect.value === 'custom';
  customStartWrap.classList.toggle('hidden', !isCustom);
  customEndWrap.classList.toggle('hidden', !isCustom);
  refreshUI();
});
customStartDateInput.addEventListener('change', refreshUI);
customEndDateInput.addEventListener('change', refreshUI);

setTodayDefault();
updateAmountDisplay();
tickClock();
setInterval(tickClock, 1000);

try {
  await ensureRemoteState();
  subscribeDashboard((state) => {
    dashboardState = state;
    syncStatus.textContent = '雲端同步完成';
    refreshUI();
  }, (error) => {
    console.error(error);
    syncStatus.textContent = `同步失敗：${error.message}`;
  });
} catch (error) {
  console.error(error);
  syncStatus.textContent = `初始化失敗：${error.message}`;
}
