// 客户端主逻辑
const API = '';
let currentUser = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let selectedDate = null;
let categories = [];
let taskTypes = [];
let monthExpenses = {};
let editingExpenseId = null;
let selectedCategoryId = null;
let selectedTaskTypeId = null;
let uploadedReceiptUrl = null;

const ICON_MAP = {
  food: '🍜', transport: '🚗', shopping: '🛍️', entertainment: '🎮',
  medical: '💊', housing: '🏠', education: '📚', other: '📦',
  truck: '🚛', cart: '🛒', wrench: '🔧', task: '📋'
};

function getIcon(icon) {
  return ICON_MAP[icon] || '💰';
}

// 判断凭证URL是否有效
function isValidReceiptUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:')) return true;
  if (url.includes('/static/uploads/')) return false;
  return true;
}

// 生成凭证缩略图HTML
function receiptImgHtml(url, className = 'h-16 rounded-lg object-cover border border-gray-200 hover:opacity-80 transition-opacity') {
  if (!isValidReceiptUrl(url)) {
    return `<div class="flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg"><i class="fa-solid fa-image-slash"></i><span>凭证已失效</span></div>`;
  }
  return `<img src="${url}" alt="凭证" class="${className}" onerror="this.parentElement.innerHTML='<div=\\'flex items-center gap-1 text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg\\'><i class=\\'fa-solid fa-image\\'></i><span>凭证加载失败</span></div>'" />`;
}

// ==================== Token 管理 ====================

function getToken() {
  return localStorage.getItem('auth_token');
}

function setToken(token) {
  localStorage.setItem('auth_token', token);
}

function clearToken() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user_info');
}

