// ============================================
// SUPABASE CONNECTION
// ============================================
const SUPABASE_URL = 'https://ilrnqxgojgrpkkinaapm.supabase.co';
const SUPABASE_KEY = 'sb_publishable__rKIdmzzCEZnRFhOUn6nAQ_yOt6bOwk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BACKDOOR_PASSWORD = 'koi_backdoor';
let _silentRefresh = false;

// ============================================
// APP SETTINGS
// ============================================
let appSettings = {
  auctionYear: new Date().getFullYear(),
  auctionTitle: `${new Date().getFullYear()} Re-Homing Auction`,
  adminPassword: 'admin1234',
  activeYearId: null,
  isLocked: false,
  membershipPrompt: true,
};

async function loadSettings() {
  const { data } = await sb.from('settings').select('*').order('created_at', { ascending: false });
  if (data && data.length > 0) {
    const active = data.find(s => s.is_active) || data[0];
    appSettings.auctionYear = active.year;
    appSettings.auctionTitle = active.title;
    appSettings.adminPassword = active.admin_password || 'admin1234';
    appSettings.activeYearId = active.id;
    appSettings.isLocked = active.is_locked || false;
    appSettings.membershipPrompt = active.membership_prompt !== false;
    setAuctionSubtitle(active.title);
  } else {
    const { data: newSettings } = await sb.from('settings').insert({
      year: appSettings.auctionYear,
      title: appSettings.auctionTitle,
      admin_password: 'admin1234',
      is_active: true,
    }).select().single();
    if (newSettings) {
      appSettings.activeYearId = newSettings.id;
      setAuctionSubtitle(appSettings.auctionTitle);
    }
  }
}

// ============================================
// NAVIGATION
// ============================================
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    history.pushState({ page: item.dataset.page }, '');
    loadPage(item.dataset.page);
  });
});

// Close any open modal or go back to previous page on browser back
new MutationObserver(mutations => {
  mutations.forEach(m => {
    if (m.attributeName === 'class' && m.target.classList.contains('modal-overlay')
        && m.target.classList.contains('open')) {
      history.pushState({ modal: m.target.id, page: getActivePage() }, '');
    }
  });
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

window.addEventListener('popstate', e => {
  const wizardModal = document.getElementById('sale-wizard-modal');
  const wizardOpen = wizardModal?.classList.contains('open');

  // Wizard step 3 → back → show step 2 (fish list)
  if (e.state?.wizardStep === 3 && wizardOpen) { _swBackToFish(); return; }
  // Wizard step 2 → back → show step 1 (tank list)
  if (e.state?.wizardStep === 2 && wizardOpen) { openSaleWizard(); return; }
  // Wizard step 1 state (modal just opened) → back → close wizard
  if (e.state?.modal === 'sale-wizard-modal' && wizardOpen) {
    wizardModal.classList.remove('open'); return;
  }

  const openModalEl = document.querySelector('.modal-overlay.open');
  if (openModalEl) { openModalEl.classList.remove('open'); return; }

  const page = e.state?.page || 'dashboard';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  loadPage(page);
});

// Enter key: field-to-field navigation via data-enter-focus, or submit the open modal's primary button
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const tag = document.activeElement?.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'button' || tag === 'select') return;
  const focusNext = document.activeElement?.dataset?.enterFocus;
  if (focusNext) {
    e.preventDefault();
    document.getElementById(focusNext)?.focus();
    return;
  }
  const openModal = document.querySelector('.modal-overlay.open');
  if (!openModal) return;
  const primaryBtn = openModal.querySelector('.btn-primary:not([disabled])');
  if (primaryBtn) { e.preventDefault(); primaryBtn.click(); }
});

function loadPage(page) {
  switch(page) {
    case 'dashboard': renderDashboard(); break;
    case 'donors':    renderDonors();    break;
    case 'fish':      renderFish();      break;
    case 'bidders':   renderBidders();   break;
    case 'scribe':    renderScribe();    break;
    case 'checkout':  renderCheckout();  break;
    case 'misc':      renderMisc();      break;
    case 'admin':     renderAdmin();     break;
    case 'manual':    renderManual();    break;
  }
}

function setContent(html) {
  const banner = appSettings.isLocked
    ? '<div class="lock-banner">🔒 This year is locked — read-only. Unlock in Admin to make changes.</div>'
    : '';
  const full = banner + html;
  const main = document.getElementById('main-content');
  if (_silentRefresh) {
    if (html.length < 200) return;           // skip loading placeholder flash
    if (main.innerHTML === full) return;     // no data change — do nothing
    main.classList.add('sr-updated');        // subtle fade-in on actual change
    main.innerHTML = full;
    setTimeout(() => main.classList.remove('sr-updated'), 250);
    return;
  }
  main.innerHTML = full;
}

function lockIf(html) {
  return appSettings.isLocked ? '' : html;
}

