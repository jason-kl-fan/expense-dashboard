import { ensureRemoteState, subscribeDashboard, saveDashboardState } from './firebase.js';
import {
  uid,
  formatCurrency,
  formatDateTime,
  formatDateOnly,
  getRangeStart,
  aggregateByCategory,
  CHART_PALETTE
} from './shared.js';

const liveClock = document.getElementById('liveClock');
const connectionIndicator = document.getElementById('connectionIndicator');
const amountDisplay = document.getElementById('amountDisplay');
const keypad = document.getElementById('keypad');
const backspaceBtn = document.getElementById('backspaceBtn');
const clearBtn = document.getElementById('clearBtn');
const categorySelect = document.getElementById('categorySelect');
const paymentMethodSelect = document.getElementById('paymentMethodSelect');
const expenseDateInput = document.getElementById('expenseDateInput');
const expenseTimeInput = document.getElementById('expenseTimeInput');
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
const categoryPieBreakdown = document.getElementById('categoryPieBreakdown');
const receiptImageInput = document.getElementById('receiptImageInput');
const scanReceiptBtn = document.getElementById('scanReceiptBtn');
const clearReceiptBtn = document.getElementById('clearReceiptBtn');
const receiptStatus = document.getElementById('receiptStatus');
const receiptPreview = document.getElementById('receiptPreview');
const receiptExtracted = document.getElementById('receiptExtracted');

let dashboardState = { categories: [], paymentMethods: [], expenses: [], settings: {} };
let categoryChart;
let categoryPieChart;
let amountValue = '0';
let receiptPreviewUrl = '';

function drawOutlinedLabel(ctx, text, x, y, fontSize = 12) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#3f3550';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.font = `700 ${fontSize}px "Noto Sans TC", sans-serif`;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

const barValueLabelsPlugin = {
  id: 'barValueLabels',
  afterDatasetsDraw(chart, _args, pluginOptions) {
    if (chart.config.type !== 'bar' || !pluginOptions?.display) return;

    const dataset = chart.data.datasets?.[0];
    const meta = chart.getDatasetMeta(0);
    if (!dataset || !meta?.data?.length) return;

    meta.data.forEach((bar, index) => {
      const rawValue = Number(dataset.data[index]) || 0;
      if (!rawValue) return;

      const label = formatCurrency(rawValue);
      const position = bar.tooltipPosition();
      drawOutlinedLabel(chart.ctx, label, position.x, Math.max(position.y - 12, 16), window.innerWidth <= 640 ? 10 : 11);
    });
  }
};

const pieSliceLabelsPlugin = {
  id: 'pieSliceLabels',
  afterDatasetsDraw(chart, _args, pluginOptions) {
    if (chart.config.type !== 'pie' || !pluginOptions?.display) return;

    const dataset = chart.data.datasets?.[0];
    const meta = chart.getDatasetMeta(0);
    if (!dataset || !meta?.data?.length) return;

    const rawValues = dataset.data.map((value) => Number(value) || 0);
    const total = rawValues.reduce((sum, value) => sum + value, 0);
    if (!total) return;

    meta.data.forEach((arc, index) => {
      const value = rawValues[index];
      const ratio = total ? value / total : 0;
      if (!ratio || ratio < 0.06) return;

      const position = arc.tooltipPosition();
      const label = `${(ratio * 100).toFixed(1)}%`;
      drawOutlinedLabel(chart.ctx, label, position.x, position.y, window.innerWidth <= 640 ? 11 : 12);
    });
  }
};

Chart.register(barValueLabelsPlugin, pieSliceLabelsPlugin);

function setConnectionStatus(status, text, title = text) {
  connectionIndicator.classList.remove('connection-indicator--connected', 'connection-indicator--error', 'connection-indicator--connecting');
  connectionIndicator.classList.add(`connection-indicator--${status}`);
  connectionIndicator.title = title;
  connectionIndicator.querySelector('.connection-text').textContent = text;
}

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

function setCurrentTimeDefault() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  expenseTimeInput.value = `${hours}:${minutes}`;
}

function setReceiptStatus(type, text) {
  receiptStatus.className = `receipt-status receipt-status--${type}`;
  receiptStatus.textContent = text;
}

function clearReceiptPreviewUrl() {
  if (receiptPreviewUrl) {
    URL.revokeObjectURL(receiptPreviewUrl);
    receiptPreviewUrl = '';
  }
}

function previewReceiptFile(file) {
  clearReceiptPreviewUrl();
  if (!file) {
    receiptPreview.removeAttribute('src');
    receiptPreview.classList.add('hidden');
    return;
  }

  receiptPreviewUrl = URL.createObjectURL(file);
  receiptPreview.src = receiptPreviewUrl;
  receiptPreview.classList.remove('hidden');
}

function clearReceiptResult() {
  receiptExtracted.innerHTML = '';
  receiptExtracted.classList.add('hidden');
}

