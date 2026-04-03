// 商家端主逻辑
const API = '';
let currentMerchant = null;
let allUsers = [];
let allCategories = [];
let allTaskTypes = [];
let editingExpenseId = null;
let recordsPage = 1;
let recordsTotal = 0;
const PAGE_SIZE = 20;
let merchantUploadedReceiptUrl = null;
let selectedOverviewUsers = []; // 多选用户

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

// 生成凭证缩略图HTML，带onerror回退
function receiptImgHtml(url, className = 'h-10 w-10 rounded-lg object-cover border border-white/20 hover:opacity-80 transition-opacity') {
  if (!isValidReceiptUrl(url)) {
    return `<div class="flex items-center gap-1 text-xs text-gray-500 bg-white/5 px-2 py-1 rounded-lg"><i class="fa-solid fa-image"></i><span>凭证已失效</span></div>`;
  }
  return `<img src="${url}" alt="凭证" class="${className}" onerror="this.parentElement.innerHTML='<div class=\\'flex items-center gap-1 text-xs text-gray-500 bg-white/5 px-2 py-1 rounded-lg\\'><i class=\\'fa-solid fa-image\\'></i><span>凭证加载失败</span></div>'" />`;
}

// 头像生成（纯本地，不依赖外部资源）
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

function getInlineAvatarHtml(name, className = 'w-8 h-8 rounded-full') {
  return getAvatarHtml(name, className);
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

function showAuthPage() {
  document.getElementById('authPage').classList.remove('hidden');
  document.getElementById('mainApp').classList.add('hidden');
}

function showMainApp() {
  document.getElementById('authPage').classList.add('hidden');
  document.getElementById('mainApp').classList.remove('hidden');
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
    currentMerchant = data.user;
    localStorage.setItem('user_info', JSON.stringify(currentMerchant));

    // 检查商家权限
    if (!currentMerchant.is_merchant) {
      showToast('您没有商家权限，即将跳转到客户端', 'error');
      setTimeout(() => window.location.href = '/static/index.html', 2000);
      return;
    }

    showToast('登录成功');
    showMainApp();
    await initMerchantApp();
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
  currentMerchant = null;
  showAuthPage();
  showToast('已退出登录');
}

async function initMerchant() {
  // 检查 Token
  const token = getToken();
  if (!token) {
    showAuthPage();
    return;
  }

  try {
    const res = await fetch(`${API}/api/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      clearToken();
      showAuthPage();
      return;
    }
    const data = await res.json();
    currentMerchant = data.user;
    localStorage.setItem('user_info', JSON.stringify(currentMerchant));

    // 检查商家权限
    if (!currentMerchant.is_merchant) {
      showToast('您没有商家权限', 'error');
      setTimeout(() => window.location.href = '/static/index.html', 2000);
      return;
    }

    showMainApp();
    await initMerchantApp();
  } catch {
    // 网络错误时尝试使用缓存
    try {
      const cached = JSON.parse(localStorage.getItem('user_info'));
      if (cached && cached.is_merchant) {
        currentMerchant = cached;
        showMainApp();
        await initMerchantApp();
        return;
      }
    } catch {}
    showAuthPage();
  }
}

async function initMerchantApp() {
  document.getElementById('merchantName').textContent = `${currentMerchant.chn_name} · 商家`;

  // 显示首字母头像
  const avatar = document.getElementById('merchantAvatar');
  avatar.style.display = 'none';
  const existingFallback = avatar.parentNode.querySelector('.avatar-fallback');
  if (existingFallback) existingFallback.remove();
  const fallback = document.createElement('div');
  fallback.className = 'avatar-fallback w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold';
  fallback.style.background = nameToColor(currentMerchant.chn_name || currentMerchant.eng_name);
  fallback.textContent = (currentMerchant.chn_name || currentMerchant.eng_name || '?').charAt(0);
  avatar.parentNode.insertBefore(fallback, avatar.nextSibling);

  await loadAllUsers();
  await loadCategories();
  await loadTaskTypes();
  initOverviewDateRange();
  loadOverview();
  loadApplyBadge();
}

async function loadAllUsers() {
  const res = await fetch(`${API}/api/users/list`);
  const data = await res.json();
  allUsers = data.users;

  // 更新花费记录筛选下拉
  const sel = document.getElementById('recordsUser');
  const firstOpt = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(firstOpt);
  allUsers.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.eng_name;
    opt.textContent = `${u.chn_name}(${u.eng_name})`;
    sel.appendChild(opt);
  });

  // 更新多选人员下拉
  buildMultiSelectOptions();
}

function buildMultiSelectOptions() {
  const optionsContainer = document.getElementById('overviewUserOptions');
  // 保留"全部人员"选项
  const allOption = document.getElementById('overviewAllOption');
  optionsContainer.innerHTML = '';
  optionsContainer.appendChild(allOption);

  allUsers.forEach(u => {
    const div = document.createElement('div');
    div.className = 'multi-select-option';
    div.dataset.value = u.eng_name;
    div.innerHTML = `<i class="fa-solid fa-check text-indigo-400 mr-2 opacity-0 check-icon"></i>${u.chn_name}(${u.eng_name})`;
    optionsContainer.appendChild(div);
  });

  // 绑定选项点击
  optionsContainer.querySelectorAll('.multi-select-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = opt.dataset.value;
      if (val === '' || val === undefined) {
        // 全部人员
        selectedOverviewUsers = [];
        optionsContainer.querySelectorAll('.multi-select-option').forEach(o => {
          o.querySelector('.check-icon').style.opacity = '0';
        });
        document.getElementById('overviewAllCheck').style.opacity = '1';
      } else {
        // 取消全选
        document.getElementById('overviewAllCheck').style.opacity = '0';
        const idx = selectedOverviewUsers.indexOf(val);
        if (idx >= 0) {
          selectedOverviewUsers.splice(idx, 1);
          opt.querySelector('.check-icon').style.opacity = '0';
        } else {
          selectedOverviewUsers.push(val);
          opt.querySelector('.check-icon').style.opacity = '1';
        }
        if (selectedOverviewUsers.length === 0) {
          document.getElementById('overviewAllCheck').style.opacity = '1';
        }
      }
      updateOverviewUserLabel();
    });
  });
}

function updateOverviewUserLabel() {
  const label = document.getElementById('overviewUserLabel');
  if (selectedOverviewUsers.length === 0) {
    label.textContent = '全部人员';
  } else if (selectedOverviewUsers.length === 1) {
    const u = allUsers.find(u => u.eng_name === selectedOverviewUsers[0]);
    label.textContent = u ? u.chn_name : selectedOverviewUsers[0];
  } else {
    label.textContent = `已选 ${selectedOverviewUsers.length} 人`;
  }
}

async function loadCategories() {
  const res = await fetch(`${API}/api/categories`);
  const data = await res.json();
  allCategories = data.categories;
}

async function loadTaskTypes() {
  const res = await fetch(`${API}/api/task-types`);
  const data = await res.json();
  allTaskTypes = data.task_types;
}

function initOverviewDateRange() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const startEl = document.getElementById('overviewStart');
  const endEl = document.getElementById('overviewEnd');
  if (startEl && !startEl.value) startEl.value = fmt(firstDay);
  if (endEl && !endEl.value) endEl.value = fmt(today);
}

// 加载总览
async function loadOverview() {
  const startDate = document.getElementById('overviewStart').value;
  const endDate = document.getElementById('overviewEnd').value;

  let url = `${API}/api/expenses/stats?`;
  if (selectedOverviewUsers.length > 0) {
    url += `eng_names=${encodeURIComponent(selectedOverviewUsers.join(','))}&`;
  }
  if (startDate) url += `start_date=${startDate}&`;
  if (endDate) url += `end_date=${endDate}&`;

  const res = await fetch(url);
  const data = await res.json();

  const total = parseFloat(data.summary?.total || 0);
  const count = data.summary?.count || 0;
  const userCount = data.by_user?.length || 0;
  const avg = userCount > 0 ? total / userCount : 0;

  document.getElementById('overviewTotal').textContent = `¥${total.toFixed(2)}`;
  document.getElementById('overviewCount').textContent = count;
  document.getElementById('overviewUsers').textContent = userCount;
  document.getElementById('overviewAvg').textContent = `¥${avg.toFixed(2)}`;

  const catChartEl = document.getElementById('overviewCatChart');
  const catChart = echarts.getInstanceByDom(catChartEl) || echarts.init(catChartEl);
  catChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { show: false },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: data.by_category.map(c => ({
        name: c.category_name || '未分类',
        value: parseFloat(c.total_amount).toFixed(2),
        itemStyle: { color: c.category_color || '#6B7280' }
      })),
      label: { color: '#9ca3af', fontSize: 11 }
    }]
  });

  const trendChartEl = document.getElementById('overviewTrendChart');
  const trendChart = echarts.getInstanceByDom(trendChartEl) || echarts.init(trendChartEl);
  trendChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', backgroundColor: '#1e293b', borderColor: '#334155', textStyle: { color: '#e2e8f0' } },
    grid: { left: 45, right: 10, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: data.by_date.map(d => d.expense_date.slice(5)),
      axisLabel: { color: '#6b7280', fontSize: 10 },
      axisLine: { lineStyle: { color: '#334155' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1e293b' } }
    },
    series: [{
      type: 'bar',
      data: data.by_date.map(d => parseFloat(d.total_amount).toFixed(2)),
      itemStyle: { color: '#6366f1', borderRadius: [4, 4, 0, 0] }
    }]
  });

  const ranking = document.getElementById('userRanking');
  const maxAmount = data.by_user.length > 0 ? parseFloat(data.by_user[0].total_amount) : 1;
  ranking.innerHTML = data.by_user.map((u, i) => {
    const pct = (parseFloat(u.total_amount) / maxAmount * 100).toFixed(0);
    const medals = ['🥇', '🥈', '🥉'];
    return `
      <div class="flex items-center gap-3">
        <span class="text-lg w-8 text-center">${medals[i] || `<span class="text-gray-500 text-sm">${i+1}</span>`}</span>
        ${getAvatarHtml(u.user_eng_name, 'w-8 h-8 rounded-full border border-white/20')}
        <div class="flex-1">
          <div class="flex justify-between text-sm mb-1">
            <span class="text-gray-300 font-medium">${u.user_chn_name || u.user_eng_name}</span>
            <span class="text-white font-bold">¥${parseFloat(u.total_amount).toFixed(2)}</span>
          </div>
          <div class="h-2 bg-white/10 rounded-full overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500" style="width:${pct}%"></div>
          </div>
        </div>
        <span class="text-xs text-gray-500 w-12 text-right">${u.count}条</span>
      </div>`;
  }).join('');
}

// ==================== 操作历史渲染（内嵌） ====================
function renderInlineHistoryLogs(logs) {
  if (!logs || logs.length === 0) {
    return `<div class="text-xs text-gray-500 py-1 text-center">暂无操作记录</div>`;
  }
  const actionLabels = { create: '创建', update: '修改', delete: '删除' };
  const actionColors = {
    create: 'text-green-400 bg-green-500/20 border-green-500/30',
    update: 'text-blue-400 bg-blue-500/20 border-blue-500/30',
    delete: 'text-red-400 bg-red-500/20 border-red-500/30'
  };
  const createLog = logs.find(l => l.action === 'create');
  const createTime = createLog ? new Date(createLog.created_at) : null;

  return logs.map(log => {
    const logTime = new Date(log.created_at);
    const minutesDiff = createTime ? Math.round((logTime - createTime) / 60000) : 0;
    const isLate = log.action !== 'create' && minutesDiff > 10;
    const rowBg = isLate ? 'bg-red-500/10 border border-red-500/30' : 'bg-white/5 border border-white/10';
    const lateTag = isLate
      ? `<span class="text-xs text-red-400 font-medium ml-1"><i class="fa-solid fa-triangle-exclamation mr-0.5"></i>${minutesDiff}分钟后修改</span>`
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
          changes.push(`<span class="text-gray-400">${label}：</span><span class="line-through text-red-400">${oldVal}</span><span class="text-gray-500 mx-0.5">→</span><span class="text-green-400">${newVal}</span>`);
        }
      });
      if (changes.length > 0) {
        changeDesc = `<div class="mt-1 text-xs space-y-0.5 pl-2 border-l-2 border-white/10">${changes.map(c => `<div>${c}</div>`).join('')}</div>`;
      }
    }
    return `
      <div class="rounded-lg p-2 ${rowBg}">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs px-1.5 py-0.5 rounded-full font-medium border ${actionColors[log.action] || 'text-gray-400 bg-gray-500/20 border-gray-500/30'}">${actionLabels[log.action] || log.action}</span>
            <span class="text-xs text-gray-300 font-medium">${log.operator_chn_name || log.operator_eng_name}</span>
            ${lateTag}
          </div>
          <span class="text-xs text-gray-500">${log.created_at ? log.created_at.slice(0, 16) : ''}</span>
        </div>
        ${changeDesc}
      </div>`;
  }).join('');
}

// 加载花费记录（内嵌操作历史）
async function loadRecords(page = 1) {
  recordsPage = page;
  const engName = document.getElementById('recordsUser').value;
  const startDate = document.getElementById('recordsStart').value;
  const endDate = document.getElementById('recordsEnd').value;

  let url = `${API}/api/expenses?page=${page}&page_size=${PAGE_SIZE}`;
  if (engName) url += `&eng_name=${engName}`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;

  const res = await fetch(url);
  const data = await res.json();
  recordsTotal = data.total;

  const tbody = document.getElementById('recordsTableBody');
  if (!data.expenses || data.expenses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">暂无记录</td></tr>';
    document.getElementById('recordsPagination').classList.add('hidden');
    return;
  }

  const logsMap = {};
  await Promise.all(data.expenses.map(async exp => {
    try {
      const r = await fetch(`${API}/api/expenses/${exp.id}/logs`);
      const d = await r.json();
      logsMap[exp.id] = d.logs || [];
    } catch { logsMap[exp.id] = []; }
  }));

  tbody.innerHTML = data.expenses.map(exp => {
    const editMinutes = exp.edit_minutes || 0;
    const isLateEdit = editMinutes > 10;
    const rowClass = isLateEdit ? 'late-edit' : 'border-b border-white/5';
    const icon = getIcon(exp.category_icon);
    const lateTag = isLateEdit
      ? `<span class="ml-1 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded-full"><i class="fa-solid fa-clock mr-0.5"></i>${editMinutes}分钟后修改</span>`
      : '';
    const receiptThumb = exp.receipt_url
      ? `<div class="block mt-1 ${isValidReceiptUrl(exp.receipt_url) ? 'cursor-pointer receipt-zoom-trigger' : ''}">
          ${receiptImgHtml(exp.receipt_url)}
         </div>`
      : '<span class="text-gray-600 text-xs">无</span>';
    const taskTag = exp.task_type_name
      ? `<span class="text-xs bg-violet-500/20 text-violet-400 px-1.5 py-0.5 rounded-full">${exp.task_type_name}</span>`
      : '<span class="text-gray-600 text-xs">-</span>';
    const logs = logsMap[exp.id] || [];
    const historyHtml = renderInlineHistoryLogs(logs);

    return `
      <tr class="${rowClass}">
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            ${getInlineAvatarHtml(exp.user_eng_name, 'w-7 h-7 rounded-full border border-white/20')}
            <div>
              <p class="text-white text-xs font-medium">${exp.user_chn_name || exp.user_eng_name}</p>
              <p class="text-gray-500 text-xs">${exp.user_eng_name}</p>
            </div>
          </div>
        </td>
        <td class="px-4 py-3 text-gray-300 text-xs">${exp.expense_date}</td>
        <td class="px-4 py-3">${taskTag}</td>
        <td class="px-4 py-3">
          <span class="flex items-center gap-1 text-xs">
            <span>${icon}</span>
            <span class="text-gray-300">${exp.category_name || '未分类'}</span>
          </span>
        </td>
        <td class="px-4 py-3 text-gray-400 text-xs">${exp.location || '-'}</td>
        <td class="px-4 py-3 text-right font-bold text-white">¥${parseFloat(exp.amount).toFixed(2)}</td>
        <td class="px-4 py-3 text-gray-400 text-xs max-w-24 truncate">${exp.note || '-'}</td>
        <td class="px-4 py-3">${receiptThumb}</td>
        <td class="px-4 py-3 text-gray-500 text-xs">${exp.created_at ? exp.created_at.slice(0,16) : '-'}</td>
        <td class="px-4 py-3 text-center">
          <div class="flex gap-1 justify-center">
            <button class="edit-record-btn w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/40 transition-colors text-xs flex items-center justify-center" data-id="${exp.id}">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="delete-record-btn w-7 h-7 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/40 transition-colors text-xs flex items-center justify-center" data-id="${exp.id}">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
      <tr class="${isLateEdit ? 'bg-red-500/5' : 'bg-white/2'} border-b border-white/5">
        <td colspan="10" class="px-4 pb-3 pt-1">
          <div class="flex items-start gap-2">
            <span class="text-xs text-gray-500 font-medium whitespace-nowrap mt-0.5"><i class="fa-solid fa-clock-rotate-left mr-1"></i>操作历史</span>
            <div class="flex-1 space-y-1">${historyHtml}</div>
          </div>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.edit-record-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.id), data.expenses));
  });
  tbody.querySelectorAll('.delete-record-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteRecord(parseInt(btn.dataset.id)));
  });

  const totalPages = Math.ceil(recordsTotal / PAGE_SIZE);
  document.getElementById('recordsPagination').classList.remove('hidden');
  document.getElementById('recordsTotal').textContent = `共 ${recordsTotal} 条记录`;
  document.getElementById('pageInfo').textContent = `${page} / ${totalPages}`;
  document.getElementById('prevPage').disabled = page <= 1;
  document.getElementById('nextPage').disabled = page >= totalPages;
}