function getSavedUser() {
  try {
    const data = localStorage.getItem('user_info');
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function saveUser(user) {
  localStorage.setItem('user_info', JSON.stringify(user));
}

// ==================== 头像生成（纯本地，不依赖外部资源） ====================

// 根据名字生成颜色
function nameToColor(name) {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getAvatarHtml(name, className = 'w-8 h-8 rounded-full') {
  const initial = (name || '?').charAt(0).toUpperCase();
  const color = nameToColor(name);
  return `<div class="${className} flex items-center justify-center text-white text-xs font-bold" style="background:${color}">${initial}</div>`;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  const toastIcon = document.getElementById('toastIcon');
  toastMsg.textContent = msg;
  toastIcon.className = type === 'success'
    ? 'fa-solid fa-check-circle text-green-400'
    : 'fa-solid fa-circle-exclamation text-red-400';
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

// ==================== 认证流程 ====================

function showAuthPage() {
  document.getElementById('authPage').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('authPage').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
}

// 检查Token有效性
async function checkAuth() {
  const token = getToken();
  if (!token) {
    showAuthPage();
    return false;
  }

  try {
    const res = await fetch(`${API}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      clearToken();
      showAuthPage();
      return false;
    }
    const data = await res.json();
    currentUser = data.user;
    saveUser(currentUser);
    return true;
  } catch {
    // 网络错误时尝试使用缓存的用户信息
    const cached = getSavedUser();
    if (cached) {
      currentUser = cached;
      return true;
    }
    showAuthPage();
    return false;
  }
}

// 登录
async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showToast('请输入用户名和密码', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || '登录失败', 'error');
      return;
    }
    setToken(data.token);
    currentUser = data.user;
    saveUser(currentUser);
    showToast('登录成功');
    showMainApp();
    await initMainApp();
  } catch {
    showToast('网络错误，请重试', 'error');
  }
}

// 注册
async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const nickname = document.getElementById('regNickname').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;

  if (!username || !nickname || !password || !confirmPassword) {
    showToast('请填写所有必填项', 'error');
    return;
  }
  if (password !== confirmPassword) {
    showToast('两次密码输入不一致', 'error');
    return;
  }
  if (password.length < 6) {
    showToast('密码长度至少6个字符', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nickname, password, confirm_password: confirmPassword })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.detail || '注册失败', 'error');
      return;
    }
    setToken(data.token);
    currentUser = data.user;
    saveUser(currentUser);
    showToast(data.message || '注册成功');
    showMainApp();
    await initMainApp();
  } catch {
    showToast('网络错误，请重试', 'error');
  }
}

// 退出登录
async function doLogout() {
  const token = getToken();
  if (token) {
    try {
      await fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch {}
  }
  clearToken();
  currentUser = null;
  showAuthPage();
  showToast('已退出登录');
}

// ==================== 初始化主应用 ====================

async function initMainApp() {
  if (!currentUser) return;

  // 更新用户信息显示
  document.getElementById('userNameDisplay').textContent = currentUser.chn_name || currentUser.eng_name;

  // 显示首字母头像
  const avatarEl = document.getElementById('userAvatar');
  avatarEl.style.display = 'none';
  const existingFallback = avatarEl.parentNode.querySelector('.avatar-fallback');
  if (existingFallback) existingFallback.remove();
  const fallback = document.createElement('div');
  fallback.className = 'avatar-fallback w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold';
  fallback.style.background = nameToColor(currentUser.chn_name || currentUser.eng_name);
  fallback.textContent = (currentUser.chn_name || currentUser.eng_name || '?').charAt(0);
  avatarEl.parentNode.insertBefore(fallback, avatarEl.nextSibling);

  // 检查商家权限
  if (currentUser.is_merchant) {
    document.getElementById('merchantBtn').classList.remove('hidden');
  }

  // 更新设置页用户信息
  const settingsUsername = document.getElementById('settingsUsername');
  const settingsNickname = document.getElementById('settingsNickname');
  if (settingsUsername) settingsUsername.textContent = `用户名：${currentUser.username || currentUser.eng_name}`;
  if (settingsNickname) settingsNickname.textContent = `昵称：${currentUser.chn_name || '-'}`;

  // 如果用户状态为待审核（0），显示申请提示
  if (currentUser.status === 0) {
    showApplyModal();
    return;
  }

  await loadCategories();
  await loadTaskTypes();
  await loadMonthExpenses();
  renderCalendar();
}

// 显示权限申请弹窗
function showApplyModal() {
  const applyName = document.getElementById('applyName');
  if (applyName) applyName.value = currentUser.chn_name || currentUser.eng_name;
  document.getElementById('applyModal').classList.remove('hidden');
}

// 加载花费类型
async function loadCategories() {
  const res = await fetch(`${API}/api/categories?eng_name=${currentUser.eng_name}`);
  const data = await res.json();
  categories = data.categories;
}

// 加载任务类型
async function loadTaskTypes() {
  const res = await fetch(`${API}/api/task-types?eng_name=${currentUser.eng_name}`);
  const data = await res.json();
  taskTypes = data.task_types;
}

// 加载当月花费
async function loadMonthExpenses() {
  if (!currentUser) return;
  const res = await fetch(`${API}/api/expenses?eng_name=${currentUser.eng_name}&year=${currentYear}&month=${currentMonth}&page_size=200`);
  const data = await res.json();
  monthExpenses = {};
  data.expenses.forEach(exp => {
    const d = exp.expense_date;
    if (!monthExpenses[d]) monthExpenses[d] = [];
    monthExpenses[d].push(exp);
  });
}

// 渲染日历
function renderCalendar() {
  const title = document.getElementById('currentMonthTitle');
  title.textContent = `${currentYear}年${currentMonth}月`;

  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  for (let i = 0; i < firstDay; i++) {
    grid.innerHTML += `<div></div>`;
  }

  let monthTotal = 0;
  Object.values(monthExpenses).forEach(exps => {
    exps.forEach(e => monthTotal += parseFloat(e.amount));
  });
  document.getElementById('monthTotalAmount').textContent = `本月共花费 ¥${monthTotal.toFixed(2)}`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const exps = monthExpenses[dateStr] || [];
    const dayTotal = exps.reduce((s, e) => s + parseFloat(e.amount), 0);
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === selectedDate;
    const hasExp = exps.length > 0;
    const dayOfWeek = new Date(currentYear, currentMonth - 1, d).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let cls = 'calendar-day rounded-xl p-1 text-center min-h-12 flex flex-col items-center justify-center';
    if (hasExp) cls += ' has-expense';
    else if (isToday) cls += ' bg-indigo-50 border-2 border-indigo-300';
    else cls += ' bg-gray-50 hover:bg-indigo-50';
    if (isSelected) cls += ' selected';

    const textColor = hasExp ? 'text-white' : (isWeekend ? (dayOfWeek === 0 ? 'text-red-500' : 'text-blue-500') : 'text-gray-700');
    const amountText = hasExp ? `<span class="amount-badge block opacity-90">¥${dayTotal >= 1000 ? (dayTotal/1000).toFixed(1)+'k' : dayTotal.toFixed(0)}</span>` : '';

    grid.innerHTML += `
      <div class="${cls}" data-date="${dateStr}">
        <span class="text-sm font-semibold ${textColor}">${d}</span>
        ${amountText}
      </div>`;
  }

  grid.querySelectorAll('.calendar-day').forEach(el => {
    el.addEventListener('click', () => selectDate(el.dataset.date));
  });
}

function selectDate(dateStr) {
  selectedDate = dateStr;
  renderCalendar();
  const panel = document.getElementById('selectedDayPanel');
  panel.classList.remove('hidden');
  const parts = dateStr.split('-');
  document.getElementById('selectedDayTitle').textContent = `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  renderDayExpenses(dateStr);
}

function renderDayExpenses(dateStr) {
  const exps = monthExpenses[dateStr] || [];
  const container = document.getElementById('selectedDayExpenses');
  const empty = document.getElementById('selectedDayEmpty');
  if (exps.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  container.innerHTML = exps.map(exp => renderExpenseCard(exp)).join('');
  bindExpenseCardEvents(container);
}

function renderExpenseCard(exp) {
  const icon = getIcon(exp.category_icon);
  const color = exp.category_color || '#6B7280';
  const editMinutes = exp.edit_minutes || 0;
  const isLateEdit = editMinutes > 10;
  const borderClass = isLateEdit ? 'border-l-4 border-red-400' : '';
  const lateTag = isLateEdit
    ? `<span class="text-xs bg-red-100 text-red-500 px-2 py-0.5 rounded-full ml-2"><i class="fa-solid fa-clock mr-0.5"></i>超10分钟修改</span>`
    : '';

  const taskTag = exp.task_type_name
    ? `<span class="text-xs bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full"><i class="fa-solid fa-briefcase mr-0.5"></i>${exp.task_type_name}</span>`
    : '';
  const locationTag = exp.location
    ? `<span class="text-xs bg-blue-50 text-blue-500 px-2 py-0.5 rounded-full"><i class="fa-solid fa-location-dot mr-0.5"></i>${exp.location}</span>`
    : '';

  const receiptThumb = exp.receipt_url
    ? `<div class="block mt-2 ${isValidReceiptUrl(exp.receipt_url) ? 'cursor-pointer receipt-zoom-trigger' : ''}">
        ${receiptImgHtml(exp.receipt_url)}
       </div>`
    : '';

  return `
    <div class="expense-card bg-gray-50 rounded-xl p-3 ${borderClass}" data-id="${exp.id}">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 mt-0.5" style="background:${color}20">
          <span>${icon}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1 flex-wrap mb-1">
            <span class="text-sm font-medium text-gray-700">${exp.category_name || '未分类'}</span>
            ${lateTag}
          </div>
          <div class="flex flex-wrap gap-1 mb-1">
            ${taskTag}${locationTag}
          </div>
          ${exp.note ? `<p class="text-xs text-gray-400 truncate">${exp.note}</p>` : ''}
        </div>
        <div class="text-right flex-shrink-0">
          <p class="font-bold text-gray-800">¥${parseFloat(exp.amount).toFixed(2)}</p>
          <div class="flex gap-1 mt-1 justify-end">
            <button class="edit-btn w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center hover:bg-indigo-200 transition-colors text-xs" data-id="${exp.id}">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="delete-btn w-6 h-6 rounded-lg bg-red-100 text-red-500 flex items-center justify-center hover:bg-red-200 transition-colors text-xs" data-id="${exp.id}">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
      ${receiptThumb}
    </div>`;
}

function bindExpenseCardEvents(container) {
  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id)));
  });
  container.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteExpense(parseInt(btn.dataset.id)));
  });
}

