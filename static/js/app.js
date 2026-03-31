/* app.js — Main list page logic */

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  page: 1,
  perPage: 50,
  total: 0,
  sortBy: 'date',
  sortDir: 'desc',
  filters: {},
  scrollY: 0,
};

// ── Selection state ───────────────────────────────────────────────────────────
let selectedIds = new Set();

// ── Multi-select filter state ─────────────────────────────────────────────────
let selectedCards   = new Set();   // card_last4 values
let selectedVendors = new Set();   // vendor name strings
let allCards   = [];               // [{card_last4, card_type, receipt_count}]
let allVendors = [];               // [{vendor_name, receipt_count}]

// ── Folder state ──────────────────────────────────────────────────────────────
let allFolders = [];          // flat list from API
let activeFolderId = null;    // currently selected folder (null = All)
let tagPickerReceiptId = null;// which receipt the tag picker is open for
let folderModalMode = null;   // 'create' | 'rename'
let folderModalParentId = null;
let folderModalEditId = null;
let selectedColor = '#6366f1';

const FOLDER_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#ef4444',
  '#f97316','#f59e0b','#10b981','#14b8a6',
  '#0ea5e9','#3b82f6','#6b7280',
];

// ── URL state persistence ────────────────────────────────────────────────────
function saveStateToURL() {
  const s = {};
  if (state.page > 1)                s.page = state.page;
  if (state.sortBy !== 'date')       s.sort = state.sortBy;
  if (state.sortDir !== 'desc')      s.dir = state.sortDir;
  if (state.filters.search)          s.q = state.filters.search;
  if (selectedCards.size)            s.cards = [...selectedCards].join('|');
  if (selectedVendors.size)          s.vendors = [...selectedVendors].join('|');
  if (state.filters.category)        s.cat = state.filters.category;
  if (state.filters.date_from)       s.from = state.filters.date_from;
  if (state.filters.date_to)         s.to = state.filters.date_to;
  if (state.filters.show_hidden)     s.hidden = '1';
  if (state.filters.missing)         s.missing = state.filters.missing;
  if (activeFolderId)                s.folder = activeFolderId;
  const hash = new URLSearchParams(s).toString();
  history.replaceState(null, '', hash ? '#' + hash : location.pathname);
}

function loadStateFromURL() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return;
  const p = new URLSearchParams(hash);
  if (p.get('page'))    state.page = parseInt(p.get('page')) || 1;
  if (p.get('sort'))    state.sortBy = p.get('sort');
  if (p.get('dir'))     state.sortDir = p.get('dir');
  if (p.get('q'))       state.filters.search = p.get('q');
  if (p.get('cards'))   p.get('cards').split('|').filter(Boolean).forEach(v => selectedCards.add(v));
  if (p.get('vendors')) p.get('vendors').split('|').filter(Boolean).forEach(v => selectedVendors.add(v));
  if (p.get('cat'))     state.filters.category = p.get('cat');
  if (p.get('from'))    state.filters.date_from = p.get('from');
  if (p.get('to'))      state.filters.date_to = p.get('to');
  if (p.get('hidden'))  state.filters.show_hidden = true;
  if (p.get('missing')) state.filters.missing = p.get('missing');
  if (p.get('folder'))  activeFolderId = parseInt(p.get('folder'));
}

