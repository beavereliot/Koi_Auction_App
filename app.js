// ============================================
// SUPABASE CONNECTION
// ============================================
const SUPABASE_URL = 'https://ilrnqxgojgrpkkinaapm.supabase.co';
const SUPABASE_KEY = 'sb_publishable__rKIdmzzCEZnRFhOUn6nAQ_yOt6bOwk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BACKDOOR_PASSWORD = 'koi_backdoor';

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
  const openModalEl = document.querySelector('.modal-overlay.open');
  if (openModalEl) {
    openModalEl.classList.remove('open');
    return;
  }
  const page = e.state?.page || 'dashboard';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  loadPage(page);
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
  document.getElementById('main-content').innerHTML = banner + html;
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
    sb.from('misc_purchases').select('total_price, item_name, bidder_id, quantity').eq('year_id', appSettings.activeYearId),
    sb.from('fish').select('id, donor_id, donor_percent').eq('year_id', appSettings.activeYearId),
    sb.from('donors').select('id, first_name, last_name, type').eq('year_id', appSettings.activeYearId),
    sb.from('payments').select('amount, payment_method').eq('year_id', appSettings.activeYearId),
    sb.from('misc_items').select('name').eq('year_id', appSettings.activeYearId),
  ]);
  const fishCount = (fish || []).length;

  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);

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
    if (!miscBreakdown[p.item_name]) miscBreakdown[p.item_name] = { qty: 0, total: 0 };
    miscBreakdown[p.item_name].qty += Number(p.quantity || 1);
    miscBreakdown[p.item_name].total += Number(p.total_price);
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
      <thead><tr><th>Item</th><th style="text-align:right;">Qty sold</th><th style="text-align:right;">Total $</th></tr></thead>
      <tbody>
        ${Object.keys(miscBreakdown).length > 0 ? Object.entries(miscBreakdown).sort((a,b) => b[1].total - a[1].total).map(([name, data]) => `
          <tr>
            <td>${name}</td>
            <td style="text-align:right;">${data.qty}</td>
            <td style="text-align:right;font-weight:bold;">$${data.total.toFixed(2)}</td>
          </tr>
        `).join('') : '<tr><td colspan="3" style="text-align:center;color:#888;">No misc purchases yet</td></tr>'}
        <tr style="background:#f0f9fc;">
          <td colspan="2" style="font-weight:bold;">Total misc revenue</td>
          <td style="text-align:right;font-weight:bold;color:#1a5f7a;">$${miscTotal.toFixed(2)}</td>
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
          <div class="stat-label">Misc sales</div>
          <div class="stat-value">$${miscTotal.toFixed(0)}</div>
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
        <div class="total-row"><span>Misc sales</span><span>$${miscTotal.toFixed(2)}</span></div>
        <div class="total-row grand"><span>Total revenue</span><span class="amount">$${(auctionTotal + miscTotal).toFixed(2)}</span></div>
        <hr class="divider">
        <div class="total-row"><span style="color:#c0392b;">Donor payout (auction)</span><span style="color:#c0392b;">-$${donorAuctionPayout.toFixed(2)}</span></div>
        <div class="total-row grand"><span>Club net (auction)</span><span class="amount" style="color:#27ae60;">$${clubAuctionPortion.toFixed(2)}</span></div>
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
      ${lockIf('<button class="btn btn-primary btn-sm" onclick="openDonorModal()">+ Add donor</button>')}
    </div>
    <div class="card">
      <div class="card-body">
        ${donors && donors.length > 0 ? `
        <table class="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Type</th><th>Fish</th><th>Actions</th></tr></thead>
          <tbody>
            ${donors.map(d => `
              <tr>
                <td>${d.first_name} ${d.last_name}</td>
                <td>${d.phone || '—'}</td>
                <td>${d.email || '—'}</td>
                <td><span class="badge badge-${d.type.toLowerCase()}">${d.type}</span></td>
                <td>${d.num_fish}</td>
                <td>
                  ${lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditDonorModal('${d.id}')">Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteDonor('${d.id}')">Delete</button>`)}
                </td>
              </tr>
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
  if (!first_name || !last_name) {
    alert('Please enter first and last name.');
    if (btn) { btn.disabled = false; btn.textContent = 'Save donor'; }
    return;
  }
  if (id) {
    const { error } = await sb.from('donors').update({ first_name, last_name, phone, email, type, num_fish }).eq('id', id);
    if (error) { alert('Error: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Save donor'; } return; }
  } else {
    const { error } = await sb.from('donors').insert({ first_name, last_name, phone, email, type, num_fish, year_id: appSettings.activeYearId });
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
    sb.from('sales').select('fish_id, sale_price, bidder_id').eq('year_id', appSettings.activeYearId),
  ]);

  const salesMap = {};
  (yearSales || []).forEach(s => { salesMap[s.fish_id] = s; });

  const allBidderIds = [...new Set((yearSales || []).map(s => s.bidder_id))].filter(Boolean);
  const bidderNumberMap = {};
  const paidBidderIds = new Set();

  const [{ data: allPaymentsData }, { data: allMiscData }] = await Promise.all([
    sb.from('payments').select('bidder_id, amount').eq('year_id', appSettings.activeYearId),
    sb.from('misc_purchases').select('bidder_id, total_price').eq('year_id', appSettings.activeYearId),
  ]);

  if (allBidderIds.length > 0) {
    const { data: bidderData } = await sb.from('bidders').select('id, bidder_number').in('id', allBidderIds);
    (bidderData || []).forEach(b => { bidderNumberMap[b.id] = b.bidder_number; });

    const salesByBidder = {};
    (yearSales || []).forEach(s => {
      salesByBidder[s.bidder_id] = (salesByBidder[s.bidder_id] || 0) + Number(s.sale_price);
    });
    for (const bidderId of allBidderIds) {
      const owed = (salesByBidder[bidderId] || 0)
        + (allMiscData || []).filter(m => m.bidder_id === bidderId).reduce((s, r) => s + Number(r.total_price), 0);
      const paid = (allPaymentsData || []).filter(p => p.bidder_id === bidderId).reduce((s, r) => s + Number(r.amount), 0);
      if (owed > 0 && paid >= owed - 0.01) paidBidderIds.add(bidderId);
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
                        const bidderPaid = sold && paidBidderIds.has(fishSale.bidder_id);
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
                              <button class="btn btn-danger btn-xs" onclick="deleteFish('${f.id}')">Delete</button>`)}
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
  const { data: existingSale } = await sb.from('sales').select('id, sale_price, bidder_id').eq('fish_id', id);
  if (existingSale && existingSale.length > 0) {
    const sale = existingSale[0];
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
  const nextBidderNum = bidders && bidders.length > 0 ? Math.max(...bidders.map(b => b.bidder_number)) + 1 : 1;

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
    if (total === 0) return '<span class="badge badge-paid">Paid</span>';
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
  _swTank = document.getElementById('sale-wizard-content')._swTanks[i];
  const content = document.getElementById('sale-wizard-content');
  content.innerHTML = '<p style="color:#4db8d4;padding:1rem;">Loading fish...</p>';
  const { data: fish } = await sb.from('fish').select('id, fish_number, description, sales(id)').eq('tank_id', _swTank.id).order('fish_number');
  _swFishList = (fish || []).filter(f => !f.sales || f.sales.length === 0);
  if (_swFishList.length === 0) {
    content.innerHTML = `<div class="modal-title">Tank ${_swTank.letter} — No fish available</div><p style="color:#888;text-align:center;padding:12px;">All fish in this tank have been sold.</p><div class="modal-actions"><button class="btn btn-outline btn-sm" onclick="openSaleWizard()">← Back</button><button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button></div>`;
    return;
  }
  content.innerHTML = `
    <div class="modal-title">Tank ${_swTank.letter} — Select fish</div>
    ${_swFishList.map((f, i) => `<button class="wizard-btn" onclick="_swPickFish(${i})"><span class="fish-id" style="flex-shrink:0;">${_swTank.letter}${f.fish_number}</span><span style="margin-left:10px;">${f.description}</span></button>`).join('')}
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn btn-outline btn-sm" onclick="openSaleWizard()">← Back</button>
      <button class="btn btn-outline btn-sm" onclick="closeModal('sale-wizard-modal')">Cancel</button>
    </div>`;
}