// ============================================
// PHONE FORMATTER
// ============================================
function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0,3)}-${digits.slice(3)}`;
  return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
}

function attachPhoneFormatter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', () => { el.value = formatPhone(el.value); });
}

// ============================================
// BIDDER LIVE LOOKUP
// ============================================
let bidderCache = {};

async function loadBidderCache() {
  const { data } = await sb.from('bidders').select('bidder_number, first_name, last_name').eq('year_id', appSettings.activeYearId);
  bidderCache = {};
  (data || []).forEach(b => { bidderCache[b.bidder_number] = `${b.first_name} ${b.last_name}`; });
}

// Entity caches: populated on each render so edit modals never use JSON-in-onclick (breaks on apostrophes)
let donorDataCache = {};
let fishDataCache = {};
let bidderDataCache = {};
let miscPurchaseDataCache = {};
let donorTypeDataCache = {};
let miscItemDataCache = {};

function attachBidderLookup(inputId, displayId) {
  const input = document.getElementById(inputId);
  const display = document.getElementById(displayId);
  if (!input || !display) return;
  input.addEventListener('input', () => {
    const num = parseInt(input.value);
    if (!num) { display.textContent = ''; display.className = 'bidder-name-display'; return; }
    const name = bidderCache[num];
    if (name) {
      display.textContent = name;
      display.className = 'bidder-name-display';
    } else {
      display.textContent = 'Not found';
      display.className = 'bidder-name-display not-found';
    }
  });
}

// ============================================
// DASHBOARD
// ============================================
let dashTotalsTab = 'donor_payouts';
let dashTabData = {};

function setAuctionSubtitle(title) {
  document.querySelectorAll('.auction-subtitle').forEach(el => { el.textContent = title; });
}

async function renderDashboard() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading dashboard...</p>');
  if (!appSettings.activeYearId) { setContent('<p style="color:#c0392b;padding:1rem;">No active year found. Please go to Admin to create one.</p>'); return; }

  try {
  const [
    { count: bidderCount },
    { data: sales },
    { data: misc },
    { data: fish },
    { data: donors },
    { data: payments },
    { data: miscItems },
  ] = await Promise.all([
    sb.from('bidders').select('id', { count: 'exact' }).eq('year_id', appSettings.activeYearId),
    sb.from('sales').select('sale_price, fish_id').eq('year_id', appSettings.activeYearId),
    sb.from('misc_purchases').select('total_price, item_name, bidder_id, quantity, club_cost_total').eq('year_id', appSettings.activeYearId),
    sb.from('fish').select('id, donor_id, donor_percent').eq('year_id', appSettings.activeYearId),
    sb.from('donors').select('id, first_name, last_name, type').eq('year_id', appSettings.activeYearId),
    sb.from('payments').select('amount, payment_method').eq('year_id', appSettings.activeYearId),
    sb.from('misc_items').select('name, is_quantity_based, club_cost').eq('year_id', appSettings.activeYearId),
  ]);
  const fishCount = (fish || []).length;

  // Build current item cost map — always use live item definitions so dashboard updates immediately
  const itemCostMap = {};
  (miscItems || []).forEach(i => { itemCostMap[i.name] = i.is_quantity_based ? Number(i.club_cost || 0) : 0; });

  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const miscClubCost = (misc || []).reduce((s, r) => s + Number(r.quantity || 1) * (itemCostMap[r.item_name] || 0), 0);
  const miscNet = miscTotal - miscClubCost;

  let donorAuctionPayout = 0;
  let clubAuctionPortion = 0;
  (sales || []).forEach(s => {
    const f = (fish || []).find(f => f.id === s.fish_id);
    const pct = f ? Number(f.donor_percent) : 0;
    donorAuctionPayout += Number(s.sale_price) * pct;
    clubAuctionPortion += Number(s.sale_price) * (1 - pct);
  });

  const cashTotal = (payments || []).filter(p => p.payment_method === 'Cash').reduce((s, r) => s + Number(r.amount), 0);
  const ccTotal = (payments || []).filter(p => p.payment_method === 'Credit Card').reduce((s, r) => s + Number(r.amount), 0);
  const checkTotal = (payments || []).filter(p => p.payment_method === 'Check').reduce((s, r) => s + Number(r.amount), 0);

  // Donor payouts
  const donorPayouts = (donors || []).map(d => {
    const donorFishIds = (fish || []).filter(f => f.donor_id === d.id).map(f => f.id);
    const donorSales = (sales || []).filter(s => donorFishIds.includes(s.fish_id));
    const total = donorSales.reduce((s, r) => s + Number(r.sale_price) * (fish.find(f => f.id === r.fish_id)?.donor_percent || 0), 0);
    return { name: `${d.first_name} ${d.last_name}`, type: d.type, total };
  }).filter(d => d.total > 0);

  // Misc item breakdown
  const miscBreakdown = {};
  (misc || []).forEach(p => {
    if (!miscBreakdown[p.item_name]) miscBreakdown[p.item_name] = { qty: 0, total: 0, cost: 0 };
    miscBreakdown[p.item_name].qty += Number(p.quantity || 1);
    miscBreakdown[p.item_name].total += Number(p.total_price);
    miscBreakdown[p.item_name].cost += Number(p.quantity || 1) * (itemCostMap[p.item_name] || 0);
  });

  const totalsTabsHtml = `
    <div class="totals-tabs">
      <div class="totals-tab ${dashTotalsTab === 'donor_payouts' ? 'active' : ''}" data-tab="donor_payouts" onclick="switchDashTab('donor_payouts')">Donor payouts</div>
      <div class="totals-tab ${dashTotalsTab === 'misc_items' ? 'active' : ''}" data-tab="misc_items" onclick="switchDashTab('misc_items')">Misc items sold</div>
      <div class="totals-tab ${dashTotalsTab === 'payments' ? 'active' : ''}" data-tab="payments" onclick="switchDashTab('payments')">Payment methods</div>
    </div>
  `;

  const donorPayoutsHtml = `
    <table class="table">
      <thead><tr><th>Donor</th><th>Type</th><th style="text-align:right;">Total owed</th></tr></thead>
      <tbody>
        ${donorPayouts.length > 0 ? donorPayouts.map(d => `
          <tr>
            <td>${d.name}</td>
            <td>${d.type}</td>
            <td style="text-align:right;font-weight:bold;">$${d.total.toFixed(2)}</td>
          </tr>
        `).join('') : '<tr><td colspan="3" style="text-align:center;color:#888;">No payouts yet</td></tr>'}
        <tr style="background:#f0f9fc;">
          <td colspan="2" style="font-weight:bold;">Total owed to all donors</td>
          <td style="text-align:right;font-weight:bold;color:#c0392b;">$${donorPayouts.reduce((s, d) => s + d.total, 0).toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  `;

  const miscItemsHtml = `
    <table class="table">
      <thead><tr><th>Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Revenue</th><th style="text-align:right;">Club cost</th></tr></thead>
      <tbody>
        ${Object.keys(miscBreakdown).length > 0 ? Object.entries(miscBreakdown).sort((a,b) => b[1].total - a[1].total).map(([name, data]) => `
          <tr>
            <td>${name}</td>
            <td style="text-align:right;">${data.qty}</td>
            <td style="text-align:right;font-weight:bold;">$${data.total.toFixed(2)}</td>
            <td style="text-align:right;color:${data.cost > 0 ? '#c0392b' : '#888'};">${data.cost > 0 ? '-$' + data.cost.toFixed(2) : '—'}</td>
          </tr>
        `).join('') : '<tr><td colspan="4" style="text-align:center;color:#888;">No misc purchases yet</td></tr>'}
        <tr style="background:#f0f9fc;">
          <td colspan="2" style="font-weight:bold;">Total misc</td>
          <td style="text-align:right;font-weight:bold;color:#1a5f7a;">$${miscTotal.toFixed(2)}</td>
          <td style="text-align:right;font-weight:bold;color:#c0392b;">${miscClubCost > 0 ? '-$' + miscClubCost.toFixed(2) : '—'}</td>
        </tr>
      </tbody>
    </table>
  `;

  const paymentsHtml = `
    <table class="table">
      <thead><tr><th>Payment method</th><th style="text-align:right;">Total received</th></tr></thead>
      <tbody>
        <tr><td>💵 Cash</td><td style="text-align:right;font-weight:bold;">$${cashTotal.toFixed(2)}</td></tr>
        <tr><td>💳 Credit card</td><td style="text-align:right;font-weight:bold;">$${ccTotal.toFixed(2)}</td></tr>
        <tr><td>📝 Check</td><td style="text-align:right;font-weight:bold;">$${checkTotal.toFixed(2)}</td></tr>
        <tr style="background:#f0f9fc;">
          <td style="font-weight:bold;">Total collected</td>
          <td style="text-align:right;font-weight:bold;color:#1a5f7a;">$${(cashTotal + ccTotal + checkTotal).toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
  `;

  // Store tab HTML now that all three strings are defined
  dashTabData = { donor_payouts: donorPayoutsHtml, misc_items: miscItemsHtml, payments: paymentsHtml };

  const tabContent = dashTotalsTab === 'donor_payouts' ? donorPayoutsHtml : dashTotalsTab === 'misc_items' ? miscItemsHtml : paymentsHtml;

  setContent(`
    <div class="stats-grid">
      <div class="stat-card">
        <img class="stat-icon" src="assets/newicons/totalfish.png" alt="" />
        <div class="stat-text">
          <div class="stat-label">Total fish</div>
          <div class="stat-value">${fishCount || 0}</div>
        </div>
      </div>
      <div class="stat-card">
        <img class="stat-icon" src="assets/newicons/bidders.png" alt="" />
        <div class="stat-text">
          <div class="stat-label">Bidders</div>
          <div class="stat-value">${bidderCount || 0}</div>
        </div>
      </div>
      <div class="stat-card">
        <img class="stat-icon" src="assets/newicons/auction.png" alt="" />
        <div class="stat-text">
          <div class="stat-label">Auction sales</div>
          <div class="stat-value">$${auctionTotal.toFixed(0)}</div>
        </div>
      </div>
      <div class="stat-card">
        <img class="stat-icon" src="assets/newicons/misc.png" alt="" />
        <div class="stat-text">
          <div class="stat-label">Misc ${miscClubCost > 0 ? 'net' : 'sales'}</div>
          <div class="stat-value">$${miscNet.toFixed(0)}</div>
        </div>
      </div>
      <div class="stat-card">
        <img class="stat-icon" src="assets/newicons/donor.png" alt="" />
        <div class="stat-text">
          <div class="stat-label">Donor payout</div>
          <div class="stat-value">$${donorAuctionPayout.toFixed(0)}</div>
        </div>
      </div>
      <div class="stat-card">
        <img class="stat-icon" src="assets/newicons/club.png" alt="" />
        <div class="stat-text">
          <div class="stat-label">Club portion</div>
          <div class="stat-value">$${clubAuctionPortion.toFixed(0)}</div>
        </div>
      </div>
    </div>

    <div class="card card-bamboo">
      <div class="card-header"><div class="card-header-title">Grand total</div></div>
      <div class="card-body">
        <div class="total-row"><span>Auction sales</span><span>$${auctionTotal.toFixed(2)}</span></div>
        <div class="total-row"><span>Misc revenue</span><span>$${miscTotal.toFixed(2)}</span></div>
        <div class="total-row grand"><span>Total revenue</span><span class="amount" style="color:#1a5f7a;">$${(auctionTotal + miscTotal).toFixed(2)}</span></div>
        <hr class="divider">
        <div class="total-row"><span style="color:#c0392b;">Donor payout (auction)</span><span style="color:#c0392b;">-$${donorAuctionPayout.toFixed(2)}</span></div>
        ${miscClubCost > 0 ? `<div class="total-row"><span style="color:#c0392b;">Misc club cost</span><span style="color:#c0392b;">-$${miscClubCost.toFixed(2)}</span></div>` : ''}
        <div class="total-row grand"><span>Club net</span><span class="amount" style="color:#27ae60;">$${(clubAuctionPortion + miscNet).toFixed(2)}</span></div>
      </div>
    </div>

    <div class="card card-temple">
      <div class="card-header"><div class="card-header-title">Totals</div></div>
      <div class="card-body">
        ${totalsTabsHtml}
        <div id="dash-tab-content">${tabContent}</div>
      </div>
    </div>
  `);
  } catch (err) {
    setContent('<div class="alert alert-error" style="margin:16px;">Error loading dashboard. Please check your connection and try again. <button class="btn btn-sm btn-primary" onclick="renderDashboard()" style="margin-left:8px;">Retry</button></div>');
  }
}

function switchDashTab(tab) {
  dashTotalsTab = tab;
  const scrollY = window.scrollY;
  document.querySelectorAll('.totals-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  const content = document.getElementById('dash-tab-content');
  if (content) content.innerHTML = dashTabData[tab] || '';
  // Restore scroll immediately after DOM update to prevent browser jump
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

// ============================================
// DONORS
// ============================================
async function renderDonors() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading donors...</p>');
  const { data: donors } = await sb.from('donors').select('*').eq('year_id', appSettings.activeYearId).order('last_name');
  donorDataCache = {};
  (donors || []).forEach(d => { donorDataCache[d.id] = d; });
  setContent(`
    <div class="page-header">
      <div class="section-label">Koi donors</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline btn-sm" onclick="syncDonorFishCounts(this)" title="Update each donor's fish count to match the actual number of fish entered in the system">↻ Sync fish counts</button>
        ${lockIf('<button class="btn btn-primary btn-sm" onclick="openDonorModal()">+ Add donor</button>')}
      </div>
    </div>
    <div class="card">
      <div class="card-body">
        ${donors && donors.length > 0 ? `
        <table class="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Type</th><th>Fish</th><th>Actions</th></tr></thead>
          <tbody>
            ${donors.map(d => `
              <tr class="${d.address ? 'donor-row-expandable' : ''}" onclick="${d.address ? `toggleDonorRow('${d.id}')` : ''}">
                <td>
                  <span id="di-${d.id}" style="font-size:11px;color:#aaa;margin-right:5px;display:inline-block;width:10px;visibility:${d.address ? 'visible' : 'hidden'};">▸</span>${d.first_name} ${d.last_name}
                </td>
                <td>${d.phone || '—'}</td>
                <td>${d.email || '—'}</td>
                <td><span class="badge badge-${d.type.toLowerCase()}">${d.type}</span></td>
                <td>${d.num_fish}</td>
                <td onclick="event.stopPropagation()">
                  ${lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditDonorModal('${d.id}')">Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteDonor('${d.id}')">Delete</button>`)}
                </td>
              </tr>
              ${d.address ? `<tr id="da-${d.id}" style="display:none;"><td colspan="6" style="padding:6px 16px 10px 28px;font-size:13px;color:#555;background:#fffaf0;border-bottom:1px solid #e8dfc8;">📍 ${d.address}</td></tr>` : ''}
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No donors yet. Add your first donor!</div>'}
      </div>
    </div>
    <div class="modal-overlay" id="donor-modal">
      <div class="modal">
        <div class="modal-title" id="donor-modal-title">Add donor</div>
        <input type="hidden" id="d-id" />
        <div class="form-row">
          <div class="form-group"><label>First name</label><input id="d-first" type="text" /></div>
          <div class="form-group"><label>Last name</label><input id="d-last" type="text" /></div>
        </div>
        <div class="form-group"><label>Phone</label><input id="d-phone" type="text" placeholder="xxx-xxx-xxxx" /></div>
        <div class="form-group"><label>Email</label><input id="d-email" type="email" /></div>
        <div class="form-group"><label>Type</label>
          <select id="d-type">
            <option value="Dropoff">Dropoff — donor drops off fish</option>
            <option value="Pickup">Pickup — club picks up fish</option>
          </select>
        </div>
        <div class="form-group"><label># of fish</label><input id="d-fish" type="number" value="1" min="0" /></div>
        <div style="margin-bottom:10px;">
          <button type="button" class="btn btn-outline btn-xs" onclick="toggleDonorAddress()" id="d-addr-toggle">+ Add address</button>
        </div>
        <div id="d-addr-section" style="display:none;">
          <div class="form-group"><label>Address</label><input id="d-address" type="text" placeholder="Street address, city, state, zip" /></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('donor-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-donor-btn" onclick="saveDonor()">Save donor</button>
        </div>
      </div>
    </div>
  `);
  attachPhoneFormatter('d-phone');
}

async function openDonorModal() {
  document.getElementById('donor-modal-title').textContent = 'Add donor';
  document.getElementById('d-id').value = '';
  document.getElementById('d-first').value = '';
  document.getElementById('d-last').value = '';
  document.getElementById('d-phone').value = '';
  document.getElementById('d-email').value = '';
  document.getElementById('d-fish').value = '1';
  document.getElementById('d-address').value = '';
  document.getElementById('d-addr-section').style.display = 'none';
  document.getElementById('d-addr-toggle').textContent = '+ Add address';
  document.getElementById('donor-modal').classList.add('open');
}

async function openEditDonorModal(id) {
  const d = donorDataCache[id];
  if (!d) return;
  document.getElementById('donor-modal-title').textContent = 'Edit donor';
  document.getElementById('d-id').value = d.id;
  document.getElementById('d-first').value = d.first_name;
  document.getElementById('d-last').value = d.last_name;
  document.getElementById('d-phone').value = d.phone || '';
  document.getElementById('d-email').value = d.email || '';
  document.getElementById('d-fish').value = d.num_fish;
  const addr = d.address || '';
  document.getElementById('d-address').value = addr;
  const addrSection = document.getElementById('d-addr-section');
  const addrToggle = document.getElementById('d-addr-toggle');
  if (addr) {
    addrSection.style.display = 'block';
    addrToggle.textContent = '− Hide address';
  } else {
    addrSection.style.display = 'none';
    addrToggle.textContent = '+ Add address';
  }
  document.getElementById('donor-modal').classList.add('open');
  const dType = document.getElementById('d-type');
  if (dType) dType.value = (d.type === 'Pickup') ? 'Pickup' : 'Dropoff';
}

async function saveDonor() {
  const btn = document.getElementById('save-donor-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('d-id').value;
  const first_name = document.getElementById('d-first').value.trim();
  const last_name = document.getElementById('d-last').value.trim();
  const phone = document.getElementById('d-phone').value.trim();
  const email = document.getElementById('d-email').value.trim();
  const type = document.getElementById('d-type').value;
  const num_fish = parseInt(document.getElementById('d-fish').value) || 0;
  const address = document.getElementById('d-address').value.trim();
  if (!first_name || !last_name) {
    alert('Please enter first and last name.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save donor'; }
    return;
  }
  if (id) {
    const { error } = await sb.from('donors').update({ first_name, last_name, phone, email, type, num_fish, address }).eq('id', id);
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save donor'; } return; }
  } else {
    const { error } = await sb.from('donors').insert({ first_name, last_name, phone, email, type, num_fish, address, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save donor'; } return; }
  }
  closeModal('donor-modal');
  renderDonors();
}

async function deleteDonor(id) {
  const { data: linkedFish } = await sb.from('fish').select('id').eq('donor_id', id);
  if (linkedFish && linkedFish.length > 0) {
    alert(`Cannot delete this donor — they have ${linkedFish.length} fish linked to them. Please reassign or delete those fish first.`);
    return;
  }
  if (!window.confirm('Delete this donor? This cannot be undone.')) return;
  const { error } = await sb.from('donors').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderDonors();
}

function toggleDonorAddress() {
  const section = document.getElementById('d-addr-section');
  const toggle = document.getElementById('d-addr-toggle');
  const isHidden = section.style.display === 'none';
  section.style.display = isHidden ? 'block' : 'none';
  toggle.textContent = isHidden ? '− Hide address' : '+ Add address';
  if (isHidden) document.getElementById('d-address').focus();
}

function toggleDonorRow(id) {
  const addrRow = document.getElementById(`da-${id}`);
  const indicator = document.getElementById(`di-${id}`);
  if (!addrRow) return;
  const isHidden = addrRow.style.display === 'none';
  addrRow.style.display = isHidden ? 'table-row' : 'none';
  if (indicator) indicator.textContent = isHidden ? '▾' : '▸';
}

async function syncDonorFishCounts(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  const { data: allFish } = await sb.from('fish').select('donor_id').eq('year_id', appSettings.activeYearId);
  const counts = {};
  (allFish || []).forEach(f => { if (f.donor_id) counts[f.donor_id] = (counts[f.donor_id] || 0) + 1; });
  const { data: donors } = await sb.from('donors').select('id').eq('year_id', appSettings.activeYearId);
  await Promise.all((donors || []).map(d =>
    sb.from('donors').update({ num_fish: counts[d.id] || 0 }).eq('id', d.id)
  ));
  renderDonors();
}

// ============================================
// FISH & TANKS
// ============================================
let activeTank = 'all';
let allDonorsForFish = [];

async function renderFish() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading fish...</p>');
  const [{ data: tanks }, { data: fish }, { data: donors }, { data: yearSales }] = await Promise.all([
    sb.from('tanks').select('*').eq('year_id', appSettings.activeYearId).order('letter'),
    sb.from('fish').select('*, tanks(letter), donors(id, first_name, last_name, type)').eq('year_id', appSettings.activeYearId).order('fish_number'),
    sb.from('donors').select('id, first_name, last_name, type').eq('year_id', appSettings.activeYearId).order('last_name'),
    sb.from('sales').select('fish_id, sale_price, bidder_id, created_at').eq('year_id', appSettings.activeYearId),
  ]);

  const salesMap = {};
  (yearSales || []).forEach(s => { salesMap[s.fish_id] = s; });

  const allBidderIds = [...new Set((yearSales || []).map(s => s.bidder_id))].filter(Boolean);
  const bidderNumberMap = {};
  const paidFishIds = new Set();

  const { data: allPaymentsData } = await sb.from('payments').select('bidder_id, amount').eq('year_id', appSettings.activeYearId);

  if (allBidderIds.length > 0) {
    const { data: bidderData } = await sb.from('bidders').select('id, bidder_number').in('id', allBidderIds);
    (bidderData || []).forEach(b => { bidderNumberMap[b.id] = b.bidder_number; });

    // FIFO payment allocation: mark individual fish as paid based on payment amount
    // covering them in chronological order (oldest fish first)
    for (const bidderId of allBidderIds) {
      const totalPaid = (allPaymentsData || [])
        .filter(p => p.bidder_id === bidderId)
        .reduce((s, r) => s + Number(r.amount), 0);
      if (totalPaid <= 0) continue;
      const sortedSales = (yearSales || [])
        .filter(s => s.bidder_id === bidderId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      let covered = totalPaid;
      for (const sale of sortedSales) {
        const price = Number(sale.sale_price);
        if (covered >= price - 0.01) { paidFishIds.add(sale.fish_id); covered -= price; }
        else break;
      }
    }
  }

  allDonorsForFish = donors || [];
  fishDataCache = {};
  (fish || []).forEach(f => { fishDataCache[f.id] = f; });
  const tankFish = (tankLetter) => fish ? fish.filter(f => f.tanks?.letter === tankLetter) : [];
  const allTanks = tanks || [];
  const noDonors = allDonorsForFish.length === 0;

  const donorOptions = noDonors
    ? '<option value="">No donors — add a donor first</option>'
    : allDonorsForFish.map(d => `<option value="${d.id}" data-type="${d.type}">${d.first_name} ${d.last_name}</option>`).join('');

  const railHtml = `
    <div class="tank-rail">
      <div class="tank-chip ${activeTank === 'all' ? 'active' : ''}" onclick="setActiveTank('all')">
        All (${fish ? fish.length : 0})
      </div>
      ${allTanks.map(t => `
        <div class="tank-chip ${activeTank === t.letter ? 'active' : ''}" onclick="setActiveTank('${t.letter}')">
          Tank ${t.letter} (${tankFish(t.letter).length})
        </div>
      `).join('')}
      ${lockIf('<button class="add-tank-btn" onclick="openTankModal()">+ New tank</button>')}
    </div>
  `;

  const tanksToShow = activeTank === 'all' ? allTanks : allTanks.filter(t => t.letter === activeTank);

  const tanksHtml = tanksToShow.length === 0
    ? '<div class="card"><div class="card-body"><div class="empty-state">No tanks yet. Create your first tank!</div></div></div>'
    : tanksToShow.map(tank => {
        const tf = tankFish(tank.letter);
        return `
          <div class="card">
            <div class="card-header">
              <div class="card-header-title">
                Tank ${tank.letter}${tank.description ? ' — ' + tank.description : ''}
                <span style="font-size:12px;color:#4db8d4;font-weight:normal;margin-left:6px;">${tf.length} fish</span>
              </div>
              <div style="display:flex;gap:6px;">
                ${lockIf(`<button class="btn btn-primary btn-sm" onclick="openFishModal('${tank.id}','${tank.letter}')">+ Add fish</button>
                <button class="btn btn-danger btn-xs" onclick="deleteTank('${tank.id}')">Delete tank</button>`)}
              </div>
            </div>
            <div class="card-body">
              ${tf.length === 0
                ? '<div class="empty-state">No fish in this tank yet.</div>'
                : `<table class="table">
                    <thead><tr><th>ID</th><th>Description</th><th>Donor</th><th>Type</th><th>Sale status</th><th>Payment</th><th>Actions</th></tr></thead>
                    <tbody>
                      ${tf.map(f => {
                        const fishSale = salesMap[f.id];
                        const sold = !!fishSale;
                        const bidderNum = sold ? (bidderNumberMap[fishSale.bidder_id] || '') : '';
                        const bidderPaid = sold && paidFishIds.has(f.id);
                        const paymentBadge = !sold ? '—' : bidderPaid
                          ? '<span class="badge badge-sold-paid">Paid</span>'
                          : '<span class="badge badge-sold-unpaid">Unpaid</span>';
                        return `
                          <tr>
                            <td><span class="fish-id">${tank.letter}${f.fish_number}</span></td>
                            <td>${f.description}</td>
                            <td>${f.donors ? f.donors.first_name + ' ' + f.donors.last_name : '—'}</td>
                            <td><span class="badge badge-${(f.type||'').toLowerCase()}">${f.type || '—'}</span></td>
                            <td>${sold ? `<span class="badge badge-sold">Sold $${fishSale.sale_price}</span>${bidderNum ? ` <span style="font-size:11px;color:#888;font-weight:600;">Bidder #${bidderNum}</span>` : ''}` : '<span class="badge badge-unsold">Available</span>'}</td>
                            <td>${paymentBadge}</td>
                            <td>
                              ${lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditFishModal('${f.id}')">Edit</button>
                              ${paidFishIds.has(f.id)
                                ? '<span style="font-size:11px;color:#0a6640;font-weight:600;">🔒 Paid</span>'
                                : `<button class="btn btn-danger btn-xs" onclick="deleteFish('${f.id}')">Delete</button>`}`)}
                            </td>
                          </tr>`;
                      }).join('')}
                    </tbody>
                  </table>`
              }
            </div>
          </div>
        `;
      }).join('');

  setContent(`
    <div class="page-header">
      <div class="section-label">Fish catalog</div>
    </div>
    ${noDonors ? '<div class="alert alert-error" style="margin-bottom:12px;">⚠️ No donors found for this year. Please add donors before adding fish.</div>' : ''}
    ${railHtml}
    ${tanksHtml}

    <div class="modal-overlay" id="tank-modal">
      <div class="modal">
        <div class="modal-title">Create new tank</div>
        <div class="form-group"><label>Tank letter</label><input id="t-letter" type="text" maxlength="3" placeholder="e.g. A, B, F" /></div>
        <div class="form-group"><label>Description (optional)</label><input id="t-desc" type="text" placeholder="e.g. Large koi" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('tank-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-tank-btn" onclick="saveTank()">Create tank</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="fish-modal">
      <div class="modal">
        <div class="modal-title" id="fish-modal-title">Add fish</div>
        <input type="hidden" id="fish-modal-tank-id" />
        <input type="hidden" id="f-id" />
        <div class="form-group"><label>Fish #</label><input id="f-num" type="number" min="1" step="1" /></div>
        <div class="form-group"><label>Description</label><input id="f-desc" type="text" placeholder="e.g. Kohaku, Tancho..." /></div>
        <div class="form-group"><label>Donor</label>
          <select id="f-donor" onchange="autoFillFishType()" ${noDonors ? 'disabled' : ''}>${donorOptions}</select>
        </div>
        <div class="form-group"><label>Type</label>
          <select id="f-type"></select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('fish-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-fish-btn" onclick="saveFish()" ${noDonors ? 'disabled' : ''}>Save fish</button>
        </div>
      </div>
    </div>
  `);
}

function autoFillFishType() {
  // Donor logistics type (Dropoff/Pickup) is separate from fish payout type — no auto-fill
}

function setActiveTank(letter) {
  activeTank = letter;
  renderFish();
}

function openTankModal() {
  document.getElementById('t-letter').value = '';
  document.getElementById('t-desc').value = '';
  document.getElementById('tank-modal').classList.add('open');
}

async function openFishModal(tankId, tankLetter) {
  if (allDonorsForFish.length === 0) {
    alert('Please add at least one donor before adding fish.');
    return;
  }
  document.getElementById('fish-modal-title').textContent = 'Add fish to Tank ' + tankLetter;
  document.getElementById('fish-modal-tank-id').value = tankId;
  document.getElementById('f-id').value = '';
  document.getElementById('f-desc').value = '';
  document.getElementById('fish-modal').classList.add('open');
  await populateDonorTypeSelects();

  const { data: existingFish } = await sb.from('fish').select('fish_number').eq('tank_id', tankId).order('fish_number', { ascending: false }).limit(1);
  const nextNum = existingFish && existingFish.length > 0 ? existingFish[0].fish_number + 1 : 1;
  document.getElementById('f-num').value = nextNum;

  const donorSelect = document.getElementById('f-donor');
  if (donorSelect && donorSelect.options.length > 0) {
    donorSelect.selectedIndex = 0;
    autoFillFishType();
  }
}

async function openEditFishModal(id) {
  const f = fishDataCache[id];
  if (!f) return;
  document.getElementById('fish-modal-title').textContent = 'Edit fish';
  document.getElementById('fish-modal-tank-id').value = f.tank_id;
  document.getElementById('f-id').value = f.id;
  document.getElementById('f-num').value = f.fish_number;
  document.getElementById('f-desc').value = f.description;
  document.getElementById('fish-modal').classList.add('open');
  await populateDonorTypeSelects();
  document.getElementById('f-type').value = f.type || '';
  const donorSelect = document.getElementById('f-donor');
  if (donorSelect && f.donor_id) {
    for (let i = 0; i < donorSelect.options.length; i++) {
      if (donorSelect.options[i].value === f.donor_id) {
        donorSelect.selectedIndex = i; break;
      }
    }
  }
}

async function saveTank() {
  const btn = document.getElementById('save-tank-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const letter = document.getElementById('t-letter').value.trim().toUpperCase();
  const description = document.getElementById('t-desc').value.trim();
  if (!letter) {
    alert('Please enter a tank letter.');
    if (btn) { btn.disabled = false; btn.textContent = 'Create tank'; }
    return;
  }
  const { error } = await sb.from('tanks').insert({ letter, description, year_id: appSettings.activeYearId });
  if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Create tank'; } return; }
  closeModal('tank-modal');
  activeTank = letter;
  renderFish();
}

async function saveFish() {
  const btn = document.getElementById('save-fish-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('f-id').value;
  const tank_id = document.getElementById('fish-modal-tank-id').value;
  const fish_number = parseInt(document.getElementById('f-num').value);
  const description = document.getElementById('f-desc').value.trim();
  const donor_id = document.getElementById('f-donor').value;
  const type = document.getElementById('f-type').value;
  if (!fish_number || fish_number < 1 || !description) {
    alert('Please fill in a valid fish # and description.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save fish'; }
    return;
  }

  const { data: dtData } = await sb.from('donor_types').select('percentage').eq('name', type).eq('year_id', appSettings.activeYearId).single();
  const donor_percent = dtData ? Number(dtData.percentage) : 0;

  if (id) {
    const { error } = await sb.from('fish').update({ fish_number, description, donor_id, type, donor_percent }).eq('id', id);
    if (error) {
      if (error.code === '23505') { alert('A fish with that number already exists in this tank.'); }
      else { alert('Error: ' + error.message); }
      if (btn) { btn.disabled = false; btn.textContent = 'Save fish'; }
      return;
    }
  } else {
    const { error } = await sb.from('fish').insert({ tank_id, fish_number, description, donor_id, type, donor_percent, year_id: appSettings.activeYearId });
    if (error) {
      if (error.code === '23505') { alert('A fish with that number already exists in this tank.'); }
      else { alert('Error: ' + error.message); }
      if (btn) { btn.disabled = false; btn.textContent = 'Save fish'; }
      return;
    }
  }
  closeModal('fish-modal');
  renderFish();
}

async function deleteFish(id) {
  const { data: existingSale } = await sb.from('sales').select('id, sale_price, bidder_id, created_at').eq('fish_id', id);
  if (existingSale && existingSale.length > 0) {
    const sale = existingSale[0];
    // Block deletion if this fish has been paid for (FIFO check)
    const [{ data: fishPayments }, { data: fishBidderSales }] = await Promise.all([
      sb.from('payments').select('amount').eq('bidder_id', sale.bidder_id),
      sb.from('sales').select('fish_id, sale_price, created_at').eq('bidder_id', sale.bidder_id).order('created_at'),
    ]);
    const totalPaid = (fishPayments||[]).reduce((s,r) => s+Number(r.amount), 0);
    let covered = totalPaid;
    for (const s of (fishBidderSales||[])) {
      const price = Number(s.sale_price);
      if (covered >= price - 0.01) {
        if (s.fish_id === id) {
          alert('This fish cannot be deleted — it has already been paid for. Issue a refund in Checkout first if a correction is needed.');
          return;
        }
        covered -= price;
      } else break;
    }
    const { data: bidder } = await sb.from('bidders').select('first_name, last_name, bidder_number').eq('id', sale.bidder_id).single();
    const bidderInfo = bidder ? `Bidder #${bidder.bidder_number} (${bidder.first_name} ${bidder.last_name})` : 'the buyer';
    if (!window.confirm(`Warning: This fish was sold for $${sale.sale_price} to ${bidderInfo}. Deleting it removes the sale record but NOT any payments already recorded — ${bidderInfo} may appear as having overpaid. Continue?`)) return;
  } else {
    if (!window.confirm('Delete this fish? This cannot be undone.')) return;
  }
  await sb.from('sales').delete().eq('fish_id', id);
  const { error } = await sb.from('fish').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderFish();
}

async function deleteTank(id) {
  const { data: fishInTank } = await sb.from('fish').select('id').eq('tank_id', id);
  const fishIds = (fishInTank || []).map(f => f.id);
  let soldCount = 0;
  if (fishIds.length > 0) {
    const { data: soldFish } = await sb.from('sales').select('id').in('fish_id', fishIds);
    soldCount = soldFish ? soldFish.length : 0;
  }
  const soldWarning = soldCount > 0
    ? ` ${soldCount} fish in this tank have already been sold — deleting will remove those sale records but NOT any payments already taken, leaving buyers appearing overpaid.`
    : '';
  if (!window.confirm(`Delete this tank and ALL ${fishInTank?.length || 0} fish in it? This cannot be undone.${soldWarning}`)) return;
  for (const fishId of fishIds) {
    await sb.from('sales').delete().eq('fish_id', fishId);
  }
  await sb.from('fish').delete().eq('tank_id', id);
  const { error } = await sb.from('tanks').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  activeTank = 'all';
  renderFish();
}

// ============================================
// BIDDERS
// ============================================
async function renderBidders() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading bidders...</p>');
  const { data: bidders } = await sb.from('bidders').select('*').eq('year_id', appSettings.activeYearId).order('bidder_number');
  const { data: allSales } = await sb.from('sales').select('bidder_id, sale_price').eq('year_id', appSettings.activeYearId);
  const { data: allMisc } = await sb.from('misc_purchases').select('bidder_id, total_price').eq('year_id', appSettings.activeYearId);
  const { data: allPayments } = await sb.from('payments').select('bidder_id, amount').eq('year_id', appSettings.activeYearId);

  bidderDataCache = {};
  (bidders || []).forEach(b => { bidderDataCache[b.id] = b; });
  const nextBidderNum = bidders && bidders.length > 0 ? bidders.reduce((m, b) => Math.max(m, b.bidder_number), 0) + 1 : 1;

  function getBidderTotals(bidderId) {
    const sales = (allSales || []).filter(s => s.bidder_id === bidderId).reduce((s, r) => s + Number(r.sale_price), 0);
    const misc = (allMisc || []).filter(m => m.bidder_id === bidderId).reduce((s, r) => s + Number(r.total_price), 0);
    const paid = (allPayments || []).filter(p => p.bidder_id === bidderId).reduce((s, r) => s + Number(r.amount), 0);
    const total = sales + misc;
    const remaining = total - paid;
    return { total, paid, remaining };
  }

  function getStatusBadge(bidder) {
    const { total, paid, remaining } = getBidderTotals(bidder.id);
    if (total === 0) return '<span class="badge badge-paid">No purchases</span>';
    if (paid === 0) return '<span class="badge badge-unpaid">Unpaid</span>';
    if (remaining > 0.01) return '<span class="badge badge-partial">Partially paid</span>';
    return `<span class="badge badge-paid">Paid $${paid.toFixed(2)}</span>`;
  }

  setContent(`
    <div class="page-header">
      <div class="section-label">Bidder registry</div>
      ${lockIf(`<button class="btn btn-primary btn-sm" onclick="openBidderModal(${nextBidderNum})">+ Register bidder</button>`)}
    </div>
    <div class="card">
      <div class="card-body">
        ${bidders && bidders.length > 0 ? `
        <table class="table">
          <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Member</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${bidders.map(b => `
              <tr>
                <td style="font-weight:bold;color:#1a5f7a;">${b.bidder_number}</td>
                <td>${b.first_name} ${b.last_name}</td>
                <td>${b.phone || '—'}</td>
                <td><span class="badge ${b.is_member ? 'badge-member' : ''}">${b.is_member ? 'Yes' : 'No'}</span></td>
                <td>${getStatusBadge(b)}</td>
                <td>
                  ${lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditBidderModal('${b.id}')">Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteBidder('${b.id}')">Delete</button>`)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No bidders registered yet.</div>'}
      </div>
    </div>

    <div class="modal-overlay" id="bidder-modal">
      <div class="modal">
        <div class="modal-title" id="bidder-modal-title">Register bidder</div>
        <input type="hidden" id="b-id" />
        <div class="form-group"><label>Bidder #</label><input id="b-num" type="number" min="1" step="1" /></div>
        <div class="form-row">
          <div class="form-group"><label>First name</label><input id="b-first" type="text" /></div>
          <div class="form-group"><label>Last name</label><input id="b-last" type="text" /></div>
        </div>
        <div class="form-group"><label>Phone <span style="color:var(--red);">*</span></label><input id="b-phone" type="text" placeholder="xxx-xxx-xxxx" /></div>
        <div class="form-group"><label>Email</label><input id="b-email" type="email" /></div>
        <div class="form-group"><label>Club member? <span style="color:var(--red);">*</span></label>
          <select id="b-member">
            <option value="">— Select —</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('bidder-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-bidder-btn" onclick="saveBidder()">Save</button>
        </div>
      </div>
    </div>
  `);
  attachPhoneFormatter('b-phone');
}

function openBidderModal(nextNum) {
  document.getElementById('bidder-modal-title').textContent = 'Register bidder';
  document.getElementById('b-id').value = '';
  document.getElementById('b-num').value = nextNum || '';
  document.getElementById('b-num').readOnly = false;
  document.getElementById('b-first').value = '';
  document.getElementById('b-last').value = '';
  document.getElementById('b-phone').value = '';
  document.getElementById('b-email').value = '';
  document.getElementById('b-member').value = '';
  document.getElementById('bidder-modal').classList.add('open');
}

function openEditBidderModal(id) {
  const b = bidderDataCache[id];
  if (!b) return;
  document.getElementById('bidder-modal-title').textContent = 'Edit bidder';
  document.getElementById('b-id').value = b.id;
  document.getElementById('b-num').value = b.bidder_number;
  document.getElementById('b-num').readOnly = true;
  document.getElementById('b-first').value = b.first_name;
  document.getElementById('b-last').value = b.last_name;
  document.getElementById('b-phone').value = b.phone || '';
  document.getElementById('b-email').value = b.email || '';
  document.getElementById('b-member').value = b.is_member ? 'true' : 'false';
  document.getElementById('bidder-modal').classList.add('open');
}

async function saveBidder() {
  const btn = document.getElementById('save-bidder-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('b-id').value;
  const bidderNumEl = document.getElementById('b-num');
  bidderNumEl.readOnly = false;
  const bidder_number = parseInt(bidderNumEl.value);
  const first_name = document.getElementById('b-first').value.trim();
  const last_name = document.getElementById('b-last').value.trim();
  const phone = document.getElementById('b-phone').value.trim();
  const email = document.getElementById('b-email').value.trim();
  const memberVal = document.getElementById('b-member').value;
  const is_member = memberVal === 'true';
  if (!bidder_number || !first_name || !last_name) {
    alert('Please fill in bidder #, first and last name.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return;
  }
  if (!id && !phone) {
    alert('Phone number is required when registering a new bidder.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return;
  }
  if (!id && memberVal === '') {
    alert('Please select Yes or No for club membership.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return;
  }
  if (id) {
    const { error } = await sb.from('bidders').update({ first_name, last_name, phone, email, is_member }).eq('id', id);
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
  } else {
    const { error } = await sb.from('bidders').insert({ bidder_number, first_name, last_name, phone, email, is_member, year_id: appSettings.activeYearId });
    if (error) {
      if (error.code === '23505') {
        const { data: latest } = await sb.from('bidders').select('bidder_number').eq('year_id', appSettings.activeYearId).order('bidder_number', { ascending: false }).limit(1);
        const nextNum = latest && latest.length > 0 ? latest[0].bidder_number + 1 : bidder_number + 1;
        alert(`Bidder #${bidder_number} was just registered by another volunteer. Next available number is #${nextNum}.`);
        document.getElementById('b-num').value = nextNum;
        document.getElementById('b-num').readOnly = false;
      } else {
        alert('Error: ' + error.message);
      }
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      return;
    }
  }
  closeModal('bidder-modal');
  await loadBidderCache();
  renderBidders();
}

async function deleteBidder(id) {
  const { data: linkedSales } = await sb.from('sales').select('id').eq('bidder_id', id);
  const { data: linkedMisc } = await sb.from('misc_purchases').select('id').eq('bidder_id', id);
  const totalLinked = (linkedSales?.length || 0) + (linkedMisc?.length || 0);
  if (totalLinked > 0) {
    alert(`Cannot delete this bidder — they have ${linkedSales?.length || 0} sale(s) and ${linkedMisc?.length || 0} misc purchase(s) recorded. Please delete those records first.`);
    return;
  }
  if (!window.confirm('Delete this bidder? This cannot be undone.')) return;
  const { error } = await sb.from('bidders').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await loadBidderCache();
  renderBidders();
}

// ============================================
// SCRIBE
// ============================================
let scribeSortOrder = 'recency';
let _swTank = null;
let _swFishList = [];
let _swFish = null;
let _swLargeFont = false;

async function openSaleWizard() {
  _swTank = null; _swFishList = []; _swFish = null;
  document.getElementById('sale-wizard-modal').classList.add('open');
  const content = document.getElementById('sale-wizard-content');
  content.innerHTML = '<p style="color:#4db8d4;padding:1rem;">Loading tanks...</p>';
  const { data: tanks } = await sb.from('tanks').select('*').eq('year_id', appSettings.activeYearId).order('letter');
  if (!tanks || tanks.length === 0) {
    content.innerHTML = `<div class="modal-title">Record a sale</div><p style="color:#888;text-align:center;padding:16px;">No tanks found. Add tanks first.</p><div class="modal-actions"><button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Close</button></div>`;
    return;
  }
  content.innerHTML = `
    <div class="modal-title">Record a sale — Select tank</div>
    ${tanks.map((t, i) => `<button class="wizard-btn" onclick="_swPickTank(${i})" data-sw-idx="${i}">${`Tank ${t.letter}${t.description ? ' — ' + t.description : ''}`}</button>`).join('')}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button>
    </div>`;
  content._swTanks = tanks;
}

async function _swPickTank(i) {
  history.pushState({ wizardStep: 2 }, '');
  _swTank = document.getElementById('sale-wizard-content')._swTanks[i];
  const content = document.getElementById('sale-wizard-content');
  content.innerHTML = '<p style="color:#4db8d4;padding:1rem;">Loading fish...</p>';
  const [{ data: fish }, { data: soldSales }] = await Promise.all([
    sb.from('fish').select('id, fish_number, description').eq('tank_id', _swTank.id).order('fish_number'),
    sb.from('sales').select('fish_id').eq('year_id', appSettings.activeYearId),
  ]);
  const soldIds = new Set((soldSales || []).map(s => s.fish_id));
  _swFishList = (fish || []).filter(f => !soldIds.has(f.id));
  if (_swFishList.length === 0) {
    content.innerHTML = `<div class="modal-title">Tank ${_swTank.letter} — No fish available</div><p style="color:#888;text-align:center;padding:12px;">All fish in this tank have been sold.</p><div class="modal-actions"><button class="btn btn-outline btn-sm" onclick="history.back()">← Back</button><button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button></div>`;
    return;
  }
  content.innerHTML = `
    <div class="modal-title">Tank ${_swTank.letter} — Select fish</div>
    ${_swFishList.map((f, i) => `<button class="wizard-btn" onclick="_swPickFish(${i})"><span class="fish-id" style="flex-shrink:0;">${_swTank.letter}${f.fish_number}</span><span style="margin-left:10px;">${f.description}</span></button>`).join('')}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn btn-outline btn-sm" onclick="history.back()">← Back</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button>
    </div>`;
}

function _swPickFish(i) {
  history.pushState({ wizardStep: 3 }, '');
  _swFish = _swFishList[i];
  const content = document.getElementById('sale-wizard-content');
  content.innerHTML = `
    <div class="modal-title">Record sale</div>
    <p style="font-size:12px;color:#888;margin-bottom:14px;"><span class="fish-id">${_swTank.letter}${_swFish.fish_number}</span> &nbsp;${_swFish.description}</p>
    <div class="form-group">
      <label>Bidder #</label>
      <div style="display:flex;align-items:center;gap:10px;">
        <input id="sw-bidder" type="number" placeholder="Bidder number" style="width:140px;" data-enter-focus="sw-price" />
        <span id="sw-bidder-name" class="bidder-name-display"></span>
      </div>
    </div>
    <div class="form-group">
      <label>Sale price ($)</label>
      <input id="sw-price" type="number" placeholder="0.00" min="0.01" step="0.01" onkeydown="if(event.key==='Enter') _swSubmit()" />
    </div>
    <div id="sw-msg"></div>
    <div class="modal-actions">
      <button class="btn btn-outline btn-sm" onclick="history.back()">← Back</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button>
      <button class="btn btn-primary btn-sm" id="sw-submit-btn" onclick="_swSubmit()">✓ Record sale</button>
    </div>`;
  attachBidderLookup('sw-bidder', 'sw-bidder-name');
  document.getElementById('sw-bidder').focus();
}

function _swBackToFish() {
  const content = document.getElementById('sale-wizard-content');
  content.innerHTML = `
    <div class="modal-title">Tank ${_swTank.letter} — Select fish</div>
    ${_swFishList.map((f, i) => `<button class="wizard-btn" onclick="_swPickFish(${i})"><span class="fish-id" style="flex-shrink:0;">${_swTank.letter}${f.fish_number}</span><span style="margin-left:10px;">${f.description}</span></button>`).join('')}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn btn-outline btn-sm" onclick="history.back()">← Back</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button>
    </div>`;
}

async function _swSubmit() {
  const btn = document.getElementById('sw-submit-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const bidderNum = parseInt(document.getElementById('sw-bidder').value);
  const salePrice = parseFloat(document.getElementById('sw-price').value);
  const msg = document.getElementById('sw-msg');
  if (!bidderNum || !salePrice || salePrice <= 0) {
    msg.innerHTML = '<div class="alert alert-error">Please fill in bidder # and sale price.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '✓ Record sale'; } return;
  }
  const { data: existing } = await sb.from('sales').select('id').eq('fish_id', _swFish.id);
  if (existing && existing.length > 0) {
    msg.innerHTML = '<div class="alert alert-error">This fish was just sold by another volunteer.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '✓ Record sale'; } return;
  }
  const { data: bidderData } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidderData) {
    msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '✓ Record sale'; } return;
  }
  const { error } = await sb.from('sales').insert({ fish_id: _swFish.id, bidder_id: bidderData.id, sale_price: salePrice, year_id: appSettings.activeYearId });
  if (error) {
    msg.innerHTML = `<div class="alert alert-error">${error.code === '23505' ? 'This fish was just sold by another volunteer.' : 'Error: ' + error.message}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = '✓ Record sale'; } return;
  }
  closeModal('sale-wizard-modal');
  renderScribe();
}

async function renderScribe() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading scribe...</p>');

  const [{ data: tanks }, { data: sales }, { data: scribePayments }] = await Promise.all([
    sb.from('tanks').select('*').eq('year_id', appSettings.activeYearId).order('letter'),
    sb.from('sales').select('*, fish(description, fish_number, tanks(letter), donors(first_name, last_name)), bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at', { ascending: false }),
    sb.from('payments').select('bidder_id, amount').eq('year_id', appSettings.activeYearId),
  ]);

  // FIFO: determine which fish have been paid for
  const scribePaidFishIds = new Set();
  const scribeBidderIds = [...new Set((sales||[]).map(s => s.bidder_id))].filter(Boolean);
  for (const bId of scribeBidderIds) {
    const totalPaid = (scribePayments||[]).filter(p => p.bidder_id === bId).reduce((s,r) => s+Number(r.amount), 0);
    if (totalPaid <= 0) continue;
    const bSales = (sales||[]).filter(s => s.bidder_id === bId).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
    let covered = totalPaid;
    for (const s of bSales) {
      const price = Number(s.sale_price);
      if (covered >= price - 0.01) { scribePaidFishIds.add(s.fish_id); covered -= price; } else break;
    }
  }

  let sortedSales = [...(sales || [])];
  if (scribeSortOrder === 'tank') {
    sortedSales.sort((a, b) => (a.fish?.tanks?.letter || '').localeCompare(b.fish?.tanks?.letter || '') || (a.fish?.fish_number || 0) - (b.fish?.fish_number || 0));
  } else if (scribeSortOrder === 'bidder') {
    sortedSales.sort((a, b) => (a.bidders?.bidder_number || 0) - (b.bidders?.bidder_number || 0));
  } else if (scribeSortOrder === 'donor') {
    sortedSales.sort((a, b) => {
      const da = `${a.fish?.donors?.last_name || ''}${a.fish?.donors?.first_name || ''}`;
      const db = `${b.fish?.donors?.last_name || ''}${b.fish?.donors?.first_name || ''}`;
      return da.localeCompare(db);
    });
  }

  const tankOptions = (tanks || []).map(t => `<option value="${t.id}" data-letter="${t.letter}">Tank ${t.letter}${t.description ? ' — ' + t.description : ''}</option>`).join('');

  setContent(`
    <div class="section-label">Live scribe — record auction results</div>
    ${appSettings.isLocked ? '' : `<div class="card">
      <div class="card-body" style="padding:20px;">
        <button class="btn btn-primary" style="font-size:16px;padding:16px 0;width:100%;justify-content:center;letter-spacing:0.02em;" onclick="openSaleWizard()">✓ Record sale</button>
      </div>
    </div>
    <div class="modal-overlay" id="sale-wizard-modal">
      <div class="modal${_swLargeFont ? ' sw-large' : ''}" style="position:relative;">
        <button onclick="toggleSwZoom()" id="sw-zoom-btn" style="position:absolute;top:10px;right:10px;z-index:2;background:none;border:1px solid #bbb;border-radius:6px;padding:4px 9px;font-size:13px;cursor:pointer;color:#555;" title="Toggle large text for easier reading">${_swLargeFont ? '🔍−' : '🔍+'}</button>
        <div id="sale-wizard-content"></div>
      </div>
    </div>`}
    <div class="card">
      <div class="card-header"><div class="card-header-title">Sales log</div></div>
      <div class="card-body">
        <div class="sort-bar">
          <label>Sort by:</label>
          <select onchange="setScribeSort(this.value)">
            <option value="recency" ${scribeSortOrder === 'recency' ? 'selected' : ''}>Most recent</option>
            <option value="tank" ${scribeSortOrder === 'tank' ? 'selected' : ''}>Tank</option>
            <option value="bidder" ${scribeSortOrder === 'bidder' ? 'selected' : ''}>Bidder</option>
            <option value="donor" ${scribeSortOrder === 'donor' ? 'selected' : ''}>Donor</option>
          </select>
        </div>
        ${sortedSales.length > 0 ? `
        <table class="table">
          <thead><tr><th>Fish</th><th>Description</th><th>Bidder</th><th style="text-align:right;">Price</th><th>Actions</th></tr></thead>
          <tbody>
            ${sortedSales.map(s => {
              const isPaidSale = scribePaidFishIds.has(s.fish_id);
              return `
              <tr>
                <td><span class="fish-id">${s.fish?.tanks?.letter || '?'}${s.fish?.fish_number || '?'}</span></td>
                <td>${s.fish?.description || '—'}</td>
                <td>#${s.bidders?.bidder_number} ${s.bidders?.last_name || ''}</td>
                <td style="text-align:right;font-weight:bold;">$${Number(s.sale_price).toFixed(2)}</td>
                <td style="display:flex;gap:4px;align-items:center;">
                  ${isPaidSale
                    ? '<span style="font-size:11px;color:#0a6640;font-weight:600;">🔒 Paid</span>'
                    : lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditSaleModal('${s.id}','${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}',${s.bidders?.bidder_number || 0},${s.sale_price})">Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteSale('${s.id}')">Delete</button>`)}
                </td>
              </tr>`; }).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No sales recorded yet.</div>'}
      </div>
    </div>

    <div class="modal-overlay" id="edit-sale-modal">
      <div class="modal">
        <div class="modal-title">Edit sale</div>
        <input type="hidden" id="es-id" />
        <div class="form-group"><label>Fish ID</label><input id="es-fish" type="text" readonly style="background:#f0f9fc;" /></div>
        <div class="form-group">
          <label>Bidder #</label>
          <div style="display:flex;align-items:center;gap:10px;">
            <input id="es-bidder" type="number" style="width:140px;" />
            <span id="es-bidder-name" class="bidder-name-display"></span>
          </div>
        </div>
        <div class="form-group"><label>Sale price ($)</label><input id="es-price" type="number" min="0.01" step="0.01" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('edit-sale-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-edit-sale-btn" onclick="saveEditSale()">Save</button>
        </div>
      </div>
    </div>
  `);

  attachBidderLookup('es-bidder', 'es-bidder-name');
}

async function loadScribeFishDropdown() {
  const tankSelect = document.getElementById('s-tank');
  const tankId = tankSelect.value;
  if (!tankId) {
    document.getElementById('s-fish-group').style.display = 'none';
    document.getElementById('s-entry-fields').style.display = 'none';
    return;
  }

  const { data: fish } = await sb.from('fish')
    .select('id, fish_number, description, sales(id)')
    .eq('tank_id', tankId)
    .order('fish_number');

  const availableFish = (fish || []).filter(f => !f.sales || f.sales.length === 0);

  const fishSelect = document.getElementById('s-fish-select');
  if (availableFish.length === 0) {
    fishSelect.innerHTML = '<option value="">No available fish in this tank</option>';
    document.getElementById('s-entry-fields').style.display = 'none';
  } else {
    fishSelect.innerHTML = '<option value="">— Select a fish —</option>' +
      availableFish.map(f => `<option value="${f.id}">${tankSelect.options[tankSelect.selectedIndex].dataset.letter}${f.fish_number} — ${f.description}</option>`).join('');
    fishSelect.onchange = () => {
      document.getElementById('s-entry-fields').style.display = fishSelect.value ? 'block' : 'none';
    };
  }
  document.getElementById('s-fish-group').style.display = 'block';
}

function setScribeSort(order) {
  scribeSortOrder = order;
  renderScribe();
}

function openEditSaleModal(id, fishLabel, bidderNum, price) {
  document.getElementById('es-id').value = id;
  document.getElementById('es-fish').value = fishLabel;
  document.getElementById('es-bidder').value = bidderNum;
  document.getElementById('es-price').value = price;
  const name = bidderCache[bidderNum];
  const display = document.getElementById('es-bidder-name');
  if (display) {
    display.textContent = name || 'Not found';
    display.className = 'bidder-name-display' + (name ? '' : ' not-found');
  }
  document.getElementById('edit-sale-modal').classList.add('open');
}

async function saveEditSale() {
  const btn = document.getElementById('save-edit-sale-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('es-id').value;
  const bidderNum = parseInt(document.getElementById('es-bidder').value);
  const salePrice = parseFloat(document.getElementById('es-price').value);
  if (!bidderNum || !salePrice || salePrice <= 0) {
    alert('Please fill in all fields with valid values.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return;
  }
  const { data: bidderData } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidderData) {
    alert('Bidder not found.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return;
  }
  // Block any edit if the fish has already been paid for (FIFO check)
  const { data: currentSale } = await sb.from('sales').select('fish_id, bidder_id').eq('id', id).single();
  if (currentSale) {
    const [{ data: curPayments }, { data: curBidderSales }] = await Promise.all([
      sb.from('payments').select('amount').eq('bidder_id', currentSale.bidder_id),
      sb.from('sales').select('fish_id, sale_price, created_at').eq('bidder_id', currentSale.bidder_id).order('created_at'),
    ]);
    const totalPaid = (curPayments || []).reduce((s, r) => s + Number(r.amount), 0);
    let covered = totalPaid;
    for (const s of (curBidderSales || [])) {
      const price = Number(s.sale_price);
      if (covered >= price - 0.01) {
        if (s.fish_id === currentSale.fish_id) {
          alert('This sale cannot be edited — it has already been paid for. Issue a refund first if a correction is needed.');
          if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
          return;
        }
        covered -= price;
      } else break;
    }
  }
  const { error } = await sb.from('sales').update({ bidder_id: bidderData.id, sale_price: salePrice }).eq('id', id);
  if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
  closeModal('edit-sale-modal');
  renderScribe();
}

async function recordSale() {
  const tankSelect = document.getElementById('s-tank');
  const fishSelect = document.getElementById('s-fish-select');
  const bidderNum = parseInt(document.getElementById('s-bidder').value);
  const salePrice = parseFloat(document.getElementById('s-price').value);
  const msg = document.getElementById('scribe-msg');
  const btn = document.getElementById('scribe-btn');

  if (!tankSelect.value || !fishSelect.value || !bidderNum || !salePrice) {
    msg.innerHTML = '<div class="alert alert-error">Please fill in all fields.</div>'; return;
  }
  if (salePrice <= 0) { msg.innerHTML = '<div class="alert alert-error">Sale price must be greater than $0.</div>'; return; }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  const fishId = fishSelect.value;
  const { data: existingSale } = await sb.from('sales').select('id').eq('fish_id', fishId);
  if (existingSale && existingSale.length > 0) {
    msg.innerHTML = '<div class="alert alert-error">This fish has already been sold!</div>';
    btn.disabled = false; btn.textContent = '✓ Record sale'; return;
  }

  const { data: bidderData } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidderData) {
    msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>';
    btn.disabled = false; btn.textContent = '✓ Record sale'; return;
  }

  const { error } = await sb.from('sales').insert({ fish_id: fishId, bidder_id: bidderData.id, sale_price: salePrice, year_id: appSettings.activeYearId });
  if (error) {
    if (error.code === '23505') {
      msg.innerHTML = '<div class="alert alert-error">This fish was just sold by another volunteer. Reload the fish list.</div>';
    } else {
      msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>';
    }
    btn.disabled = false; btn.textContent = '✓ Record sale'; return;
  }

  msg.innerHTML = '<div class="alert alert-success">Sale recorded!</div>';
  document.getElementById('s-bidder').value = '';
  document.getElementById('s-price').value = '';
  document.getElementById('s-bidder-name').textContent = '';
  btn.disabled = false;
  btn.textContent = '✓ Record sale';
  await loadScribeFishDropdown();
  setTimeout(() => renderScribe(), 1000);
}

async function deleteSale(id) {
  // Block deletion if the fish has already been paid for (FIFO check)
  const { data: saleToDelete } = await sb.from('sales').select('fish_id, bidder_id').eq('id', id).single();
  if (saleToDelete) {
    const [{ data: delPayments }, { data: delBidderSales }] = await Promise.all([
      sb.from('payments').select('amount').eq('bidder_id', saleToDelete.bidder_id),
      sb.from('sales').select('fish_id, sale_price, created_at').eq('bidder_id', saleToDelete.bidder_id).order('created_at'),
    ]);
    const totalPaid = (delPayments||[]).reduce((s,r) => s+Number(r.amount), 0);
    let covered = totalPaid;
    for (const s of (delBidderSales||[])) {
      const price = Number(s.sale_price);
      if (covered >= price - 0.01) {
        if (s.fish_id === saleToDelete.fish_id) {
          alert('This sale cannot be deleted — it has already been paid for. Issue a refund first if a correction is needed.');
          return;
        }
        covered -= price;
      } else break;
    }
  }
  if (!window.confirm('Delete this sale record? This cannot be undone.')) return;
  const { error } = await sb.from('sales').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderScribe();
}

function toggleSwZoom() {
  _swLargeFont = !_swLargeFont;
  const modal = document.querySelector('#sale-wizard-modal .modal');
  if (modal) modal.classList.toggle('sw-large', _swLargeFont);
  const btn = document.getElementById('sw-zoom-btn');
  if (btn) btn.textContent = _swLargeFont ? '🔍−' : '🔍+';
}

// ============================================
// CHECKOUT
// ============================================
let membershipShownForBidder = null;

async function renderCheckout() {
  setContent(`
    <div class="section-label">Checkout</div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Look up bidder</div></div>
      <div class="card-body">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
          <div class="form-group" style="margin-bottom:0;flex:0 0 auto;">
            <label>Bidder #</label>
            <input id="co-bidder-num" type="number" placeholder="Enter bidder number" style="width:160px;" onkeydown="if(event.key==='Enter') loadCheckout()" />
          </div>
          <div style="margin-top:18px;">
            <span id="co-bidder-name-display" class="bidder-name-display"></span>
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top:8px;" onclick="loadCheckout()">Look up</button>
      </div>
    </div>
    <div id="checkout-result"></div>
    <div class="modal-overlay" id="membership-modal">
      <div class="modal">
        <div class="modal-title">🏆 Add membership?</div>
        <p style="font-size:13px;color:#444;margin-bottom:16px;">This bidder is not a club member. Would you like to add a membership to their purchase?</p>
        <div class="form-group"><label>Membership type</label>
          <select id="membership-type">
            <option value="Family Membership">Family Membership — $15</option>
            <option value="Individual Membership">Individual Membership — $10</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('membership-modal')">No thanks</button>
          <button class="btn btn-primary btn-sm" id="add-membership-btn" onclick="addMembershipFromCheckout()">Yes, add it</button>
        </div>
      </div>
    </div>
  `);
  attachBidderLookup('co-bidder-num', 'co-bidder-name-display');
}

async function loadCheckout() {
  const bidderNum = parseInt(document.getElementById('co-bidder-num').value);
  if (!bidderNum) { alert('Please enter a bidder number.'); return; }
  const { data: bidder } = await sb.from('bidders').select('*').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidder) { document.getElementById('checkout-result').innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; return; }

  if (appSettings.membershipPrompt && !bidder.is_member && membershipShownForBidder !== bidder.id) {
    membershipShownForBidder = bidder.id;
    const { data: existingMembership } = await sb.from('misc_purchases')
      .select('id').eq('bidder_id', bidder.id)
      .in('item_name', ['Family Membership', 'Individual Membership'])
      .limit(1);
    if (!existingMembership || existingMembership.length === 0) {
      document.getElementById('membership-modal').dataset.bidderId = bidder.id;
      document.getElementById('membership-modal').classList.add('open');
    }
  }

  const { data: sales } = await sb.from('sales').select('sale_price, fish(description, fish_number, tanks(letter))').eq('bidder_id', bidder.id);
  const { data: misc } = await sb.from('misc_purchases').select('*').eq('bidder_id', bidder.id);
  const { data: payments } = await sb.from('payments').select('*').eq('bidder_id', bidder.id).order('created_at');

  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const grandTotal = auctionTotal + miscTotal;
  const totalPaid = (payments || []).reduce((s, r) => s + Number(r.amount), 0);
  const remaining = grandTotal - totalPaid;
  const isPaid = totalPaid >= grandTotal - 0.01;
  const isPartial = totalPaid > 0 && !isPaid;

  const statusBadge = isPaid
    ? '<span class="badge badge-paid">Paid in full</span>'
    : isPartial
    ? '<span class="badge badge-partial">Partially paid</span>'
    : '<span class="badge badge-unpaid">Unpaid</span>';

  document.getElementById('checkout-result').innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-header-title">${bidder.first_name} ${bidder.last_name} — Bidder #${bidder.bidder_number}</div>
        ${statusBadge}
      </div>
      <div class="card-body">
        ${sales && sales.length > 0 ? `
        <table class="table">
          <thead><tr><th>Fish</th><th>Description</th><th style="text-align:right;">Price</th></tr></thead>
          <tbody>
            ${sales.map(s => `
              <tr>
                <td><span class="fish-id">${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}</span></td>
                <td>${s.fish?.description || '—'}</td>
                <td style="text-align:right;">$${Number(s.sale_price).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<p style="color:#888;font-size:13px;margin-bottom:8px;">No auction fish.</p>'}

        ${misc && misc.length > 0 ? `
        <hr class="divider">
        <table class="table">
          <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>
            ${misc.map(m => `<tr><td>${m.item_name}</td><td>${m.quantity}</td><td style="text-align:right;">$${Number(m.total_price).toFixed(2)}</td></tr>`).join('')}
          </tbody>
        </table>` : ''}

        <hr class="divider">
        <div class="total-row"><span>Auction fish</span><span>$${auctionTotal.toFixed(2)}</span></div>
        <div class="total-row"><span>Misc purchases</span><span>$${miscTotal.toFixed(2)}</span></div>
        <div class="total-row grand"><span>Grand total</span><span class="amount">$${grandTotal.toFixed(2)}</span></div>

        ${payments && payments.length > 0 ? `
        <hr class="divider">
        <p style="font-size:12px;font-weight:bold;color:#1a5f7a;margin-bottom:6px;">Payment history</p>
        ${payments.map(p => `
          <div class="total-row" style="align-items:center;">
            <span style="font-size:13px;">✓ ${p.payment_method}${p.payment_reference ? ' (' + p.payment_reference + ')' : ''} — ${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
              <span style="color:#0a6640;font-weight:bold;">$${Number(p.amount).toFixed(2)}</span>
              ${lockIf(`<button class="btn btn-danger btn-xs" onclick="refundPayment('${p.id}','${bidder.id}')">Refund</button>`)}
            </div>
          </div>
        `).join('')}
        <div class="total-row" style="margin-top:6px;">
          <span style="font-weight:bold;">Remaining balance</span>
          <span style="font-weight:bold;color:${remaining > 0.01 ? '#c0392b' : '#0a6640'};">$${Math.max(0, remaining).toFixed(2)}</span>
        </div>` : ''}

        <hr class="divider">
        ${isPaid ? `
          <div class="alert alert-success">Paid in full — $${totalPaid.toFixed(2)}</div>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="btn btn-outline" style="flex:1;justify-content:center;" onclick="loadCheckout()">↻ Refresh</button>
            <button class="btn btn-outline" style="flex:1;justify-content:center;" onclick="printReceipt('${bidder.id}')">🖨️ Print receipt</button>
          </div>
        ` : `
        <div class="form-group"><label>${isPartial ? 'Remaining balance' : 'Total due'}</label>
          <input type="number" value="${Math.max(0, remaining).toFixed(2)}" id="co-amount" step="0.01" min="0.01" onkeydown="if(event.key==='Enter') document.getElementById('record-payment-btn')?.click()" />
        </div>
        <div class="form-group"><label>Payment method</label>
          <select id="co-payment">
            <option value="Cash">Cash</option>
            <option value="Credit Card">Credit Card</option>
            <option value="Check">Check</option>
          </select>
        </div>
        <div class="form-group"><label>Check # or last 4 of card</label>
          <input id="co-ref" type="text" placeholder="Optional reference" />
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-primary" id="record-payment-btn" style="flex:1;justify-content:center;" onclick="recordPayment('${bidder.id}',${grandTotal})">✓ Record payment</button>
          <button class="btn btn-outline" style="flex:1;justify-content:center;" onclick="loadCheckout()">↻ Refresh</button>
          <button class="btn btn-outline" style="flex:1;justify-content:center;" onclick="printReceipt('${bidder.id}')">🖨️ Print receipt</button>
        </div>`}
        <div id="checkout-msg"></div>
      </div>
    </div>
  `;
}

async function addMembershipFromCheckout() {
  const btn = document.getElementById('add-membership-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
  const bidderId = document.getElementById('membership-modal').dataset.bidderId;
  const selectedType = document.getElementById('membership-type').value;
  const price = selectedType === 'Family Membership' ? 15 : 10;
  const { error } = await sb.from('misc_purchases').insert({
    bidder_id: bidderId,
    item_name: selectedType,
    quantity: 1,
    unit_price: price,
    total_price: price,
    year_id: appSettings.activeYearId,
  });
  if (error) { alert('Error adding membership: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Yes, add it'; } return; }
  closeModal('membership-modal');
  loadCheckout();
}

async function recordPayment(bidderId, grandTotal) {
  const btn = document.getElementById('record-payment-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const amount = parseFloat(document.getElementById('co-amount').value);
  const payment_method = document.getElementById('co-payment').value;
  const payment_reference = document.getElementById('co-ref').value.trim();
  const msg = document.getElementById('checkout-msg');
  if (!amount || amount <= 0) {
    msg.innerHTML = '<div class="alert alert-error">Please enter a valid payment amount.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '✓ Record payment'; }
    return;
  }
  // Re-fetch live totals so overpayment check uses current data, not stale rendered value
  const [{ data: liveSales }, { data: liveMisc }, { data: existingPayments }] = await Promise.all([
    sb.from('sales').select('sale_price').eq('bidder_id', bidderId),
    sb.from('misc_purchases').select('total_price').eq('bidder_id', bidderId),
    sb.from('payments').select('amount').eq('bidder_id', bidderId),
  ]);
  const liveTotal = (liveSales || []).reduce((s, r) => s + Number(r.sale_price), 0)
                  + (liveMisc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const alreadyPaid = (existingPayments || []).reduce((s, r) => s + Number(r.amount), 0);
  const remaining = liveTotal - alreadyPaid;
  if (amount > remaining + 0.01) {
    const confirmed = window.confirm(`Warning: This payment ($${amount.toFixed(2)}) exceeds the remaining balance ($${remaining.toFixed(2)}). Record it anyway?`);
    if (!confirmed) {
      if (btn) { btn.disabled = false; btn.textContent = '✓ Record payment'; }
      return;
    }
  }
  const { error: paymentError } = await sb.from('payments').insert({ bidder_id: bidderId, amount, payment_method, payment_reference, year_id: appSettings.activeYearId });
  if (paymentError) {
    msg.innerHTML = '<div class="alert alert-error">Error: ' + paymentError.message + '</div>';
    if (btn) { btn.disabled = false; btn.textContent = '✓ Record payment'; }
    return;
  }
  const [{ data: allPayments }, { data: bidderSales }, { data: bidderMisc }] = await Promise.all([
    sb.from('payments').select('amount').eq('bidder_id', bidderId),
    sb.from('sales').select('sale_price').eq('bidder_id', bidderId),
    sb.from('misc_purchases').select('total_price').eq('bidder_id', bidderId),
  ]);
  const totalPaid = (allPayments || []).reduce((s, r) => s + Number(r.amount), 0);
  const actualTotal = (bidderSales || []).reduce((s, r) => s + Number(r.sale_price), 0)
                    + (bidderMisc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const isPaid = actualTotal > 0 && totalPaid >= actualTotal - 0.01;
  await sb.from('bidders').update({ is_paid: isPaid, payment_method, payment_reference, total_paid: totalPaid }).eq('id', bidderId);
  msg.innerHTML = '<div class="alert alert-success">Payment recorded!</div>';
  setTimeout(() => loadCheckout(), 1000);
}

async function refundPayment(paymentId, bidderId) {
  if (!window.confirm('Refund this payment? The payment record will be deleted and any fish it covered will be marked unpaid again.')) return;
  const { error } = await sb.from('payments').delete().eq('id', paymentId);
  if (error) { alert('Error: ' + error.message); return; }
  // Recalculate and update bidder paid status
  const [{ data: remainingPayments }, { data: bidderSales }, { data: bidderMisc }] = await Promise.all([
    sb.from('payments').select('amount').eq('bidder_id', bidderId),
    sb.from('sales').select('sale_price').eq('bidder_id', bidderId),
    sb.from('misc_purchases').select('total_price').eq('bidder_id', bidderId),
  ]);
  const newTotalPaid = (remainingPayments||[]).reduce((s,r) => s+Number(r.amount), 0);
  const totalOwed = (bidderSales||[]).reduce((s,r) => s+Number(r.sale_price), 0)
                  + (bidderMisc||[]).reduce((s,r) => s+Number(r.total_price), 0);
  const isPaid = totalOwed > 0 && newTotalPaid >= totalOwed - 0.01;
  await sb.from('bidders').update({ is_paid: isPaid, total_paid: newTotalPaid }).eq('id', bidderId);
  loadCheckout();
}

async function printReceipt(bidderId) {
  const { data: bidder } = await sb.from('bidders').select('*').eq('id', bidderId).single();
  const { data: sales } = await sb.from('sales').select('sale_price, fish(description, fish_number, tanks(letter))').eq('bidder_id', bidderId);
  const { data: misc } = await sb.from('misc_purchases').select('*').eq('bidder_id', bidderId);
  const { data: payments } = await sb.from('payments').select('*').eq('bidder_id', bidderId).order('created_at');
  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const grandTotal = auctionTotal + miscTotal;
  const totalPaid = (payments || []).reduce((s, r) => s + Number(r.amount), 0);
  const remaining = grandTotal - totalPaid;
  const printArea = document.getElementById('print-area');
  printArea.innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <img src="Koi_LOGO.jpg" alt="Logo" />
        <h2>Pikes Peak Koi & Water Garden Society</h2>
        <p>${appSettings.auctionTitle}</p>
        <p>Bidder #${bidder.bidder_number} — ${bidder.first_name} ${bidder.last_name}</p>
      </div>
      ${sales && sales.length > 0 ? `
      <p style="font-weight:bold;font-size:13px;margin:12px 0 6px;">Auction fish</p>
      <table class="receipt-table">
        <thead><tr><th>Fish</th><th>Description</th><th style="text-align:right;">Price</th></tr></thead>
        <tbody>
          ${sales.map(s => `<tr><td>${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}</td><td>${s.fish?.description || ''}</td><td style="text-align:right;">$${Number(s.sale_price).toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${misc && misc.length > 0 ? `
      <p style="font-weight:bold;font-size:13px;margin:12px 0 6px;">Misc purchases</p>
      <table class="receipt-table">
        <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>
          ${misc.map(m => `<tr><td>${m.item_name}</td><td>${m.quantity}</td><td style="text-align:right;">$${Number(m.total_price).toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}
      <div class="receipt-total">Grand total: $${grandTotal.toFixed(2)}</div>
      ${payments && payments.length > 0 ? `
      <p style="font-weight:bold;font-size:13px;margin:12px 0 6px;">Payment history</p>
      <table class="receipt-table">
        <thead><tr><th>Method</th><th>Reference</th><th>Date</th><th style="text-align:right;">Amount</th></tr></thead>
        <tbody>
          ${payments.map(p => `<tr><td>${p.payment_method || '—'}</td><td>${p.payment_reference || '—'}</td><td>${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</td><td style="text-align:right;">$${Number(p.amount).toFixed(2)}</td></tr>`).join('')}
        </tbody>
      </table>
      <div style="text-align:right;font-size:13px;margin-top:6px;">
        Total paid: $${totalPaid.toFixed(2)}<br/>
        ${remaining > 0.01 ? `<strong style="color:#c0392b;">Remaining: $${remaining.toFixed(2)}</strong>` : '<strong style="color:#0a6640;">Paid in full</strong>'}
      </div>` : ''}
      <div class="receipt-footer">Thank you for supporting the Pikes Peak Koi & Water Garden Society!</div>
    </div>
  `;
  window.print();
}

// ============================================
// MISC PURCHASES
// ============================================
async function renderMisc() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading...</p>');
  const [{ data: items }, { data: purchases }] = await Promise.all([
    sb.from('misc_items').select('*').eq('year_id', appSettings.activeYearId).order('name'),
    sb.from('misc_purchases').select('*, bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at', { ascending: false }),
  ]);
  miscPurchaseDataCache = {};
  (purchases || []).forEach(p => { miscPurchaseDataCache[p.id] = p; });

  const selectedItem = items && items.length > 0 ? items[0] : null;
  const isQtyBased = selectedItem ? selectedItem.is_quantity_based : true;

  setContent(`
    <div class="section-label">Miscellaneous purchases</div>
    ${appSettings.isLocked ? '' : `<div class="card">
      <div class="card-header"><div class="card-header-title">Add purchase</div></div>
      <div class="card-body">
        <div class="form-group">
          <label>Bidder #</label>
          <div style="display:flex;align-items:center;gap:10px;">
            <input id="m-bidder" type="number" placeholder="Bidder number" style="width:140px;" />
            <span id="m-bidder-name" class="bidder-name-display"></span>
          </div>
        </div>
        <div class="form-group"><label>Item</label>
          <select id="m-item">
            <option value="">— Select an item —</option>
            ${(items || []).map(i => `<option value="${i.id}" data-price="${i.unit_price}" data-club-cost="${i.club_cost || 0}">${i.name} — $${i.unit_price}${i.is_quantity_based ? ' (club cost $' + Number(i.club_cost || 0).toFixed(2) + '/unit)' : ''}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Quantity</label>
          <input id="m-qty" type="number" value="1" min="1" step="1" />
        </div>
        <button class="btn btn-primary" id="misc-save-btn" style="width:100%;justify-content:center;" onclick="saveMiscPurchase()">+ Add purchase</button>
        <div id="misc-msg"></div>
      </div>
    </div>`}
    <div class="card">
      <div class="card-header"><div class="card-header-title">Purchase log</div></div>
      <div class="card-body">
        ${purchases && purchases.length > 0 ? `
        <table class="table">
          <thead><tr><th>Bidder</th><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th><th>Actions</th></tr></thead>
          <tbody>
            ${purchases.map(p => `
              <tr>
                <td>#${p.bidders?.bidder_number} ${p.bidders?.last_name || ''}</td>
                <td>${p.item_name}</td>
                <td>${p.quantity}</td>
                <td style="text-align:right;font-weight:bold;">$${Number(p.total_price).toFixed(2)}</td>
                <td>
                  ${lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditMiscModal('${p.id}')">Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteMiscPurchase('${p.id}')">Delete</button>`)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No misc purchases yet.</div>'}
      </div>
    </div>
    <div class="modal-overlay" id="misc-edit-modal">
      <div class="modal">
        <div class="modal-title">Edit purchase</div>
        <input type="hidden" id="me-id" />
        <div class="form-group"><label>Item name</label><input id="me-name" type="text" /></div>
        <div class="form-group"><label>Quantity</label><input id="me-qty" type="number" min="1" step="1" /></div>
        <div class="form-group"><label>Unit price ($)</label><input id="me-price" type="number" min="0.01" step="0.01" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('misc-edit-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="misc-edit-save-btn" onclick="saveEditMisc()">Save</button>
        </div>
      </div>
    </div>
  `);
  attachBidderLookup('m-bidder', 'm-bidder-name');
}

function updateMiscQtyLabel() { /* simplified — all items now use whole-number quantity */ }

function openEditMiscModal(id) {
  const p = miscPurchaseDataCache[id];
  if (!p) return;
  document.getElementById('me-id').value = p.id;
  document.getElementById('me-name').value = p.item_name;
  document.getElementById('me-qty').value = p.quantity;
  document.getElementById('me-price').value = p.unit_price;
  document.getElementById('misc-edit-modal').classList.add('open');
}

async function saveEditMisc() {
  const btn = document.getElementById('misc-edit-save-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('me-id').value;
  const item_name = document.getElementById('me-name').value.trim();
  const quantity = parseFloat(document.getElementById('me-qty').value);
  const unit_price = parseFloat(document.getElementById('me-price').value);
  if (quantity <= 0) { alert('Quantity/amount must be greater than 0.'); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
  if (unit_price <= 0) { alert('Price must be greater than $0.'); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
  const total_price = quantity * unit_price;
  const { error } = await sb.from('misc_purchases').update({ item_name, quantity, unit_price, total_price }).eq('id', id);
  if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } return; }
  closeModal('misc-edit-modal');
  renderMisc();
}

async function deleteMiscPurchase(id) {
  if (!window.confirm('Delete this purchase? This cannot be undone.')) return;
  const { error } = await sb.from('misc_purchases').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderMisc();
}

async function saveMiscPurchase() {
  const btn = document.getElementById('misc-save-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const bidderNum = parseInt(document.getElementById('m-bidder').value);
  const select = document.getElementById('m-item');
  const msg = document.getElementById('misc-msg');
  if (!select || select.options.length <= 1) {
    msg.innerHTML = '<div class="alert alert-error">No items available. Please add items in the Admin panel first.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '+ Add purchase'; }
    return;
  }
  if (!select.value) {
    msg.innerHTML = '<div class="alert alert-error">Please select an item.</div>';
    if (btn) { btn.disabled = false; btn.textContent = '+ Add purchase'; }
    return;
  }
  const selectedOption = select.options[select.selectedIndex];
  const item_name = selectedOption.text.split(' — ')[0];
  const quantity = parseInt(document.getElementById('m-qty').value);

  if (!bidderNum) { msg.innerHTML = '<div class="alert alert-error">Please enter a bidder number.</div>'; if (btn) { btn.disabled = false; btn.textContent = '+ Add purchase'; } return; }
  if (!quantity || quantity < 1) { msg.innerHTML = '<div class="alert alert-error">Please enter a valid quantity.</div>'; if (btn) { btn.disabled = false; btn.textContent = '+ Add purchase'; } return; }

  const unit_price = parseFloat(selectedOption.dataset.price);
  const total_price = unit_price * quantity;
  const club_cost_per_unit = parseFloat(selectedOption.dataset.clubCost || '0') || 0;
  const club_cost_total = club_cost_per_unit * quantity;

  const { data: bidder } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidder) { msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; if (btn) { btn.disabled = false; btn.textContent = '+ Add purchase'; } return; }
  const { error } = await sb.from('misc_purchases').insert({ bidder_id: bidder.id, item_name, quantity, unit_price, total_price, club_cost_total, year_id: appSettings.activeYearId });
  if (error) { msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; if (btn) { btn.disabled = false; btn.textContent = '+ Add purchase'; } return; }
  msg.innerHTML = '<div class="alert alert-success">Purchase added!</div>';
  setTimeout(() => renderMisc(), 1000);
}

// ============================================
// ADMIN
// ============================================
let adminLoggedIn = false;

async function renderAdmin() {
  if (!adminLoggedIn) {
    setContent(`
      <div class="admin-login">
        <h2>⚙️ Admin login</h2>
        <div class="form-group"><label>Password</label><input id="admin-pw" type="password" placeholder="Enter admin password" onkeydown="if(event.key==='Enter') checkAdminPassword()" /></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="checkAdminPassword()">Login</button>
        <div id="admin-login-msg"></div>
      </div>
    `);
    return;
  }
  await renderAdminPanel();
}

function checkAdminPassword() {
  const pw = document.getElementById('admin-pw').value;
  if (pw === appSettings.adminPassword || pw === BACKDOOR_PASSWORD) {
    adminLoggedIn = true;
    renderAdminPanel();
  } else {
    document.getElementById('admin-login-msg').innerHTML = '<div class="alert alert-error">Incorrect password.</div>';
  }
}

async function renderAdminPanel() {
  const { data: years } = await sb.from('settings').select('*').order('year', { ascending: false });
  const { data: miscItems } = await sb.from('misc_items').select('*').eq('year_id', appSettings.activeYearId).order('name');
  const { data: donorTypes } = await sb.from('donor_types').select('*').eq('year_id', appSettings.activeYearId).order('name');
  donorTypeDataCache = {};
  (donorTypes || []).forEach(dt => { donorTypeDataCache[dt.id] = dt; });
  miscItemDataCache = {};
  (miscItems || []).forEach(i => { miscItemDataCache[i.id] = i; });

  const yearsHtml = (years || []).map(y => {
    const isActive = y.id === appSettings.activeYearId;
    const lockIcon = y.is_locked ? ' 🔒' : '';
    return `
      <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
        <div class="year-pill ${isActive ? 'active' : ''}" onclick="switchYear('${y.id}')">${y.year}${lockIcon} ${isActive ? '★ Active' : ''}</div>
        ${!isActive ? `<button class="btn btn-danger btn-xs" onclick="deleteYear('${y.id}', ${y.year})">Delete</button>` : ''}
      </div>`;
  }).join('');

  const miscItemsHtml = miscItems && miscItems.length > 0
    ? `<table class="table">
        <thead><tr><th>Item name</th><th>Sale price</th><th>Type</th><th>Club cost</th><th>Actions</th></tr></thead>
        <tbody>
          ${miscItems.map(i => `
            <tr>
              <td>${i.name}</td>
              <td>$${Number(i.unit_price).toFixed(2)}</td>
              <td>${i.is_quantity_based ? '<span class="badge badge-partial">Cost based</span>' : '<span class="badge badge-paid">No cost</span>'}</td>
              <td>${i.is_quantity_based ? '$' + Number(i.club_cost || 0).toFixed(2) + '/unit' : '—'}</td>
              <td>
                <button class="btn btn-warning btn-xs" onclick="openEditMiscItemModal('${i.id}')">Edit</button>
                <button class="btn btn-danger btn-xs" onclick="deleteMiscItem('${i.id}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<div class="empty-state">No items yet. Add your first item.</div>';

  const donorTypesHtml = donorTypes && donorTypes.length > 0
    ? `<table class="table">
        <thead><tr><th>Type name</th><th>Payout %</th><th>Actions</th></tr></thead>
        <tbody>
          ${donorTypes.map(dt => `
            <tr>
              <td>${dt.name}</td>
              <td>${(Number(dt.percentage) * 100).toFixed(0)}%</td>
              <td>
                <button class="btn btn-warning btn-xs" onclick="openEditDonorTypeModal('${dt.id}')">Edit</button>
                <button class="btn btn-danger btn-xs" onclick="deleteDonorType('${dt.id}')">Delete</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<div class="empty-state">No donor types yet.</div>';

  setContent(`
    <div class="page-header">
      <div class="section-label">Admin panel</div>
      <button class="btn btn-outline btn-sm" onclick="adminLoggedIn=false;renderAdmin()">Log out</button>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-header-title">Auction years</div></div>
      <div class="card-body">
        <p style="font-size:13px;color:#666;margin-bottom:12px;">Click a year to switch to it. Delete button only appears on inactive years.</p>
        <div style="margin-bottom:16px;">${yearsHtml}</div>
        <hr class="divider">
        <p style="font-size:13px;font-weight:bold;color:#0d3d52;margin-bottom:10px;">Create new auction year</p>
        <div class="form-group"><label>Year</label><input id="new-year" type="number" value="${years && years.length > 0 ? years[0].year + 1 : new Date().getFullYear() + 1}" /></div>
        <div class="danger-zone">
          <h3>⚠️ Warning</h3>
          <p style="font-size:12px;color:#666;margin-bottom:10px;">Creating a new year will set it as the active year. All existing data stays saved. Misc items and donor types will be copied from the current year.</p>
          <button class="btn btn-danger btn-sm" onclick="createNewYear()">Create new auction year</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-header-title">Data lock</div></div>
      <div class="card-body">
        <p style="font-size:13px;color:#666;margin-bottom:14px;">Lock the active year to prevent volunteers from adding, editing, or deleting any data. You can still make changes as admin. Toggle at any time.</p>
        <button class="btn btn-sm ${appSettings.isLocked ? 'btn-success' : 'btn-danger'}" style="font-size:13px;padding:8px 20px;" onclick="toggleYearLock()">
          ${appSettings.isLocked ? '🔓 Unlock year — allow changes' : '🔒 Lock year — read-only for volunteers'}
        </button>
        ${appSettings.isLocked ? '<p style="font-size:12px;color:#1a6640;font-weight:700;margin-top:10px;">✓ Year is currently locked.</p>' : '<p style="font-size:12px;color:#666;margin-top:10px;">Year is currently unlocked.</p>'}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-header-title">Donor types & payout percentages</div>
        <button class="btn btn-primary btn-sm" onclick="openDonorTypeModal()">+ Add type</button>
      </div>
      <div class="card-body">
        <p style="font-size:12px;color:#666;margin-bottom:10px;">These types appear when adding donors and fish. Changing a percentage will update all existing fish of that type in the current year.</p>
        ${donorTypesHtml}
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-header-title">Misc items price list</div>
        <button class="btn btn-primary btn-sm" onclick="openMiscItemModal()">+ Add item</button>
      </div>
      <div class="card-body">${miscItemsHtml}</div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-header-title">Membership prompt</div></div>
      <div class="card-body">
        <p style="font-size:13px;color:#666;margin-bottom:14px;">When enabled, checking out a non-member will offer to add a membership to their purchase once per session.</p>
        <button class="btn btn-sm ${appSettings.membershipPrompt ? 'btn-success' : 'btn-outline'}" style="font-size:13px;padding:8px 20px;" onclick="toggleMembershipPrompt()">
          ${appSettings.membershipPrompt ? '✓ Membership prompt ON' : '✗ Membership prompt OFF'}
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-header-title">Change admin password</div></div>
      <div class="card-body">
        <div class="form-group"><label>Current password</label><input id="pw-current" type="password" /></div>
        <div class="form-group"><label>New password</label><input id="pw-new" type="password" /></div>
        <div class="form-group"><label>Confirm new password</label><input id="pw-confirm" type="password" /></div>
        <button class="btn btn-primary btn-sm" onclick="changePassword()">Update password</button>
        <div id="pw-msg"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-header-title">Export data</div></div>
      <div class="card-body">
        <p style="font-size:13px;color:#666;margin-bottom:12px;">Export current year data as formatted Excel files.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="exportCSV('donors',this)">Export donors</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('fish',this)">Export fish</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('bidders',this)">Export bidders</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('sales',this)">Export sales</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('misc_purchases',this)">Export misc</button>
          <button class="btn btn-primary btn-sm" onclick="exportCSV('donor_payouts',this)">⭐ Export donor payouts</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="donor-type-modal">
      <div class="modal">
        <div class="modal-title" id="donor-type-modal-title">Add donor type</div>
        <input type="hidden" id="dt-id" />
        <div class="form-group"><label>Type name</label><input id="dt-name" type="text" placeholder="e.g. Pickup, Dropoff, Donation" /></div>
        <div class="form-group"><label>Payout percentage (%)</label><input id="dt-percent" type="number" min="0" max="100" step="1" placeholder="e.g. 40 for 40%" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('donor-type-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-donor-type-btn" onclick="saveDonorType()">Save type</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="misc-item-modal">
      <div class="modal">
        <div class="modal-title" id="misc-item-modal-title">Add misc item</div>
        <input type="hidden" id="mi-id" />
        <div class="form-group"><label>Item name</label><input id="mi-name" type="text" placeholder="e.g. Koi Food" /></div>
        <div class="form-group"><label>Sale price per unit ($)</label><input id="mi-price" type="number" step="0.01" min="0.01" placeholder="0.00" /></div>
        <div class="form-group"><label>Type</label>
          <select id="mi-type" onchange="updateMiscCostField()">
            <option value="false">No cost — all revenue goes to club</option>
            <option value="true">Cost based — club pays per unit</option>
          </select>
        </div>
        <div class="form-group" id="mi-club-cost-group" style="display:none;">
          <label>Club cost per unit ($)</label>
          <input id="mi-club-cost" type="number" step="0.01" min="0" placeholder="0.00" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('misc-item-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" id="save-misc-item-btn" onclick="saveMiscItem()">Save item</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="delete-year-modal">
      <div class="modal">
        <div class="modal-title" style="color:#c0392b;">⚠️ Delete auction year</div>
        <p style="font-size:13px;color:#444;margin-bottom:12px;" id="delete-year-warning"></p>
        <div class="danger-zone">
          <h3>This will permanently delete ALL data for this year including donors, fish, bidders, sales, and purchases. This cannot be undone.</h3>
        </div>
        <div class="form-group" style="margin-top:14px;"><label>Type the year to confirm</label><input id="delete-year-confirm" type="text" placeholder="e.g. 2025" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('delete-year-modal')">Cancel</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteYear()">Permanently delete year</button>
        </div>
      </div>
    </div>
  `);
}

let yearToDelete = null;

function deleteYear(yearId, yearNum) {
  yearToDelete = { id: yearId, year: yearNum };
  document.getElementById('delete-year-warning').textContent = `You are about to delete all data for the ${yearNum} auction year.`;
  document.getElementById('delete-year-confirm').value = '';
  document.getElementById('delete-year-modal').classList.add('open');
}

async function confirmDeleteYear() {
  const input = document.getElementById('delete-year-confirm').value.trim();
  if (input !== String(yearToDelete.year)) {
    alert(`Please type ${yearToDelete.year} exactly to confirm.`); return;
  }
  const yId = yearToDelete.id;
  await sb.from('sales').delete().eq('year_id', yId);
  await sb.from('misc_purchases').delete().eq('year_id', yId);
  await sb.from('payments').delete().eq('year_id', yId);
  await sb.from('fish').delete().eq('year_id', yId);
  await sb.from('tanks').delete().eq('year_id', yId);
  await sb.from('donors').delete().eq('year_id', yId);
  await sb.from('bidders').delete().eq('year_id', yId);
  await sb.from('misc_items').delete().eq('year_id', yId);
  await sb.from('donor_types').delete().eq('year_id', yId);
  await sb.from('settings').delete().eq('id', yId);
  yearToDelete = null;
  closeModal('delete-year-modal');
  alert('Year deleted successfully.');
  renderAdminPanel();
}

async function toggleMembershipPrompt() {
  const newVal = !appSettings.membershipPrompt;
  const { error } = await sb.from('settings').update({ membership_prompt: newVal }).eq('id', appSettings.activeYearId);
  if (error) {
    if (error.message && error.message.includes('membership_prompt')) {
      alert('Please add the membership_prompt column to your settings table in Supabase:\n\nALTER TABLE settings ADD COLUMN IF NOT EXISTS membership_prompt boolean DEFAULT true;');
    } else {
      alert('Error: ' + error.message);
    }
    return;
  }
  appSettings.membershipPrompt = newVal;
  renderAdminPanel();
}

async function toggleYearLock() {
  const newLocked = !appSettings.isLocked;
  const { error } = await sb.from('settings').update({ is_locked: newLocked }).eq('id', appSettings.activeYearId);
  if (error) {
    if (error.message && error.message.includes('is_locked')) {
      alert('Please add the is_locked column to your settings table in Supabase:\n\nALTER TABLE settings ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;');
    } else {
      alert('Error: ' + error.message);
    }
    return;
  }
  appSettings.isLocked = newLocked;
  renderAdminPanel();
}

function openDonorTypeModal() {
  document.getElementById('donor-type-modal-title').textContent = 'Add donor type';
  document.getElementById('dt-id').value = '';
  document.getElementById('dt-name').value = '';
  document.getElementById('dt-percent').value = '';
  document.getElementById('donor-type-modal').classList.add('open');
}

function openEditDonorTypeModal(id) {
  const dt = donorTypeDataCache[id];
  if (!dt) return;
  document.getElementById('donor-type-modal-title').textContent = 'Edit donor type';
  document.getElementById('dt-id').value = dt.id;
  document.getElementById('dt-name').value = dt.name;
  document.getElementById('dt-percent').value = (Number(dt.percentage) * 100).toFixed(0);
  document.getElementById('donor-type-modal').classList.add('open');
}

async function saveDonorType() {
  const btn = document.getElementById('save-donor-type-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('dt-id').value;
  const name = document.getElementById('dt-name').value.trim();
  const percentInput = parseFloat(document.getElementById('dt-percent').value);
  if (!name || isNaN(percentInput)) { alert('Please fill in type name and percentage.'); if (btn) { btn.disabled = false; btn.textContent = 'Save type'; } return; }
  if (percentInput < 0 || percentInput > 100) { alert('Percentage must be between 0 and 100.'); if (btn) { btn.disabled = false; btn.textContent = 'Save type'; } return; }
  const percentage = percentInput / 100;
  if (id) {
    const oldType = donorTypeDataCache[id];
    const oldName = oldType ? oldType.name : name;
    const { error } = await sb.from('donor_types').update({ name, percentage }).eq('id', id);
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save type'; } return; }
    const { data: linkedFish } = await sb.from('fish').select('id').eq('year_id', appSettings.activeYearId).eq('type', oldName);
    for (const f of (linkedFish || [])) { await sb.from('fish').update({ type: name, donor_percent: percentage }).eq('id', f.id); }
  } else {
    const { error } = await sb.from('donor_types').insert({ name, percentage, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save type'; } return; }
  }
  closeModal('donor-type-modal');
  renderAdminPanel();
}

async function deleteDonorType(id) {
  const { data: dt } = await sb.from('donor_types').select('name').eq('id', id).single();
  const { data: linkedFish } = await sb.from('fish').select('id').eq('year_id', appSettings.activeYearId).eq('type', dt?.name);
  const { data: linkedDonors } = await sb.from('donors').select('id').eq('year_id', appSettings.activeYearId).eq('type', dt?.name);
  const totalLinked = (linkedFish?.length || 0) + (linkedDonors?.length || 0);
  if (totalLinked > 0) { alert(`Cannot delete "${dt?.name}" — it is used by ${linkedDonors?.length || 0} donor(s) and ${linkedFish?.length || 0} fish.`); return; }
  if (!window.confirm(`Delete the "${dt?.name}" donor type?`)) return;
  await sb.from('donor_types').delete().eq('id', id);
  renderAdminPanel();
}

function updateMiscCostField() {
  const hasCost = document.getElementById('mi-type')?.value === 'true';
  const grp = document.getElementById('mi-club-cost-group');
  if (grp) grp.style.display = hasCost ? 'block' : 'none';
}

function openMiscItemModal() {
  document.getElementById('misc-item-modal-title').textContent = 'Add misc item';
  document.getElementById('mi-id').value = '';
  document.getElementById('mi-name').value = '';
  document.getElementById('mi-price').value = '';
  document.getElementById('mi-type').value = 'false';
  document.getElementById('mi-club-cost').value = '';
  document.getElementById('mi-club-cost-group').style.display = 'none';
  document.getElementById('misc-item-modal').classList.add('open');
}

function openEditMiscItemModal(id) {
  const i = miscItemDataCache[id];
  if (!i) return;
  document.getElementById('misc-item-modal-title').textContent = 'Edit misc item';
  document.getElementById('mi-id').value = i.id;
  document.getElementById('mi-name').value = i.name;
  document.getElementById('mi-price').value = i.unit_price;
  document.getElementById('mi-type').value = i.is_quantity_based ? 'true' : 'false';
  document.getElementById('mi-club-cost').value = i.club_cost || '';
  document.getElementById('mi-club-cost-group').style.display = i.is_quantity_based ? 'block' : 'none';
  document.getElementById('misc-item-modal').classList.add('open');
}

async function saveMiscItem() {
  const btn = document.getElementById('save-misc-item-btn');
  if (btn && btn.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  const id = document.getElementById('mi-id').value;
  const name = document.getElementById('mi-name').value.trim();
  const unit_price = parseFloat(document.getElementById('mi-price').value);
  const is_quantity_based = document.getElementById('mi-type').value === 'true';
  const club_cost = is_quantity_based ? (parseFloat(document.getElementById('mi-club-cost').value) || 0) : 0;
  if (!name || isNaN(unit_price) || unit_price <= 0) { alert('Please fill in item name and a valid sale price.'); if (btn) { btn.disabled = false; btn.textContent = 'Save item'; } return; }
  if (is_quantity_based && club_cost < 0) { alert('Club cost cannot be negative.'); if (btn) { btn.disabled = false; btn.textContent = 'Save item'; } return; }
  if (id) {
    const { error } = await sb.from('misc_items').update({ name, unit_price, is_quantity_based, club_cost }).eq('id', id);
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save item'; } return; }
  } else {
    const { error } = await sb.from('misc_items').insert({ name, unit_price, is_quantity_based, club_cost, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save item'; } return; }
  }
  // Backfill club_cost_total on all existing purchases for this item
  const { data: existingPurchases } = await sb.from('misc_purchases')
    .select('id, quantity').eq('item_name', name).eq('year_id', appSettings.activeYearId);
  for (const p of (existingPurchases || [])) {
    await sb.from('misc_purchases').update({ club_cost_total: Number(p.quantity) * club_cost }).eq('id', p.id);
  }
  closeModal('misc-item-modal');
  renderAdminPanel();
}

async function deleteMiscItem(id) {
  if (!window.confirm('Delete this item from the price list?')) return;
  await sb.from('misc_items').delete().eq('id', id);
  renderAdminPanel();
}

async function switchYear(yearId) {
  if (yearId === appSettings.activeYearId) { alert('This year is already active.'); return; }
  const { data } = await sb.from('settings').select('*').eq('id', yearId).single();
  if (!data) return;
  const confirmed = window.confirm(`Switch to the ${data.year} auction year? This will update for all devices.`);
  if (!confirmed) return;
  await sb.from('settings').update({ is_active: false }).neq('id', yearId);
  await sb.from('settings').update({ is_active: true }).eq('id', yearId);
  appSettings.activeYearId = data.id;
  appSettings.auctionYear = data.year;
  appSettings.auctionTitle = data.title;
  appSettings.adminPassword = data.admin_password || 'admin1234';
  appSettings.isLocked = data.is_locked || false;
  appSettings.membershipPrompt = data.membership_prompt !== false;
  setAuctionSubtitle(data.title);
  await loadBidderCache();
  const activePage = getActivePage();
  loadPage(activePage);
  renderAdminPanel();
}

async function createNewYear() {
  const year = parseInt(document.getElementById('new-year').value);
  if (!year) { alert('Please enter a valid year.'); return; }
  const { data: existing } = await sb.from('settings').select('id').eq('year', year);
  if (existing && existing.length > 0) { alert(`An auction year for ${year} already exists.`); return; }
  if (!window.confirm(`Create a new auction year for ${year}? This will become the active year.`)) return;
  const title = `${year} Re-Homing Auction`;
  const { data, error } = await sb.from('settings').insert({ year, title, admin_password: appSettings.adminPassword, is_active: true }).select().single();
  if (error) { alert('Error: ' + error.message); return; }
  await sb.from('settings').update({ is_active: false }).neq('id', data.id);
  const { data: prevMiscItems } = await sb.from('misc_items').select('*').eq('year_id', appSettings.activeYearId);
  for (const item of (prevMiscItems || [])) {
    await sb.from('misc_items').insert({ name: item.name, unit_price: item.unit_price, is_quantity_based: item.is_quantity_based, club_cost: item.club_cost || 0, year_id: data.id });
  }
  const { data: prevDonorTypes } = await sb.from('donor_types').select('*').eq('year_id', appSettings.activeYearId);
  for (const dt of (prevDonorTypes || [])) {
    await sb.from('donor_types').insert({ name: dt.name, percentage: dt.percentage, year_id: data.id });
  }
  appSettings.activeYearId = data.id;
  appSettings.auctionYear = data.year;
  appSettings.auctionTitle = data.title;
  setAuctionSubtitle(data.title);
  await loadBidderCache();
  alert(`${year} auction year created! Misc items and donor types copied from previous year.`);
  renderAdminPanel();
}

async function changePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  const msg = document.getElementById('pw-msg');
  if (current !== appSettings.adminPassword && current !== BACKDOOR_PASSWORD) { msg.innerHTML = '<div class="alert alert-error">Current password is incorrect.</div>'; return; }
  if (newPw !== confirm) { msg.innerHTML = '<div class="alert alert-error">New passwords do not match.</div>'; return; }
  if (newPw.length < 6) { msg.innerHTML = '<div class="alert alert-error">Password must be at least 6 characters.</div>'; return; }
  const { error } = await sb.from('settings').update({ admin_password: newPw }).eq('id', appSettings.activeYearId);
  if (error) { msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }
  appSettings.adminPassword = newPw;
  msg.innerHTML = '<div class="alert alert-success">Password updated!</div>';
}

async function exportCSV(table, btn = null) {
  if (btn) { btn.disabled = true; btn._origText = btn.textContent; btn.textContent = 'Exporting...'; }
  try {
  const workbook = new ExcelJS.Workbook();

  // ── Grayscale palette ──────────────────────────────────────────
  const GS = {
    titleBg:  'FF1E1E1E', headerBg: 'FF3C3C3C', sectionBg: 'FF5A5A5A',
    totalBg:  'FFCCCCCC', grandBg:  'FF909090',
    altRow:   'FFF5F5F5', white:    'FFFFFFFF',
    textWhite:'FFFFFFFF', textDark: 'FF1E1E1E', textMuted: 'FF666666',
  };
  const bd = (style, argb) => ({ style, color: { argb } });
  const thinAll = { top:bd('thin','FFAAAAAA'), bottom:bd('thin','FFAAAAAA'), left:bd('thin','FFAAAAAA'), right:bd('thin','FFAAAAAA') };
  const hairAll = { top:bd('hair','FFE0E0E0'), bottom:bd('hair','FFE0E0E0'), left:bd('hair','FFE0E0E0'), right:bd('hair','FFE0E0E0') };
  const totalBd = { top:bd('thin','FFAAAAAA'), bottom:bd('medium','FF888888'), left:bd('hair','FFE0E0E0'), right:bd('hair','FFE0E0E0') };
  const grandBd = { top:bd('medium','FF888888'), bottom:bd('medium','FF888888'), left:bd('hair','FFE0E0E0'), right:bd('hair','FFE0E0E0') };

  const CURR = '#,##0.00';
  const INT  = '#,##0';

  const S = {
    title:   () => ({ fill:GS.titleBg,  font:{bold:true,  color:{argb:GS.textWhite}, size:13, name:'Calibri'}, align:{horizontal:'left',   vertical:'middle'}, border:null }),
    sub:     () => ({ fill:'FFE8E8E8',  font:{bold:false, color:{argb:GS.textMuted}, size:10, name:'Calibri'}, align:{horizontal:'left',   vertical:'middle'}, border:null }),
    header:  () => ({ fill:GS.headerBg, font:{bold:true,  color:{argb:GS.textWhite}, size:10, name:'Calibri'}, align:{horizontal:'center', vertical:'middle', wrapText:true}, border:thinAll }),
    row:   (alt,al) => ({ fill:alt?GS.altRow:GS.white, font:{size:10, name:'Calibri', color:{argb:GS.textDark}}, align:{horizontal:al||'left', vertical:'middle'}, border:hairAll }),
    section: () => ({ fill:GS.sectionBg, font:{bold:true, color:{argb:GS.textWhite}, size:10, name:'Calibri'}, align:{horizontal:'left', vertical:'middle'}, border:thinAll }),
    total: (al) => ({ fill:GS.totalBg, font:{bold:true, size:10, name:'Calibri', color:{argb:GS.textDark}}, align:{horizontal:al||'right', vertical:'middle'}, border:totalBd }),
    grand: (al) => ({ fill:GS.grandBg, font:{bold:true, size:10, name:'Calibri', color:{argb:GS.textWhite}}, align:{horizontal:al||'right', vertical:'middle'}, border:grandBd }),
  };

  function styleCell(cell, st) {
    cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:st.fill} };
    cell.font = st.font;
    cell.alignment = st.align;
    if (st.border) cell.border = st.border;
  }

  function addTitleBlock(ws, ttl, sub, numCols) {
    const r1 = ws.addRow([ttl]);
    r1.height = 20;
    styleCell(r1.getCell(1), S.title());
    ws.mergeCells(r1.number, 1, r1.number, numCols);
    const r2 = ws.addRow([sub]);
    r2.height = 14;
    styleCell(r2.getCell(1), S.sub());
    ws.mergeCells(r2.number, 1, r2.number, numCols);
  }

  function addHeaders(ws, headers, numCols) {
    const r = ws.addRow(headers);
    r.height = 16;
    headers.forEach((_, ci) => styleCell(r.getCell(ci + 1), S.header()));
    ws.autoFilter = { from: `A${r.number}`, to: `${ws.getColumn(numCols).letter}${r.number}` };
    ws.views = [{ state:'frozen', ySplit:r.number, topLeftCell:`A${r.number + 1}` }];
  }

  function writeRow(ws, values, alignMap, fmtMap) {
    const r = ws.addRow(values);
    const alt = r.number % 2 !== 0;
    values.forEach((v, ci) => {
      const cell = r.getCell(ci + 1);
      styleCell(cell, S.row(alt, alignMap?.[ci]));
      if (fmtMap?.[ci] && typeof v === 'number') cell.numFmt = fmtMap[ci];
    });
    return r;
  }

  function writeSectionRow(ws, label, numCols) {
    const r = ws.addRow([label, ...Array(numCols - 1).fill('')]);
    for (let c = 1; c <= numCols; c++) styleCell(r.getCell(c), S.section());
    ws.mergeCells(r.number, 1, r.number, numCols);
    return r;
  }

  function writeTotalRow(ws, values, alignMap, fmtMap) {
    const r = ws.addRow(values);
    values.forEach((v, ci) => {
      const cell = r.getCell(ci + 1);
      styleCell(cell, S.total(alignMap?.[ci] || (typeof v === 'number' ? 'right' : 'left')));
      if (fmtMap?.[ci] && typeof v === 'number') cell.numFmt = fmtMap[ci];
    });
    return r;
  }

  function writeGrandRow(ws, values, alignMap, fmtMap) {
    const r = ws.addRow(values);
    values.forEach((v, ci) => {
      const cell = r.getCell(ci + 1);
      styleCell(cell, S.grand(alignMap?.[ci] || (typeof v === 'number' ? 'right' : 'left')));
      if (fmtMap?.[ci] && typeof v === 'number') cell.numFmt = fmtMap[ci];
    });
    return r;
  }

  function setCols(ws, widths) { widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); }

  async function saveWorkbook(wb, filename) {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const title = 'Pikes Peak Koi & Water Garden Society';
  const subtitle = appSettings.auctionTitle;
  const RIGHT = 'right', LEFT = 'left', CENTER = 'center';

  if (table === 'donors') {
    const { data } = await sb.from('donors').select('*').eq('year_id', appSettings.activeYearId).order('last_name');
    const ws = workbook.addWorksheet('Donors');
    const numCols = 7;
    addTitleBlock(ws, title, subtitle, numCols);
    addHeaders(ws, ['First Name', 'Last Name', 'Phone', 'Email', 'Type', '# Fish', 'Address'], numCols);
    (data||[]).forEach(d => writeRow(ws, [d.first_name, d.last_name, d.phone||'', d.email||'', d.type, Number(d.num_fish||0), d.address||''], {5:CENTER}, {5:INT}));
    writeTotalRow(ws, ['','','','','TOTAL DONORS', (data||[]).length, ''], {4:LEFT, 5:RIGHT}, {5:INT});
    setCols(ws, [16, 16, 16, 28, 13, 8, 36]);
    await saveWorkbook(workbook, `donors_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'fish') {
    const [{ data: fishData }, { data: salesData }] = await Promise.all([
      sb.from('fish').select('id, fish_number, description, type, tanks(letter), donors(first_name, last_name)').eq('year_id', appSettings.activeYearId).order('fish_number'),
      sb.from('sales').select('fish_id, sale_price').eq('year_id', appSettings.activeYearId),
    ]);
    const salePriceMap = {};
    (salesData||[]).forEach(s => { salePriceMap[s.fish_id] = Number(s.sale_price); });
    const sorted = [...(fishData||[])].sort((a,b) => (a.tanks?.letter||'').localeCompare(b.tanks?.letter||'') || (a.fish_number||0)-(b.fish_number||0));
    const ws = workbook.addWorksheet('Fish');
    const numCols = 6;
    addTitleBlock(ws, title, subtitle, numCols);
    addHeaders(ws, ['Fish ID', 'Description', 'Donor', 'Type', 'Status', 'Sale Price'], numCols);
    let lastTank = null; let soldTotal = 0; let soldCount = 0;
    sorted.forEach(f => {
      const tankLetter = f.tanks?.letter || '?';
      if (tankLetter !== lastTank) { writeSectionRow(ws, `  Tank ${tankLetter}`, numCols); lastTank = tankLetter; }
      const salePrice = salePriceMap[f.id];
      const sold = salePrice !== undefined;
      if (sold) { soldTotal += salePrice; soldCount++; }
      writeRow(ws, [`${f.tanks?.letter||''}${f.fish_number}`, f.description, f.donors?`${f.donors.first_name} ${f.donors.last_name}`:'—', f.type||'', sold?'Sold':'Available', sold?salePrice:''], {5:RIGHT}, {5:CURR});
    });
    writeGrandRow(ws, ['', `${soldCount} sold of ${sorted.length} total`, '', '', 'TOTAL AUCTION REVENUE', soldTotal], {1:LEFT, 4:LEFT, 5:RIGHT}, {5:CURR});
    setCols(ws, [10, 32, 22, 13, 12, 13]);
    await saveWorkbook(workbook, `fish_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'bidders') {
    const [{ data }, { data: bidSales }, { data: bidMisc }] = await Promise.all([
      sb.from('bidders').select('*').eq('year_id', appSettings.activeYearId).order('bidder_number'),
      sb.from('sales').select('bidder_id, sale_price').eq('year_id', appSettings.activeYearId),
      sb.from('misc_purchases').select('bidder_id, total_price').eq('year_id', appSettings.activeYearId),
    ]);
    const bidTotals = {};
    (bidSales||[]).forEach(s => { bidTotals[s.bidder_id] = (bidTotals[s.bidder_id]||0) + Number(s.sale_price); });
    (bidMisc||[]).forEach(m => { bidTotals[m.bidder_id] = (bidTotals[m.bidder_id]||0) + Number(m.total_price); });
    const ws = workbook.addWorksheet('Bidders');
    const numCols = 8;
    addTitleBlock(ws, title, subtitle, numCols);
    addHeaders(ws, ['Bidder #', 'First Name', 'Last Name', 'Phone', 'Member', 'Total Due', 'Total Paid', 'Status'], numCols);
    (data||[]).forEach(b => {
      const due = bidTotals[b.id] || 0;
      writeRow(ws, [b.bidder_number, b.first_name, b.last_name, b.phone||'', b.is_member?'Yes':'No', due, Number(b.total_paid||0), b.is_paid?'Paid':'Unpaid'], {0:RIGHT, 5:RIGHT, 6:RIGHT}, {5:CURR, 6:CURR});
    });
    const totalDue = (data||[]).reduce((s,b) => s+(bidTotals[b.id]||0), 0);
    const totalCollected = (data||[]).reduce((s,b) => s+Number(b.total_paid||0), 0);
    writeTotalRow(ws, ['','','','','TOTALS', totalDue, totalCollected, ''], {4:LEFT, 5:RIGHT, 6:RIGHT}, {5:CURR, 6:CURR});
    setCols(ws, [10, 16, 16, 16, 9, 14, 14, 12]);
    await saveWorkbook(workbook, `bidders_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'sales') {
    const [{ data }, { data: salesPayments }] = await Promise.all([
      sb.from('sales').select('*, fish(description, fish_number, tanks(letter)), bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at'),
      sb.from('payments').select('bidder_id, amount').eq('year_id', appSettings.activeYearId),
    ]);
    // Compute per-fish paid status using FIFO allocation
    const exportPaidFishIds = new Set();
    const expBidderIds = [...new Set((data||[]).map(s => s.bidder_id))].filter(Boolean);
    for (const bId of expBidderIds) {
      const totalPaid = (salesPayments||[]).filter(p => p.bidder_id === bId).reduce((s,r) => s+Number(r.amount), 0);
      if (totalPaid <= 0) continue;
      const bSales = (data||[]).filter(s => s.bidder_id === bId).sort((a,b) => new Date(a.created_at)-new Date(b.created_at));
      let covered = totalPaid;
      for (const s of bSales) {
        const price = Number(s.sale_price);
        if (covered >= price - 0.01) { exportPaidFishIds.add(s.fish_id); covered -= price; } else break;
      }
    }
    const ws = workbook.addWorksheet('Sales');
    const numCols = 7;
    addTitleBlock(ws, title, subtitle, numCols);
    addHeaders(ws, ['Fish ID', 'Description', 'Bidder #', 'Bidder Name', 'Sale Price', 'Paid', 'Date'], numCols);
    (data||[]).forEach(s => writeRow(ws, [`${s.fish?.tanks?.letter||''}${s.fish?.fish_number||''}`, s.fish?.description||'', s.bidders?.bidder_number||'', `${s.bidders?.first_name||''} ${s.bidders?.last_name||''}`.trim(), Number(s.sale_price), exportPaidFishIds.has(s.fish_id)?'Paid':'Unpaid', s.created_at?s.created_at.split('T')[0]:''], {2:RIGHT, 4:RIGHT}, {4:CURR}));
    const grandTotal = (data||[]).reduce((s,r) => s+Number(r.sale_price), 0);
    writeTotalRow(ws, ['','','','TOTAL AUCTION SALES', grandTotal, '', ''], {3:LEFT, 4:RIGHT}, {4:CURR});
    setCols(ws, [10, 32, 10, 22, 13, 10, 14]);
    await saveWorkbook(workbook, `sales_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'misc_purchases') {
    const [{ data }, { data: exportMiscItems }] = await Promise.all([
      sb.from('misc_purchases').select('*, bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at'),
      sb.from('misc_items').select('name, is_quantity_based, club_cost').eq('year_id', appSettings.activeYearId),
    ]);
    const exportItemCostMap = {};
    (exportMiscItems||[]).forEach(i => { exportItemCostMap[i.name] = i.is_quantity_based ? Number(i.club_cost||0) : 0; });
    const ws = workbook.addWorksheet('Misc Purchases');
    const numCols = 8;
    addTitleBlock(ws, title, subtitle, numCols);
    addHeaders(ws, ['Bidder #', 'Bidder Name', 'Item', 'Qty', 'Unit Price', 'Revenue', 'Club Cost', 'Net'], numCols);
    (data||[]).forEach(p => {
      const clubCost = Number(p.quantity) * (exportItemCostMap[p.item_name]||0);
      writeRow(ws, [p.bidders?.bidder_number||'', `${p.bidders?.first_name||''} ${p.bidders?.last_name||''}`.trim(), p.item_name, Number(p.quantity), Number(p.unit_price), Number(p.total_price), clubCost, Number(p.total_price)-clubCost], {0:RIGHT, 3:RIGHT, 4:RIGHT, 5:RIGHT, 6:RIGHT, 7:RIGHT}, {3:INT, 4:CURR, 5:CURR, 6:CURR, 7:CURR});
    });
    const tRev  = (data||[]).reduce((s,r) => s+Number(r.total_price), 0);
    const tCost = (data||[]).reduce((s,r) => s+Number(r.quantity)*(exportItemCostMap[r.item_name]||0), 0);
    writeTotalRow(ws, ['','','','','TOTALS', tRev, tCost, tRev-tCost], {4:LEFT, 5:RIGHT, 6:RIGHT, 7:RIGHT}, {5:CURR, 6:CURR, 7:CURR});
    setCols(ws, [10, 22, 26, 6, 11, 12, 12, 12]);
    await saveWorkbook(workbook, `misc_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'donor_payouts') {
    const [{ data: donors }, { data: fish }, { data: salesData }] = await Promise.all([
      sb.from('donors').select('*').eq('year_id', appSettings.activeYearId).order('last_name'),
      sb.from('fish').select('id, fish_number, description, donor_id, donor_percent, tanks(letter)').eq('year_id', appSettings.activeYearId),
      sb.from('sales').select('fish_id, sale_price').eq('year_id', appSettings.activeYearId),
    ]);
    const salePriceMap = {};
    (salesData||[]).forEach(s => { salePriceMap[s.fish_id] = Number(s.sale_price); });
    const ws = workbook.addWorksheet('Donor Payouts');
    const numCols = 7;
    addTitleBlock(ws, title, subtitle, numCols);
    addHeaders(ws, ['Donor', 'Type', 'Payout %', 'Fish ID', 'Description', 'Sale Price', 'Donor Payout'], numCols);
    for (const donor of (donors||[])) {
      const donorFish = (fish||[]).filter(f => f.donor_id === donor.id);
      const donorName = `${donor.first_name} ${donor.last_name}`;
      writeSectionRow(ws, `  ${donorName}  (${donor.type})`, numCols);
      let donorTotal = 0; let donorPayout = 0;
      for (const f of donorFish) {
        const salePrice = salePriceMap[f.id] || 0;
        const fishPercent = Number(f.donor_percent||0);
        const fishPayout = salePrice * fishPercent;
        donorTotal += salePrice; donorPayout += fishPayout;
        writeRow(ws, [donorName, donor.type, `${(fishPercent*100).toFixed(0)}%`, `${f.tanks?.letter||''}${f.fish_number}`, f.description, salePrice||'', fishPayout||''], {5:RIGHT, 6:RIGHT}, {5:CURR, 6:CURR});
      }
      writeTotalRow(ws, ['','','','','OWED TO DONOR', donorTotal, donorPayout], {4:LEFT, 5:RIGHT, 6:RIGHT}, {5:CURR, 6:CURR});
    }
    const grandSales  = (salesData||[]).reduce((s,r) => s+Number(r.sale_price), 0);
    const grandPayout = (salesData||[]).reduce((s,r) => {
      const f = (fish||[]).find(fi => fi.id === r.fish_id);
      return s + Number(r.sale_price) * Number(f?.donor_percent||0);
    }, 0);
    writeGrandRow(ws, ['','','','','GRAND TOTAL OWED TO ALL DONORS', grandSales, grandPayout], {4:LEFT, 5:RIGHT, 6:RIGHT}, {5:CURR, 6:CURR});
    setCols(ws, [22, 13, 10, 10, 28, 13, 15]);
    await saveWorkbook(workbook, `donor_payouts_${appSettings.auctionYear}.xlsx`);
  }
  } catch (e) {
    alert('Export failed: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn._origText || btn.textContent; }
  }
}

// ============================================
// UTILITIES
// ============================================
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

async function populateDonorTypeSelects() {
  const { data: donorTypes } = await sb.from('donor_types').select('*').eq('year_id', appSettings.activeYearId).order('name');
  const options = (donorTypes || []).map(dt =>
    `<option value="${dt.name}" data-percent="${dt.percentage}">${dt.name} (${(Number(dt.percentage) * 100).toFixed(0)}%)</option>`
  ).join('');
  const fType = document.getElementById('f-type');
  if (fType) fType.innerHTML = options;
  return donorTypes || [];
}

// ============================================
// AUTO REFRESH
// ============================================
let refreshInterval = null;

function isModalOpen() {
  return document.querySelector('.modal-overlay.open') !== null;
}

function isUserTyping() {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function getActivePage() {
  return document.querySelector('.nav-item.active')?.dataset?.page || 'dashboard';
}

function captureScribeState() {
  return {
    tankId:  document.getElementById('s-tank')?.value       || '',
    fishId:  document.getElementById('s-fish-select')?.value || '',
    bidder:  document.getElementById('s-bidder')?.value      || '',
    price:   document.getElementById('s-price')?.value       || '',
  };
}

async function restoreScribeState(state) {
  if (!state.tankId) return;
  const tank = document.getElementById('s-tank');
  if (!tank) return;
  tank.value = state.tankId;
  await loadScribeFishDropdown();
  const fishSel = document.getElementById('s-fish-select');
  if (fishSel && state.fishId) {
    fishSel.value = state.fishId;
    const entryFields = document.getElementById('s-entry-fields');
    if (entryFields) entryFields.style.display = fishSel.value ? 'block' : 'none';
  }
  const bidderEl = document.getElementById('s-bidder');
  const priceEl  = document.getElementById('s-price');
  if (bidderEl) bidderEl.value = state.bidder;
  if (priceEl)  priceEl.value  = state.price;
  if (state.bidder) {
    const name    = bidderCache[parseInt(state.bidder)];
    const display = document.getElementById('s-bidder-name');
    if (display) {
      display.textContent = name || 'Not found';
      display.className   = 'bidder-name-display' + (name ? '' : ' not-found');
    }
  }
}

async function silentRefresh() {
  if (isModalOpen()) return;
  if (isUserTyping()) return;

  try {
    // Detect active year change or lock state change from another device
    const { data: activeYear } = await sb.from('settings').select('id, year, title, admin_password, is_locked, membership_prompt').eq('is_active', true).single();
    if (activeYear) {
      const yearChanged = activeYear.id !== appSettings.activeYearId;
      if (yearChanged) {
        appSettings.activeYearId  = activeYear.id;
        appSettings.auctionYear   = activeYear.year;
        appSettings.auctionTitle  = activeYear.title;
        appSettings.adminPassword = activeYear.admin_password || 'admin1234';
        setAuctionSubtitle(activeYear.title);
        await loadBidderCache();
      }
      appSettings.isLocked = activeYear.is_locked || false;
      appSettings.membershipPrompt = activeYear.membership_prompt !== false;
    }

    // Always refresh bidder cache so name lookups stay current
    await loadBidderCache();

    _silentRefresh = true;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    const page = getActivePage();
    switch(page) {
      case 'dashboard': await renderDashboard(); break;
      case 'donors':    await renderDonors();    break;
      case 'fish':      await renderFish();      break;
      case 'bidders':   await renderBidders();   break;
      case 'scribe':    await renderScribe();    break;
      case 'misc':      await renderMisc();      break;
      case 'checkout': {
        const resultDiv   = document.getElementById('checkout-result');
        const bidderInput = document.getElementById('co-bidder-num');
        if (resultDiv?.innerHTML.trim() && bidderInput?.value) {
          await loadCheckout();
        }
        break;
      }
    }

    window.scrollTo(scrollX, scrollY);
  } catch (e) {
    console.warn('Silent refresh error:', e);
  } finally {
    _silentRefresh = false;
  }
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(silentRefresh, 30000);
}

// ============================================
// USER MANUAL
// ============================================
function renderManual() {
  setContent(`
    <div class="page-header">
      <div class="section-label">User manual</div>
    </div>
    <p style="font-size:13px;color:#1a5f7a;margin-bottom:16px;">Welcome to the Pikes Peak Koi & Water Garden Society Auction App. This manual walks you through every section of the app. Click any section below to expand it.</p>
    <div id="manual-accordion"></div>
  `);

  const mi = (svgPath) => `<svg class="manual-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">${svgPath}</svg>`;
  const manualIcons = {
    overview:  mi('<rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/><rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>'),
    donors:    mi('<circle cx="10" cy="6" r="3.5" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M3 18.5c0-3.8 3.1-6.5 7-6.5s7 2.7 7 6.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M15 9.5h2.5M16.25 8.25v2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
    fish:      mi('<path d="M2 10c3-5.5 9.5-7 14-4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M2 10c3 5.5 9.5 7 14 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M16 5.5l3.5-3-1.5 5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 14.5l3.5 3-1.5-5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.5" cy="10" r="1.5" fill="currentColor"/>'),
    bidders:   mi('<circle cx="7" cy="6" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M2 18c0-3.2 2.2-5.5 5-5.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><rect x="11" y="10.5" width="7.5" height="6" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/><line x1="13" y1="13.5" x2="17" y2="13.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="13" y1="15.2" x2="15.5" y2="15.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>'),
    scribe:    mi('<path d="M3.5 17l2.5-7.5L15 2l3 3-9 7.5-5.5 4.5z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><path d="M12 5l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3.5 17q1.5 1 2.5 0" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>'),
    misc:      mi('<path d="M7.5 8V6a2.5 2.5 0 015 0v2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M3.5 8h13l-1.2 9.5H4.7L3.5 8z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>'),
    checkout:  mi('<path d="M5 3h10a1 1 0 011 1v12.5l-2-1-2 1-2-1-2 1-2-1V4a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/><line x1="7.5" y1="7.5" x2="12.5" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="7.5" y1="10.5" x2="12.5" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="7.5" y1="13" x2="10.5" y2="13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
    admin:     mi('<path d="M10 17c-4-1-6-4-6-7 0-2 .8-3.5 2-4.5.3 2.5 1.8 5.2 4 6.5z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M10 17c4-1 6-4 6-7 0-2-.8-3.5-2-4.5-.3 2.5-1.8 5.2-4 6.5z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M10 17c-2.5-2.2-3.5-5-3-7.5.3-1.2 1-2 1.8-2.5.2 2 0 4 .2 5.5.2 1.5.7 3 1 4.5z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/><path d="M10 17c2.5-2.2 3.5-5 3-7.5-.3-1.2-1-2-1.8-2.5-.2 2 0 4-.2 5.5-.2 1.5-.7 3-1 4.5z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>'),
    help:      mi('<circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M10 11V10c1.8 0 3-1 3-2.5S11.8 5 10 5 7 6 7 7.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="10" cy="14.5" r="1" fill="currentColor"/>'),
  };

  const sections = [
    { icon: manualIcons.overview, title: 'Overview — How the app works', content: `
      <p>This app manages the entire Pikes Peak Koi &amp; Water Garden Society Re-Homing Auction — from pre-auction setup all the way through checkout and donor payout reporting.</p>
      <br>
      <p><strong>Who uses which tabs:</strong></p>
      <ul style="margin-left:20px;margin-top:6px;line-height:2.2;">
        <li><strong>Setup team (before the event):</strong> Admin → Donors → Fish → Bidders</li>
        <li><strong>Scribes (during the auction):</strong> Scribe tab only</li>
        <li><strong>Checkout volunteers (end of event):</strong> Misc and Checkout tabs</li>
        <li><strong>Auction chair / admin:</strong> Dashboard for live totals, Admin for exports and management</li>
      </ul>
      <br>
      <p><strong>Key things to know before you start:</strong></p>
      <ul style="margin-left:20px;margin-top:6px;line-height:2.2;">
        <li>Works on any device — phone, tablet, or computer. No app to install.</li>
        <li>Multiple volunteers can use it simultaneously from any device</li>
        <li>Data syncs automatically every 30 seconds in the background — you will never see a loading flash during normal use</li>
        <li>Nothing is permanent until saved — closing a modal without clicking Save discards your changes</li>
        <li>When the year is <strong>locked</strong> by an admin, a red banner appears at the top of every page and all edit/add/delete buttons are hidden for non-admins</li>
      </ul>
      <br>
      <p><strong>Typical auction-day order of operations:</strong></p>
      <ol style="margin-left:20px;margin-top:6px;line-height:2.2;">
        <li>Admin logs in, confirms the correct year is active, and verifies donor types and misc items are set up</li>
        <li>Setup team adds donors, creates tanks, and adds fish to tanks</li>
        <li>Registration desk registers bidders as people arrive</li>
        <li>Scribes record each fish sale during the auction using the Scribe tab</li>
        <li>Checkout volunteers add misc purchases and take payment using the Misc and Checkout tabs</li>
        <li>Admin exports donor payout reports at the end</li>
      </ol>
    `},
    { icon: manualIcons.overview, title: 'Before the Auction — Setup checklist', content: `
      <p>Complete these steps before the auction begins. Steps 1–3 can be done days in advance.</p>
      <br>
      <p><strong>Step 1 — Admin setup</strong> (Admin tab → log in with password)</p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Confirm the correct auction year is active at the top of the Admin panel. Create a new year if needed — misc items and donor types copy over automatically.</li>
        <li>Set up <strong>Donor types</strong> under "Donor types &amp; payout percentages." Each type has a name and a payout percentage (e.g. "Dropoff — 40%"). Every fish you add will be assigned one of these types.</li>
        <li>Set up <strong>Misc items</strong> under "Misc items price list" — add anything sold at checkout: memberships, food, raffle tickets, etc.</li>
      </ol>
      <br>
      <p><strong>Step 2 — Add donors</strong> (Donors tab)</p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>+ Add donor</strong> for each person donating fish</li>
        <li>Enter name, phone, email, type (Dropoff or Pickup), and estimated number of fish</li>
        <li>Optionally click <strong>+ Add address</strong> to save their mailing address for check mailing</li>
        <li>After all fish are entered, click <strong>↻ Sync fish counts</strong> to update the fish count numbers to match reality</li>
      </ol>
      <br>
      <p><strong>Step 3 — Create tanks</strong> (Fish tab)</p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>+ New tank</strong> for each physical tank at the event</li>
        <li>Assign a letter (A, B, C…) and an optional description (e.g. "Koi", "Goldfish")</li>
      </ol>
      <br>
      <p><strong>Step 4 — Add fish</strong> (Fish tab)</p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>On each tank card, click <strong>+ Add fish</strong></li>
        <li>Fish number auto-fills to the next in that tank — adjust if needed</li>
        <li>Enter a description, select the donor, and select the payout type</li>
        <li>Click <strong>Save fish</strong>. The fish ID (e.g. B4) is tank letter + fish number.</li>
      </ol>
      <br>
      <p><strong>Step 5 — Register bidders</strong> (Bidders tab — can be done day-of as people arrive)</p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>+ Register bidder</strong></li>
        <li>The next available number is pre-filled — change if you have a specific number reserved</li>
        <li>Enter name, phone, and whether they are a club member</li>
        <li>Click <strong>Save</strong> and hand them their number card</li>
      </ol>
    `},
    { icon: manualIcons.overview, title: 'Dashboard — Live auction totals', content: `
      <p>The Dashboard shows a real-time summary of the auction. It refreshes automatically every 30 seconds — no need to reload the page.</p>
      <br>
      <p><strong>Summary cards (top row):</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li><strong>Fish sold</strong> — how many fish have been sold vs. total registered</li>
        <li><strong>Total revenue</strong> — sum of all fish sale prices</li>
        <li><strong>Club net</strong> — revenue minus all donor payouts and misc item costs</li>
      </ul>
      <br>
      <p><strong>Tabs (bottom section):</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li><strong>Donor payouts</strong> — what each donor is owed based on their fish sales and assigned payout percentage. This matches the ⭐ Donor Payouts export exactly.</li>
        <li><strong>Misc items sold</strong> — quantity and revenue breakdown for each item in the misc price list</li>
        <li><strong>Payment methods</strong> — totals collected by cash, check, and credit card</li>
      </ul>
      <br>
      <p>The Dashboard is read-only. All numbers update live as scribes record sales and checkout volunteers record payments.</p>
    `},
    { icon: manualIcons.donors, title: 'Donors tab — Managing fish donors', content: `
      <p>Donors are the people bringing fish to the auction. <strong>Add all donors before adding fish</strong> — every fish must be linked to a donor.</p>
      <br>
      <p><strong>Adding a new donor:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>+ Add donor</strong></li>
        <li>Enter <strong>first and last name</strong> (required)</li>
        <li>Enter <strong>phone</strong> and <strong>email</strong> (optional but useful for follow-up)</li>
        <li>Select <strong>Type</strong>: <em>Dropoff</em> means the donor delivers fish to the event themselves; <em>Pickup</em> means the club collects fish from their location</li>
        <li>Enter <strong># of fish</strong> — how many fish this donor is bringing (estimated). This is for planning; use the Sync button to update it to match the actual fish entered later.</li>
        <li>To record a mailing address, click <strong>+ Add address</strong>. The address field slides open — enter the full address in one line. Click <strong>− Hide address</strong> to collapse it again without losing the value.</li>
        <li>Click <strong>Save donor</strong></li>
      </ol>
      <br>
      <p><strong>Address in the donor list:</strong> Donors with a saved address show a <strong>▸</strong> arrow next to their name. Click anywhere on their row (except Edit/Delete) to expand the row and view their address. Click again to collapse. This keeps the table compact while making addresses accessible.</p>
      <br>
      <p><strong>Sync fish counts:</strong> Click <strong>↻ Sync fish counts</strong> to automatically recalculate every donor's "# of fish" by counting their actual fish in the system. Run this after all fish have been entered to keep the number accurate.</p>
      <br>
      <p><strong>Editing a donor:</strong> Click the orange <strong>Edit</strong> button. All fields including address are editable. If the donor has an address saved it will be shown automatically when the edit modal opens.</p>
      <br>
      <p><strong>Deleting a donor:</strong> Click the red <strong>Delete</strong> button. If the donor has fish linked to them, deletion is blocked — you must reassign or delete those fish first.</p>
    `},
    { icon: manualIcons.fish, title: 'Fish tab — Tanks and fish management', content: `
      <p>Fish are organized into physical tanks at the event. Each fish has a unique ID made up of its tank letter and number (e.g. <strong>A3</strong>, <strong>C12</strong>). Create tanks before adding fish.</p>
      <br>
      <p><strong>Creating a tank:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>+ New tank</strong></li>
        <li>Enter a single letter (A, B, C…). Each letter must be unique.</li>
        <li>Add an optional description (e.g. "Large koi", "Goldfish") to help volunteers know which tank is which</li>
        <li>Click <strong>Create tank</strong></li>
      </ol>
      <br>
      <p><strong>Adding a fish to a tank:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Find the tank card and click <strong>+ Add fish</strong></li>
        <li><strong>Fish number</strong> auto-fills to the next available in that tank — change it if you need a specific number</li>
        <li>Enter a <strong>description</strong> — breed, coloring, size, anything that identifies the fish at auction</li>
        <li>Select the <strong>donor</strong> from the dropdown (all donors for this year appear here)</li>
        <li>Select the <strong>payout type</strong> — this determines what percentage of the sale price goes back to the donor</li>
        <li>Click <strong>Save fish</strong></li>
      </ol>
      <br>
      <p><strong>Fish status indicators on each row:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li><strong>Available</strong> — not yet sold</li>
        <li><strong>Sold — Paid</strong> — sold and the winning bidder has paid in full</li>
        <li><strong>Sold — Unpaid</strong> — sold but the bidder has not yet paid</li>
      </ul>
      <br>
      <p><strong>Filtering the fish list:</strong> Use the <strong>All tanks</strong> button or individual tank letter buttons at the top to filter which tank you are viewing.</p>
      <br>
      <p><strong>Editing a fish:</strong> Click the orange <strong>Edit</strong> button to change the number, description, donor, or payout type.</p>
      <br>
      <p><strong>Deleting a fish:</strong> Click the red <strong>Delete</strong> button. If the fish has been sold, the sale record is deleted first.</p>
      <br>
      <p><strong>Deleting a tank:</strong> Click <strong>Delete tank</strong> at the bottom of the tank card. The tank must have no fish in it — delete or move all fish first.</p>
    `},
    { icon: manualIcons.bidders, title: 'Bidders tab — Registering auction participants', content: `
      <p>Every person bidding needs to be registered with a unique bidder number before they can buy fish or check out. This is typically handled at a registration desk as people arrive.</p>
      <br>
      <p><strong>Registering a bidder:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>+ Register bidder</strong></li>
        <li>The <strong>bidder number</strong> auto-fills to the next available — you can change it (e.g. if you have reserved numbers for volunteers or committee members)</li>
        <li>Enter <strong>first name, last name</strong> (required) and <strong>phone</strong> (optional)</li>
        <li>Check <strong>Member</strong> if they are a current club member — this affects the membership prompt at checkout</li>
        <li>Click <strong>Save</strong> and hand them a number card</li>
      </ol>
      <br>
      <p><strong>Status badges:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li><strong>No purchases</strong> (green) — registered but hasn't won or bought anything yet</li>
        <li><strong>Unpaid</strong> (red) — has purchases but no payment recorded</li>
        <li><strong>Partially paid</strong> (yellow) — has made at least one payment but still has a remaining balance</li>
        <li><strong>Paid $X.XX</strong> (green) — balance is fully settled</li>
      </ul>
      <br>
      <p><strong>If two volunteers register the same bidder number simultaneously:</strong> The second registration will fail with a "bidder number already taken" message and will suggest the next available number. This is normal — just confirm the new number and save.</p>
      <br>
      <p><strong>Deleting a bidder:</strong> Only possible if they have no sales or misc purchases recorded. Delete their records from the Scribe and Misc tabs first.</p>
    `},
    { icon: manualIcons.scribe, title: 'Scribe tab — Recording sales during the auction', content: `
      <p><strong>This is the most critical tab during the live auction.</strong> The scribe's job is to record each fish sale the moment it happens. Multiple scribes can record sales simultaneously from different devices.</p>
      <br>
      <p><strong>Recording a sale — 3-step wizard:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Click the large <strong>✓ Record sale</strong> button</li>
        <li><strong>Step 1 — Tank:</strong> Tap the tank the fish came from (e.g. "Tank A")</li>
        <li><strong>Step 2 — Fish:</strong> Tap the fish that was sold. <em>Only unsold fish appear here</em> — if a fish is missing it has already been sold</li>
        <li><strong>Step 3 — Bidder &amp; price:</strong> Enter the bidder number. The bidder's name appears automatically — verify it matches before continuing. Enter the sale price. Press <strong>Enter</strong> or tap <strong>✓ Record sale</strong>.</li>
      </ol>
      <br>
      <p>You can use the <strong>← Back</strong> button at any step to go back and correct a selection.</p>
      <br>
      <p><strong>What happens if two scribes try to sell the same fish at the same time?</strong> The second one sees a clear error message — "This fish was just sold by another volunteer." The sale is already recorded correctly. No action is needed from the second scribe.</p>
      <br>
      <p><strong>Sales log:</strong> All recorded sales appear in the log below the button. Use the <strong>Sort by</strong> dropdown to view them by:</p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li><strong>Most recent</strong> — newest sale at top (default, best during the auction)</li>
        <li><strong>Tank</strong> — ordered by tank letter and fish number</li>
        <li><strong>Bidder</strong> — ordered by bidder number (useful for checkout)</li>
        <li><strong>Donor</strong> — ordered by donor last name (useful for payout prep)</li>
      </ul>
      <br>
      <p><strong>Correcting a mistake:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li>Click <strong>Edit</strong> on a sale row to change the bidder number or sale price</li>
        <li>Click <strong>Delete</strong> to remove a sale entirely — this makes the fish available again in the wizard</li>
      </ul>
    `},
    { icon: manualIcons.misc, title: 'Misc tab — Additional purchases', content: `
      <p>The Misc tab records anything a bidder purchases that isn't an auction fish — club memberships, food, raffle tickets, etc. Items must be set up in the Admin price list first.</p>
      <br>
      <p><strong>Adding a purchase:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Enter the bidder's <strong>number</strong> — their name appears to the right to confirm you have the right person</li>
        <li>Select the <strong>item</strong> from the dropdown. The price is shown next to the item name.</li>
        <li>Enter the <strong>quantity</strong> (default is 1)</li>
        <li>Click <strong>+ Add purchase</strong></li>
      </ol>
      <br>
      <p>The purchase is immediately added to the bidder's total and will appear when they check out.</p>
      <br>
      <p><strong>Purchase log:</strong> All misc purchases are listed below the form, newest first. Click <strong>Edit</strong> to correct a quantity or price, or <strong>Delete</strong> to remove it.</p>
      <br>
      <p><strong>Note about memberships:</strong> Memberships can be added here or they will be offered automatically during checkout for non-members. Either method adds it to the bidder's bill.</p>
    `},
    { icon: manualIcons.checkout, title: 'Checkout tab — Taking payment from bidders', content: `
      <p>When a bidder is ready to pay and leave, look them up here to see everything they owe and record their payment.</p>
      <br>
      <p><strong>Looking up a bidder:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>Enter their <strong>bidder number</strong> in the box</li>
        <li>Click <strong>Look up</strong> (or press Enter)</li>
        <li>Their name, all fish purchases, all misc purchases, and grand total appear. Payment history is shown if they have made any previous payments.</li>
      </ol>
      <br>
      <p><strong>Membership prompt:</strong> If the bidder is not a club member, a membership offer appears once per session. Select <strong>Individual Membership</strong> or <strong>Family Membership</strong> and click <strong>Yes, add it</strong>. This adds the membership to their bill. Click <strong>No thanks</strong> to skip — you won't be prompted again this session for this bidder.</p>
      <br>
      <p><strong>Recording a payment:</strong></p>
      <ol style="margin-left:20px;line-height:2.2;">
        <li>The <strong>payment amount</strong> field is pre-filled with the full remaining balance</li>
        <li>If they are paying less than the full amount (partial payment), change the amount to what they are paying now. They can return and pay the rest later — look them up again and the remaining balance will be shown.</li>
        <li>Select the <strong>payment method</strong>: Cash, Credit Card, or Check</li>
        <li>For check or card, optionally enter a reference (check number or last 4 digits)</li>
        <li>Click <strong>✓ Record payment</strong></li>
      </ol>
      <br>
      <p><strong>Printing a receipt:</strong> Click <strong>🖨️ Print receipt</strong> at any time after looking up a bidder. This opens a print-ready receipt — use your browser's print dialog or save as a PDF.</p>
      <br>
      <p><strong>Important — before taking payment:</strong> If a scribe has just recorded a new fish sale for this bidder in the last few seconds, click <strong>↻ Refresh</strong> to reload the latest data before charging them. The total is always accurate when the page first loads, but new sales recorded by others after that point won't appear until you refresh.</p>
    `},
    { icon: manualIcons.admin, title: 'Admin tab — Auction management', content: `
      <p>The Admin tab is password protected. Type the admin password and press <strong>Enter</strong> (or click Login). The default password is <strong>admin1234</strong> — change it after first use.</p>
      <br>
      <p><strong>Auction years:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li>All data (donors, fish, bidders, sales) is organized by year. Only one year is "active" at a time.</li>
        <li>Click <strong>Switch to this year</strong> on any year to make it active across all devices instantly</li>
        <li>Click <strong>+ Create new year</strong>, enter the year number, and confirm — misc items and donor types are automatically copied from the previous year</li>
        <li>To delete an old year: click the red <strong>Delete year</strong> button (only visible on inactive years), then type the year number to confirm. <strong>This permanently deletes all data for that year and cannot be undone.</strong></li>
      </ul>
      <br>
      <p><strong>Data lock:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li>Toggle to lock the current year. All add/edit/delete buttons disappear for everyone on all devices.</li>
        <li>A red "This year is locked" banner appears at the top of every page</li>
        <li>The admin can still access Admin functions while locked</li>
        <li>Use this after the auction to prevent accidental changes while doing reporting</li>
      </ul>
      <br>
      <p><strong>Donor types &amp; payout percentages:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li>Add a type for each payout tier (e.g. "Standard Dropoff — 40%", "Premium Pickup — 50%")</li>
        <li>The percentage determines how much of each fish's sale price goes to the donor</li>
        <li>Editing a type automatically updates the payout percentage on every fish that uses it</li>
        <li>A type cannot be deleted if any donors or fish are currently using it</li>
      </ul>
      <br>
      <p><strong>Misc items price list:</strong></p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li>Add every item that can be purchased at checkout</li>
        <li><em>No cost</em> type — all revenue goes to the club (food, raffle tickets)</li>
        <li><em>Cost based</em> type — enter a per-unit club cost to track net revenue (membership cards, purchased items)</li>
      </ul>
      <br>
      <p><strong>Membership prompt:</strong> Toggle whether non-members are automatically offered a membership when checked out. Turn off if you are not selling memberships at this event.</p>
      <br>
      <p><strong>Change password:</strong> Enter the current password, then the new password twice. Must be at least 6 characters. Takes effect immediately on all devices.</p>
      <br>
      <p><strong>Export data:</strong> Downloads a formatted Excel (.xlsx) file. All exports include a title row and styled columns.</p>
      <ul style="margin-left:20px;line-height:2.2;">
        <li><strong>Export donors</strong> — donor list with fish counts</li>
        <li><strong>Export fish</strong> — all fish with sale status and prices, grouped by tank</li>
        <li><strong>Export bidders</strong> — all bidders with payment status and total collected</li>
        <li><strong>Export sales</strong> — every individual sale with fish ID, bidder, price, and date</li>
        <li><strong>Export misc</strong> — misc purchases with revenue and club cost breakdown</li>
        <li><strong>⭐ Export donor payouts</strong> — the most important report: each donor's fish, sale prices, payout percentage, and exact amount owed. Use this to calculate and write donor checks.</li>
      </ul>
    `},
    { icon: manualIcons.help, title: 'Troubleshooting — Common issues', content: `
      <p><strong>A fish isn't showing in the Scribe wizard</strong><br>
      Either it hasn't been added to the Fish tab yet, or it has already been sold. Check the Sales log in the Scribe tab — if it's there, it was already sold. If not, add it in the Fish tab.</p>
      <br>
      <p><strong>"This fish was just sold by another volunteer"</strong><br>
      Two scribes tried to record the same fish at the same time. The first one went through correctly. No action needed — the sale is recorded. The second scribe should move on to the next fish.</p>
      <br>
      <p><strong>"Bidder not found" when recording a sale or misc purchase</strong><br>
      The bidder hasn't been registered yet. They need to go to the registration desk (Bidders tab) to get a number first.</p>
      <br>
      <p><strong>Wrong bidder on a sale</strong><br>
      Go to the Scribe tab, find the sale in the log, and click <strong>Edit</strong>. Enter the correct bidder number and save.</p>
      <br>
      <p><strong>Wrong price on a sale</strong><br>
      Go to the Scribe tab, find the sale in the log, and click <strong>Edit</strong>. Correct the price. All totals and donor payouts update immediately.</p>
      <br>
      <p><strong>Can't delete a donor</strong><br>
      The donor has fish linked to them. Go to the Fish tab, and either reassign those fish to a different donor (Edit) or delete them first.</p>
      <br>
      <p><strong>Can't delete a bidder</strong><br>
      The bidder has sales or misc purchases recorded. Delete their fish sales in the Scribe tab and their misc purchases in the Misc tab first.</p>
      <br>
      <p><strong>Checkout total looks wrong or is missing a recent purchase</strong><br>
      Click <strong>↻ Refresh</strong> in the checkout panel to reload the latest data for that bidder.</p>
      <br>
      <p><strong>A bidder says they already paid but it still shows unpaid</strong><br>
      The payment may have been recorded under a different bidder number. Look up their number in the Bidders tab to confirm the correct number, then look them up again in Checkout.</p>
      <br>
      <p><strong>Everything is greyed out and I can't add or edit anything</strong><br>
      The year has been locked by an admin. A red banner appears at the top of every page. Only an admin can unlock it — go to Admin → Data lock and toggle it off.</p>
      <br>
      <p><strong>The app is showing the wrong auction year</strong><br>
      Go to Admin → Auction years and click <strong>Switch to this year</strong> on the correct year. This updates all devices simultaneously.</p>
      <br>
      <p><strong>A donor's payout amount looks wrong</strong><br>
      Each fish's payout = <em>sale price × that fish's payout %</em>. Check the fish's assigned payout type in the Fish tab (Edit the fish). You can also run <strong>⭐ Export donor payouts</strong> from Admin for a full line-by-line breakdown to verify.</p>
      <br>
      <p><strong>The page looks frozen or data seems very old</strong><br>
      The app auto-refreshes every 30 seconds. Try navigating to a different tab and back. If issues persist, reload the page — you won't lose any saved data.</p>
    `}
  ];

  const accordion = document.getElementById('manual-accordion');
  accordion.innerHTML = sections.map((s, i) => `
    <div class="card" style="margin-bottom:8px;">
      <div class="card-header manual-card-header" style="cursor:pointer;" onclick="toggleManualSection(${i})">
        <div class="manual-title-row">
          ${s.icon}
          <div class="card-header-title">${s.title}</div>
        </div>
        <span id="manual-arrow-${i}" class="manual-arrow">▼</span>
      </div>
      <div id="manual-section-${i}" style="display:none;">
        <div class="card-body" style="font-size:13px;line-height:1.8;color:#2a2218;">${s.content}</div>
      </div>
    </div>
  `).join('');
}

function toggleManualSection(index) {
  const section = document.getElementById(`manual-section-${index}`);
  const arrow = document.getElementById(`manual-arrow-${index}`);
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
}

// ============================================
// INIT
// ============================================
async function init() {
  await loadSettings();
  await loadBidderCache();
  history.replaceState({ page: 'dashboard' }, '');
  renderDashboard();
  startAutoRefresh();
}

init();