function restoreFiltersToUI() {
  if (state.filters.search)      $('filter-search').value = state.filters.search;
  if (state.filters.category)    $('filter-category').value = state.filters.category;
  if (state.filters.date_from)   $('filter-date-from').value = state.filters.date_from;
  if (state.filters.date_to)     $('filter-date-to').value = state.filters.date_to;
  if (state.filters.show_hidden) $('filter-show-hidden').checked = true;
  if (state.filters.missing)     $('filter-missing').value = state.filters.missing;
  // Multi-selects restore via updateCardTrigger/updateVendorTrigger called after data loads
  document.querySelectorAll('.sort-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === state.sortBy)
  );
  // Highlight active folder in sidebar (activeFolderId restored from URL)
  if (activeFolderId !== null) {
    renderFolderTree();
  }
}

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
  if (state.filters.search)      params.set('search',      state.filters.search);
  if (selectedCards.size)        params.set('cards',       [...selectedCards].join('|'));
  if (selectedVendors.size)      params.set('vendors',     [...selectedVendors].join('|'));
  if (state.filters.category)    params.set('category',    state.filters.category);
  if (state.filters.date_from)   params.set('date_from',   state.filters.date_from);
  if (state.filters.date_to)     params.set('date_to',     state.filters.date_to);
  if (state.filters.show_hidden) params.set('show_hidden', '1');
  if (state.filters.missing)     params.set('missing',     state.filters.missing);
  if (activeFolderId)            params.set('folder_id',   activeFolderId);
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
  // Build filter params so the stat bar reflects the active filter
  const params = new URLSearchParams();
  if (state.filters.search)      params.set('search',      state.filters.search);
  if (selectedCards.size)        params.set('cards',       [...selectedCards].join('|'));
  if (selectedVendors.size)      params.set('vendors',     [...selectedVendors].join('|'));
  if (state.filters.category)    params.set('category',    state.filters.category);
  if (state.filters.date_from)   params.set('date_from',   state.filters.date_from);
  if (state.filters.date_to)     params.set('date_to',     state.filters.date_to);
  if (state.filters.show_hidden) params.set('show_hidden', '1');
  if (state.filters.missing)     params.set('missing',     state.filters.missing);
  if (activeFolderId)            params.set('folder_id',   activeFolderId);

  const qs = params.toString();
  const s = await fetchJSON('/api/stats' + (qs ? '?' + qs : ''));

  $('stat-total').textContent   = s.total_receipts;
  $('stat-spend').textContent   = fmt_money(s.total_spend);
  $('stat-vendors').textContent = s.vendors;
  $('stat-cards').textContent   = s.cards_on_file;

  // Sidebar "All Receipts" count always shows the global unfiltered total
  if (!qs) {
    $('sidebar-all-count').textContent = s.total_receipts || '';
  } else {
    // Fetch global count separately so sidebar stays accurate
    fetchJSON('/api/stats').then(g => {
      $('sidebar-all-count').textContent = g.total_receipts || '';
    });
  }
}

async function loadCards() {
  allCards = await fetchJSON('/api/cards');
  renderCardMultiSelect();
}

async function loadVendors() {
  allVendors = await fetchJSON('/api/vendors');
  renderVendorMultiSelect();
}

// ── Multi-select rendering ────────────────────────────────────────────────────
function renderCardMultiSelect() {
  const list = $('ms-card-list');
  if (!allCards.length) {
    list.innerHTML = '<div class="ms-empty">No cards found yet.</div>';
    return;
  }

  // Group by card_last4 to detect duplicates (shown with a ⚠ indicator)
  const byLast4 = {};
  allCards.forEach(c => {
    if (!byLast4[c.card_last4]) byLast4[c.card_last4] = [];
    byLast4[c.card_last4].push(c);
  });

  list.innerHTML = Object.entries(byLast4).map(([last4, entries]) => {
    const isSelected = selectedCards.has(last4);
    const totalCount = entries.reduce((s, e) => s + e.receipt_count, 0);
    const isDupe = entries.length > 1;
    const label = entries[0].card_type
      ? `${entries[0].card_type} ••••${last4}`
      : `••••${last4}`;
    return `
      <label class="ms-item">
        <input type="checkbox" value="${last4}" ${isSelected ? 'checked' : ''} />
        <span class="ms-item-label">${escHtml(label)}${isDupe ? ' ⚠' : ''}</span>
        <span class="ms-item-count">${totalCount}</span>
      </label>`;
  }).join('');

  updateCardTrigger();
  // Wire checkbox events
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCards.add(cb.value);
      else selectedCards.delete(cb.value);
      updateCardTrigger();
      state.page = 1;
      clearSelection();
      loadReceipts();
    });
  });
}

function updateCardTrigger() {
  const btn = $('ms-card-trigger');
  if (selectedCards.size === 0) {
    btn.textContent = 'All Cards ▾';
    btn.classList.remove('has-selection');
  } else {
    btn.textContent = `${selectedCards.size} card${selectedCards.size > 1 ? 's' : ''} ▾`;
    btn.classList.add('has-selection');
  }
}

function renderVendorMultiSelect(filter = '') {
  const list = $('ms-vendor-list');
  const filtered = filter
    ? allVendors.filter(v => v.vendor_name.toLowerCase().includes(filter.toLowerCase()))
    : allVendors;

  if (!filtered.length) {
    list.innerHTML = '<div class="ms-empty">No vendors found.</div>';
    return;
  }

  list.innerHTML = filtered.slice(0, 100).map(v => {
    const isSelected = selectedVendors.has(v.vendor_name);
    return `
      <label class="ms-item">
        <input type="checkbox" value="${escHtml(v.vendor_name)}" ${isSelected ? 'checked' : ''} />
        <span class="ms-item-label">${escHtml(v.vendor_name)}</span>
        <span class="ms-item-count">${v.receipt_count}</span>
      </label>`;
  }).join('');

  updateVendorTrigger();
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedVendors.add(cb.value);
      else selectedVendors.delete(cb.value);
      updateVendorTrigger();
      state.page = 1;
      clearSelection();
      loadReceipts();
    });
  });
}