// 打开编辑弹窗
function openEditModal(expId, expenses) {
  const exp = expenses.find(e => e.id === expId);
  if (!exp) return;
  editingExpenseId = expId;
  merchantUploadedReceiptUrl = exp.receipt_url || null;

  document.getElementById('editDate').value = exp.expense_date;
  document.getElementById('editAmount').value = exp.amount;
  document.getElementById('editNote').value = exp.note || '';
  document.getElementById('editLocation').value = exp.location || '';

  const ttSel = document.getElementById('editTaskType');
  ttSel.innerHTML = `<option value="">无</option>` + allTaskTypes.map(t =>
    `<option value="${t.id}" ${t.id === exp.task_type_id ? 'selected' : ''}>${getIcon(t.icon)} ${t.name}</option>`
  ).join('');

  const catSel = document.getElementById('editCategory');
  catSel.innerHTML = `<option value="">未分类</option>` + allCategories.map(c =>
    `<option value="${c.id}" ${c.id === exp.category_id ? 'selected' : ''}>${getIcon(c.icon)} ${c.name}</option>`
  ).join('');

  if (exp.receipt_url) {
    showMerchantReceiptPreview(exp.receipt_url);
  } else {
    resetMerchantReceiptUpload();
  }

  document.getElementById('editModal').classList.remove('hidden');
}

