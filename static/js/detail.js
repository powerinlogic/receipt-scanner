/* detail.js — Receipt detail page logic */

const RID = window.RECEIPT_ID;
let receipt = null;
let zoomLevel = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function fmt_money(val) {
  if (val === null || val === undefined || val === '') return '';
  return parseFloat(val).toFixed(2);
}

function showToast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.style.display = 'block';
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.style.display = 'none', 260); }, 2800);
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load receipt ──────────────────────────────────────────────────────────────
async function loadReceipt() {
  const res = await fetch(`/api/receipts/${RID}`);
  if (!res.ok) {
    document.body.innerHTML = '<div style="padding:48px;text-align:center;color:#6b7280">Receipt not found.</div>';
    return;
  }
  receipt = await res.json();
  renderAll();
}

async function loadCategories() {
  const cats = await fetch('/api/categories').then(r => r.json());
  const sel = $('f-category');
  sel.innerHTML = '<option value="">— Select —</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === receipt.category) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  $('detail-loading').style.display = 'none';
  $('detail-image-panel').style.display = 'flex';
  $('detail-data-panel').style.display = 'block';

  // Image
  const imgEl = $('receipt-img');
  if (receipt.stored_path) {
    const filename = receipt.stored_path.split(/[\\/]/).pop();
    imgEl.src = `/receipts/originals/${encodeURIComponent(filename)}`;
    imgEl.alt = receipt.vendor_name || 'Receipt';
  } else {
    $('detail-image-panel').innerHTML = '<div style="color:#9ca3af;padding:40px;text-align:center">No image available</div>';
  }

  // Status badge
  const badge = $('detail-status');
  const statusMap = {
    processed:  ['status-processed', 'Processed'],
    error:      ['status-error',     'Extraction Error'],
    processing: ['status-processing','Processing…'],
    pending:    ['status-processing','Pending'],
  };
  const [cls, label] = statusMap[receipt.status] || ['status-processing', receipt.status];
  badge.className = `detail-status-badge ${cls}`;
  badge.textContent = label;

  // Fields
  $('f-vendor').value     = receipt.vendor_name    || '';
  $('f-date').value       = receipt.date           || '';
  $('f-amount').value     = fmt_money(receipt.total_amount);
  $('f-card-type').value  = receipt.card_type      || '';
  $('f-card-last4').value = receipt.card_last4     || '';
  $('f-notes').value      = receipt.notes          || '';

  loadCategories();
  renderItems(receipt.items || []);
  updateTitle();
}

function updateTitle() {
  document.title = `${receipt.vendor_name || 'Receipt'} — Receipt Scanner`;
}

// ── Line items ────────────────────────────────────────────────────────────────
function renderItems(items) {
  const tbody = $('items-tbody');
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:20px">No line items extracted.</td></tr>`;
    updateItemsTotal(items);
    return;
  }
  tbody.innerHTML = items.map((it, i) => itemRow(it, i)).join('');
  updateItemsTotal(items);
}

function itemRow(it, i) {
  return `
    <tr data-idx="${i}">
      <td><input class="item-input"     data-field="description" value="${escHtml(it.description || '')}" placeholder="Item description" /></td>
      <td><input class="item-input num" data-field="quantity"    value="${it.quantity ?? 1}" type="number" min="0" step="any" /></td>
      <td><input class="item-input num" data-field="unit_price"  value="${fmt_money(it.unit_price)}" type="number" min="0" step="0.01" /></td>
      <td><input class="item-input num" data-field="total_price" value="${fmt_money(it.total_price)}" type="number" min="0" step="0.01" /></td>
      <td>
        <button class="action-btn danger remove-item-btn" data-idx="${i}" title="Remove">
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      </td>
    </tr>`;
}

function collectItems() {
  const rows = $('items-tbody').querySelectorAll('tr[data-idx]');
  return Array.from(rows).map(row => ({
    description: row.querySelector('[data-field="description"]').value.trim(),
    quantity:    parseFloat(row.querySelector('[data-field="quantity"]').value)  || 1,
    unit_price:  parseFloat(row.querySelector('[data-field="unit_price"]').value)  || null,
    total_price: parseFloat(row.querySelector('[data-field="total_price"]').value) || null,
  }));
}