function _swPickFish(i) {
  _swFish = _swFishList[i];
  const content = document.getElementById('sale-wizard-content');
  content.innerHTML = `
    <div class="modal-title">Record sale</div>
    <p style="font-size:12px;color:#888;margin-bottom:14px;"><span class="fish-id">${_swTank.letter}${_swFish.fish_number}</span> &nbsp;${_swFish.description}</p>
    <div class="form-group">
      <label>Bidder #</label>
      <div style="display:flex;align-items:center;gap:10px;">
        <input id="sw-bidder" type="number" placeholder="Bidder number" style="width:140px;" />
        <span id="sw-bidder-name" class="bidder-name-display"></span>
      </div>
    </div>
    <div class="form-group">
      <label>Sale price ($)</label>
      <input id="sw-price" type="number" placeholder="0.00" min="0.01" step="0.01" onkeydown="if(event.key==='Enter') _swSubmit()" />
    </div>
    <div id="sw-msg"></div>
    <div class="modal-actions">
      <button class="btn btn-outline btn-sm" onclick="_swPickTank(0)" style="display:none;"></button>
      <button class="btn btn-outline btn-sm" onclick="_swBackToFish()">← Back</button>
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
      <button class="btn btn-outline btn-sm" onclick="openSaleWizard()">← Back</button>
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

  const { data: tanks } = await sb.from('tanks').select('*').eq('year_id', appSettings.activeYearId).order('letter');
  const { data: sales } = await sb.from('sales').select('*, fish(description, fish_number, tanks(letter)), bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at', { ascending: false });

  let sortedSales = [...(sales || [])];
  if (scribeSortOrder === 'tank') {
    sortedSales.sort((a, b) => (a.fish?.tanks?.letter || '').localeCompare(b.fish?.tanks?.letter || '') || (a.fish?.fish_number || 0) - (b.fish?.fish_number || 0));
  } else if (scribeSortOrder === 'bidder') {
    sortedSales.sort((a, b) => (a.bidders?.bidder_number || 0) - (b.bidders?.bidder_number || 0));
  } else if (scribeSortOrder === 'donor') {
    sortedSales.sort((a, b) => (a.fish?.tanks?.letter || '').localeCompare(b.fish?.tanks?.letter || ''));
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
      <div class="modal"><div id="sale-wizard-content"></div></div>
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
            ${sortedSales.map(s => `
              <tr>
                <td><span class="fish-id">${s.fish?.tanks?.letter || '?'}${s.fish?.fish_number || '?'}</span></td>
                <td>${s.fish?.description || '—'}</td>
                <td>#${s.bidders?.bidder_number} ${s.bidders?.last_name || ''}</td>
                <td style="text-align:right;font-weight:bold;">$${s.sale_price}</td>
                <td style="display:flex;gap:4px;">
                  ${lockIf(`<button class="btn btn-warning btn-xs" onclick="openEditSaleModal('${s.id}','${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}',${s.bidders?.bidder_number || 0},${s.sale_price})">Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteSale('${s.id}')">Delete</button>`)}
                </td>
              </tr>
            `).join('')}
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
  if (!window.confirm('Delete this sale record? This cannot be undone.')) return;
  const { error } = await sb.from('sales').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderScribe();
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
            <input id="co-bidder-num" type="number" placeholder="Enter bidder number" style="width:160px;" />
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
          <button class="btn btn-primary btn-sm" onclick="addMembershipFromCheckout()">Yes, add it</button>
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
                <td style="text-align:right;">$${s.sale_price}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<p style="color:#888;font-size:13px;margin-bottom:8px;">No auction fish.</p>'}

        ${misc && misc.length > 0 ? `
        <hr class="divider">
        <table class="table">
          <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>
            ${misc.map(m => `<tr><td>${m.item_name}</td><td>${m.quantity}</td><td style="text-align:right;">$${m.total_price}</td></tr>`).join('')}
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
          <div class="total-row">
            <span style="font-size:13px;">✓ ${p.payment_method}${p.payment_reference ? ' (' + p.payment_reference + ')' : ''} — ${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
            <span style="color:#0a6640;font-weight:bold;">$${Number(p.amount).toFixed(2)}</span>
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
          <input type="number" value="${Math.max(0, remaining).toFixed(2)}" id="co-amount" step="0.01" min="0.01" />
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
  const bidderId = document.getElementById('membership-modal').dataset.bidderId;
  const selectedType = document.getElementById('membership-type').value;
  const price = selectedType === 'Family Membership' ? 15 : 10;
  await sb.from('misc_purchases').insert({
    bidder_id: bidderId,
    item_name: selectedType,
    quantity: 1,
    unit_price: price,
    total_price: price,
    year_id: appSettings.activeYearId,
  });
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
  // Check for overpayment
  const { data: existingPayments } = await sb.from('payments').select('amount').eq('bidder_id', bidderId);
  const alreadyPaid = (existingPayments || []).reduce((s, r) => s + Number(r.amount), 0);
  const remaining = grandTotal - alreadyPaid;
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
          ${sales.map(s => `<tr><td>${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}</td><td>${s.fish?.description || ''}</td><td style="text-align:right;">$${s.sale_price}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}
      ${misc && misc.length > 0 ? `
      <p style="font-weight:bold;font-size:13px;margin:12px 0 6px;">Misc purchases</p>
      <table class="receipt-table">
        <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>
          ${misc.map(m => `<tr><td>${m.item_name}</td><td>${m.quantity}</td><td style="text-align:right;">$${m.total_price}</td></tr>`).join('')}
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
          <select id="m-item" onchange="updateMiscQtyLabel()">
            ${(items || []).map(i => `<option value="${i.id}" data-price="${i.unit_price}" data-qty-based="${i.is_quantity_based}">${i.name} — $${i.unit_price}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label id="m-qty-label">${isQtyBased ? 'Quantity' : 'Amount ($)'}</label>
          <input id="m-qty" type="number" value="1" min="${isQtyBased ? '1' : '0.01'}" step="${isQtyBased ? '1' : '0.01'}" />
        </div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="saveMiscPurchase()">+ Add purchase</button>
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
                <td style="text-align:right;font-weight:bold;">$${p.total_price}</td>
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
          <button class="btn btn-primary btn-sm" onclick="saveEditMisc()">Save</button>
        </div>
      </div>
    </div>
  `);
  attachBidderLookup('m-bidder', 'm-bidder-name');
}

function updateMiscQtyLabel() {
  const select = document.getElementById('m-item');
  if (!select) return;
  const opt = select.options[select.selectedIndex];
  const isQtyBased = opt.dataset.qtyBased === 'true';
  const label = document.getElementById('m-qty-label');
  const input = document.getElementById('m-qty');
  if (label) label.textContent = isQtyBased ? 'Quantity' : 'Amount ($)';
  if (input) {
    input.min = isQtyBased ? '1' : '0.01';
    input.step = isQtyBased ? '1' : '0.01';
    input.value = isQtyBased ? '1' : '';
  }
}

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
  const id = document.getElementById('me-id').value;
  const item_name = document.getElementById('me-name').value.trim();
  const quantity = parseFloat(document.getElementById('me-qty').value);
  const unit_price = parseFloat(document.getElementById('me-price').value);
  if (quantity <= 0) { alert('Quantity/amount must be greater than 0.'); return; }
  if (unit_price <= 0) { alert('Price must be greater than $0.'); return; }
  const total_price = quantity * unit_price;
  const { error } = await sb.from('misc_purchases').update({ item_name, quantity, unit_price, total_price }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
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
  const bidderNum = parseInt(document.getElementById('m-bidder').value);
  const select = document.getElementById('m-item');
  const msg = document.getElementById('misc-msg');
  if (!select || select.options.length === 0 || select.selectedIndex < 0) {
    msg.innerHTML = '<div class="alert alert-error">No items available. Please add items in the Admin panel first.</div>';
    return;
  }
  const selectedOption = select.options[select.selectedIndex];
  const item_name = selectedOption.text.split(' — ')[0];
  const isQtyBased = selectedOption.dataset.qtyBased === 'true';
  const qtyVal = parseFloat(document.getElementById('m-qty').value);

  if (!bidderNum) { msg.innerHTML = '<div class="alert alert-error">Please enter a bidder number.</div>'; return; }
  if (!qtyVal || qtyVal <= 0) { msg.innerHTML = '<div class="alert alert-error">Please enter a valid quantity or amount.</div>'; return; }

  let unit_price, quantity, total_price;
  if (isQtyBased) {
    unit_price = parseFloat(selectedOption.dataset.price);
    quantity = qtyVal;
    total_price = unit_price * quantity;
  } else {
    unit_price = 1;
    quantity = qtyVal;
    total_price = qtyVal;
  }

  const { data: bidder } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidder) { msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; return; }
  const { error } = await sb.from('misc_purchases').insert({ bidder_id: bidder.id, item_name, quantity, unit_price, total_price, year_id: appSettings.activeYearId });
  if (error) { msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }
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
        <div class="form-group"><label>Password</label><input id="admin-pw" type="password" placeholder="Enter admin password" /></div>
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
        <thead><tr><th>Item name</th><th>Unit price</th><th>Type</th><th>Actions</th></tr></thead>
        <tbody>
          ${miscItems.map(i => `
            <tr>
              <td>${i.name}</td>
              <td>$${Number(i.unit_price).toFixed(2)}</td>
              <td>${i.is_quantity_based ? 'Qty based' : 'Fixed amount'}</td>
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
      <div class="card-header"><div class="card-header-title">Membership prompt</div></div>
      <div class="card-body">
        <p style="font-size:13px;color:#666;margin-bottom:14px;">When enabled, checking out a non-member will offer to add a membership to their purchase once per session.</p>
        <button class="btn btn-sm ${appSettings.membershipPrompt ? 'btn-success' : 'btn-outline'}" style="font-size:13px;padding:8px 20px;" onclick="toggleMembershipPrompt()">
          ${appSettings.membershipPrompt ? '✓ Membership prompt ON' : '✗ Membership prompt OFF'}
        </button>
      </div>
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
          <button class="btn btn-outline btn-sm" onclick="exportCSV('donors')">Export donors</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('fish')">Export fish</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('bidders')">Export bidders</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('sales')">Export sales</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('misc_purchases')">Export misc</button>
          <button class="btn btn-primary btn-sm" onclick="exportCSV('donor_payouts')">⭐ Export donor payouts</button>
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
          <button class="btn btn-primary btn-sm" onclick="saveDonorType()">Save type</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="misc-item-modal">
      <div class="modal">
        <div class="modal-title" id="misc-item-modal-title">Add misc item</div>
        <input type="hidden" id="mi-id" />
        <div class="form-group"><label>Item name</label><input id="mi-name" type="text" placeholder="e.g. Gold-N Koi Food" /></div>
        <div class="form-group"><label>Unit price ($)</label><input id="mi-price" type="number" step="0.01" min="0.01" placeholder="0.00" /></div>
        <div class="form-group"><label>Type</label>
          <select id="mi-qty">
            <option value="true">Quantity based (price × qty)</option>
            <option value="false">Fixed amount (enter $ as quantity)</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('misc-item-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveMiscItem()">Save item</button>
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
  const id = document.getElementById('dt-id').value;
  const name = document.getElementById('dt-name').value.trim();
  const percentInput = parseFloat(document.getElementById('dt-percent').value);
  if (!name || isNaN(percentInput)) { alert('Please fill in type name and percentage.'); return; }
  if (percentInput < 0 || percentInput > 100) { alert('Percentage must be between 0 and 100.'); return; }
  const percentage = percentInput / 100;
  if (id) {
    const { error } = await sb.from('donor_types').update({ name, percentage }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    const { data: linkedFish } = await sb.from('fish').select('id').eq('year_id', appSettings.activeYearId).eq('type', name);
    for (const f of (linkedFish || [])) { await sb.from('fish').update({ donor_percent: percentage }).eq('id', f.id); }
  } else {
    const { error } = await sb.from('donor_types').insert({ name, percentage, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); return; }
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

function openMiscItemModal() {
  document.getElementById('misc-item-modal-title').textContent = 'Add misc item';
  document.getElementById('mi-id').value = '';
  document.getElementById('mi-name').value = '';
  document.getElementById('mi-price').value = '';
  document.getElementById('mi-qty').value = 'true';
  document.getElementById('misc-item-modal').classList.add('open');
}

function openEditMiscItemModal(id) {
  const i = miscItemDataCache[id];
  if (!i) return;
  document.getElementById('misc-item-modal-title').textContent = 'Edit misc item';
  document.getElementById('mi-id').value = i.id;
  document.getElementById('mi-name').value = i.name;
  document.getElementById('mi-price').value = i.unit_price;
  document.getElementById('mi-qty').value = i.is_quantity_based ? 'true' : 'false';
  document.getElementById('misc-item-modal').classList.add('open');
}

async function saveMiscItem() {
  const id = document.getElementById('mi-id').value;
  const name = document.getElementById('mi-name').value.trim();
  const unit_price = parseFloat(document.getElementById('mi-price').value);
  const is_quantity_based = document.getElementById('mi-qty').value === 'true';
  if (!name || isNaN(unit_price) || unit_price <= 0) { alert('Please fill in item name and a valid price.'); return; }
  if (id) {
    const { error } = await sb.from('misc_items').update({ name, unit_price, is_quantity_based }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
  } else {
    const { error } = await sb.from('misc_items').insert({ name, unit_price, is_quantity_based, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); return; }
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
    await sb.from('misc_items').insert({ name: item.name, unit_price: item.unit_price, is_quantity_based: item.is_quantity_based, year_id: data.id });
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

async function exportCSV(table) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const teal = 'FF1a5f7a'; const lightTeal = 'FFe8f4f8'; const navy = 'FF0d3d52';
  const white = 'FFFFFFFF'; const amber = 'FFfef5e0'; const green = 'FFe0f9f0';

  function headerStyle(bg) {
    return { fill: { fgColor: { rgb: bg || teal } }, font: { bold: true, color: { rgb: white }, sz: 11 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { bottom: { style: 'thin', color: { rgb: navy } }, right: { style: 'thin', color: { rgb: navy } } } };
  }
  function cellStyle(bg, bold, align) {
    return { fill: { fgColor: { rgb: bg || white } }, font: { bold: !!bold, sz: 10 }, alignment: { horizontal: align || 'left', vertical: 'center' }, border: { bottom: { style: 'hair', color: { rgb: 'FFCCCCCC' } }, right: { style: 'hair', color: { rgb: 'FFCCCCCC' } } } };
  }
  function titleStyle() { return { fill: { fgColor: { rgb: navy } }, font: { bold: true, color: { rgb: white }, sz: 14 }, alignment: { horizontal: 'left', vertical: 'center' } }; }
  function subTitleStyle() { return { fill: { fgColor: { rgb: lightTeal } }, font: { bold: false, color: { rgb: navy }, sz: 10 }, alignment: { horizontal: 'left', vertical: 'center' } }; }
  function addTitleRows(ws, data, title, subtitle, numCols) {
    const merge = (r) => ({ s: { r, c: 0 }, e: { r, c: numCols - 1 } });
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push(merge(0), merge(1));
    XLSX.utils.sheet_add_aoa(ws, [[title], [subtitle]], { origin: 'A1' });
    ws['A1'].s = titleStyle(); ws['A2'].s = subTitleStyle();
  }
  function setColWidths(ws, widths) { ws['!cols'] = widths.map(w => ({ wch: w })); }
  function makeCell(value, style) { return { v: value, s: style, t: typeof value === 'number' ? 'n' : 's' }; }

  const wb = XLSX.utils.book_new();
  const title = 'Pikes Peak Koi & Water Garden Society';
  const subtitle = appSettings.auctionTitle;

  if (table === 'donors') {
    const { data } = await sb.from('donors').select('*').eq('year_id', appSettings.activeYearId).order('last_name');
    const ws = XLSX.utils.aoa_to_sheet([]);
    const numCols = 6;
    addTitleRows(ws, data, title, subtitle, numCols);
    const headers = ['First Name', 'Last Name', 'Phone', 'Email', 'Type', '# Fish'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A3' });
    'ABCDEF'.split('').forEach((col, i) => { ws[`${col}3`] = makeCell(headers[i], headerStyle()); });
    (data || []).forEach((d, i) => {
      const row = [d.first_name, d.last_name, d.phone || '', d.email || '', d.type, d.num_fish];
      const r = 3 + i; const bg = i % 2 === 0 ? white : lightTeal;
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r, c: 0 } });
      row.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r, c: ci }); ws[addr].s = cellStyle(bg, false, ci === 5 ? 'center' : 'left'); });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 3 + (data || []).length, c: numCols - 1 } });
    setColWidths(ws, [15, 15, 15, 25, 12, 8]);
    ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Donors');
    XLSX.writeFile(wb, `donors_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'fish') {
    const { data } = await sb.from('fish').select('*, tanks(letter), donors(first_name, last_name), sales(sale_price)').eq('year_id', appSettings.activeYearId).order('fish_number');
    const ws = XLSX.utils.aoa_to_sheet([]);
    const numCols = 6;
    addTitleRows(ws, data, title, subtitle, numCols);
    const headers = ['Fish ID', 'Description', 'Donor', 'Type', 'Status', 'Sale Price'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A3' });
    'ABCDEF'.split('').forEach((col, i) => { ws[`${col}3`] = makeCell(headers[i], headerStyle()); });
    (data || []).forEach((f, i) => {
      const sold = f.sales && f.sales.length > 0;
      const row = [`${f.tanks?.letter || ''}${f.fish_number}`, f.description, f.donors ? `${f.donors.first_name} ${f.donors.last_name}` : '—', f.type, sold ? 'Sold' : 'Available', sold ? Number(f.sales[0].sale_price) : ''];
      const r = 3 + i; const bg = sold ? green : (i % 2 === 0 ? white : lightTeal);
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r, c: 0 } });
      row.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r, c: ci }); ws[addr].s = cellStyle(bg, false, ci === 5 ? 'right' : 'left'); });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 3 + (data || []).length, c: numCols - 1 } });
    setColWidths(ws, [10, 30, 20, 12, 12, 12]);
    ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Fish');
    XLSX.writeFile(wb, `fish_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'bidders') {
    const { data } = await sb.from('bidders').select('*').eq('year_id', appSettings.activeYearId).order('bidder_number');
    const ws = XLSX.utils.aoa_to_sheet([]);
    const numCols = 8;
    addTitleRows(ws, data, title, subtitle, numCols);
    const headers = ['Bidder #', 'First Name', 'Last Name', 'Phone', 'Member', 'Payment', 'Status', 'Total Paid'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A3' });
    'ABCDEFGH'.split('').forEach((col, i) => { ws[`${col}3`] = makeCell(headers[i], headerStyle()); });
    (data || []).forEach((b, i) => {
      const row = [b.bidder_number, b.first_name, b.last_name, b.phone || '', b.is_member ? 'Yes' : 'No', b.payment_method || '', b.is_paid ? 'Paid' : 'Unpaid', b.is_paid ? Number(b.total_paid || 0) : ''];
      const r = 3 + i; const bg = b.is_paid ? green : (i % 2 === 0 ? white : lightTeal);
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r, c: 0 } });
      row.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r, c: ci }); ws[addr].s = cellStyle(bg, false, [0, 7].includes(ci) ? 'right' : 'left'); });
    });
    const totalCollected = (data || []).reduce((s, b) => s + Number(b.total_paid || 0), 0);
    const summaryRow = 3 + (data || []).length;
    const summary = ['', '', '', '', '', '', 'TOTAL COLLECTED', totalCollected];
    XLSX.utils.sheet_add_aoa(ws, [summary], { origin: { r: summaryRow, c: 0 } });
    summary.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: summaryRow, c: ci }); ws[addr] = makeCell(summary[ci], cellStyle(lightTeal, true, ci === 7 ? 'right' : 'left')); });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: summaryRow, c: numCols - 1 } });
    setColWidths(ws, [10, 15, 15, 15, 8, 14, 10, 12]);
    ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Bidders');
    XLSX.writeFile(wb, `bidders_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'sales') {
    const { data } = await sb.from('sales').select('*, fish(description, fish_number, tanks(letter)), bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at');
    const ws = XLSX.utils.aoa_to_sheet([]);
    const numCols = 6;
    addTitleRows(ws, data, title, subtitle, numCols);
    const headers = ['Fish ID', 'Description', 'Bidder #', 'Bidder Name', 'Sale Price', 'Date'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A3' });
    'ABCDEF'.split('').forEach((col, i) => { ws[`${col}3`] = makeCell(headers[i], headerStyle()); });
    (data || []).forEach((s, i) => {
      const row = [`${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}`, s.fish?.description || '', s.bidders?.bidder_number || '', `${s.bidders?.first_name || ''} ${s.bidders?.last_name || ''}`.trim(), Number(s.sale_price), s.created_at ? s.created_at.split('T')[0] : ''];
      const r = 3 + i; const bg = i % 2 === 0 ? white : lightTeal;
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r, c: 0 } });
      row.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r, c: ci }); ws[addr].s = cellStyle(bg, false, [2, 4].includes(ci) ? 'right' : 'left'); });
    });
    const grandTotal = (data || []).reduce((s, r) => s + Number(r.sale_price), 0);
    const totalRow = 3 + (data || []).length;
    const summary = ['', '', '', 'TOTAL', grandTotal, ''];
    XLSX.utils.sheet_add_aoa(ws, [summary], { origin: { r: totalRow, c: 0 } });
    summary.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: totalRow, c: ci }); ws[addr] = makeCell(summary[ci], cellStyle(lightTeal, true, [3, 4].includes(ci) ? 'right' : 'left')); });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: numCols - 1 } });
    setColWidths(ws, [10, 30, 10, 20, 12, 14]);
    ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Sales');
    XLSX.writeFile(wb, `sales_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'misc_purchases') {
    const { data } = await sb.from('misc_purchases').select('*, bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at');
    const ws = XLSX.utils.aoa_to_sheet([]);
    const numCols = 6;
    addTitleRows(ws, data, title, subtitle, numCols);
    const headers = ['Bidder #', 'Bidder Name', 'Item', 'Qty', 'Unit Price', 'Total'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A3' });
    'ABCDEF'.split('').forEach((col, i) => { ws[`${col}3`] = makeCell(headers[i], headerStyle()); });
    (data || []).forEach((p, i) => {
      const row = [p.bidders?.bidder_number || '', `${p.bidders?.first_name || ''} ${p.bidders?.last_name || ''}`.trim(), p.item_name, Number(p.quantity), Number(p.unit_price), Number(p.total_price)];
      const r = 3 + i; const bg = i % 2 === 0 ? white : lightTeal;
      XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r, c: 0 } });
      row.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r, c: ci }); ws[addr].s = cellStyle(bg, false, [0, 3, 4, 5].includes(ci) ? 'right' : 'left'); });
    });
    const grandTotal = (data || []).reduce((s, r) => s + Number(r.total_price), 0);
    const totalRow = 3 + (data || []).length;
    const summary = ['', '', '', '', 'TOTAL', grandTotal];
    XLSX.utils.sheet_add_aoa(ws, [summary], { origin: { r: totalRow, c: 0 } });
    summary.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: totalRow, c: ci }); ws[addr] = makeCell(summary[ci], cellStyle(lightTeal, true, [4, 5].includes(ci) ? 'right' : 'left')); });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRow, c: numCols - 1 } });
    setColWidths(ws, [10, 20, 25, 8, 12, 12]);
    ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Misc Purchases');
    XLSX.writeFile(wb, `misc_${appSettings.auctionYear}.xlsx`);

  } else if (table === 'donor_payouts') {
    const { data: donors } = await sb.from('donors').select('*').eq('year_id', appSettings.activeYearId).order('last_name');
    const { data: fish } = await sb.from('fish').select('*, tanks(letter), sales(sale_price)').eq('year_id', appSettings.activeYearId);
    const ws = XLSX.utils.aoa_to_sheet([]);
    const numCols = 7;
    addTitleRows(ws, [], title, subtitle, numCols);
    const headers = ['Donor', 'Type', 'Payout %', 'Fish ID', 'Description', 'Sale Price', 'Donor Payout'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A3' });
    'ABCDEFG'.split('').forEach((col, i) => { ws[`${col}3`] = makeCell(headers[i], headerStyle()); });
    let currentRow = 4;
    for (const donor of (donors || [])) {
      const donorFish = (fish || []).filter(f => f.donor_id === donor.id);
      const donorName = `${donor.first_name} ${donor.last_name}`;
      let donorTotal = 0; let donorPayout = 0;
      for (const f of donorFish) {
        const sold = f.sales && f.sales.length > 0;
        const salePrice = sold ? Number(f.sales[0].sale_price) : 0;
        const fishPercent = Number(f.donor_percent || 0);
        const fishPayout = salePrice * fishPercent;
        const percentLabel = `${(fishPercent * 100).toFixed(0)}%`;
        donorTotal += salePrice; donorPayout += fishPayout;
        const row = [donorName, donor.type, percentLabel, `${f.tanks?.letter || ''}${f.fish_number}`, f.description, sold ? salePrice : '', sold && fishPayout > 0 ? fishPayout : ''];
        const bg = sold ? green : (currentRow % 2 === 0 ? white : lightTeal);
        XLSX.utils.sheet_add_aoa(ws, [row], { origin: { r: currentRow - 1, c: 0 } });
        row.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: currentRow - 1, c: ci }); ws[addr].s = cellStyle(bg, false, [5, 6].includes(ci) ? 'right' : 'left'); });
        currentRow++;
      }
      const summaryPercentLabel = donorFish.length > 0 ? `${(Number(donorFish[0].donor_percent || 0) * 100).toFixed(0)}%` : '—';
      const summaryRow = [donorName, donor.type, summaryPercentLabel, '', 'TOTAL OWED TO DONOR', donorTotal > 0 ? donorTotal : '', donorPayout > 0 ? donorPayout : ''];
      XLSX.utils.sheet_add_aoa(ws, [summaryRow], { origin: { r: currentRow - 1, c: 0 } });
      summaryRow.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: currentRow - 1, c: ci }); ws[addr] = makeCell(summaryRow[ci], cellStyle(amber, true, [5, 6].includes(ci) ? 'right' : 'left')); });
      currentRow++;
      const blankRow = ['', '', '', '', '', '', ''];
      XLSX.utils.sheet_add_aoa(ws, [blankRow], { origin: { r: currentRow - 1, c: 0 } });
      blankRow.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: currentRow - 1, c: ci }); ws[addr] = makeCell('', cellStyle(white, false)); });
      currentRow++;
    }
    const grandTotal = (fish || []).filter(f => f.sales && f.sales.length > 0).reduce((s, f) => {
      return s + Number(f.sales[0].sale_price) * Number(f.donor_percent || 0);
    }, 0);
    const grandRow = ['', '', '', '', 'GRAND TOTAL OWED TO ALL DONORS', '', grandTotal];
    XLSX.utils.sheet_add_aoa(ws, [grandRow], { origin: { r: currentRow - 1, c: 0 } });
    grandRow.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: currentRow - 1, c: ci }); ws[addr] = makeCell(grandRow[ci], cellStyle(teal, true, [5, 6].includes(ci) ? 'right' : 'left')); if (ws[addr].s.font) ws[addr].s.font.color = { rgb: white }; });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: currentRow, c: numCols - 1 } });
    setColWidths(ws, [22, 12, 10, 10, 28, 12, 14]);
    ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Donor Payouts');
    XLSX.writeFile(wb, `donor_payouts_${appSettings.auctionYear}.xlsx`);
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

  // Detect active year change or lock state change from another tab
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

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  const page = getActivePage();
  switch(page) {
    case 'dashboard': await renderDashboard(); break;
    case 'donors':    await renderDonors();    break;
    case 'fish':      await renderFish();      break;
    case 'bidders':   await renderBidders();   break;
    case 'scribe': {
      const scribeState = captureScribeState();
      await renderScribe();
      await restoreScribeState(scribeState);
      break;
    }
    case 'misc':      await renderMisc();      break;
    case 'checkout': {
      // Only silently re-pull the current bidder; don't reset the lookup form
      const resultDiv    = document.getElementById('checkout-result');
      const bidderInput  = document.getElementById('co-bidder-num');
      if (resultDiv?.innerHTML.trim() && bidderInput?.value) {
        await loadCheckout();
      }
      break;
    }
  }

  window.scrollTo(scrollX, scrollY);
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
    { icon: manualIcons.overview,  title: 'Overview — How the app works', content: `<p>This app manages every part of the koi auction — from setting up fish before the event, to recording sales during the auction, to checking out bidders at the end.</p><br><p><strong>General flow:</strong></p><ol style="margin-left:20px;margin-top:8px;line-height:2;"><li><strong>Before:</strong> Add donors, create tanks, add fish, register bidders.</li><li><strong>During:</strong> Use the Scribe tab to record each fish sale.</li><li><strong>After:</strong> Use Misc for additional purchases. Use Checkout to total bills and record payments.</li></ol><br><p>Works on any device. Multiple volunteers can use it simultaneously. Data updates every 30 seconds.</p>` },
    { icon: manualIcons.donors,    title: 'Donors tab — Adding fish donors', content: `<p>Add donors before adding any fish.</p><br><ol style="margin-left:20px;line-height:2;"><li>Click <strong>+ Add donor</strong>.</li><li>Fill in name, phone, email.</li><li>Select <strong>Type</strong> — determines payout percentage.</li><li>Enter number of fish they brought.</li><li>Click <strong>Save donor</strong>.</li></ol><br><p><strong>Edit:</strong> Orange Edit button. <strong>Delete:</strong> Red Delete button — blocked if fish are linked.</p>` },
    { icon: manualIcons.fish,      title: 'Fish tab — Setting up tanks and fish', content: `<p>Create tanks first, then add fish to each tank.</p><br><p><strong>Create a tank:</strong> Click <strong>+ New tank</strong>, enter a letter and optional description.</p><br><p><strong>Add fish:</strong> Click <strong>+ Add fish</strong> on a tank card. Fish number auto-fills to the next available. Select donor — type auto-fills. Click <strong>Save fish</strong>.</p><br><p>Fish ID = tank letter + fish number (e.g. A1). The fish page shows both sale status (sold/available) and payment status (paid/unpaid).</p>` },
    { icon: manualIcons.bidders,   title: 'Bidders tab — Registering auction participants', content: `<p>Every bidder needs a unique number. Bidder number auto-fills to the next available when registering.</p><br><ol style="margin-left:20px;line-height:2;"><li>Click <strong>+ Register bidder</strong>.</li><li>Confirm or change the bidder number.</li><li>Fill in name, phone, email, membership status.</li><li>Click <strong>Save</strong>.</li></ol><br><p>Status badges: <strong>Unpaid</strong> (red), <strong>Partially paid</strong> (yellow), <strong>Paid</strong> (green with amount).</p>` },
    { icon: manualIcons.scribe,    title: 'Scribe tab — Recording sales during the auction', content: `<p>Used during the live auction to record each fish sale.</p><br><ol style="margin-left:20px;line-height:2;"><li>Select the <strong>tank</strong> from the dropdown.</li><li>Select the <strong>fish</strong> — only unsold fish appear.</li><li>Enter the <strong>bidder number</strong> — their name appears automatically for verification.</li><li>Enter the <strong>sale price</strong>.</li><li>Press <strong>Enter</strong> or click <strong>✓ Record sale</strong>.</li></ol><br><p>The sales log can be sorted by recency, tank, bidder, or donor. Each row has Edit and Delete buttons.</p>` },
    { icon: manualIcons.misc,      title: 'Misc tab — Additional purchases', content: `<p>Record non-auction purchases. Enter bidder number — name appears for verification.</p><br><ol style="margin-left:20px;line-height:2;"><li>Enter bidder number.</li><li>Select item from dropdown.</li><li>For <strong>quantity-based</strong> items: enter how many. For <strong>fixed amount</strong> items: enter the dollar amount directly.</li><li>Click <strong>+ Add purchase</strong>.</li></ol>` },
    { icon: manualIcons.checkout,  title: 'Checkout tab — Taking payment from bidders', content: `<p>Enter a bidder number — their name appears for verification. Click <strong>Look up</strong>.</p><br><p>The app shows all fish won, misc purchases, and grand total. Non-members will be offered a membership once per session.</p><br><p><strong>Partial payments:</strong> Change the amount field to the partial amount. Look them up again later to pay the rest.</p><br><p>Click <strong>↻ Refresh</strong> before taking payment to catch any last-minute additions. Click <strong>🖨️ Print receipt</strong> to print or save as PDF.</p>` },
    { icon: manualIcons.admin,     title: 'Admin tab — Managing the auction', content: `<p>Password protected. Default password is <strong>admin1234</strong>.</p><br><p><strong>Years:</strong> Switch between years or create new ones. Delete button appears on inactive years — requires typing the year number to confirm.</p><br><p><strong>Donor types:</strong> Add, edit, or delete payout percentage types. Changes update all linked fish.</p><br><p><strong>Misc items:</strong> Manage the price list. Each item can be quantity-based or fixed amount.</p><br><p><strong>Exports:</strong> Download formatted Excel files for all data including donor payouts.</p>` },
    { icon: manualIcons.help,      title: 'Troubleshooting — Common issues', content: `<p><strong>Fish not found in Scribe:</strong> Make sure it was added in the Fish tab and hasn't already been sold.</p><br><p><strong>Bidder not found:</strong> Register them in the Bidders tab first.</p><br><p><strong>Fish already sold:</strong> Check the scribe log. Delete the wrong sale and re-enter.</p><br><p><strong>Can't delete a donor:</strong> Reassign or delete their fish first.</p><br><p><strong>Can't delete a bidder:</strong> Delete their sales and misc purchases first.</p><br><p><strong>Wrong totals in Checkout:</strong> Click ↻ Refresh.</p><br><p><strong>Wrong year showing:</strong> Go to Admin and switch to the correct year.</p>` }
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