// ==================== 凭证图片弹窗预览 ====================
function initReceiptZoom() {
  let overlay = document.getElementById('receiptZoomOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'receiptZoomOverlay';
    overlay.className = 'fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center hidden';
    overlay.style.backdropFilter = 'blur(4px)';
    overlay.innerHTML = `
      <div class="relative max-w-[90vw] max-h-[90vh]">
        <img id="receiptZoomImg" class="max-w-[90vw] max-h-[85vh] object-contain rounded-xl shadow-2xl" src="" alt="凭证大图" />
        <button id="receiptZoomClose" class="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-gray-600 shadow-lg flex items-center justify-center hover:bg-gray-100 transition-colors">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'receiptZoomClose' || e.target.closest('#receiptZoomClose')) {
        overlay.classList.add('hidden');
      }
    });
  }

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.receipt-zoom-trigger');
    if (trigger) {
      const img = trigger.querySelector('img');
      if (img && img.src) {
        document.getElementById('receiptZoomImg').src = img.src;
        document.getElementById('receiptZoomOverlay').classList.remove('hidden');
      }
    }
  });
}

// ==================== 操作历史渲染 ====================
function renderInlineHistoryLogs(logs) {
  if (!logs || logs.length === 0) {
    return `<div class="text-xs text-gray-400 py-2 text-center">暂无操作记录</div>`;
  }
  const actionLabels = { create: '创建', update: '修改', delete: '删除' };
  const actionColors = {
    create: 'text-green-600 bg-green-50 border-green-200',
    update: 'text-blue-600 bg-blue-50 border-blue-200',
    delete: 'text-red-600 bg-red-50 border-red-200'
  };
  const createLog = logs.find(l => l.action === 'create');
  const createTime = createLog ? new Date(createLog.created_at) : null;

  return logs.map(log => {
    const logTime = new Date(log.created_at);
    const minutesDiff = createTime ? Math.round((logTime - createTime) / 60000) : 0;
    const isLate = log.action !== 'create' && minutesDiff > 10;
    const rowBg = isLate ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100';
    const lateTag = isLate
      ? `<span class="text-xs text-red-500 font-medium ml-1"><i class="fa-solid fa-triangle-exclamation mr-0.5"></i>${minutesDiff}分钟后修改</span>`
      : '';
    let changeDesc = '';
    if (log.action === 'update' && log.old_data && log.new_data) {
      const changes = [];
      const fieldNames = { category_id: '类型', task_type_id: '任务类型', amount: '金额', expense_date: '日期', location: '地点', note: '备注' };
      Object.keys(log.new_data).forEach(key => {
        if (String(log.old_data[key]) !== String(log.new_data[key])) {
          const label = fieldNames[key] || key;
          const oldVal = key === 'amount' ? `¥${parseFloat(log.old_data[key] || 0).toFixed(2)}` : (log.old_data[key] || '空');
          const newVal = key === 'amount' ? `¥${parseFloat(log.new_data[key] || 0).toFixed(2)}` : (log.new_data[key] || '空');
          changes.push(`<span class="text-gray-500">${label}：</span><span class="line-through text-red-400">${oldVal}</span><span class="text-gray-400 mx-0.5">→</span><span class="text-green-600">${newVal}</span>`);
        }
      });
      if (changes.length > 0) {
        changeDesc = `<div class="mt-1 text-xs space-y-0.5 pl-2 border-l-2 border-gray-200">${changes.map(c => `<div>${c}</div>`).join('')}</div>`;
      }
    }
    return `
      <div class="rounded-lg p-2 ${rowBg}">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs px-1.5 py-0.5 rounded-full font-medium border ${actionColors[log.action] || 'text-gray-600 bg-gray-50 border-gray-200'}">${actionLabels[log.action] || log.action}</span>
            <span class="text-xs text-gray-600 font-medium">${log.operator_chn_name || log.operator_eng_name}</span>
            ${lateTag}
          </div>
          <span class="text-xs text-gray-400">${log.created_at ? log.created_at.slice(0, 16) : ''}</span>
        </div>
        ${changeDesc}
      </div>`;
  }).join('');
}

// 打开添加弹窗
function openAddModal(dateStr) {
  editingExpenseId = null;
  uploadedReceiptUrl = null;
  selectedCategoryId = null;
  selectedTaskTypeId = null;
  document.getElementById('modalTitle').textContent = '添加花费';
  document.getElementById('expenseDate').value = dateStr || selectedDate || '';
  document.getElementById('expenseAmount').value = '';
  document.getElementById('expenseNote').value = '';
  document.getElementById('expenseLocation').value = '';
  resetReceiptUpload();
  renderCategoryChips();
  renderTaskTypeChips();
  document.getElementById('expenseModal').classList.remove('hidden');
}

function openEditModal(expId) {
  const allExps = Object.values(monthExpenses).flat();
  const exp = allExps.find(e => e.id === expId);
  if (!exp) return;
  fillEditModal(exp);
}

function openEditModalFromList(expId, expenses) {
  const exp = expenses.find(e => e.id === expId);
  if (!exp) return;
  fillEditModal(exp);
}

function fillEditModal(exp) {
  editingExpenseId = exp.id;
  uploadedReceiptUrl = exp.receipt_url || null;
  selectedCategoryId = exp.category_id;
  selectedTaskTypeId = exp.task_type_id || null;
  document.getElementById('modalTitle').textContent = '编辑花费';
  document.getElementById('expenseDate').value = exp.expense_date;
  document.getElementById('expenseAmount').value = exp.amount;
  document.getElementById('expenseNote').value = exp.note || '';
  document.getElementById('expenseLocation').value = exp.location || '';
  if (exp.receipt_url) {
    showReceiptPreview(exp.receipt_url);
  } else {
    resetReceiptUpload();
  }
  renderCategoryChips();
  renderTaskTypeChips();
  document.getElementById('expenseModal').classList.remove('hidden');
}

function resetReceiptUpload() {
  document.getElementById('receiptPlaceholder').classList.remove('hidden');
  document.getElementById('receiptPreview').classList.add('hidden');
  document.getElementById('receiptFile').value = '';
  uploadedReceiptUrl = null;
}

function showReceiptPreview(url) {
  document.getElementById('receiptPlaceholder').classList.add('hidden');
  document.getElementById('receiptPreview').classList.remove('hidden');
  document.getElementById('receiptPreviewImg').src = url;
}

async function uploadReceipt(file) {
  const formData = new FormData();
  formData.append('file', file);
  showToast('上传中...', 'success');
  try {
    const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      uploadedReceiptUrl = data.url;
      showReceiptPreview(data.url);
      showToast('凭证上传成功');
    } else {
      showToast(data.detail || '上传失败', 'error');
    }
  } catch {
    showToast('上传失败，请重试', 'error');
  }
}

function renderCategoryChips() {
  const container = document.getElementById('categoryChips');
  container.innerHTML = categories.map(cat => {
    const icon = getIcon(cat.icon);
    const isSelected = cat.id === selectedCategoryId;
    return `
      <button class="category-chip flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${isSelected ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-indigo-300'}"
        data-cat-id="${cat.id}" style="${isSelected ? `border-color:${cat.color};background:${cat.color}20;color:${cat.color}` : ''}">
        <span>${icon}</span>${cat.name}
      </button>`;
  }).join('');
  container.querySelectorAll('.category-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategoryId = parseInt(btn.dataset.catId);
      renderCategoryChips();
    });
  });
}

function renderTaskTypeChips() {
  const container = document.getElementById('taskTypeChips');
  container.innerHTML = taskTypes.map(tt => {
    const icon = getIcon(tt.icon);
    const isSelected = tt.id === selectedTaskTypeId;
    return `
      <button class="task-chip flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border-2 transition-all ${isSelected ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-violet-300'}"
        data-tt-id="${tt.id}" style="${isSelected ? `border-color:${tt.color};background:${tt.color}20;color:${tt.color}` : ''}">
        <span>${icon}</span>${tt.name}
      </button>`;
  }).join('');
  container.querySelectorAll('.task-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.ttId);
      selectedTaskTypeId = selectedTaskTypeId === id ? null : id;
      renderTaskTypeChips();
    });
  });
}

async function saveExpense() {
  const date = document.getElementById('expenseDate').value;
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const note = document.getElementById('expenseNote').value.trim();
  const location = document.getElementById('expenseLocation').value.trim();

  if (!date) { showToast('请选择日期', 'error'); return; }
  if (!amount || amount <= 0) { showToast('请输入有效金额', 'error'); return; }
  if (!uploadedReceiptUrl) { showToast('请上传花费凭证照片', 'error'); return; }

  const payload = {
    user_eng_name: currentUser.eng_name,
    user_chn_name: currentUser.chn_name,
    category_id: selectedCategoryId,
    task_type_id: selectedTaskTypeId,
    amount,
    expense_date: date,
    location: location || null,
    note,
    receipt_url: uploadedReceiptUrl
  };

  try {
    let res;
    if (editingExpenseId) {
      res = await fetch(`${API}/api/expenses/${editingExpenseId}?operator=${currentUser.eng_name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: selectedCategoryId,
          task_type_id: selectedTaskTypeId,
          amount, expense_date: date,
          location: location || null,
          note,
          receipt_url: uploadedReceiptUrl
        })
      });
    } else {
      res = await fetch(`${API}/api/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    const data = await res.json();
    if (data.success) {
      showToast(editingExpenseId ? '修改成功' : '添加成功');
      document.getElementById('expenseModal').classList.add('hidden');
      await loadMonthExpenses();
      renderCalendar();
      if (selectedDate) renderDayExpenses(selectedDate);
    } else {
      showToast('操作失败', 'error');
    }
  } catch {
    showToast('网络错误', 'error');
  }
}

async function deleteExpense(expId) {
  if (!confirm('确定删除这条花费记录？')) return;
  try {
    const res = await fetch(`${API}/api/expenses/${expId}?operator=${currentUser.eng_name}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('删除成功');
      await loadMonthExpenses();
      renderCalendar();
      if (selectedDate) renderDayExpenses(selectedDate);
    } else {
      showToast('删除失败', 'error');
    }
  } catch {
    showToast('网络错误', 'error');
  }
}

