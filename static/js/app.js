/* app.js — Main list page logic */

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  page: 1,
  perPage: 50,
  total: 0,
  sortBy: 'date',
  sortDir: 'desc',
  filters: {},
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function fmt_money(val) {
  if (val === null || val === undefined) return '';
  return '$' + parseFloat(val).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmt_date(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
}

function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.style.display = 'block';
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 260); }, 2800);
}

function cardClass(type) {
  const map = { Visa: 'card-visa', Mastercard: 'card-mastercard', Discover: 'card-discover', Amex: 'card-amex', Debit: 'card-debit' };
  return map[type] || 'card-unknown';
}

function cardIcon(type) {
  const icons = { Visa: '💳', Mastercard: '🔴', Discover: '🟠', Amex: '🟢', Debit: '🏦' };
  return icons[type] || '💳';
}

function badgeClass(cat) {
  return 'badge badge-' + (cat || 'Other').replace(/\s+/g, '-');
}

function buildQueryString(extra = {}) {
  const params = new URLSearchParams();
  if (state.filters.search)    params.set('search',    state.filters.search);
  if (state.filters.card)      params.set('card',      state.filters.card);
  if (state.filters.category)  params.set('category',  state.filters.category);
  if (state.filters.date_from) params.set('date_from', state.filters.date_from);
  if (state.filters.date_to)   params.set('date_to',   state.filters.date_to);
  params.set('sort_by',  state.sortBy);
  params.set('sort_dir', state.sortDir);
  params.set('page',     state.page);
  params.set('per_page', state.perPage);
  Object.entries(extra).forEach(([k, v]) => params.set(k, v));
  return params.toString();
}

// ── API ──────────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadStats() {
  const s = await fetchJSON('/api/stats');
  $('stat-total').textContent  = s.total_receipts;
  $('stat-spend').textContent  = fmt_money(s.total_spend);
  $('stat-vendors').textContent = s.vendors;
  $('stat-cards').textContent  = s.cards_on_file;
}

