import { ensureRemoteState, subscribeDashboard, saveDashboardState, uploadReceiptImage, deleteReceiptImage } from './firebase.js';
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
const cardLastFourInput = document.getElementById('cardLastFourInput');
const cardLastFourHint = document.getElementById('cardLastFourHint');
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

function loadImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('收據圖片讀取失敗'));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('收據圖片轉換失敗'));
    }, 'image/png', 1);
  });
}

async function buildReceiptCanvas(file, options = {}) {
  const image = await loadImageElementFromFile(file);
  const {
    cropTopRatio = 0,
    cropBottomRatio = 1,
    maxLongestSide = 2200
  } = options;

  const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const scale = longestSide > maxLongestSide ? maxLongestSide / longestSide : 1;
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

  const canvas = document.createElement('canvas');
  const sourceTop = Math.max(0, Math.min(image.naturalHeight || image.height, Math.round((image.naturalHeight || image.height) * cropTopRatio)));
  const sourceBottom = Math.max(sourceTop + 1, Math.min(image.naturalHeight || image.height, Math.round((image.naturalHeight || image.height) * cropBottomRatio)));
  const sourceHeight = sourceBottom - sourceTop;
  const outputHeight = Math.max(1, Math.round(sourceHeight * scale));

  canvas.width = width;
  canvas.height = outputHeight;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, outputHeight);
  ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.05)';
  ctx.drawImage(
    image,
    0,
    sourceTop,
    image.naturalWidth || image.width,
    sourceHeight,
    0,
    0,
    width,
    outputHeight
  );

  const imageData = ctx.getImageData(0, 0, width, outputHeight);
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const grayscale = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    const boosted = grayscale > 178 ? 255 : grayscale < 92 ? 0 : Math.max(0, Math.min(255, ((grayscale - 128) * 1.55) + 128));
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function preprocessReceiptImage(file, options = {}) {
  const canvas = await buildReceiptCanvas(file, options);
  return canvasToBlob(canvas);
}