// 加载列表
async function loadList() {
  if (!currentUser) return;
  const startDate = document.getElementById('listStartDate').value;
  const endDate = document.getElementById('listEndDate').value;
  document.getElementById('listLoading').classList.remove('hidden');
  document.getElementById('listEmpty').classList.add('hidden');
  document.getElementById('listExpenses').innerHTML = '';

  let url = `${API}/api/expenses?eng_name=${currentUser.eng_name}&page_size=100`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;

  const res = await fetch(url);
  const data = await res.json();
  document.getElementById('listLoading').classList.add('hidden');

  if (!data.expenses || data.expenses.length === 0) {
    document.getElementById('listEmpty').classList.remove('hidden');
    return;
  }

  const expenseIds = data.expenses.map(e => e.id);
  const logsMap = {};
  await Promise.all(expenseIds.map(async id => {
    try {
      const r = await fetch(`${API}/api/expenses/${id}/logs`);
      const d = await r.json();
      logsMap[id] = d.logs || [];
    } catch { logsMap[id] = []; }
  }));

  const container = document.getElementById('listExpenses');
  const grouped = {};
  data.expenses.forEach(exp => {
    const d = exp.expense_date;
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(exp);
  });

  Object.keys(grouped).sort((a, b) => b.localeCompare(a)).forEach(dateStr => {
    const exps = grouped[dateStr];
    const dayTotal = exps.reduce((s, e) => s + parseFloat(e.amount), 0);
    const parts = dateStr.split('-');
    const dateLabel = `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;

    const section = document.createElement('div');
    section.className = 'bg-white rounded-2xl shadow-sm p-4 mb-3 fade-in';

    const expHtml = exps.map(exp => {
      const icon = getIcon(exp.category_icon);
      const color = exp.category_color || '#6B7280';
      const editMinutes = exp.edit_minutes || 0;
      const isLateEdit = editMinutes > 10;
      const borderClass = isLateEdit ? 'border-l-4 border-red-400' : 'border-l-4 border-transparent';
      const lateTag = isLateEdit
        ? `<span class="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded-full"><i class="fa-solid fa-clock mr-0.5"></i>超10分钟修改</span>`
        : '';
      const taskTag = exp.task_type_name
        ? `<span class="text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full">${exp.task_type_name}</span>`
        : '';
      const locationTag = exp.location
        ? `<span class="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full"><i class="fa-solid fa-location-dot mr-0.5"></i>${exp.location}</span>`
        : '';
      const receiptThumb = exp.receipt_url
        ? `<div class="flex-shrink-0 ${isValidReceiptUrl(exp.receipt_url) ? 'cursor-pointer receipt-zoom-trigger' : ''}">
            ${receiptImgHtml(exp.receipt_url, 'h-12 w-12 rounded-lg object-cover border border-gray-200 hover:opacity-80 transition-opacity')}
           </div>`
        : '';
      const logs = logsMap[exp.id] || [];
      const historyHtml = renderInlineHistoryLogs(logs);

      return `
        <div class="rounded-xl ${borderClass} bg-gray-50 mb-2 overflow-hidden" data-id="${exp.id}">
          <div class="p-3 flex items-start gap-3">
            <div class="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 mt-0.5" style="background:${color}20">
              <span>${icon}</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 flex-wrap mb-1">
                <span class="text-sm font-medium text-gray-700">${exp.category_name || '未分类'}</span>
                ${lateTag}
              </div>
              <div class="flex flex-wrap gap-1 mb-1">${taskTag}${locationTag}</div>
              ${exp.note ? `<p class="text-xs text-gray-400 truncate">${exp.note}</p>` : ''}
            </div>
            ${receiptThumb}
            <div class="text-right flex-shrink-0">
              <p class="font-bold text-gray-800">¥${parseFloat(exp.amount).toFixed(2)}</p>
              <div class="flex gap-1 mt-1 justify-end">
                <button class="list-edit-btn w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center hover:bg-indigo-200 transition-colors text-xs" data-id="${exp.id}">
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button class="list-delete-btn w-6 h-6 rounded-lg bg-red-100 text-red-500 flex items-center justify-center hover:bg-red-200 transition-colors text-xs" data-id="${exp.id}">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
          <div class="px-3 pb-3">
            <div class="border-t border-gray-100 pt-2">
              <p class="text-xs text-gray-400 font-medium mb-1.5"><i class="fa-solid fa-clock-rotate-left mr-1"></i>操作历史</p>
              <div class="space-y-1">${historyHtml}</div>
            </div>
          </div>
        </div>`;
    }).join('');

    section.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <span class="font-semibold text-gray-700 text-sm">${dateLabel}</span>
        <span class="text-sm font-bold text-indigo-600">¥${dayTotal.toFixed(2)}</span>
      </div>
      ${expHtml}`;

    container.appendChild(section);

    section.querySelectorAll('.list-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => openEditModalFromList(parseInt(btn.dataset.id), data.expenses));
    });
    section.querySelectorAll('.list-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('确定删除这条花费记录？')) return;
        const r = await fetch(`${API}/api/expenses/${btn.dataset.id}?operator=${currentUser.eng_name}`, { method: 'DELETE' });
        const d = await r.json();
        if (d.success) { showToast('删除成功'); loadList(); }
        else showToast('删除失败', 'error');
      });
    });
  });
}