async function loadCards() {
  const cards = await fetchJSON('/api/cards');
  const sel = $('filter-card');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Cards</option>';
  cards.forEach(c => {
    const label = c.card_type ? `${c.card_type} -${c.card_last4}` : `•••• ${c.card_last4}`;
    const opt = document.createElement('option');
    opt.value = c.card_last4;
    opt.textContent = `${label} (${c.receipt_count})`;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

async function loadCategories() {
  const cats = await fetchJSON('/api/categories');
  const sel = $('filter-category');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

async function loadReceipts() {
  const tbody = $('receipts-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="8"><div class="spinner"></div></td></tr>';

  const data = await fetchJSON(`/api/receipts?${buildQueryString()}`);
  state.total = data.total;
  renderReceipts(data.receipts);
  renderPagination();
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderReceipts(rows) {
  const tbody = $('receipts-tbody');
  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-state-icon">🧾</div>
          <div class="empty-state-title">No receipts found</div>
          <div class="empty-state-sub">Try adjusting filters or scan a folder to import receipts.</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    // Thumbnail
    const thumb = r.thumbnail_path
      ? `<img class="receipt-thumb" src="/receipts/thumbnails/${encodeURIComponent(r.filename.replace(/\.[^.]+$/, '.jpg'))}" alt="receipt" loading="lazy" />`
      : `<div class="thumb-placeholder">🧾</div>`;

    // Amount
    const amt = r.total_amount !== null
      ? `<span class="amount-cell">${fmt_money(r.total_amount)}</span>`
      : `<span class="amount-missing">—</span>`;

    // Card chip
    let cardHtml = '<span class="text-light">—</span>';
    if (r.card_last4) {
      const cls = cardClass(r.card_type);
      const icon = cardIcon(r.card_type);
      const label = r.card_type ? `${r.card_type} -${r.card_last4}` : `•••• ${r.card_last4}`;
      cardHtml = `<span class="card-chip ${cls}"><span class="card-chip-icon">${icon}</span>${label}</span>`;
    }

    // Category badge
    const catHtml = r.category
      ? `<span class="${badgeClass(r.category)}">${r.category}</span>`
      : '<span class="text-light">—</span>';

    // Items preview
    const items = r.items_preview
      ? `<span class="items-preview" title="${r.items_preview}">${r.items_preview}</span>`
      : '<span class="text-light">—</span>';

    return `
      <tr data-id="${r.id}" class="receipt-row">
        <td>${thumb}</td>
        <td>
          <div class="vendor-name">${escHtml(r.vendor_name || 'Unknown Vendor')}</div>
          <div class="vendor-preview">${escHtml(r.items_preview || '')}</div>
        </td>
        <td>${fmt_date(r.date)}</td>
        <td>${amt}</td>
        <td>${cardHtml}</td>
        <td>${catHtml}</td>
        <td>${items}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn edit-btn" data-id="${r.id}" title="Edit">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
            </button>
            <button class="action-btn danger delete-btn" data-id="${r.id}" title="Delete">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm0 2h2l.5 1H8.5L9 4zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function renderPagination() {
  const pg = $('pagination');
  const totalPages = Math.ceil(state.total / state.perPage);
  if (totalPages <= 1) { pg.innerHTML = ''; return; }

  let html = `<span>${state.total} receipts</span>`;
  html += `<button class="page-btn" ${state.page === 1 ? 'disabled' : ''} data-page="${state.page - 1}">‹ Prev</button>`;

  const range = [];
  for (let i = Math.max(1, state.page - 2); i <= Math.min(totalPages, state.page + 2); i++) range.push(i);
  range.forEach(p => {
    html += `<button class="page-btn ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
  });

  html += `<button class="page-btn" ${state.page === totalPages ? 'disabled' : ''} data-page="${state.page + 1}">Next ›</button>`;
  pg.innerHTML = html;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Status polling ────────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const s = await fetchJSON('/api/status');
    const dot = $('watch-status').querySelector('.dot');
    const label = $('watch-label');
    if (s.watching) {
      dot.className = s.processing ? 'dot dot-yellow' : 'dot dot-green';
      label.textContent = s.processing ? 'Processing…' : 'Watching for new photos';
    } else {
      dot.className = 'dot dot-gray';
      label.textContent = 'Watcher offline';
    }
    if (s.processing) {
      // Refresh receipts after processing completes
      setTimeout(() => { loadReceipts(); loadStats(); }, 3000);
    }
  } catch { /* ignore */ }
}

// ── Event wiring ─────────────────────────────────────────────────────────────
function wireEvents() {
  // Row click → detail page
  $('receipts-tbody').addEventListener('click', e => {
    const editBtn = e.target.closest('.edit-btn');
    const delBtn  = e.target.closest('.delete-btn');
    const row     = e.target.closest('.receipt-row');

    if (editBtn) {
      e.stopPropagation();
      window.location.href = `/receipt/${editBtn.dataset.id}`;
      return;
    }
    if (delBtn) {
      e.stopPropagation();
      deleteReceipt(parseInt(delBtn.dataset.id));
      return;
    }
    if (row) {
      window.location.href = `/receipt/${row.dataset.id}`;
    }
  });

  // Filters
  let searchTimer;
  $('filter-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      state.page = 1;
      loadReceipts();
    }, 350);
  });

  $('filter-card').addEventListener('change', e => {
    state.filters.card = e.target.value;
    state.page = 1;
    loadReceipts();
  });

  $('filter-category').addEventListener('change', e => {
    state.filters.category = e.target.value;
    state.page = 1;
    loadReceipts();
  });

  $('filter-date-from').addEventListener('change', e => {
    state.filters.date_from = e.target.value;
    state.page = 1;
    loadReceipts();
  });

  $('filter-date-to').addEventListener('change', e => {
    state.filters.date_to = e.target.value;
    state.page = 1;
    loadReceipts();
  });

  $('btn-clear-filters').addEventListener('click', () => {
    state.filters = {};
    state.page = 1;
    $('filter-search').value = '';
    $('filter-card').value = '';
    $('filter-category').value = '';
    $('filter-date-from').value = '';
    $('filter-date-to').value = '';
    loadReceipts();
  });

  // Sort toggle
  $('sort-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.sort-btn');
    if (!btn) return;
    const newSort = btn.dataset.sort;
    if (newSort === state.sortBy) {
      state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      state.sortBy = newSort;
      state.sortDir = 'desc';
    }
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === state.sortBy));
    state.page = 1;
    loadReceipts();
  });

  // Pagination
  $('pagination').addEventListener('click', e => {
    const btn = e.target.closest('.page-btn');
    if (!btn || btn.disabled) return;
    state.page = parseInt(btn.dataset.page);
    loadReceipts();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Scan Now
  $('btn-scan').addEventListener('click', async () => {
    const btn = $('btn-scan');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px"></div> Scanning…';
    try {
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Scan started — new receipts will appear shortly.', 'success');
      // Poll for results over the next 30 seconds
      let polls = 0;
      const pollId = setInterval(async () => {
        polls++;
        await Promise.all([loadReceipts(), loadStats(), loadCards()]);
        if (polls >= 6) clearInterval(pollId);
      }, 5000);
    } catch (err) {
      showToast('Scan failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  });

  // Export menu toggle
  $('btn-export-toggle').addEventListener('click', e => {
    e.stopPropagation();
    const menu = $('export-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', () => { $('export-menu').style.display = 'none'; });

  document.querySelectorAll('.export-item').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const fmt = a.dataset.fmt;
      const qs = buildQueryString();
      window.location.href = `/api/export/${fmt}?${qs}`;
      $('export-menu').style.display = 'none';
    });
  });

  // Change folder modal
  $('btn-change-folder').addEventListener('click', () => {
    $('folder-modal').style.display = 'flex';
    $('folder-input').focus();
  });
  $('btn-folder-cancel').addEventListener('click', () => {
    $('folder-modal').style.display = 'none';
    $('folder-error').style.display = 'none';
  });
  $('btn-folder-save').addEventListener('click', async () => {
    const folder = $('folder-input').value.trim();
    if (!folder) return;
    try {
      const res = await fetch('/api/watch-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      });
      const data = await res.json();
      if (!res.ok) {
        $('folder-error').textContent = data.error || 'Failed to set folder';
        $('folder-error').style.display = 'block';
        return;
      }
      $('folder-modal').style.display = 'none';
      showToast('Watch folder updated.', 'success');
    } catch {
      $('folder-error').textContent = 'Request failed.';
      $('folder-error').style.display = 'block';
    }
  });
}

async function deleteReceipt(id) {
  if (!confirm('Delete this receipt? This cannot be undone.')) return;
  const res = await fetch(`/api/receipts/${id}`, { method: 'DELETE' });
  if (res.ok) {
    showToast('Receipt deleted.', 'success');
    loadReceipts();
    loadStats();
    loadCards();
  } else {
    showToast('Delete failed.', 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  wireEvents();
  await Promise.all([loadStats(), loadCards(), loadCategories()]);
  await loadReceipts();
  // Poll status every 8 seconds
  pollStatus();
  setInterval(pollStatus, 8000);
}

init();