function renderReceiptResult(data) {
  const items = [
    { label: '辨識金額', value: data.amount != null ? formatCurrency(data.amount) : '未辨識到' },
    { label: '辨識日期', value: data.dateLabel || '未辨識到' },
    { label: '辨識時間', value: data.timeLabel || '未辨識到' },
    { label: '店家 / 備註', value: data.merchant || '未辨識到' },
    { label: '卡號末四碼', value: data.cardLastFour || '未辨識到' }
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

function formatUsDateLabel(year, month, day) {
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
}

function formatToInputDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeYear(year) {
  const numeric = Number(year);
  if (numeric < 100) return numeric >= 70 ? 1900 + numeric : 2000 + numeric;
  return numeric;
}

function normalizeNumericLikeText(value) {
  return value
    .replace(/(\d)[Oo]/g, '$10')
    .replace(/[Oo](\d)/g, '0$1')
    .replace(/(\d)[Il]/g, '$11')
    .replace(/[Il](\d)/g, '1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMerchantText(value) {
  return value
    .replace(/[|]/g, 'I')
    .replace(/[€]/g, 'C')
    .replace(/[®©™]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCardLastFour(value) {
  return String(value || '').replace(/\D/g, '').slice(-4);
}

function supportsCardLastFour(paymentMethod) {
  return /信用卡|金融卡|debit|credit|visa|master|amex|discover|apple\s*pay|google\s*pay|line\s*pay|paypal|card/i.test(String(paymentMethod || ''));
}

function updateCardLastFourHint() {
  if (!cardLastFourHint) return;
  if (supportsCardLastFour(paymentMethodSelect.value)) {
    cardLastFourHint.textContent = '若有刷卡 / 綁卡付款，可填信用卡末四碼；系統也會嘗試從收據自動帶入。';
  } else {
    cardLastFourHint.textContent = '非卡類付款可留空，若填寫則只接受 4 位數字。';
  }
}

function getValidatedCardLastFour({ value, paymentMethod, allowEmpty = true } = {}) {
  const normalized = normalizeCardLastFour(value);

  if (!normalized) {
    if (allowEmpty) return '';
    throw new Error('請輸入信用卡末四碼');
  }

  if (normalized.length !== 4) {
    throw new Error('信用卡末四碼必須是 4 位數字');
  }

  if (/^(\d)\1{3}$/.test(normalized)) {
    throw new Error('信用卡末四碼看起來不太合理，請再確認一次');
  }

  if (!supportsCardLastFour(paymentMethod)) {
    throw new Error('目前付款方式看起來不是卡片或綁卡支付，若不是刷卡可留空');
  }

  return normalized;
}

function extractAmountsFromLine(line) {
  const normalized = normalizeNumericLikeText(line);
  return [...normalized.matchAll(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\b/g)]
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100000);
}

function isHardRejectedAmountLine(normalized) {
  return /you\s*saved|member\s*savings?|instant\s*savings?|store\s*savings?|discount|coupon|promo|promotion|cash\s*back|cashback|reward|rebate|off\b|save\s*\$?/i.test(normalized)
    || /-\s*\$?\s*\d+(?:[.,]\d{2})?/.test(normalized)
    || /\(\s*\$?\s*\d+(?:[.,]\d{2})?\s*\)/.test(normalized);
}

function isPrimaryTotalLine(normalized) {
  return /grand\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*tendered/.test(normalized)
    || (/\btotal\b/.test(normalized) && !/subtotal|total\s*savings?|estimated\s*total/.test(normalized));
}

function getAmountContextBonus(lines, index) {
  const current = normalizeNumericLikeText(lines[index] || '').toLowerCase();
  const previous = normalizeNumericLikeText(lines[index - 1] || '').toLowerCase();
  const next = normalizeNumericLikeText(lines[index + 1] || '').toLowerCase();
  let bonus = 0;

  if (isPrimaryTotalLine(current)) bonus += 12;
  if (isPrimaryTotalLine(previous)) bonus += 9;
  if (isPrimaryTotalLine(next)) bonus += 4;
  if (/subtotal|tax|tip/.test(previous)) bonus += 3;
  if (/subtotal|tax|tip/.test(current)) bonus -= 10;
  if (/change|cash|discount|saving|coupon|promo|reward|rebate/.test(previous)) bonus -= 4;

  return bonus;
}

function scoreAmountLine(line) {
  const normalized = normalizeNumericLikeText(line).toLowerCase();
  let score = 0;
  if (/grand\s*total/.test(normalized)) score += 24;
  if (/amount\s*due|balance\s*due|total\s*due/.test(normalized)) score += 21;
  if (/\btotal\b/.test(normalized) && !/subtotal|total\s*savings?|estimated\s*total/.test(normalized)) score += 13;
  if (/\$/.test(normalized)) score += 2;
  if (/auth|approval|reference|invoice\s*#|order\s*#/.test(normalized)) score -= 3;
  if (/subtotal/.test(normalized)) score -= 14;
  if (/tax/.test(normalized)) score -= 10;
  if (/tip/.test(normalized)) score -= 4;
  if (/discount|saving|coupon|promo|promotion|cashback|reward|rebate/.test(normalized)) score -= 20;
  if (/cash|change|visa|mastercard|debit|credit|card/.test(normalized)) score -= 4;
  if (isHardRejectedAmountLine(normalized)) score -= 30;
  return score;
}

function extractReceiptAmount(lines) {
  const candidates = [];

  lines.forEach((line, index) => {
    const normalized = normalizeNumericLikeText(line).toLowerCase();
    const amounts = extractAmountsFromLine(line);
    const score = scoreAmountLine(line) + getAmountContextBonus(lines, index);
    const hardRejected = isHardRejectedAmountLine(normalized);

    amounts.forEach((value) => {
      if (hardRejected) return;
      candidates.push({ value, score, index, source: 'line' });
    });

    const nextLine = lines[index + 1];
    const nextLineNormalized = normalizeNumericLikeText(nextLine || '').toLowerCase();
    if (nextLine && isPrimaryTotalLine(normalized) && !amounts.length && !isHardRejectedAmountLine(nextLineNormalized)) {
      extractAmountsFromLine(nextLine).forEach((value) => {
        candidates.push({ value, score: score + 8 + getAmountContextBonus(lines, index + 1), index: index + 0.25, source: 'next-line' });
      });
    }

    const previousLine = lines[index - 1];
    const previousLineNormalized = normalizeNumericLikeText(previousLine || '').toLowerCase();
    if (previousLine && amounts.length && isPrimaryTotalLine(previousLineNormalized) && !hardRejected) {
      amounts.forEach((value) => {
        candidates.push({ value, score: score + 10, index: index - 0.25, source: 'after-total-label' });
      });
    }
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) => (b.score - a.score) || (a.index - b.index) || (b.value - a.value));
  const preferred = candidates.find((candidate) => candidate.score > 0);
  return preferred?.value ?? candidates[0].value;
}

function scoreCardLastFourLine(line, index) {
  const normalized = normalizeNumericLikeText(line);
  const lower = normalized.toLowerCase();
  let score = 0;

  if (/visa|master\s*card|mastercard|amex|american\s*express|discover|debit|credit|card|acct|account/i.test(lower)) score += 10;
  if (/ending|last\s*4|xxxx|x{2,}|\*{2,}|#/.test(lower)) score += 7;
  if (index <= 10) score += 2;

  if (/approval|auth|reference|order|invoice|register|terminal|trace|sequence|trans|transaction|phone|tel|store\s*#|cashier|date|time/i.test(lower)) score -= 9;
  if (/subtotal|tax|total|saving|discount|coupon|promo|reward|rebate|change|amount\s*due/i.test(lower)) score -= 10;
  if (/\d{5,}/.test(normalized)) score -= 5;

  return score;
}

function extractReceiptCardLastFour(lines) {
  const candidates = [];

  lines.slice(0, 28).forEach((line, index) => {
    const normalized = normalizeNumericLikeText(line);
    const score = scoreCardLastFourLine(normalized, index);
    const matches = [
      ...normalized.matchAll(/(?:visa|master\s*card|mastercard|amex|american\s*express|discover|debit|credit|card|acct|account|ending|last\s*4)[^\d]{0,16}(\d{4})\b/ig),
      ...normalized.matchAll(/(?:\*{2,}|x{2,}|#)[^\d]{0,6}(\d{4})\b/ig)
    ];

    matches.forEach((match) => {
      const value = normalizeCardLastFour(match[1]);
      if (value.length === 4 && !/^(\d)\1{3}$/.test(value)) {
        candidates.push({ value, score, index });
      }
    });
  });

  if (!candidates.length) return '';

  candidates.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const best = candidates[0];
  const competing = candidates.find((candidate) => candidate !== best && candidate.value !== best.value && candidate.score >= best.score - 1);
  if (!best || best.score < 6 || competing) return '';
  return best.value;
}

const MONTH_NAME_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

function scoreDateLine(line) {
  const normalized = line.toLowerCase();
  let score = 0;
  if (/\bdate\b|purchase|transaction/.test(normalized)) score += 6;
  if (/dob|birth/.test(normalized)) score -= 10;
  return score;
}

function buildDateCandidate(year, month, day, score) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const normalizedYear = normalizeYear(year);
  return {
    input: formatToInputDate(normalizedYear, month, day),
    label: formatUsDateLabel(normalizedYear, month, day),
    score
  };
}

function extractReceiptDate(lines, fullText) {
  const candidates = [];

  const collectFromSource = (source, bonus = 0) => {
    const normalized = normalizeNumericLikeText(source);

    [...normalized.matchAll(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g)].forEach((match) => {
      const candidate = buildDateCandidate(match[3], Number(match[1]), Number(match[2]), scoreDateLine(source) + bonus);
      if (candidate) candidates.push(candidate);
    });

    [...normalized.matchAll(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g)].forEach((match) => {
      const candidate = buildDateCandidate(match[1], Number(match[2]), Number(match[3]), scoreDateLine(source) + bonus + 1);
      if (candidate) candidates.push(candidate);
    });

    [...source.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{2,4})\b/ig)].forEach((match) => {
      const month = MONTH_NAME_MAP[match[1].slice(0, 4).toLowerCase()];
      const candidate = buildDateCandidate(match[3], month, Number(match[2]), scoreDateLine(source) + bonus + 2);
      if (candidate) candidates.push(candidate);
    });
  };

  lines.slice(0, 18).forEach((line) => collectFromSource(line));
  if (!candidates.length && fullText) collectFromSource(fullText, -1);
  if (!candidates.length) return { input: '', label: '' };

  candidates.sort((a, b) => b.score - a.score);
  return { input: candidates[0].input, label: candidates[0].label };
}

function buildTimeCandidate(hours, minutes, meridiem, score) {
  let normalizedHours = Number(hours);
  const normalizedMinutes = Number(minutes);
  const upperMeridiem = meridiem?.toUpperCase();

  if (upperMeridiem === 'PM' && normalizedHours < 12) normalizedHours += 12;
  if (upperMeridiem === 'AM' && normalizedHours === 12) normalizedHours = 0;
  if (normalizedHours > 23 || normalizedMinutes > 59) return null;

  return {
    input: `${String(normalizedHours).padStart(2, '0')}:${String(normalizedMinutes).padStart(2, '0')}`,
    label: upperMeridiem
      ? `${String(Number(hours)).padStart(2, '0')}:${String(normalizedMinutes).padStart(2, '0')} ${upperMeridiem}`
      : `${String(normalizedHours).padStart(2, '0')}:${String(normalizedMinutes).padStart(2, '0')}`,
    score
  };
}

function scoreTimeLine(line) {
  const normalized = line.toLowerCase();
  let score = 0;
  if (/\btime\b|purchase|transaction/.test(normalized)) score += 6;
  if (/table|item|qty/.test(normalized)) score -= 4;
  return score;
}

function extractReceiptTime(lines, fullText) {
  const candidates = [];

  const collectFromSource = (source, bonus = 0) => {
    const normalized = normalizeNumericLikeText(source).replace(/(\d)\.(\d{2})(\s*[AP]M\b)/ig, '$1:$2$3');

    [...normalized.matchAll(/\b(\d{1,2})[:](\d{2})(?:\s*([AP]M))?\b/ig)].forEach((match) => {
      const candidate = buildTimeCandidate(match[1], match[2], match[3], scoreTimeLine(source) + bonus);
      if (candidate) candidates.push(candidate);
    });

    [...normalized.matchAll(/\b(\d{1,2})(\d{2})\s*([AP]M)\b/ig)].forEach((match) => {
      const candidate = buildTimeCandidate(match[1], match[2], match[3], scoreTimeLine(source) + bonus - 1);
      if (candidate) candidates.push(candidate);
    });
  };

  lines.slice(0, 20).forEach((line) => collectFromSource(line));
  if (!candidates.length && fullText) collectFromSource(fullText, -1);
  if (!candidates.length) return { input: '', label: '' };

  candidates.sort((a, b) => b.score - a.score);
  return { input: candidates[0].input, label: candidates[0].label };
}

const KNOWN_US_MERCHANTS = [
  ['Costco', ['costco', 'costco wholesale']],
  ['Target', ['target']],
  ['Walmart', ['walmart', 'wal mart']],
  ["Trader Joe's", ["trader joe's", 'trader joes', 'traderjoe']],
  ['Safeway', ['safeway']],
  ['Whole Foods', ['whole foods', 'wholefoods', 'whole foods market']],
  ['Amazon', ['amazon', 'amzn']],
  ['Starbucks', ['starbucks', 'sbux']],
  ['McDonald\'s', ['mcdonalds', "mcdonald's", 'mcdonald']],
  ['Chipotle', ['chipotle']],
  ['In-N-Out', ['innout', 'in n out', 'in-n-out']],
  ['Subway', ['subway']],
  ['CVS', ['cvs', 'cvs pharmacy']],
  ['Walgreens', ['walgreens']],
  ['7-Eleven', ['7eleven', '7-eleven']],
  ['Shell', ['shell']],
  ['Chevron', ['chevron']],
  ['Exxon', ['exxon', 'exxonmobil']],
  ['Mobil', ['mobil']],
  ['Home Depot', ['home depot', 'homedepot']],
  ['IKEA', ['ikea']],
  ['Best Buy', ['best buy', 'bestbuy']],
  ['Dollar Tree', ['dollar tree', 'dollartree']],
  ['Ross', ['ross', 'ross dress for less']],
  ['Macy\'s', ['macys', "macy's"]]
];

function canonicalizeMerchantKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function matchKnownMerchant(rawValue) {
  const key = canonicalizeMerchantKey(rawValue);
  if (!key || key.length < 3) return '';

  let bestMatch = { score: 0, name: '' };

  KNOWN_US_MERCHANTS.forEach(([name, aliases]) => {
    aliases.forEach((alias) => {
      const aliasKey = canonicalizeMerchantKey(alias);
      if (!aliasKey) return;

      let score = 0;
      if (key === aliasKey) score = 1;
      else if (key.includes(aliasKey) || aliasKey.includes(key)) score = 0.94;
      else {
        const distance = levenshteinDistance(key, aliasKey);
        const similarity = 1 - (distance / Math.max(key.length, aliasKey.length));
        score = similarity;
      }

      if (score > bestMatch.score) bestMatch = { score, name };
    });
  });

  return bestMatch.score >= 0.74 ? bestMatch.name : '';
}

function cleanMerchantCandidate(line) {
  return normalizeMerchantText(line)
    .replace(/\b(store|location|branch|terminal|register|lane|station)\s*#?\d+\b/ig, '')
    .replace(/#\s*\d{1,6}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[^A-Za-z]+|[^A-Za-z0-9'&\-.]+$/g, '')
    .trim();
}

function scoreMerchantLine(line, index, sourceLabel = 'full') {
  const normalized = cleanMerchantCandidate(line);
  const lower = normalized.toLowerCase();
  let score = 0;

  if (!normalized) return { value: '', score: -999 };
  if (/[A-Za-z]/.test(normalized)) score += 6;
  if (!/\d{3,}/.test(normalized)) score += 2;
  if (index <= 2) score += 4;
  else if (index <= 5) score += 2;
  if (sourceLabel === 'top') score += 5;
  if (normalized === normalized.toUpperCase() && normalized.length <= 32) score += 2;
  if (normalized.split(' ').length <= 4) score += 2;

  if (/receipt|invoice|thank you|welcome|visit again|customer copy|merchant copy|order|transaction|approval|auth|subtotal|tax|total|balance|amount due|cash|change|visa|mastercard|debit|credit|payment|server|cashier|item|qty|sku|table/i.test(lower)) score -= 10;
  if (/street|st\b|avenue|ave\b|boulevard|blvd|road|rd\b|drive|dr\b|suite|ste\b|floor|fl\b|highway|hwy|way\b|plaza|city|ca\b|ny\b|tx\b/.test(lower)) score -= 8;
  if (/\bwww\.|\.com\b|@/.test(lower)) score -= 8;
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(normalized)) score -= 10;
  if (/\d{5}(?:-\d{4})?\b/.test(normalized)) score -= 7;
  if (normalized.length < 3 || normalized.length > 40) score -= 4;

  const knownMerchant = matchKnownMerchant(normalized);
  if (knownMerchant) score += 8;

  return { value: knownMerchant || normalized, score };
}

function extractReceiptMerchant(fullLines, topLines = []) {
  const candidates = [
    ...topLines.slice(0, 10).map((line, index) => scoreMerchantLine(line, index, 'top')),
    ...fullLines.slice(0, 10).map((line, index) => scoreMerchantLine(line, index, 'full'))
  ]
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.value || '';
}

function parseReceiptText(text, options = {}) {
  const topText = options.topText || '';
  const normalizedText = text.replace(/\r/g, '');
  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);
  const topLines = topText
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 18);

  const dateInfo = extractReceiptDate(lines, normalizedText);
  const timeInfo = extractReceiptTime(lines, normalizedText);
  const amount = extractReceiptAmount(lines);
  const merchant = extractReceiptMerchant(lines, topLines);
  const cardLastFour = extractReceiptCardLastFour(lines);

  return {
    amount,
    dateInput: dateInfo.input,
    dateLabel: dateInfo.label,
    timeInput: timeInfo.input,
    timeLabel: timeInfo.label,
    merchant,
    cardLastFour,
    rawText: normalizedText
  };
}

function getReceiptResultScore(result) {
  return [result.amount != null, Boolean(result.dateInput), Boolean(result.timeInput), Boolean(result.merchant), Boolean(result.cardLastFour)].filter(Boolean).length;
}

function applyReceiptToForm(result) {
  if (result.amount != null) {
    amountValue = normalizeAmountDisplay(result.amount);
    updateAmountDisplay();
  }

  if (result.dateInput) expenseDateInput.value = result.dateInput;
  if (result.timeInput) expenseTimeInput.value = result.timeInput;
  if (result.merchant && !noteInput.value.trim()) noteInput.value = result.merchant;
  if (result.cardLastFour && !cardLastFourInput.value.trim()) cardLastFourInput.value = result.cardLastFour;
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
  setReceiptStatus('working', '正在強化收據圖片並辨識，會另外加強掃描收據上半部店名…');

  try {
    const processedImage = await preprocessReceiptImage(file);
    const topProcessedImage = await preprocessReceiptImage(file, { cropTopRatio: 0, cropBottomRatio: 0.32, maxLongestSide: 1800 });

    const { data } = await window.Tesseract.recognize(processedImage, 'eng', {
      logger: (message) => {
        if (message.status === 'recognizing text' && typeof message.progress === 'number') {
          setReceiptStatus('working', `正在辨識美國收據，約 ${Math.round(message.progress * 100)}%`);
        }
      }
    });

    setReceiptStatus('working', '正在加強辨識收據上半部店家名稱…');
    const topScan = await window.Tesseract.recognize(topProcessedImage, 'eng', {
      logger: (message) => {
        if (message.status === 'recognizing text' && typeof message.progress === 'number') {
          setReceiptStatus('working', `正在辨識上半部店名，約 ${Math.round(message.progress * 100)}%`);
        }
      }
    });

    let result = parseReceiptText(data.text || '', { topText: topScan.data?.text || '' });

    if (getReceiptResultScore(result) < 2 || !result.merchant) {
      setReceiptStatus('working', '第一次辨識店家或欄位資訊偏少，正在用原始照片再試一次…');
      const retry = await window.Tesseract.recognize(file, 'eng', {
        logger: (message) => {
          if (message.status === 'recognizing text' && typeof message.progress === 'number') {
            setReceiptStatus('working', `正在二次辨識原始照片，約 ${Math.round(message.progress * 100)}%`);
          }
        }
      });
      const retryResult = parseReceiptText(retry.data?.text || '', { topText: topScan.data?.text || '' });
      if (getReceiptResultScore(retryResult) >= getReceiptResultScore(result)) {
        result = retryResult;
      }
    }

    applyReceiptToForm(result);
    renderReceiptResult(result);

    const filledFields = [result.amount != null ? '金額' : '', result.dateInput ? '日期' : '', result.timeInput ? '時間' : '', result.merchant ? '店家' : '', result.cardLastFour ? '卡號末四碼' : ''].filter(Boolean);
    if (filledFields.length) {
      setReceiptStatus('success', `辨識完成，已自動帶入：${filledFields.join('、')}（已優先套用美國格式）`);
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

function getPreferredPaymentMethod() {
  if (dashboardState.paymentMethods.includes('信用卡')) return '信用卡';
  return dashboardState.paymentMethods[0] || '';
}

function renderSelectors() {
  const previousCategory = categorySelect.value;
  const previousPaymentMethod = paymentMethodSelect.value;

  categorySelect.innerHTML = dashboardState.categories.map((item) => `<option value="${item}">${item}</option>`).join('');
  paymentMethodSelect.innerHTML = dashboardState.paymentMethods.map((item) => `<option value="${item}">${item}</option>`).join('');

  if (dashboardState.categories.includes(previousCategory)) {
    categorySelect.value = previousCategory;
  }

  if (dashboardState.paymentMethods.includes(previousPaymentMethod)) {
    paymentMethodSelect.value = previousPaymentMethod;
  } else {
    paymentMethodSelect.value = getPreferredPaymentMethod();
  }
+
+  updateCardLastFourHint();
+}

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
        <div class="record-meta">${item.paymentMethod}${item.cardLastFour ? ` ・ 末四碼 ${item.cardLastFour}` : ''} ・ ${formatDateTime(item.expenseDate)}</div>
        <div class="record-time">${item.note || '無備註'}</div>
        ${item.receiptImageUrl ? `<div class="record-extra-link"><a href="${item.receiptImageUrl}" target="_blank" rel="noopener noreferrer">查看收據圖片</a></div>` : ''}
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

  let cardLastFour = '';
  try {
    cardLastFour = getValidatedCardLastFour({
      value: cardLastFourInput.value,
      paymentMethod: paymentMethodSelect.value,
      allowEmpty: true
    });
  } catch (error) {
    alert(error.message);
    return;
  }

  const expenseId = uid();
  const receiptFile = receiptImageInput.files?.[0];
  let receiptImageUrl = '';
  let receiptImagePath = '';

  try {
    if (receiptFile) {
      scanReceiptBtn.disabled = true;
      clearReceiptBtn.disabled = true;
      setReceiptStatus('working', '正在上傳收據圖片並綁定到這筆消費…');
      const uploadResult = await uploadReceiptImage(expenseId, receiptFile);
      receiptImageUrl = uploadResult.downloadUrl;
      receiptImagePath = uploadResult.storagePath;
      setReceiptStatus('success', '收據圖片已上傳，正在儲存這筆消費紀錄…');
    }

    const nextExpenses = [...dashboardState.expenses, {
      id: expenseId,
      amount,
      category: categorySelect.value,
      paymentMethod: paymentMethodSelect.value,
      cardLastFour,
      expenseDate: combineExpenseDateTime(expenseDateInput.value, expenseTimeInput.value),
      note: noteInput.value.trim(),
      receiptImageUrl,
      receiptImagePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }];

    await persistState({ expenses: nextExpenses });
    clearAmount();
    setCurrentTimeDefault();
    noteInput.value = '';
    cardLastFourInput.value = '';
    paymentMethodSelect.value = getPreferredPaymentMethod();
    updateCardLastFourHint();
    clearReceiptSelection();
  } catch (error) {
    console.error(error);
    if (receiptImagePath) {
      try {
        await deleteReceiptImage(receiptImagePath);
      } catch (cleanupError) {
        console.error(cleanupError);
      }
    }
    if (receiptFile && /storage\//i.test(error?.code || '')) {
      setReceiptStatus('error', `收據圖片上傳失敗：${error.message}`);
      alert(`收據圖片上傳失敗：${error.message}`);
      return;
    }
    throw error;
  } finally {
    scanReceiptBtn.disabled = false;
    clearReceiptBtn.disabled = false;
  }
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
paymentMethodSelect.addEventListener('change', updateCardLastFourHint);
cardLastFourInput.addEventListener('input', () => {
  cardLastFourInput.value = normalizeCardLastFour(cardLastFourInput.value);
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
updateCardLastFourHint();
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