// ==================== 统计分析 ====================
async function loadStats() {
  if (!currentUser) return;
  const startDate = document.getElementById('statsStartDate').value;
  const endDate = document.getElementById('statsEndDate').value;

  let url = `${API}/api/expenses/stats?eng_name=${currentUser.eng_name}`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;

  const res = await fetch(url);
  const data = await res.json();

  document.getElementById('statsTotalAmount').textContent = `¥${parseFloat(data.summary?.total || 0).toFixed(2)}`;
  document.getElementById('statsTotalCount').textContent = data.summary?.count || 0;

  const catChartEl = document.getElementById('categoryChart');
  const catChart = echarts.getInstanceByDom(catChartEl) || echarts.init(catChartEl);
  catChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { show: false },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: data.by_category.map(c => ({
        name: c.category_name || '未分类',
        value: parseFloat(c.total_amount).toFixed(2),
        itemStyle: { color: c.category_color || '#6B7280' }
      })),
      label: { fontSize: 11 }
    }]
  });

  const trendChartEl = document.getElementById('trendChart');
  const trendChart = echarts.getInstanceByDom(trendChartEl) || echarts.init(trendChartEl);
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 10, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: data.by_date.map(d => d.expense_date.slice(5)),
      axisLabel: { fontSize: 10 }
    },
    yAxis: { type: 'value', axisLabel: { fontSize: 10 } },
    series: [{
      type: 'bar', data: data.by_date.map(d => parseFloat(d.total_amount).toFixed(2)),
      itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] }
    }]
  });

  const detail = document.getElementById('categoryDetail');
  const total = parseFloat(data.summary?.total || 1);
  detail.innerHTML = data.by_category.map(c => {
    const pct = ((parseFloat(c.total_amount) / total) * 100).toFixed(1);
    const icon = getIcon(c.category_icon);
    return `
      <div class="flex items-center gap-3">
        <span class="text-lg w-8 text-center">${icon}</span>
        <div class="flex-1">
          <div class="flex justify-between text-sm mb-1">
            <span class="font-medium text-gray-700">${c.category_name || '未分类'}</span>
            <span class="font-bold text-gray-800">¥${parseFloat(c.total_amount).toFixed(2)}</span>
          </div>
          <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full rounded-full" style="width:${pct}%;background:${c.category_color || '#6B7280'}"></div>
          </div>
        </div>
        <span class="text-xs text-gray-400 w-10 text-right">${pct}%</span>
      </div>`;
  }).join('');
}