function renderReceiptResult(data) {
  const items = [
    { label: '辨識金額', value: data.amount != null ? formatCurrency(data.amount) : '未辨識到' },
    { label: '辨識日期', value: data.dateLabel || '未辨識到' },
    { label: '辨識時間', value: data.timeLabel || '未辨識到' },
    { label: '店家 / 備註', value: data.merchant || '未辨識到' }
  ];

  receiptExtracted.innerHTML = items.map((item) => `
    <div class="receipt-result-item">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
    </div>
  `).join('');
  receiptExtracted.classList.remove('hidden');
}

function normalizeAmountDisplay(value) {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatToInputDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeYear(year) {
  const numeric = Number(year);
  if (numeric < 100) return numeric >= 70 ? 1900 + numeric : 2000 + numeric;
  return numeric;
}

function extractReceiptDate(text) {
  const patterns = [
    /(\b\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4}\b)/,
    /(\b\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2}\b)/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    if (pattern === patterns[0]) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      const year = normalizeYear(match[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return {
          input: formatToInputDate(year, month, day),
          label: `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`
        };
      }
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        input: formatToInputDate(year, month, day),
        label: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      };
    }
  }

  return { input: '', label: '' };
}

function extractReceiptTime(text) {
  const match = text.match(/(\b\d{1,2}:\d{2})(?:\s*([AP]M))?/i);
  if (!match) return { input: '', label: '' };

  let [hours, minutes] = match[1].split(':').map(Number);
  const meridiem = match[2]?.toUpperCase();

  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return { input: '', label: '' };

  const input = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return { input, label: match[2] ? `${match[1]} ${meridiem}` : input };
}

function parseAmountFromLine(line) {
  const matches = [...line.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/g)];
  if (!matches.length) return null;

  const values = matches
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.max(...values) : null;
}

function extractReceiptAmount(lines) {
  const priorityPatterns = [
    /\bgrand\s*total\b/i,
    /\bamount\s*due\b/i,
    /\bbalance\s*due\b/i,
    /\btotal\b/i
  ];
  const rejectPatterns = [/subtotal/i, /tax/i, /change/i, /cash/i, /visa/i, /mastercard/i, /debit/i];

  for (const pattern of priorityPatterns) {
    for (const line of lines) {
      if (!pattern.test(line) || rejectPatterns.some((reject) => reject.test(line))) continue;
      const amount = parseAmountFromLine(line);
      if (amount != null) return amount;
    }
  }

  const fallbackValues = lines
    .map((line) => parseAmountFromLine(line))
    .filter((value) => value != null);

  return fallbackValues.length ? Math.max(...fallbackValues) : null;
}

function extractReceiptMerchant(lines) {
  return lines.find((line) => !/^(receipt|invoice|order|thank you|visa|mastercard|subtotal|tax|total|date|time)$/i.test(line) && /[A-Za-z]/.test(line)) || '';
}

function parseReceiptText(text) {
  const normalizedText = text.replace(/\r/g, '');
  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);

  const dateInfo = extractReceiptDate(normalizedText);
  const timeInfo = extractReceiptTime(normalizedText);
  const amount = extractReceiptAmount(lines);
  const merchant = extractReceiptMerchant(lines);

  return {
    amount,
    dateInput: dateInfo.input,
    dateLabel: dateInfo.label,
    timeInput: timeInfo.input,
    timeLabel: timeInfo.label,
    merchant,
    rawText: normalizedText
  };
}

function applyReceiptToForm(result) {
  if (result.amount != null) {
    amountValue = normalizeAmountDisplay(result.amount);
    updateAmountDisplay();
  }

  if (result.dateInput) expenseDateInput.value = result.dateInput;
  if (result.timeInput) expenseTimeInput.value = result.timeInput;
  if (result.merchant && !noteInput.value.trim()) noteInput.value = result.merchant;
}

function clearReceiptSelection() {
  receiptImageInput.value = '';
  clearReceiptPreviewUrl();
  receiptPreview.removeAttribute('src');
  receiptPreview.classList.add('hidden');
  clearReceiptResult();
  setReceiptStatus('idle', '尚未選擇收據照片');
}

async function scanReceipt() {
  const file = receiptImageInput.files?.[0];
  if (!file) {
    alert('請先拍照或選擇一張收據圖片');
    return;
  }

  if (!window.Tesseract) {
    setReceiptStatus('error', 'OCR 元件尚未載入完成，請稍後再試');
    return;
  }

  scanReceiptBtn.disabled = true;
  setReceiptStatus('working', '正在辨識收據，請稍等一下…');

  try {
    const { data } = await window.Tesseract.recognize(file, 'eng', {
      logger: (message) => {
        if (message.status === 'recognizing text' && typeof message.progress === 'number') {
          setReceiptStatus('working', `正在辨識收據，約 ${Math.round(message.progress * 100)}%`);
        }
      }
    });

    const result = parseReceiptText(data.text || '');
    applyReceiptToForm(result);
    renderReceiptResult(result);

    const filledFields = [result.amount != null ? '金額' : '', result.dateInput ? '日期' : '', result.timeInput ? '時間' : ''].filter(Boolean);
    if (filledFields.length) {
      setReceiptStatus('success', `辨識完成，已自動帶入：${filledFields.join('、')}`);
    } else {
      setReceiptStatus('error', '辨識完成，但這張收據沒有成功抓到金額 / 日期 / 時間，建議換清楚一點的照片再試');
    }
  } catch (error) {
    console.error(error);
    setReceiptStatus('error', `辨識失敗：${error.message}`);
  } finally {
    scanReceiptBtn.disabled = false;
  }
}