function updateItemsTotal(items) {
  const sum = items.reduce((acc, it) => acc + (parseFloat(it.total_price) || 0), 0);
  $('items-total-cell').textContent = sum > 0 ? `$${sum.toFixed(2)}` : '—';
}

function addBlankItem() {
  const items = collectItems();
  items.push({ description: '', quantity: 1, unit_price: null, total_price: null });
  renderItems(items);
  // Focus the new description input
  const rows = $('items-tbody').querySelectorAll('tr[data-idx]');
  const lastRow = rows[rows.length - 1];
  if (lastRow) lastRow.querySelector('[data-field="description"]').focus();
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    vendor_name:  $('f-vendor').value.trim()     || null,
    date:         $('f-date').value              || null,
    total_amount: parseFloat($('f-amount').value) || null,
    category:     $('f-category').value          || null,
    card_type:    $('f-card-type').value         || null,
    card_last4:   $('f-card-last4').value.trim() || null,
    notes:        $('f-notes').value.trim()      || null,
    items:        collectItems(),
  };

  try {
    const res = await fetch(`/api/receipts/${RID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    receipt = await res.json();
    showToast('Changes saved.', 'success');
    updateTitle();
  } catch {
    showToast('Save failed. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteReceipt() {
  if (!confirm('Permanently delete this receipt and its image? This cannot be undone.')) return;
  const res = await fetch(`/api/receipts/${RID}`, { method: 'DELETE' });
  if (res.ok) {
    window.location.href = '/';
  } else {
    showToast('Delete failed.', 'error');
  }
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
function applyZoom() {
  $('receipt-img').style.transform = `scale(${zoomLevel})`;
  $('receipt-img').style.transformOrigin = 'top center';
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function openLightbox() {
  const src = $('receipt-img').src;
  $('lightbox-img').src = src;
  $('lightbox').style.display = 'flex';
}
function closeLightbox() {
  $('lightbox').style.display = 'none';
}

// ── Events ────────────────────────────────────────────────────────────────────
function wireEvents() {
  $('btn-save').addEventListener('click', save);
  $('btn-delete').addEventListener('click', deleteReceipt);
  $('btn-add-item').addEventListener('click', addBlankItem);

  // Zoom controls
  $('btn-zoom-in').addEventListener('click',    () => { zoomLevel = Math.min(zoomLevel + 0.25, 3); applyZoom(); });
  $('btn-zoom-out').addEventListener('click',   () => { zoomLevel = Math.max(zoomLevel - 0.25, 0.5); applyZoom(); });
  $('btn-zoom-reset').addEventListener('click', () => { zoomLevel = 1; applyZoom(); });

  // Click image to open lightbox
  $('receipt-img').addEventListener('click', openLightbox);
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', e => { if (e.target === $('lightbox')) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Remove item buttons (delegated)
  $('items-tbody').addEventListener('click', e => {
    const btn = e.target.closest('.remove-item-btn');
    if (!btn) return;
    const items = collectItems();
    items.splice(parseInt(btn.dataset.idx), 1);
    renderItems(items);
  });

  // Live-update items total when prices change
  $('items-tbody').addEventListener('input', e => {
    if (e.target.dataset.field === 'total_price') {
      updateItemsTotal(collectItems());
    }
    // Auto-calculate total_price from qty × unit_price
    const row = e.target.closest('tr');
    if (row && (e.target.dataset.field === 'quantity' || e.target.dataset.field === 'unit_price')) {
      const qty   = parseFloat(row.querySelector('[data-field="quantity"]').value)   || 0;
      const price = parseFloat(row.querySelector('[data-field="unit_price"]').value) || 0;
      if (qty && price) {
        row.querySelector('[data-field="total_price"]').value = (qty * price).toFixed(2);
      }
      updateItemsTotal(collectItems());
    }
  });

  // Save on Ctrl+S / Cmd+S
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
wireEvents();
loadReceipt();