// ==================== 批量删除 ====================
async function previewBatchDelete() {
  const startDate = document.getElementById('batchDeleteStartDate').value;
  const endDate = document.getElementById('batchDeleteEndDate').value;
  const previewEl = document.getElementById('batchDeletePreview');
  const previewText = document.getElementById('batchDeletePreviewText');

  if (!startDate || !endDate) {
    previewEl.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`${API}/api/expenses?eng_name=${currentUser.eng_name}&start_date=${startDate}&end_date=${endDate}&page_size=1`);
    const data = await res.json();
    const count = data.total || 0;
    previewText.textContent = `该时间范围内共有 ${count} 条花费记录将被删除`;
    previewEl.classList.remove('hidden');
  } catch {
    previewText.textContent = '无法获取记录数量';
    previewEl.classList.remove('hidden');
  }
}

async function confirmBatchDelete() {
  const startDate = document.getElementById('batchDeleteStartDate').value;
  const endDate = document.getElementById('batchDeleteEndDate').value;
  const password = document.getElementById('batchDeletePassword').value.trim();

  if (!startDate || !endDate) {
    showToast('请选择开始和结束日期', 'error');
    return;
  }
  if (!password) {
    showToast('请输入删除密码', 'error');
    return;
  }

  try {
    const res = await fetch(`${API}/api/expenses/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eng_name: currentUser.eng_name,
        start_date: startDate,
        end_date: endDate,
        password: password
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`成功删除 ${data.deleted_count} 条记录`);
      document.getElementById('batchDeleteModal').classList.add('hidden');
      await loadMonthExpenses();
      renderCalendar();
      loadList();
    } else {
      showToast(data.detail || '删除失败', 'error');
    }
  } catch (err) {
    showToast('网络错误，请重试', 'error');
  }
}

function initStatsDateRange() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const startEl = document.getElementById('statsStartDate');
  const endEl = document.getElementById('statsEndDate');
  if (startEl && !startEl.value) startEl.value = fmt(firstDay);
  if (endEl && !endEl.value) endEl.value = fmt(today);
}

// ==================== 设置 ====================
async function loadSettings() {
  await loadCategories();
  await loadTaskTypes();
  renderCategorySettings();
  renderTaskTypeSettings();
}

function renderCategorySettings() {
  const container = document.getElementById('categoryList');
  container.innerHTML = categories.map(cat => {
    const icon = getIcon(cat.icon);
    return `
      <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
        <span class="text-lg">${icon}</span>
        <span class="flex-1 text-sm font-medium text-gray-700">${cat.name}</span>
        <button class="del-cat-btn w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors text-sm flex items-center justify-center" data-id="${cat.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`;
  }).join('');

  container.querySelectorAll('.del-cat-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除此花费类型？')) return;
      const res = await fetch(`${API}/api/categories/${btn.dataset.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('删除成功');
        await loadCategories();
        renderCategorySettings();
      } else {
        showToast(data.detail || '删除失败', 'error');
      }
    });
  });
}

function renderTaskTypeSettings() {
  const container = document.getElementById('taskTypeList');
  container.innerHTML = taskTypes.map(tt => {
    const icon = getIcon(tt.icon);
    return `
      <div class="flex items-center gap-3 p-3 bg-violet-50 rounded-xl">
        <span class="text-lg">${icon}</span>
        <span class="flex-1 text-sm font-medium text-gray-700">${tt.name}</span>
        <button class="del-tt-btn w-7 h-7 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors text-sm flex items-center justify-center" data-id="${tt.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`;
  }).join('');

  container.querySelectorAll('.del-tt-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除此任务类型？')) return;
      const res = await fetch(`${API}/api/task-types/${btn.dataset.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('删除成功');
        await loadTaskTypes();
        renderTaskTypeSettings();
      } else {
        showToast(data.detail || '删除失败', 'error');
      }
    });
  });
}

// ==================== 文字识别（OCR） ====================

function parseExpenseLine(line, defaultYear, defaultMonth) {
  const result = {
    raw: line,
    date: null,
    location: null,
    task_type: null,
    category: null,
    amount: null,
    note: line
  };

  let dateMatch = line.match(/(\d{1,2})月(\d{1,2})[日号]?/);
  if (dateMatch) {
    const m = parseInt(dateMatch[1]);
    const d = parseInt(dateMatch[2]);
    result.date = `${defaultYear}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  } else {
    dateMatch = line.match(/^(\d{1,2})[号日]/);
    if (dateMatch) {
      const d = parseInt(dateMatch[1]);
      result.date = `${defaultYear}-${String(defaultMonth).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }

  const amountMatch = line.match(/[¥￥]?(\d+(?:\.\d+)?)\s*[元块钱]/);
  if (amountMatch) {
    result.amount = parseFloat(amountMatch[1]);
  }

  const locationPatterns = [
    /(?:在|去|到|从)([^\s，,。.0-9\d]{2,6}?)(?:送|买|采|维|过|加|停|住|吃|用|花|付|消|支)/,
    /^(?:\d+[号日月]?\s*)([^\s，,。.0-9\d]{2,6}?)(?:送|买|采|维|过|加|停)/
  ];
  for (const pat of locationPatterns) {
    const m = line.match(pat);
    if (m) { result.location = m[1]; break; }
  }

  for (const tt of taskTypes) {
    if (line.includes(tt.name)) {
      result.task_type = tt;
      break;
    }
  }

  for (const cat of categories) {
    if (line.includes(cat.name)) {
      result.category = cat;
      break;
    }
  }

  if (!result.task_type) {
    const taskMatch = line.match(/(?:送|买|采购|维修|运|拉|取|装|卸|过磅|加油|停车)[\u4e00-\u9fa5]{0,6}/);
    if (taskMatch) result.task_note = taskMatch[0];
  }

  return result;
}

function renderOcrResults(parsedList) {
  const container = document.getElementById('ocrResultList');
  const today = new Date();
  const defaultYear = today.getFullYear();
  const defaultMonth = today.getMonth() + 1;

  container.innerHTML = parsedList.map((item, idx) => {
    const catOptions = categories.map(c =>
      `<option value="${c.id}" ${item.category && item.category.id === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');
    const ttOptions = `<option value="">无</option>` + taskTypes.map(t =>
      `<option value="${t.id}" ${item.task_type && item.task_type.id === t.id ? 'selected' : ''}>${t.name}</option>`
    ).join('');

    const dateVal = item.date || `${defaultYear}-${String(defaultMonth).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

    return `
      <div class="bg-white rounded-2xl shadow-sm p-4 border-2 border-gray-100 ocr-item" data-idx="${idx}">
        <div class="flex items-start justify-between mb-3">
          <p class="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded-lg flex-1 mr-2 truncate">"${item.raw}"</p>
          <button class="ocr-remove-btn w-6 h-6 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 flex items-center justify-center text-xs flex-shrink-0" data-idx="${idx}">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label class="text-xs text-gray-500 mb-1 block">日期</label>
            <input type="date" class="ocr-date w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" value="${dateVal}" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">金额（元）<span class="text-red-400">*</span></label>
            <input type="number" class="ocr-amount w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" value="${item.amount || ''}" placeholder="0.00" step="0.01" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">地点</label>
            <input type="text" class="ocr-location w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" value="${item.location || ''}" placeholder="地点" />
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">任务类型</label>
            <select class="ocr-task-type w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300">${ttOptions}</select>
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">花费类型</label>
            <select class="ocr-category w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300">
              <option value="">未分类</option>${catOptions}
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">备注</label>
            <input type="text" class="ocr-note w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" value="${item.task_note || ''}" placeholder="备注" />
          </div>
        </div>
        <div class="border-t border-gray-100 pt-2">
          <label class="text-xs text-gray-500 mb-1 block">花费凭证 <span class="text-red-400">*</span></label>
          <div class="ocr-receipt-area border-2 border-dashed border-gray-200 rounded-xl p-2 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all" data-idx="${idx}">
            <input type="file" class="ocr-receipt-file hidden" accept="image/*" data-idx="${idx}" />
            <div class="ocr-receipt-placeholder">
              <i class="fa-solid fa-cloud-arrow-up text-gray-300 text-lg mb-1 block"></i>
              <p class="text-xs text-gray-400">点击上传凭证</p>
            </div>
            <div class="ocr-receipt-preview hidden">
              <img class="ocr-receipt-img max-h-16 mx-auto rounded-lg object-contain" src="" alt="凭证" />
              <p class="text-xs text-gray-400 mt-1">点击重新上传</p>
            </div>
          </div>
        </div>
        <button class="ocr-save-btn mt-3 w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-2 rounded-xl text-xs font-medium hover:opacity-90 transition-opacity" data-idx="${idx}">
          <i class="fa-solid fa-check mr-1"></i>保存此条
        </button>
      </div>`;
  }).join('');

  // 绑定凭证上传
  container.querySelectorAll('.ocr-receipt-area').forEach(area => {
    const fileInput = area.querySelector('.ocr-receipt-file');
    area.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      showToast('上传中...', 'success');
      try {
        const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          area.dataset.receiptUrl = data.url;
          area.querySelector('.ocr-receipt-placeholder').classList.add('hidden');
          const preview = area.querySelector('.ocr-receipt-preview');
          preview.classList.remove('hidden');
          preview.querySelector('.ocr-receipt-img').src = data.url;
          showToast('凭证上传成功');
        }
      } catch { showToast('上传失败', 'error'); }
    });
  });

  container.querySelectorAll('.ocr-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.ocr-item').remove();
      if (container.children.length === 0) {
        document.getElementById('ocrResults').classList.add('hidden');
      }
    });
  });

  container.querySelectorAll('.ocr-save-btn').forEach(btn => {
    btn.addEventListener('click', () => saveOcrItem(btn.closest('.ocr-item')));
  });
}

async function saveOcrItem(itemEl) {
  const date = itemEl.querySelector('.ocr-date').value;
  const amount = parseFloat(itemEl.querySelector('.ocr-amount').value);
  const location = itemEl.querySelector('.ocr-location').value.trim();
  const taskTypeId = itemEl.querySelector('.ocr-task-type').value;
  const categoryId = itemEl.querySelector('.ocr-category').value;
  const note = itemEl.querySelector('.ocr-note').value.trim();
  const receiptArea = itemEl.querySelector('.ocr-receipt-area');
  const receiptUrl = receiptArea.dataset.receiptUrl || null;

  if (!date) { showToast('请填写日期', 'error'); return; }
  if (!amount || amount <= 0) { showToast('请填写有效金额', 'error'); return; }
  if (!receiptUrl) { showToast('请上传花费凭证', 'error'); return; }

  const payload = {
    user_eng_name: currentUser.eng_name,
    user_chn_name: currentUser.chn_name,
    category_id: categoryId ? parseInt(categoryId) : null,
    task_type_id: taskTypeId ? parseInt(taskTypeId) : null,
    amount,
    expense_date: date,
    location: location || null,
    note,
    receipt_url: receiptUrl
  };

  try {
    const res = await fetch(`${API}/api/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('保存成功');
      itemEl.classList.add('opacity-50', 'pointer-events-none');
      itemEl.querySelector('.ocr-save-btn').textContent = '✓ 已保存';
      await loadMonthExpenses();
      renderCalendar();
    } else {
      showToast('保存失败', 'error');
    }
  } catch {
    showToast('网络错误', 'error');
  }
}