function combineExpenseDateTime(dateValue, timeValue) {
  const safeTime = timeValue || '12:00';
  return `${dateValue}T${safeTime}:00`;
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
  const pieCtx = document.getElementById('categoryPieChart');
  const isMobile = window.innerWidth <= 640;
  const activeEntries = categories
    .map((category, index) => ({
      category,
      total: totals[index],
      color: CHART_PALETTE[index % CHART_PALETTE.length]
    }))
    .filter((entry) => entry.total > 0);
  const pieEntries = activeEntries.length
    ? activeEntries
    : [{ category: '尚無資料', total: 1, color: 'rgba(220, 212, 231, 0.9)' }];
  const totalAmount = totals.reduce((sum, value) => sum + value, 0);

  if (categoryChart) categoryChart.destroy();
  if (categoryPieChart) categoryPieChart.destroy();

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
      maintainAspectRatio: false,
      alignToPixels: true,
      plugins: {
        legend: { display: false },
        barValueLabels: {
          display: true
        }
      },
      layout: {
        padding: {
          top: 26,
          right: 10,
          bottom: 4,
          left: 4
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#5f5374',
            font: {
              size: isMobile ? 12 : 12,
              weight: '700'
            },
            maxRotation: 0,
            minRotation: 0,
            autoSkip: false,
            padding: 8
          },
          grid: {
            display: false
          },
          border: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#7a6f8b',
            font: {
              size: isMobile ? 11 : 12,
              weight: '600'
            },
            maxRotation: 0,
            minRotation: 0,
            padding: 6
          },
          grid: {
            color: 'rgba(224, 208, 231, 0.4)'
          },
          border: {
            display: false
          }
        }
      }
    }
  });

  categoryPieChart = new Chart(pieCtx, {
    type: 'pie',
    data: {
      labels: pieEntries.map((entry) => entry.category),
      datasets: [{
        data: pieEntries.map((entry) => entry.total),
        backgroundColor: pieEntries.map((entry) => entry.color),
        borderWidth: 1,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        },
        pieSliceLabels: {
          display: totalAmount > 0
        }
      },
      layout: {
        padding: 8
      }
    }
  });

  categoryBreakdown.innerHTML = categories.map((category, index) => `
    <div class="chart-stat-item">
      <div><span class="color-dot" style="background:${CHART_PALETTE[index % CHART_PALETTE.length]}"></span> ${category}</div>
      <strong>${formatCurrency(totals[index])}</strong>
    </div>
  `).join('');

  categoryPieBreakdown.innerHTML = activeEntries.length
    ? activeEntries.map((entry) => {
        const ratio = totalAmount ? ((entry.total / totalAmount) * 100).toFixed(1) : '0.0';
        return `
          <div class="chart-stat-item">
            <div><span class="color-dot" style="background:${entry.color}"></span> ${entry.category}</div>
            <strong>${ratio}%</strong>
          </div>
        `;
      }).join('')
    : '<div class="empty-state">目前沒有可顯示的比例資料。</div>';
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
        <div class="record-meta">${item.paymentMethod} ・ ${formatDateTime(item.expenseDate)}</div>
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
    expenseDate: combineExpenseDateTime(expenseDateInput.value, expenseTimeInput.value),
    note: noteInput.value.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }];

  await persistState({ expenses: nextExpenses });
  clearAmount();
  setCurrentTimeDefault();
  noteInput.value = '';
}

keypad.addEventListener('click', (event) => {
  const key = event.target.dataset.key;
  if (!key) return;
  inputKey(key);
});
receiptImageInput.addEventListener('change', () => {
  const file = receiptImageInput.files?.[0];
  previewReceiptFile(file);
  clearReceiptResult();
  setReceiptStatus(file ? 'idle' : 'idle', file ? '已選擇收據照片，按「開始辨識收據」即可自動帶入表單' : '尚未選擇收據照片');
});
scanReceiptBtn.addEventListener('click', scanReceipt);
clearReceiptBtn.addEventListener('click', clearReceiptSelection);
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
setCurrentTimeDefault();
updateAmountDisplay();
tickClock();
setInterval(tickClock, 1000);

try {
  setConnectionStatus('connecting', '連線中', '資料庫連線初始化中');
  await ensureRemoteState();
  subscribeDashboard((state) => {
    dashboardState = state;
    setConnectionStatus('connected', '已連線', '資料庫連線正常');
    refreshUI();
  }, (error) => {
    console.error(error);
    setConnectionStatus('error', '失敗', `同步失敗：${error.message}`);
  });
} catch (error) {
  console.error(error);
  setConnectionStatus('error', '失敗', `初始化失敗：${error.message}`);
}