function updateVendorTrigger() {
  const btn = $('ms-vendor-trigger');
  if (selectedVendors.size === 0) {
    btn.textContent = 'All Vendors ▾';
    btn.classList.remove('has-selection');
  } else {
    btn.textContent = `${selectedVendors.size} vendor${selectedVendors.size > 1 ? 's' : ''} ▾`;
    btn.classList.add('has-selection');
  }
}

// ── Card Manager ──────────────────────────────────────────────────────────────
async function openCardManager() {
  $('ms-card-popover').style.display = 'none';
  const cards = await fetchJSON('/api/cards');

  // Group by last4
  const byLast4 = {};
  cards.forEach(c => {
    if (!byLast4[c.card_last4]) byLast4[c.card_last4] = [];
    byLast4[c.card_last4].push(c);
  });

  const CARD_TYPES = ['Visa', 'Mastercard', 'Discover', 'Amex', 'Debit'];

  const html = Object.entries(byLast4).map(([last4, entries]) => {
    const isConflict = entries.length > 1 || !entries[0].card_type;
    const totalCount = entries.reduce((s, e) => s + e.receipt_count, 0);
    const typeBadges = entries.map(e =>
      `<span class="card-manager-type-badge">${escHtml(e.card_type || 'Unknown')} (${e.receipt_count})</span>`
    ).join('');

    const typeOptions = CARD_TYPES.map(t =>
      `<option value="${t}" ${entries[0].card_type === t ? 'selected' : ''}>${t}</option>`
    ).join('');

    return `
      <div class="card-manager-row${isConflict ? ' card-conflict' : ''}" data-last4="${last4}">
        <div class="card-manager-last4">••••${last4}</div>
        <div class="card-manager-types">
          ${typeBadges}
          ${isConflict ? '<br><span class="card-conflict-label">⚠ conflict</span>' : ''}
        </div>
        <div class="card-manager-actions">
          <select class="filter-select card-type-sel" style="height:28px;font-size:12px;min-width:110px" data-last4="${last4}">
            ${typeOptions}
          </select>
          <button class="btn btn-primary btn-sm card-merge-btn" data-last4="${last4}">Apply to all</button>
        </div>
      </div>`;
  }).join('');

  $('card-manager-list').innerHTML = html || '<div style="color:var(--text-muted);padding:20px 0">No cards found.</div>';
  $('card-manager-modal').style.display = 'flex';
}

async function loadCategories() {
  const cats = await fetchJSON('/api/categories');

  // Filter dropdown
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

  // Bulk category select (selection bar)
  const bulkSel = $('bulk-category-select');
  bulkSel.innerHTML = '<option value="">Set category…</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    bulkSel.appendChild(opt);
  });
}

async function loadReceipts() {
  const tbody = $('receipts-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="9"><div class="spinner"></div></td></tr>';

  const data = await fetchJSON(`/api/receipts?${buildQueryString()}`);
  state.total = data.total;
  renderReceipts(data.receipts);
  renderPagination();
  updateBulkTagBar();
  saveStateToURL();
  loadStats(); // refresh stat bar to reflect current filter
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderReceipts(rows) {
  const tbody = $('receipts-tbody');
  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <div class="empty-state-icon">🧾</div>
          <div class="empty-state-title">No receipts found</div>
          <div class="empty-state-sub">Try adjusting filters or scan a folder to import receipts.</div>
        </div>
      </td></tr>`;
    updateSelectionBar();
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

    const isHidden = r.status === 'hidden';

    return `
      <tr data-id="${r.id}" class="receipt-row${isHidden ? ' row-hidden' : ''}">
        <td class="col-check" onclick="event.stopPropagation()">
          <input type="checkbox" class="row-check" data-id="${r.id}" ${selectedIds.has(r.id) ? 'checked' : ''} />
        </td>
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
            ${isHidden
              ? `<button class="action-btn unhide-btn" data-id="${r.id}" title="Unhide">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
                </button>`
              : `<button class="action-btn hide-btn" data-id="${r.id}" title="Hide">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clip-rule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>
                </button>`
            }
            <button class="action-btn tag-btn" data-id="${r.id}" title="Folders">
              <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>
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
      setTimeout(() => { loadReceipts(); loadStats(); loadReviewQueue(); }, 3000);
    }
  } catch { /* ignore */ }
}