function resetMerchantReceiptUpload() {
  const placeholder = document.getElementById('editReceiptPlaceholder');
  const preview = document.getElementById('editReceiptPreview');
  if (placeholder) placeholder.classList.remove('hidden');
  if (preview) preview.classList.add('hidden');
  const fileInput = document.getElementById('editReceiptFile');
  if (fileInput) fileInput.value = '';
  merchantUploadedReceiptUrl = null;
}

function showMerchantReceiptPreview(url) {
  const placeholder = document.getElementById('editReceiptPlaceholder');
  const preview = document.getElementById('editReceiptPreview');
  const img = document.getElementById('editReceiptPreviewImg');
  if (placeholder) placeholder.classList.add('hidden');
  if (preview) preview.classList.remove('hidden');
  if (img) img.src = url;
}

async function uploadMerchantReceipt(file) {
  const formData = new FormData();
  formData.append('file', file);
  showToast('上传中...', 'success');
  try {
    const res = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      merchantUploadedReceiptUrl = data.url;
      showMerchantReceiptPreview(data.url);
      showToast('凭证上传成功');
    } else {
      showToast(data.detail || '上传失败', 'error');
    }
  } catch {
    showToast('上传失败，请重试', 'error');
  }
}

async function saveEdit() {
  const date = document.getElementById('editDate').value;
  const amount = parseFloat(document.getElementById('editAmount').value);
  const note = document.getElementById('editNote').value.trim();
  const location = document.getElementById('editLocation').value.trim();
  const categoryId = document.getElementById('editCategory').value;
  const taskTypeId = document.getElementById('editTaskType').value;

  if (!date || !amount || amount <= 0) {
    showToast('请填写完整信息', 'error');
    return;
  }

  const payload = {
    category_id: categoryId ? parseInt(categoryId) : null,
    task_type_id: taskTypeId ? parseInt(taskTypeId) : null,
    amount,
    expense_date: date,
    location: location || null,
    note
  };
  if (merchantUploadedReceiptUrl !== null) {
    payload.receipt_url = merchantUploadedReceiptUrl;
  }

  const res = await fetch(`${API}/api/expenses/${editingExpenseId}?operator=${currentMerchant.eng_name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (data.success) {
    showToast('修改成功');
    document.getElementById('editModal').classList.add('hidden');
    loadRecords(recordsPage);
  } else {
    showToast('修改失败', 'error');
  }
}

async function deleteRecord(expId) {
  if (!confirm('确定删除这条花费记录？')) return;
  const res = await fetch(`${API}/api/expenses/${expId}?operator=${currentMerchant.eng_name}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) {
    showToast('删除成功');
    loadRecords(recordsPage);
  } else {
    showToast('删除失败', 'error');
  }
}