// ==================== Tab 切换 ====================
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('tab-active');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.remove('hidden');

      if (tab === 'list') loadList();
      if (tab === 'stats') { initStatsDateRange(); loadStats(); }
      if (tab === 'settings') loadSettings();
    });
  });
}

// ==================== 事件绑定 ====================
function initEvents() {
  // 认证相关事件
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('registerBtn').addEventListener('click', doRegister);
  document.getElementById('showRegisterBtn').addEventListener('click', () => {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
  });
  document.getElementById('showLoginBtn').addEventListener('click', () => {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
  });

  // 登录表单回车提交
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('regConfirmPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doRegister();
  });

  // 退出登录
  document.getElementById('logoutBtn').addEventListener('click', () => {
    if (confirm('确定要退出登录吗？')) doLogout();
  });

  document.getElementById('prevMonth').addEventListener('click', async () => {
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    await loadMonthExpenses();
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', async () => {
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    await loadMonthExpenses();
    renderCalendar();
  });

  document.getElementById('addExpenseBtn').addEventListener('click', () => openAddModal(selectedDate));
  document.getElementById('closeModal').addEventListener('click', () => document.getElementById('expenseModal').classList.add('hidden'));
  document.getElementById('cancelModal').addEventListener('click', () => document.getElementById('expenseModal').classList.add('hidden'));
  document.getElementById('saveExpense').addEventListener('click', saveExpense);

  document.getElementById('listSearchBtn').addEventListener('click', loadList);
  document.getElementById('statsSearchBtn').addEventListener('click', loadStats);

  // 批量删除
  document.getElementById('batchDeleteBtn').addEventListener('click', () => {
    const startDate = document.getElementById('listStartDate').value;
    const endDate = document.getElementById('listEndDate').value;
    if (startDate) document.getElementById('batchDeleteStartDate').value = startDate;
    if (endDate) document.getElementById('batchDeleteEndDate').value = endDate;
    document.getElementById('batchDeletePassword').value = '';
    document.getElementById('batchDeletePreview').classList.add('hidden');
    document.getElementById('batchDeleteModal').classList.remove('hidden');
    if (startDate && endDate) previewBatchDelete();
  });

  document.getElementById('cancelBatchDeleteModal').addEventListener('click', () => {
    document.getElementById('batchDeleteModal').classList.add('hidden');
  });

  document.getElementById('batchDeleteModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('batchDeleteModal')) {
      document.getElementById('batchDeleteModal').classList.add('hidden');
    }
  });

  document.getElementById('batchDeleteStartDate').addEventListener('change', previewBatchDelete);
  document.getElementById('batchDeleteEndDate').addEventListener('change', previewBatchDelete);
  document.getElementById('confirmBatchDeleteBtn').addEventListener('click', confirmBatchDelete);

  // 花费类型添加
  document.getElementById('addCategoryBtn').addEventListener('click', async () => {
    const name = document.getElementById('newCategoryName').value.trim();
    if (!name) { showToast('请输入类型名称', 'error'); return; }
    const res = await fetch(`${API}/api/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: 'other', color: '#6B7280', created_by: currentUser.eng_name, is_global: 0 })
    });
    const data = await res.json();
    if (data.success) {
      showToast('添加成功');
      document.getElementById('newCategoryName').value = '';
      await loadCategories();
      renderCategorySettings();
    }
  });

  // 任务类型添加
  document.getElementById('addTaskTypeBtn').addEventListener('click', async () => {
    const name = document.getElementById('newTaskTypeName').value.trim();
    if (!name) { showToast('请输入任务类型名称', 'error'); return; }
    const res = await fetch(`${API}/api/task-types`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon: 'task', color: '#8B5CF6', created_by: currentUser.eng_name, is_global: 0 })
    });
    const data = await res.json();
    if (data.success) {
      showToast('添加成功');
      document.getElementById('newTaskTypeName').value = '';
      await loadTaskTypes();
      renderTaskTypeSettings();
    }
  });

  document.getElementById('merchantBtn').addEventListener('click', () => {
    window.location.href = '/static/merchant.html';
  });

  document.getElementById('expenseModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('expenseModal')) {
      document.getElementById('expenseModal').classList.add('hidden');
    }
  });

  // 凭证上传
  const uploadArea = document.getElementById('receiptUploadArea');
  const fileInput = document.getElementById('receiptFile');
  if (uploadArea && fileInput) {
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) uploadReceipt(file);
    });
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('border-indigo-400', 'bg-indigo-50');
    });
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('border-indigo-400', 'bg-indigo-50');
    });
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('border-indigo-400', 'bg-indigo-50');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) uploadReceipt(file);
      else showToast('请上传图片文件', 'error');
    });
  }

  // OCR 识别
  document.getElementById('ocrParseBtn').addEventListener('click', () => {
    const text = document.getElementById('ocrInput').value.trim();
    if (!text) { showToast('请输入要识别的文字', 'error'); return; }
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const today = new Date();
    const parsedList = lines.map(line => parseExpenseLine(line, today.getFullYear(), today.getMonth() + 1));
    renderOcrResults(parsedList);
    document.getElementById('ocrResults').classList.remove('hidden');
  });

  document.getElementById('ocrClearBtn').addEventListener('click', () => {
    document.getElementById('ocrInput').value = '';
    document.getElementById('ocrResults').classList.add('hidden');
    document.getElementById('ocrResultList').innerHTML = '';
  });

  document.getElementById('ocrSaveAllBtn').addEventListener('click', async () => {
    const items = document.querySelectorAll('.ocr-item:not(.pointer-events-none)');
    for (const item of items) {
      await saveOcrItem(item);
    }
  });

  // 权限申请弹窗
  document.getElementById('cancelApplyModal').addEventListener('click', () => {
    document.getElementById('applyModal').classList.add('hidden');
  });

  document.getElementById('submitApplyBtn').addEventListener('click', async () => {
    const phone = document.getElementById('applyPhone').value.trim();
    try {
      const res = await fetch(`${API}/api/users/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eng_name: currentUser.eng_name, phone })
      });
      const data = await res.json();
      if (data.success) {
        showToast('申请已提交，请联系商家审核');
        document.getElementById('applyModal').classList.add('hidden');
      }
    } catch {
      showToast('提交失败，请重试', 'error');
    }
  });
}

async function init() {
  initTabs();
  initEvents();
  initReceiptZoom();

  // 检查认证状态
  const isAuthed = await checkAuth();
  if (isAuthed) {
    showMainApp();
    await initMainApp();
  }
}

init();
```