// ── Event wiring ─────────────────────────────────────────────────────────────
function wireEvents() {
  // Row click → detail page
  $('receipts-tbody').addEventListener('click', e => {
    const checkBox  = e.target.closest('.row-check');
    const editBtn   = e.target.closest('.edit-btn');
    const hideBtn   = e.target.closest('.hide-btn');
    const unhideBtn = e.target.closest('.unhide-btn');
    const tagBtn    = e.target.closest('.tag-btn');
    const delBtn    = e.target.closest('.delete-btn');
    const row       = e.target.closest('.receipt-row');

    if (checkBox) {
      e.stopPropagation();
      const id = parseInt(checkBox.dataset.id);
      if (checkBox.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateSelectionBar();
      return;
    }

    if (editBtn) {
      e.stopPropagation();
      sessionStorage.setItem('lastViewedReceipt', editBtn.dataset.id);
      window.location.href = `/receipt/${editBtn.dataset.id}`;
      return;
    }
    if (hideBtn) {
      e.stopPropagation();
      hideReceipt(parseInt(hideBtn.dataset.id), hideBtn.closest('.receipt-row'));
      return;
    }
    if (unhideBtn) {
      e.stopPropagation();
      unhideReceipt(parseInt(unhideBtn.dataset.id), unhideBtn.closest('.receipt-row'));
      return;
    }
    if (tagBtn) {
      e.stopPropagation();
      openTagPicker(parseInt(tagBtn.dataset.id), tagBtn);
      return;
    }
    if (delBtn) {
      e.stopPropagation();
      deleteReceipt(parseInt(delBtn.dataset.id));
      return;
    }
    if (row) {
      sessionStorage.setItem('lastViewedReceipt', row.dataset.id);
      window.location.href = `/receipt/${row.dataset.id}`;
    }
  });

  // Filters
  let searchTimer;
  $('filter-search').addEventListener('input', e => {
    // Save to state immediately so URL is current even if user clicks fast
    state.filters.search = e.target.value.trim();
    state.page = 1;
    clearSelection();
    saveStateToURL();
    // Debounce the actual fetch
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      loadReceipts();
    }, 350);
  });

  // ── Card multi-select toggle ─────────────────────────────────────────────
  $('ms-card-trigger').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('ms-card-popover');
    const isOpen = pop.style.display !== 'none';
    closeAllMultiSelects();
    if (!isOpen) { pop.style.display = 'block'; $('ms-card-trigger').classList.add('active'); }
  });

  // ── Vendor multi-select toggle ────────────────────────────────────────────
  $('ms-vendor-trigger').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('ms-vendor-popover');
    const isOpen = pop.style.display !== 'none';
    closeAllMultiSelects();
    if (!isOpen) {
      pop.style.display = 'block';
      $('ms-vendor-trigger').classList.add('active');
      $('ms-vendor-search').focus();
    }
  });

  $('ms-vendor-search').addEventListener('input', e => {
    renderVendorMultiSelect(e.target.value);
  });

  $('btn-vendor-clear').addEventListener('click', () => {
    selectedVendors.clear();
    renderVendorMultiSelect($('ms-vendor-search').value);
    state.page = 1; clearSelection(); loadReceipts();
  });

  // ── Card manager ──────────────────────────────────────────────────────────
  $('btn-manage-cards').addEventListener('click', openCardManager);
  $('btn-card-manager-close').addEventListener('click', () => {
    $('card-manager-modal').style.display = 'none';
    loadCards(); // refresh multi-select after potential merges
    clearSelection(); loadReceipts(); loadStats();
  });

  $('card-manager-list').addEventListener('click', async e => {
    const btn = e.target.closest('.card-merge-btn');
    if (!btn) return;
    const last4 = btn.dataset.last4;
    const row = btn.closest('.card-manager-row');
    const cardType = row.querySelector('.card-type-sel').value;
    btn.disabled = true; btn.textContent = '…';
    const res = await fetch('/api/cards/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_last4: last4, card_type: cardType }),
    });
    const data = await res.json();
    btn.disabled = false; btn.textContent = 'Apply to all';
    showToast(`Updated ${data.updated} receipt${data.updated !== 1 ? 's' : ''} to ${cardType}.`, 'success');
    // Refresh the card manager view
    openCardManager();
  });

  // Close multi-selects on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.ms-wrap')) closeAllMultiSelects();
  });

  $('filter-category').addEventListener('change', e => {
    state.filters.category = e.target.value;
    state.page = 1;
    clearSelection();
    loadReceipts();
  });

  $('filter-date-from').addEventListener('change', e => {
    state.filters.date_from = e.target.value;
    state.page = 1;
    clearSelection();
    loadReceipts();
  });

  $('filter-date-to').addEventListener('change', e => {
    state.filters.date_to = e.target.value;
    state.page = 1;
    clearSelection();
    loadReceipts();
  });

  $('filter-show-hidden').addEventListener('change', e => {
    state.filters.show_hidden = e.target.checked;
    state.page = 1;
    clearSelection();
    loadReceipts();
  });

  $('filter-missing').addEventListener('change', e => {
    state.filters.missing = e.target.value;
    state.page = 1;
    clearSelection();
    loadReceipts();
  });

  $('btn-clear-filters').addEventListener('click', () => {
    state.filters = {};
    state.page = 1;
    selectedCards.clear();
    selectedVendors.clear();
    updateCardTrigger();
    updateVendorTrigger();
    $('filter-search').value = '';
    $('filter-category').value = '';
    $('filter-date-from').value = '';
    $('filter-date-to').value = '';
    $('filter-show-hidden').checked = false;
    $('filter-missing').value = '';
    clearSelection();
    loadReceipts();
  });

  // Select-all checkbox
  $('select-all-check').addEventListener('change', e => {
    document.querySelectorAll('.row-check').forEach(c => {
      const id = parseInt(c.dataset.id);
      if (e.target.checked) { selectedIds.add(id); c.checked = true; }
      else { selectedIds.delete(id); c.checked = false; }
    });
    updateSelectionBar();
  });

  // Deselect all
  $('btn-deselect-all').addEventListener('click', clearSelection);

  // Bulk category apply
  $('btn-bulk-category').addEventListener('click', async () => {
    const cat = $('bulk-category-select').value;
    if (!cat) { showToast('Select a category first.', ''); return; }
    if (!selectedIds.size) return;
    const btn = $('btn-bulk-category');
    btn.disabled = true; btn.textContent = 'Applying…';
    await fetch('/api/receipts/bulk-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds], data: { category: cat } }),
    });
    btn.disabled = false; btn.textContent = 'Apply';
    showToast(`Category set on ${selectedIds.size} receipt${selectedIds.size !== 1 ? 's' : ''}.`, 'success');
    clearSelection();
    loadReceipts();
    loadStats();
  });

  // Bulk folder apply (from selection)
  $('btn-bulk-folder-sel').addEventListener('click', async () => {
    const fid = $('bulk-folder-select-sel').value;
    if (!fid) { showToast('Select a folder first.', ''); return; }
    if (!selectedIds.size) return;
    const btn = $('btn-bulk-folder-sel');
    btn.disabled = true; btn.textContent = 'Tagging…';
    await fetch('/api/receipts/bulk-tag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds], folder_id: parseInt(fid) }),
    });
    btn.disabled = false; btn.textContent = 'Apply';
    showToast(`Tagged ${selectedIds.size} receipt${selectedIds.size !== 1 ? 's' : ''}.`, 'success');
    await loadFolders();
    clearSelection();
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

async function hideReceipt(id, rowEl) {
  const res = await fetch(`/api/receipts/${id}/hide`, { method: 'POST' });
  if (res.ok) {
    // Animate row out
    if (rowEl) {
      rowEl.style.transition = 'opacity .25s, transform .25s';
      rowEl.style.opacity = '0';
      rowEl.style.transform = 'translateX(20px)';
      setTimeout(() => { rowEl.remove(); loadStats(); }, 280);
    } else {
      loadReceipts();
      loadStats();
    }
    showToast('Receipt hidden.', 'success');
  } else {
    showToast('Hide failed.', 'error');
  }
}

async function unhideReceipt(id, rowEl) {
  const res = await fetch(`/api/receipts/${id}/unhide`, { method: 'POST' });
  if (res.ok) {
    showToast('Receipt restored.', 'success');
    loadReceipts();
    loadStats();
  } else {
    showToast('Unhide failed.', 'error');
  }
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

// ── Folders ───────────────────────────────────────────────────────────────────
async function loadFolders() {
  allFolders = await fetchJSON('/api/folders');
  renderFolderTree();
  renderBulkTagSelect();
  renderBulkFolderSelSelect();
}

function renderBulkFolderSelSelect() {
  const sel = $('bulk-folder-select-sel');
  sel.innerHTML = '<option value="">Add to folder…</option>';
  allFolders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
}

function buildTree(folders, parentId = null) {
  return folders.filter(f => (f.parent_id ?? null) === parentId);
}

function renderFolderTree() {
  const tree = $('folder-tree');
  const stats = allFolders.reduce((m, f) => { m[f.id] = f.receipt_count; return m; }, {});

  function renderNode(folder) {
    const children = buildTree(allFolders, folder.id);
    const hasChildren = children.length > 0;
    const isActive = activeFolderId === folder.id;

    const childHtml = hasChildren
      ? `<div class="folder-children" id="fc-${folder.id}">${children.map(renderNode).join('')}</div>`
      : '';

    return `
      <div class="folder-node" data-id="${folder.id}">
        <div class="sidebar-item${isActive ? ' active' : ''}" data-folder-id="${folder.id}">
          ${hasChildren
            ? `<span class="folder-expand${isActive ? ' open' : ''}" data-expand="${folder.id}">
                <svg viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>
               </span>`
            : `<span style="width:10px;display:inline-block;flex-shrink:0"></span>`
          }
          <span class="folder-dot" style="background:${escHtml(folder.color)}"></span>
          <span class="sidebar-item-name">${escHtml(folder.name)}</span>
          <span class="sidebar-item-count">${folder.receipt_count || ''}</span>
          <span class="sidebar-item-actions">
            <button class="sidebar-action-btn" data-action="add-child" data-id="${folder.id}" title="Add subfolder">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fill-rule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clip-rule="evenodd"/></svg>
            </button>
            <button class="sidebar-action-btn" data-action="rename" data-id="${folder.id}" data-name="${escHtml(folder.name)}" data-color="${escHtml(folder.color)}" title="Rename">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
            </button>
            <button class="sidebar-action-btn danger" data-action="delete" data-id="${folder.id}" data-name="${escHtml(folder.name)}" title="Delete">
              <svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zm0 2h2l.5 1H8.5L9 4zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clip-rule="evenodd"/></svg>
            </button>
          </span>
        </div>
        ${childHtml}
      </div>`;
  }

  const roots = buildTree(allFolders, null);
  tree.innerHTML = roots.map(renderNode).join('');

  // Update "All Receipts" count
  const totalCount = allFolders.reduce((s, f) => s + (f.parent_id ? 0 : 0), 0);
  // We show total from stats instead — just update active state
  $('sidebar-all').classList.toggle('active', activeFolderId === null);
}

function renderBulkTagSelect() {
  const sel = $('bulk-tag-select');
  sel.innerHTML = '<option value="">Tag all results with folder…</option>';
  allFolders.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
}

function updateBulkTagBar() {
  const bar = $('bulk-tag-bar');
  const hasFilters = state.filters.search || selectedCards.size || selectedVendors.size
    || state.filters.category || state.filters.date_from || state.filters.date_to
    || state.filters.missing || activeFolderId;
  if (hasFilters && state.total > 0) {
    $('bulk-tag-label').textContent = `${state.total} receipt${state.total !== 1 ? 's' : ''} shown.`;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function updateSelectionBar() {
  const count = selectedIds.size;
  const bar = $('selection-bar');
  if (count > 0) {
    $('selection-count').textContent = `${count} receipt${count !== 1 ? 's' : ''} selected`;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
  // Sync the select-all checkbox state
  const allChecks = document.querySelectorAll('.row-check');
  const selectAll = $('select-all-check');
  if (selectAll && allChecks.length > 0) {
    const checkedCount = [...allChecks].filter(c => selectedIds.has(parseInt(c.dataset.id))).length;
    selectAll.checked = checkedCount === allChecks.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < allChecks.length;
  } else if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll('.row-check').forEach(c => { c.checked = false; });
  updateSelectionBar();
}

// ── Folder modal ──────────────────────────────────────────────────────────────
function openFolderModal(mode, opts = {}) {
  folderModalMode = mode;
  folderModalParentId = opts.parentId ?? null;
  folderModalEditId   = opts.editId   ?? null;
  selectedColor       = opts.color    ?? '#6366f1';

  $('folder-modal-title').textContent = mode === 'rename' ? 'Rename Folder' : 'New Folder';
  $('btn-folder-name-save').textContent = mode === 'rename' ? 'Save' : 'Create';
  $('folder-name-input').value = opts.name ?? '';
  $('folder-name-error').style.display = 'none';

  // Render color swatches
  $('folder-color-picker').innerHTML = FOLDER_COLORS.map(c =>
    `<div class="color-swatch${c === selectedColor ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`
  ).join('');

  $('create-folder-modal').style.display = 'flex';
  $('folder-name-input').focus();
}

function closeFolderModal() {
  $('create-folder-modal').style.display = 'none';
}

async function saveFolderModal() {
  const name = $('folder-name-input').value.trim();
  if (!name) {
    $('folder-name-error').textContent = 'Please enter a folder name.';
    $('folder-name-error').style.display = 'block';
    return;
  }

  if (folderModalMode === 'rename') {
    await fetch(`/api/folders/${folderModalEditId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: selectedColor }),
    });
  } else {
    await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: selectedColor, parent_id: folderModalParentId }),
    });
  }
  closeFolderModal();
  await loadFolders();
  showToast(folderModalMode === 'rename' ? 'Folder renamed.' : 'Folder created.', 'success');
}

// ── Tag picker ────────────────────────────────────────────────────────────────
async function openTagPicker(receiptId, anchorEl) {
  tagPickerReceiptId = receiptId;
  const picker = $('tag-picker');

  // Position near the anchor button
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  picker.style.left = Math.min(rect.left, window.innerWidth - 216) + 'px';
  picker.style.display = 'block';

  // Load current folder ids for this receipt
  const currentIds = await fetchJSON(`/api/receipts/${receiptId}/folders`);

  const list = $('tag-picker-list');
  if (!allFolders.length) {
    list.innerHTML = '<div style="padding:10px 12px;color:var(--text-muted);font-size:12px">No folders yet.</div>';
  } else {
    list.innerHTML = allFolders.map(f => `
      <label class="tag-picker-item">
        <input type="checkbox" value="${f.id}" ${currentIds.includes(f.id) ? 'checked' : ''} />
        <span class="folder-dot" style="background:${escHtml(f.color)}"></span>
        <span>${escHtml(f.name)}</span>
      </label>`
    ).join('');
  }

  // Save on checkbox change
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const checked = Array.from(list.querySelectorAll('input:checked')).map(c => parseInt(c.value));
      await fetch(`/api/receipts/${receiptId}/folders`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_ids: checked }),
      });
      await loadFolders(); // refresh counts
    });
  });
}

function closeTagPicker() {
  $('tag-picker').style.display = 'none';
  tagPickerReceiptId = null;
}

function closeAllMultiSelects() {
  $('ms-card-popover').style.display   = 'none';
  $('ms-vendor-popover').style.display = 'none';
  $('ms-card-trigger').classList.remove('active');
  $('ms-vendor-trigger').classList.remove('active');
}

function wireFolderEvents() {
  // Sidebar: All Receipts
  $('sidebar-all').addEventListener('click', () => {
    activeFolderId = null;
    state.page = 1;
    clearSelection();
    renderFolderTree();
    loadReceipts();
  });

  // Sidebar: new root folder
  $('btn-add-root-folder').addEventListener('click', () => openFolderModal('create'));

  // Sidebar: delegated clicks (folder select, expand, actions)
  $('folder-tree').addEventListener('click', async e => {
    // Action buttons
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const { action, id, name, color } = actionBtn.dataset;
      if (action === 'add-child') openFolderModal('create', { parentId: parseInt(id) });
      if (action === 'rename')    openFolderModal('rename', { editId: parseInt(id), name, color });
      if (action === 'delete') {
        if (!confirm(`Delete folder "${name}"? Receipts won't be deleted.`)) return;
        await fetch(`/api/folders/${id}`, { method: 'DELETE' });
        if (activeFolderId === parseInt(id)) activeFolderId = null;
        await loadFolders();
        loadReceipts();
        showToast('Folder deleted.', 'success');
      }
      return;
    }

    // Expand/collapse
    const expandEl = e.target.closest('[data-expand]');
    if (expandEl) {
      e.stopPropagation();
      const childDiv = document.getElementById('fc-' + expandEl.dataset.expand);
      if (childDiv) {
        const isOpen = childDiv.style.display !== 'none';
        childDiv.style.display = isOpen ? 'none' : 'block';
        expandEl.classList.toggle('open', !isOpen);
      }
      return;
    }

    // Folder item click → filter
    const item = e.target.closest('.sidebar-item[data-folder-id]');
    if (item) {
      const fid = parseInt(item.dataset.folderId);
      activeFolderId = fid;
      state.page = 1;
      clearSelection();
      renderFolderTree();
      loadReceipts();
    }
  });

  // Folder modal
  $('folder-color-picker').addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    selectedColor = swatch.dataset.color;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === selectedColor));
  });
  $('btn-folder-name-save').addEventListener('click', saveFolderModal);
  $('btn-folder-name-cancel').addEventListener('click', closeFolderModal);
  $('folder-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveFolderModal(); });
  $('create-folder-modal').addEventListener('click', e => { if (e.target === $('create-folder-modal')) closeFolderModal(); });

  // Tag picker
  $('tag-picker-new').addEventListener('click', () => {
    closeTagPicker();
    openFolderModal('create');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#tag-picker') && !e.target.closest('.tag-btn')) closeTagPicker();
  });

  // Bulk tag
  $('btn-bulk-tag').addEventListener('click', async () => {
    const fid = $('bulk-tag-select').value;
    if (!fid) { showToast('Select a folder first.', ''); return; }
    const btn = $('btn-bulk-tag');
    btn.disabled = true;
    btn.textContent = 'Tagging…';
    const body = {
      search:    state.filters.search    || null,
      cards:     selectedCards.size   ? [...selectedCards]   : null,
      vendors:   selectedVendors.size ? [...selectedVendors] : null,
      category:  state.filters.category  || null,
      date_from: state.filters.date_from || null,
      date_to:   state.filters.date_to   || null,
      folder_id: activeFolderId          || null,
    };
    const res = await fetch(`/api/folders/${fid}/tag-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    btn.disabled = false;
    btn.textContent = 'Apply';
    await loadFolders();
    showToast(`Tagged ${data.tagged} receipt${data.tagged !== 1 ? 's' : ''}.`, 'success');
  });
}

// ── Review Queue ──────────────────────────────────────────────────────────────
async function loadReviewQueue() {
  const stats = await fetchJSON('/api/stats');
  const count = stats.review || 0;
  const banner = $('review-banner');
  if (count > 0) {
    banner.style.display = 'block';
    $('review-count').textContent = count;
  } else {
    banner.style.display = 'none';
    $('review-panel').style.display = 'none';
  }
}

async function showReviewPanel() {
  const items = await fetchJSON('/api/review');
  const grid = $('review-grid');

  if (!items.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);padding:20px">No items to review.</div>';
    $('review-panel').style.display = 'block';
    return;
  }

  grid.innerHTML = items.map(r => {
    const thumb = r.thumbnail_path
      ? `/receipts/thumbnails/${encodeURIComponent(r.filename.replace(/\.[^.]+$/, '.jpg'))}`
      : '';
    const vendor = escHtml(r.vendor_name || 'Unknown');
    const amt = r.total_amount !== null ? fmt_money(r.total_amount) : '—';
    const date = r.date ? fmt_date(r.date) : '';
    const meta = [date, amt].filter(Boolean).join(' · ');

    return `
      <div class="review-card" data-id="${r.id}">
        ${thumb
          ? `<img class="review-card-img" src="${thumb}" alt="scan" loading="lazy" />`
          : `<div class="review-card-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:28px">🧾</div>`
        }
        <div class="review-card-body">
          <div class="review-card-vendor">${vendor}</div>
          <div class="review-card-meta">${meta || 'No details extracted'}</div>
          <div class="review-card-actions">
            <button class="btn btn-sm btn-approve" data-action="approve" data-id="${r.id}">✓ Keep</button>
            <button class="btn btn-sm btn-dismiss" data-action="dismiss" data-id="${r.id}">✕ Dismiss</button>
          </div>
        </div>
      </div>`;
  }).join('');

  $('review-panel').style.display = 'block';
}

function wireReviewEvents() {
  $('btn-show-review').addEventListener('click', showReviewPanel);
  $('btn-close-review').addEventListener('click', () => {
    $('review-panel').style.display = 'none';
  });

  $('review-grid').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;
    btn.disabled = true;

    try {
      const res = await fetch(`/api/review/${id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error();

      // Animate card removal
      const card = btn.closest('.review-card');
      card.style.transition = 'opacity .25s, transform .25s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => card.remove(), 280);

      if (action === 'approve') {
        showToast('Receipt approved.', 'success');
        loadReceipts();
        loadStats();
      } else {
        showToast('Item dismissed.', 'success');
      }

      // Update review count
      setTimeout(loadReviewQueue, 350);
    } catch {
      showToast('Action failed.', 'error');
      btn.disabled = false;
    }
  });

  // Click review card image → open detail
  $('review-grid').addEventListener('click', e => {
    const img = e.target.closest('.review-card-img');
    if (!img) return;
    const card = img.closest('.review-card');
    if (card) window.location.href = `/receipt/${card.dataset.id}`;
  });
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  loadStateFromURL();
  wireEvents();
  wireReviewEvents();
  await Promise.all([loadStats(), loadCards(), loadVendors(), loadCategories(), loadReviewQueue(), loadFolders()]);
  wireFolderEvents();
  restoreFiltersToUI();
  // Restore multi-select trigger labels now that data is loaded
  updateCardTrigger();
  updateVendorTrigger();
  await loadReceipts();

  // Scroll to the receipt that was last viewed (if coming back from detail page)
  const lastViewedId = sessionStorage.getItem('lastViewedReceipt');
  if (lastViewedId) {
    sessionStorage.removeItem('lastViewedReceipt');
    requestAnimationFrame(() => {
      const row = document.querySelector(`tr[data-id="${lastViewedId}"]`);
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'instant' });
        row.style.transition = 'background .3s';
        row.style.background = '#eef2ff';
        setTimeout(() => { row.style.background = ''; }, 1500);
      }
    });
  }

  // Poll status every 8 seconds
  pollStatus();
  setInterval(pollStatus, 8000);
}

init();

// Handle bfcache restore (e.g., back button after hide/delete on detail page)
window.addEventListener('pageshow', (event) => {
  const needsRefresh = sessionStorage.getItem('receiptListNeedsRefresh');
  if (event.persisted || needsRefresh) {
    sessionStorage.removeItem('receiptListNeedsRefresh');
    loadReceipts();
    loadStats();
    loadFolders();
    loadCards();
  }
});