// 加载用户管理
async function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  document.getElementById('userCount').textContent = `共 ${allUsers.length} 位用户`;

  const statusLabels = { 0: '待审核', 1: '已激活', 2: '已拒绝' };
  const statusColors = {
    0: 'bg-amber-500/20 text-amber-400',
    1: 'bg-green-500/20 text-green-400',
    2: 'bg-red-500/20 text-red-400'
  };

  tbody.innerHTML = allUsers.map(u => `
    <tr class="user-row border-b border-white/5 transition-colors">
      <td class="px-4 py-3">
        ${getInlineAvatarHtml(u.eng_name, 'w-9 h-9 rounded-full border border-white/20')}
      </td>
      <td class="px-4 py-3 text-gray-300 text-sm">${u.eng_name}</td>
      <td class="px-4 py-3 text-white font-medium text-sm">${u.chn_name}</td>
      <td class="px-4 py-3 text-gray-400 text-sm">${u.dept_name || '-'}</td>
      <td class="px-4 py-3 text-gray-400 text-sm">${u.phone || '-'}</td>
      <td class="px-4 py-3">
        ${u.is_merchant
          ? '<span class="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-full"><i class="fa-solid fa-store mr-1"></i>商家</span>'
          : '<span class="text-xs bg-gray-500/20 text-gray-400 px-2 py-1 rounded-full"><i class="fa-solid fa-user mr-1"></i>普通用户</span>'}
      </td>
      <td class="px-4 py-3">
        <span class="text-xs px-2 py-1 rounded-full ${statusColors[u.status] || statusColors[1]}">${statusLabels[u.status] ?? '已激活'}</span>
      </td>
      <td class="px-4 py-3 text-gray-500 text-xs">${u.created_at ? u.created_at.slice(0,16) : '-'}</td>
      <td class="px-4 py-3 text-center">
        <div class="flex gap-1 justify-center">
          <button class="toggle-merchant-btn text-xs px-2 py-1 rounded-lg transition-colors ${u.is_merchant ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30'}"
            data-eng="${u.eng_name}" data-is-merchant="${u.is_merchant}">
            ${u.is_merchant ? '撤销商家' : '设为商家'}
          </button>
        </div>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('.toggle-merchant-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const engName = btn.dataset.eng;
      const isMerchant = parseInt(btn.dataset.isMerchant);
      const newVal = isMerchant ? 0 : 1;
      const res = await fetch(`${API}/api/users/${engName}/merchant?is_merchant=${newVal}`, { method: 'PUT' });
      const data = await res.json();
      if (data.success) {
        showToast(newVal ? '已设为商家' : '已撤销商家权限');
        await loadAllUsers();
        loadUsers();
      }
    });
  });
}

// ==================== 权限审核 ====================
async function loadApplyBadge() {
  try {
    const res = await fetch(`${API}/api/users/list?status=0`);
    const data = await res.json();
    const count = data.users?.length || 0;
    const badge = document.getElementById('applyBadge');
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {}
}

async function loadApplyList() {
  const applyList = document.getElementById('applyList');
  const approvedBody = document.getElementById('approvedTableBody');

  // 加载待审核
  try {
    const res = await fetch(`${API}/api/users/list?status=0`);
    const data = await res.json();
    const pending = data.users || [];
    document.getElementById('applyCount').textContent = `${pending.length} 人待审核`;

    if (pending.length === 0) {
      applyList.innerHTML = `<div class="text-center py-8 text-gray-500"><i class="fa-solid fa-check-circle text-green-500 text-3xl mb-2 block"></i>暂无待审核用户</div>`;
    } else {
      applyList.innerHTML = pending.map(u => `
        <div class="glass rounded-xl p-4 flex items-center gap-4 fade-in">
          ${getInlineAvatarHtml(u.eng_name, 'w-12 h-12 rounded-full border-2 border-amber-500/50')}
          <div class="flex-1">
            <p class="font-semibold text-white">${u.chn_name} <span class="text-gray-400 text-sm font-normal">(${u.eng_name})</span></p>
            <p class="text-xs text-gray-400 mt-0.5">${u.dept_name || '未知部门'}</p>
            ${u.phone ? `<p class="text-xs text-amber-400 mt-0.5"><i class="fa-solid fa-phone mr-1"></i>${u.phone}</p>` : ''}
            <p class="text-xs text-gray-500 mt-0.5">申请时间：${u.created_at ? u.created_at.slice(0,16) : '-'}</p>
          </div>
          <div class="flex gap-2">
            <button class="approve-btn bg-green-500/20 text-green-400 hover:bg-green-500/30 px-4 py-2 rounded-xl text-sm font-medium transition-colors" data-eng="${u.eng_name}">
              <i class="fa-solid fa-check mr-1"></i>同意
            </button>
            <button class="reject-btn bg-red-500/20 text-red-400 hover:bg-red-500/30 px-4 py-2 rounded-xl text-sm font-medium transition-colors" data-eng="${u.eng_name}">
              <i class="fa-solid fa-xmark mr-1"></i>拒绝
            </button>
          </div>
        </div>`).join('');

      applyList.querySelectorAll('.approve-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const res = await fetch(`${API}/api/users/${btn.dataset.eng}/status?status=1`, { method: 'PUT' });
          const data = await res.json();
          if (data.success) {
            showToast('已同意申请');
            await loadAllUsers();
            loadApplyList();
            loadApplyBadge();
          }
        });
      });

      applyList.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const res = await fetch(`${API}/api/users/${btn.dataset.eng}/status?status=2`, { method: 'PUT' });
          const data = await res.json();
          if (data.success) {
            showToast('已拒绝申请');
            await loadAllUsers();
            loadApplyList();
            loadApplyBadge();
          }
        });
      });
    }
  } catch (e) {
    applyList.innerHTML = `<div class="text-center py-4 text-gray-500">加载失败</div>`;
  }

  // 加载已审核（status=1 或 status=2）
  try {
    const res = await fetch(`${API}/api/users/list`);
    const data = await res.json();
    const approved = (data.users || []).filter(u => u.status === 1 || u.status === 2);
    const statusLabels = { 1: '已激活', 2: '已拒绝' };
    const statusColors = { 1: 'bg-green-500/20 text-green-400', 2: 'bg-red-500/20 text-red-400' };

    approvedBody.innerHTML = approved.map(u => `
      <tr class="border-b border-white/5">
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            ${getInlineAvatarHtml(u.eng_name, 'w-8 h-8 rounded-full border border-white/20')}
            <div>
              <p class="text-white text-xs font-medium">${u.chn_name}</p>
              <p class="text-gray-500 text-xs">${u.eng_name}</p>
            </div>
          </div>
        </td>
        <td class="px-4 py-3 text-gray-400 text-xs">${u.phone || '-'}</td>
        <td class="px-4 py-3">
          <span class="text-xs px-2 py-1 rounded-full ${statusColors[u.status] || ''}">${statusLabels[u.status] || '-'}</span>
        </td>
        <td class="px-4 py-3 text-gray-500 text-xs">${u.created_at ? u.created_at.slice(0,16) : '-'}</td>
        <td class="px-4 py-3 text-center">
          ${u.status === 2 ? `<button class="re-approve-btn text-xs px-3 py-1 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors" data-eng="${u.eng_name}">重新激活</button>` : ''}
          ${u.status === 1 ? `<button class="revoke-btn text-xs px-3 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors" data-eng="${u.eng_name}">撤销权限</button>` : ''}
        </td>
      </tr>`).join('');

    approvedBody.querySelectorAll('.re-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`${API}/api/users/${btn.dataset.eng}/status?status=1`, { method: 'PUT' });
        showToast('已重新激活');
        loadApplyList();
      });
    });
    approvedBody.querySelectorAll('.revoke-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch(`${API}/api/users/${btn.dataset.eng}/status?status=2`, { method: 'PUT' });
        showToast('已撤销权限');
        loadApplyList();
      });
    });
  } catch {}
}

// Tab 切换
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('tab-active');
        b.classList.add('text-gray-400');
        b.classList.remove('text-white');
      });
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('tab-active');
      btn.classList.remove('text-gray-400');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.remove('hidden');

      if (tab === 'users') loadUsers();
      if (tab === 'apply') loadApplyList();
    });
  });
}

function initEvents() {
  // 登录事件
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });

  document.getElementById('overviewSearchBtn').addEventListener('click', loadOverview);
  document.getElementById('recordsSearchBtn').addEventListener('click', () => loadRecords(1));

  document.getElementById('prevPage').addEventListener('click', () => {
    if (recordsPage > 1) loadRecords(recordsPage - 1);
  });
  document.getElementById('nextPage').addEventListener('click', () => {
    const totalPages = Math.ceil(recordsTotal / PAGE_SIZE);
    if (recordsPage < totalPages) loadRecords(recordsPage + 1);
  });

  document.getElementById('closeEditModal').addEventListener('click', () => document.getElementById('editModal').classList.add('hidden'));
  document.getElementById('cancelEditModal').addEventListener('click', () => document.getElementById('editModal').classList.add('hidden'));
  document.getElementById('saveEditBtn').addEventListener('click', saveEdit);

  document.getElementById('editModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('editModal')) {
      document.getElementById('editModal').classList.add('hidden');
    }
  });

  // 商家端凭证上传
  const editUploadArea = document.getElementById('editReceiptUploadArea');
  const editFileInput = document.getElementById('editReceiptFile');
  if (editUploadArea && editFileInput) {
    editUploadArea.addEventListener('click', () => editFileInput.click());
    editFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) uploadMerchantReceipt(file);
    });
    editUploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      editUploadArea.classList.add('border-indigo-400');
    });
    editUploadArea.addEventListener('dragleave', () => {
      editUploadArea.classList.remove('border-indigo-400');
    });
    editUploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      editUploadArea.classList.remove('border-indigo-400');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) uploadMerchantReceipt(file);
      else showToast('请上传图片文件', 'error');
    });
  }

  // 多选下拉开关
  const trigger = document.getElementById('overviewUserTrigger');
  const options = document.getElementById('overviewUserOptions');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    options.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    options.classList.add('hidden');
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
        <button id="receiptZoomClose" class="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white/20 text-white shadow-lg flex items-center justify-center hover:bg-white/30 transition-colors">
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

async function init() {
  initTabs();
  initEvents();
  initReceiptZoom();
  await initMerchant();
}

init();