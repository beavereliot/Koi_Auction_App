// ============================================
// SUPABASE CONNECTION
// ============================================
const SUPABASE_URL = 'https://ilrnqxgojgrpkkinaapm.supabase.co';
const SUPABASE_KEY = 'sb_publishable__rKIdmzzCEZnRFhOUn6nAQ_yOt6bOwk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// APP SETTINGS
// ============================================
let appSettings = {
  auctionYear: new Date().getFullYear(),
  auctionTitle: `${new Date().getFullYear()} Re-Homing Auction`,
  adminPassword: 'admin1234',
  activeYearId: null,
};

async function loadSettings() {
  const { data } = await sb.from('settings').select('*').order('created_at', { ascending: false });
  if (data && data.length > 0) {
    const active = data.find(s => s.is_active) || data[0];
    appSettings.auctionYear = active.year;
    appSettings.auctionTitle = active.title;
    appSettings.adminPassword = active.admin_password || 'admin1234';
    appSettings.activeYearId = active.id;
    document.getElementById('auction-subtitle').textContent = active.title;
  } else {
    const { data: newSettings } = await sb.from('settings').insert({
      year: appSettings.auctionYear,
      title: appSettings.auctionTitle,
      admin_password: 'admin1234',
      is_active: true,
    }).select().single();
    if (newSettings) {
      appSettings.activeYearId = newSettings.id;
      document.getElementById('auction-subtitle').textContent = appSettings.auctionTitle;
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
    loadPage(item.dataset.page);
  });
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
  }
}

function setContent(html) {
  document.getElementById('main-content').innerHTML = html;
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
// DASHBOARD
// ============================================
async function renderDashboard() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading dashboard...</p>');
  if (!appSettings.activeYearId) { setContent('<p style="color:#c0392b;padding:1rem;">No active year found. Please go to Admin to create one.</p>'); return; }
  const [{ count: fishCount }, { count: bidderCount }, { data: sales }, { data: misc }] = await Promise.all([
    sb.from('fish').select('*', { count: 'exact', head: true }).eq('year_id', appSettings.activeYearId),
    sb.from('bidders').select('*', { count: 'exact', head: true }).eq('year_id', appSettings.activeYearId),
    sb.from('sales').select('sale_price').eq('year_id', appSettings.activeYearId),
    sb.from('misc_purchases').select('total_price').eq('year_id', appSettings.activeYearId),
  ]);
  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);
  setContent(`
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total fish</div>
        <div class="stat-value">${fishCount || 0}</div>
      </div>
      <div class="stat-card" style="border-left-color:#e8a0b0;">
        <div class="stat-label">Bidders</div>
        <div class="stat-value">${bidderCount || 0}</div>
      </div>
      <div class="stat-card" style="border-left-color:#4db87a;">
        <div class="stat-label">Auction sales</div>
        <div class="stat-value">$${auctionTotal.toFixed(0)}</div>
      </div>
      <div class="stat-card" style="border-left-color:#e8c44a;">
        <div class="stat-label">Misc sales</div>
        <div class="stat-value">$${miscTotal.toFixed(0)}</div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Grand total</div></div>
      <div class="card-body">
        <div class="total-row grand">
          <span>Total revenue</span>
          <span class="amount">$${(auctionTotal + miscTotal).toFixed(0)}</span>
        </div>
      </div>
    </div>
  `);
}

// ============================================
// DONORS
// ============================================
async function renderDonors() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading donors...</p>');
  const { data: donors } = await sb.from('donors').select('*').eq('year_id', appSettings.activeYearId).order('last_name');
  setContent(`
    <div class="page-header">
      <div class="section-label">Koi donors</div>
      <button class="btn btn-primary btn-sm" onclick="openDonorModal()">+ Add donor</button>
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
                  <button class="btn btn-warning btn-xs" onclick='openEditDonorModal(${JSON.stringify(d)})'>Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteDonor('${d.id}')">Delete</button>
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
            <option value="Pickup">Pickup (40%)</option>
            <option value="Dropoff">Dropoff (50%)</option>
            <option value="Donation">Donation (0%)</option>
          </select>
        </div>
        <div class="form-group"><label># of fish</label><input id="d-fish" type="number" value="1" min="0" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('donor-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveDonor()">Save donor</button>
        </div>
      </div>
    </div>
  `);
  attachPhoneFormatter('d-phone');
}

function openDonorModal() {
  document.getElementById('donor-modal-title').textContent = 'Add donor';
  document.getElementById('d-id').value = '';
  document.getElementById('d-first').value = '';
  document.getElementById('d-last').value = '';
  document.getElementById('d-phone').value = '';
  document.getElementById('d-email').value = '';
  document.getElementById('d-type').value = 'Pickup';
  document.getElementById('d-fish').value = '1';
  document.getElementById('donor-modal').classList.add('open');
}

function openEditDonorModal(d) {
  document.getElementById('donor-modal-title').textContent = 'Edit donor';
  document.getElementById('d-id').value = d.id;
  document.getElementById('d-first').value = d.first_name;
  document.getElementById('d-last').value = d.last_name;
  document.getElementById('d-phone').value = d.phone || '';
  document.getElementById('d-email').value = d.email || '';
  document.getElementById('d-type').value = d.type;
  document.getElementById('d-fish').value = d.num_fish;
  document.getElementById('donor-modal').classList.add('open');
}

async function saveDonor() {
  const id = document.getElementById('d-id').value;
  const first_name = document.getElementById('d-first').value.trim();
  const last_name = document.getElementById('d-last').value.trim();
  const phone = document.getElementById('d-phone').value.trim();
  const email = document.getElementById('d-email').value.trim();
  const type = document.getElementById('d-type').value;
  const num_fish = parseInt(document.getElementById('d-fish').value) || 0;
  if (!first_name || !last_name) { alert('Please enter first and last name.'); return; }
  if (id) {
    const { error } = await sb.from('donors').update({ first_name, last_name, phone, email, type, num_fish }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
  } else {
    const { error } = await sb.from('donors').insert({ first_name, last_name, phone, email, type, num_fish, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); return; }
  }
  closeModal('donor-modal');
  renderDonors();
}

async function deleteDonor(id) {
  if (!confirm('Delete this donor? This cannot be undone.')) return;
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
  const [{ data: tanks }, { data: fish }, { data: donors }] = await Promise.all([
    sb.from('tanks').select('*').eq('year_id', appSettings.activeYearId).order('letter'),
    sb.from('fish').select('*, tanks(letter), donors(id, first_name, last_name, type), sales(sale_price)').eq('year_id', appSettings.activeYearId).order('fish_number'),
    sb.from('donors').select('id, first_name, last_name, type').eq('year_id', appSettings.activeYearId).order('last_name'),
  ]);

  allDonorsForFish = donors || [];
  const tankFish = (tankLetter) => fish ? fish.filter(f => f.tanks?.letter === tankLetter) : [];
  const allTanks = tanks || [];

  const donorOptions = allDonorsForFish.map(d =>
    `<option value="${d.id}" data-type="${d.type}">${d.first_name} ${d.last_name}</option>`
  ).join('');

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
      <button class="add-tank-btn" onclick="openTankModal()">+ New tank</button>
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
                <button class="btn btn-primary btn-sm" onclick="openFishModal('${tank.id}','${tank.letter}')">+ Add fish</button>
                <button class="btn btn-danger btn-xs" onclick="deleteTank('${tank.id}')">Delete tank</button>
              </div>
            </div>
            <div class="card-body">
              ${tf.length === 0
                ? '<div class="empty-state">No fish in this tank yet.</div>'
                : `<table class="table">
                    <thead><tr><th>ID</th><th>Description</th><th>Donor</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      ${tf.map(f => `
                        <tr>
                          <td><span class="fish-id">${tank.letter}${f.fish_number}</span></td>
                          <td>${f.description}</td>
                          <td>${f.donors ? f.donors.first_name + ' ' + f.donors.last_name : '—'}</td>
                          <td><span class="badge badge-${(f.type||'').toLowerCase()}">${f.type || '—'}</span></td>
                          <td>${f.sales && f.sales.length > 0
                            ? `<span class="badge badge-sold">Sold $${f.sales[0].sale_price}</span>`
                            : '<span class="badge badge-unsold">Available</span>'}</td>
                          <td>
                            <button class="btn btn-warning btn-xs" onclick='openEditFishModal(${JSON.stringify(f)}, "${tank.id}")'>Edit</button>
                            <button class="btn btn-danger btn-xs" onclick="deleteFish('${f.id}')">Delete</button>
                          </td>
                        </tr>
                      `).join('')}
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
    ${railHtml}
    ${tanksHtml}

    <div class="modal-overlay" id="tank-modal">
      <div class="modal">
        <div class="modal-title">Create new tank</div>
        <div class="form-group"><label>Tank letter</label><input id="t-letter" type="text" maxlength="3" placeholder="e.g. A, B, F" /></div>
        <div class="form-group"><label>Description (optional)</label><input id="t-desc" type="text" placeholder="e.g. Large koi" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('tank-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveTank()">Create tank</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" id="fish-modal">
      <div class="modal">
        <div class="modal-title" id="fish-modal-title">Add fish</div>
        <input type="hidden" id="fish-modal-tank-id" />
        <input type="hidden" id="f-id" />
        <div class="form-group"><label>Fish #</label><input id="f-num" type="number" min="1" /></div>
        <div class="form-group"><label>Description</label><input id="f-desc" type="text" placeholder="e.g. Kohaku, Tancho..." /></div>
        <div class="form-group"><label>Donor</label>
          <select id="f-donor" onchange="autoFillFishType()">${donorOptions}</select>
        </div>
        <div class="form-group"><label>Type</label>
          <select id="f-type">
            <option value="Pickup">Pickup (40%)</option>
            <option value="Dropoff">Dropoff (50%)</option>
            <option value="Donation">Donation (0%)</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('fish-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveFish()">Save fish</button>
        </div>
      </div>
    </div>
  `);
}

function autoFillFishType() {
  const select = document.getElementById('f-donor');
  if (!select) return;
  const selectedOption = select.options[select.selectedIndex];
  const donorType = selectedOption ? selectedOption.dataset.type : null;
  if (donorType) document.getElementById('f-type').value = donorType;
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

function openFishModal(tankId, tankLetter) {
  document.getElementById('fish-modal-title').textContent = 'Add fish to Tank ' + tankLetter;
  document.getElementById('fish-modal-tank-id').value = tankId;
  document.getElementById('f-id').value = '';
  document.getElementById('f-num').value = '';
  document.getElementById('f-desc').value = '';
  const donorSelect = document.getElementById('f-donor');
  if (donorSelect && donorSelect.options.length > 0) {
    donorSelect.selectedIndex = 0;
    autoFillFishType();
  }
  document.getElementById('fish-modal').classList.add('open');
}

function openEditFishModal(f, tankId) {
  document.getElementById('fish-modal-title').textContent = 'Edit fish';
  document.getElementById('fish-modal-tank-id').value = tankId;
  document.getElementById('f-id').value = f.id;
  document.getElementById('f-num').value = f.fish_number;
  document.getElementById('f-desc').value = f.description;
  document.getElementById('f-type').value = f.type || 'Pickup';
  const donorSelect = document.getElementById('f-donor');
  if (donorSelect && f.donor_id) {
    for (let i = 0; i < donorSelect.options.length; i++) {
      if (donorSelect.options[i].value === f.donor_id) {
        donorSelect.selectedIndex = i; break;
      }
    }
  }
  document.getElementById('fish-modal').classList.add('open');
}

async function saveTank() {
  const letter = document.getElementById('t-letter').value.trim().toUpperCase();
  const description = document.getElementById('t-desc').value.trim();
  if (!letter) { alert('Please enter a tank letter.'); return; }
  const { error } = await sb.from('tanks').insert({ letter, description, year_id: appSettings.activeYearId });
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('tank-modal');
  activeTank = letter;
  renderFish();
}

async function saveFish() {
  const id = document.getElementById('f-id').value;
  const tank_id = document.getElementById('fish-modal-tank-id').value;
  const fish_number = parseInt(document.getElementById('f-num').value);
  const description = document.getElementById('f-desc').value.trim();
  const donor_id = document.getElementById('f-donor').value;
  const type = document.getElementById('f-type').value;
  const donor_percent = type === 'Pickup' ? 0.4 : type === 'Dropoff' ? 0.5 : 0;
  if (!fish_number || !description) { alert('Please fill in fish # and description.'); return; }
  if (id) {
    const { error } = await sb.from('fish').update({ fish_number, description, donor_id, type, donor_percent }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
  } else {
    const { error } = await sb.from('fish').insert({ tank_id, fish_number, description, donor_id, type, donor_percent, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); return; }
  }
  closeModal('fish-modal');
  renderFish();
}

async function deleteFish(id) {
  if (!confirm('Delete this fish? This cannot be undone.')) return;
  await sb.from('sales').delete().eq('fish_id', id);
  const { error } = await sb.from('fish').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderFish();
}

async function deleteTank(id) {
  if (!confirm('Delete this tank and ALL fish in it? This cannot be undone.')) return;
  const { data: fishInTank } = await sb.from('fish').select('id').eq('tank_id', id);
  for (const f of (fishInTank || [])) {
    await sb.from('sales').delete().eq('fish_id', f.id);
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
  setContent(`
    <div class="page-header">
      <div class="section-label">Bidder registry</div>
      <button class="btn btn-primary btn-sm" onclick="openBidderModal()">+ Register bidder</button>
    </div>
    <div class="card">
      <div class="card-body">
        ${bidders && bidders.length > 0 ? `
        <table class="table">
          <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Member</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${bidders.map(b => `
              <tr>
                <td style="font-weight:bold;color:#1a5f7a;">${b.bidder_number}</td>
                <td>${b.first_name} ${b.last_name}</td>
                <td>${b.phone || '—'}</td>
                <td><span class="badge ${b.is_member ? 'badge-member' : ''}">${b.is_member ? 'Yes' : 'No'}</span></td>
                <td>${b.payment_method ? `<span class="badge badge-${b.payment_method === 'Cash' ? 'cash' : b.payment_method === 'Credit Card' ? 'cc' : 'check'}">${b.payment_method}</span>` : '—'}</td>
                <td>${b.is_paid
                    ? `<span class="badge badge-paid">Paid $${Number(b.total_paid || 0).toFixed(2)}</span>`
                    : '<span class="badge badge-unpaid">Unpaid</span>'}</td>
                <td>
                  <button class="btn btn-warning btn-xs" onclick='openEditBidderModal(${JSON.stringify(b)})'>Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteBidder('${b.id}')">Delete</button>
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
        <div class="form-group"><label>Bidder #</label><input id="b-num" type="number" min="1" /></div>
        <div class="form-row">
          <div class="form-group"><label>First name</label><input id="b-first" type="text" /></div>
          <div class="form-group"><label>Last name</label><input id="b-last" type="text" /></div>
        </div>
        <div class="form-group"><label>Phone</label><input id="b-phone" type="text" placeholder="xxx-xxx-xxxx" /></div>
        <div class="form-group"><label>Email</label><input id="b-email" type="email" /></div>
        <div class="form-group"><label>Club member?</label>
          <select id="b-member">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('bidder-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveBidder()">Save</button>
        </div>
      </div>
    </div>
  `);
  attachPhoneFormatter('b-phone');
}

function openBidderModal() {
  document.getElementById('bidder-modal-title').textContent = 'Register bidder';
  document.getElementById('b-id').value = '';
  document.getElementById('b-num').value = '';
  document.getElementById('b-first').value = '';
  document.getElementById('b-last').value = '';
  document.getElementById('b-phone').value = '';
  document.getElementById('b-email').value = '';
  document.getElementById('b-member').value = 'false';
  document.getElementById('bidder-modal').classList.add('open');
}

function openEditBidderModal(b) {
  document.getElementById('bidder-modal-title').textContent = 'Edit bidder';
  document.getElementById('b-id').value = b.id;
  document.getElementById('b-num').value = b.bidder_number;
  document.getElementById('b-first').value = b.first_name;
  document.getElementById('b-last').value = b.last_name;
  document.getElementById('b-phone').value = b.phone || '';
  document.getElementById('b-email').value = b.email || '';
  document.getElementById('b-member').value = b.is_member ? 'true' : 'false';
  document.getElementById('bidder-modal').classList.add('open');
}

async function saveBidder() {
  const id = document.getElementById('b-id').value;
  const bidder_number = parseInt(document.getElementById('b-num').value);
  const first_name = document.getElementById('b-first').value.trim();
  const last_name = document.getElementById('b-last').value.trim();
  const phone = document.getElementById('b-phone').value.trim();
  const email = document.getElementById('b-email').value.trim();
  const is_member = document.getElementById('b-member').value === 'true';
  if (!bidder_number || !first_name || !last_name) { alert('Please fill in bidder #, first and last name.'); return; }
  if (id) {
    const { error } = await sb.from('bidders').update({ bidder_number, first_name, last_name, phone, email, is_member }).eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
  } else {
    const { error } = await sb.from('bidders').insert({ bidder_number, first_name, last_name, phone, email, is_member, year_id: appSettings.activeYearId });
    if (error) { alert('Error: ' + error.message); return; }
  }
  closeModal('bidder-modal');
  renderBidders();
}

async function deleteBidder(id) {
  if (!confirm('Delete this bidder? This cannot be undone.')) return;
  const { error } = await sb.from('bidders').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderBidders();
}

// ============================================
// SCRIBE
// ============================================
async function renderScribe() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading scribe...</p>');
  const { data: sales } = await sb.from('sales').select('*, fish(description, fish_number, tanks(letter)), bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at', { ascending: false });
  setContent(`
    <div class="section-label">Live scribe — record auction results</div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Record a sale</div></div>
      <div class="card-body">
        <div class="form-group"><label>Fish ID (e.g. A1, B3)</label><input id="s-fish-id" type="text" placeholder="Tank letter + fish number" /></div>
        <div class="form-group"><label>Bidder #</label><input id="s-bidder" type="number" placeholder="Bidder number" /></div>
        <div class="form-group"><label>Sale price ($)</label><input id="s-price" type="number" placeholder="0.00" /></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="recordSale()">✓ Record sale</button>
        <div id="scribe-msg"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Sales log</div></div>
      <div class="card-body">
        ${sales && sales.length > 0 ? `
        <table class="table">
          <thead><tr><th>Fish</th><th>Description</th><th>Bidder</th><th style="text-align:right;">Price</th></tr></thead>
          <tbody>
            ${sales.map(s => `
              <tr>
                <td><span class="fish-id">${s.fish?.tanks?.letter || '?'}${s.fish?.fish_number || '?'}</span></td>
                <td>${s.fish?.description || '—'}</td>
                <td>#${s.bidders?.bidder_number} ${s.bidders?.last_name || ''}</td>
                <td style="text-align:right;font-weight:bold;">$${s.sale_price}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No sales recorded yet.</div>'}
      </div>
    </div>
  `);
}

async function recordSale() {
  const fishIdInput = document.getElementById('s-fish-id').value.trim().toUpperCase();
  const bidderNum = parseInt(document.getElementById('s-bidder').value);
  const salePrice = parseFloat(document.getElementById('s-price').value);
  const msg = document.getElementById('scribe-msg');
  if (!fishIdInput || !bidderNum || !salePrice) { msg.innerHTML = '<div class="alert alert-error">Please fill in all fields.</div>'; return; }
  const tankLetter = fishIdInput.charAt(0);
  const fishNum = parseInt(fishIdInput.slice(1));
  const { data: tankData } = await sb.from('tanks').select('id').eq('letter', tankLetter).eq('year_id', appSettings.activeYearId).single();
  if (!tankData) { msg.innerHTML = '<div class="alert alert-error">Tank not found.</div>'; return; }
  const { data: fishData } = await sb.from('fish').select('id').eq('tank_id', tankData.id).eq('fish_number', fishNum).single();
  if (!fishData) { msg.innerHTML = '<div class="alert alert-error">Fish not found.</div>'; return; }
  const { data: bidderData } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidderData) { msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; return; }
  const { error } = await sb.from('sales').insert({ fish_id: fishData.id, bidder_id: bidderData.id, sale_price: salePrice, year_id: appSettings.activeYearId });
  if (error) { msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }
  msg.innerHTML = '<div class="alert alert-success">Sale recorded!</div>';
  document.getElementById('s-fish-id').value = '';
  document.getElementById('s-bidder').value = '';
  document.getElementById('s-price').value = '';
  setTimeout(() => renderScribe(), 1000);
}

// ============================================
// CHECKOUT
// ============================================
async function renderCheckout() {
  setContent(`
    <div class="section-label">Checkout</div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Look up bidder</div></div>
      <div class="card-body">
        <div class="form-group"><label>Bidder #</label><input id="co-bidder-num" type="number" placeholder="Enter bidder number" /></div>
        <button class="btn btn-primary" onclick="loadCheckout()">Look up</button>
      </div>
    </div>
    <div id="checkout-result"></div>
  `);
}

async function loadCheckout() {
  const bidderNum = parseInt(document.getElementById('co-bidder-num').value);
  if (!bidderNum) { alert('Please enter a bidder number.'); return; }
  const { data: bidder } = await sb.from('bidders').select('*').eq('bidder_number', bidderNum).eq('year_id', appSettings.activeYearId).single();
  if (!bidder) { document.getElementById('checkout-result').innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; return; }
  const { data: sales } = await sb.from('sales').select('sale_price, fish(description, fish_number, tanks(letter))').eq('bidder_id', bidder.id);
  const { data: misc } = await sb.from('misc_purchases').select('*').eq('bidder_id', bidder.id);
  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const grandTotal = auctionTotal + miscTotal;
  document.getElementById('checkout-result').innerHTML = `
    <div class="card">
      <div class="card-header">
        <div class="card-header-title">${bidder.first_name} ${bidder.last_name} — Bidder #${bidder.bidder_number}</div>
        <span class="badge ${bidder.is_paid ? 'badge-paid' : 'badge-unpaid'}">${bidder.is_paid ? 'Paid' : 'Unpaid'}</span>
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
        <div class="total-row grand"><span>Total due</span><span class="amount">$${grandTotal.toFixed(2)}</span></div>
        <hr class="divider">
        <div class="form-group"><label>Payment method</label>
          <select id="co-payment">
            <option value="Cash">Cash</option>
            <option value="Credit Card">Credit Card</option>
            <option value="Check">Check</option>
          </select>
        </div>
        <div class="form-group"><label>Check # or last 4 of card</label>
          <input id="co-ref" type="text" placeholder="Optional reference" value="${bidder.payment_reference || ''}" />
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="btn btn-primary" style="flex:1;justify-content:center;" onclick="markPaid('${bidder.id}',${grandTotal})">✓ Mark as paid</button>
          <button class="btn btn-outline" style="flex:1;justify-content:center;" onclick="printReceipt('${bidder.id}')">🖨️ Print receipt</button>
        </div>
        <div id="checkout-msg"></div>
      </div>
    </div>
  `;
}

async function markPaid(bidderId, totalPaid) {
  const payment_method = document.getElementById('co-payment').value;
  const payment_reference = document.getElementById('co-ref').value.trim();
  const { error } = await sb.from('bidders').update({ is_paid: true, payment_method, payment_reference, total_paid: totalPaid }).eq('id', bidderId);
  if (error) { document.getElementById('checkout-msg').innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }
  document.getElementById('checkout-msg').innerHTML = '<div class="alert alert-success">Payment recorded!</div>';
  setTimeout(() => loadCheckout(), 1000);
}

async function printReceipt(bidderId) {
  const { data: bidder } = await sb.from('bidders').select('*').eq('id', bidderId).single();
  const { data: sales } = await sb.from('sales').select('sale_price, fish(description, fish_number, tanks(letter))').eq('bidder_id', bidderId);
  const { data: misc } = await sb.from('misc_purchases').select('*').eq('bidder_id', bidderId);
  const auctionTotal = (sales || []).reduce((s, r) => s + Number(r.sale_price), 0);
  const miscTotal = (misc || []).reduce((s, r) => s + Number(r.total_price), 0);
  const grandTotal = auctionTotal + miscTotal;
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
      <table class="receipt-table">
        <thead><tr><th>Fish</th><th>Description</th><th style="text-align:right;">Price</th></tr></thead>
        <tbody>
          ${sales.map(s => `
            <tr>
              <td>${s.fish?.tanks?.letter || ''}${s.fish?.fish_number || ''}</td>
              <td>${s.fish?.description || ''}</td>
              <td style="text-align:right;">$${s.sale_price}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : ''}
      ${misc && misc.length > 0 ? `
      <table class="receipt-table">
        <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>
          ${misc.map(m => `<tr><td>${m.item_name}</td><td>${m.quantity}</td><td style="text-align:right;">$${m.total_price}</td></tr>`).join('')}
        </tbody>
      </table>` : ''}
      <div class="receipt-total">Total: $${grandTotal.toFixed(2)}</div>
      <div style="margin-top:8px;font-size:13px;">Payment: ${bidder.payment_method || '—'} ${bidder.payment_reference ? '(' + bidder.payment_reference + ')' : ''}</div>
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
    sb.from('misc_items').select('*').order('name'),
    sb.from('misc_purchases').select('*, bidders(first_name, last_name, bidder_number)').eq('year_id', appSettings.activeYearId).order('created_at', { ascending: false }),
  ]);
  setContent(`
    <div class="section-label">Miscellaneous purchases</div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Add purchase</div></div>
      <div class="card-body">
        <div class="form-group"><label>Bidder #</label><input id="m-bidder" type="number" placeholder="Bidder number" /></div>
        <div class="form-group"><label>Item</label>
          <select id="m-item">
            ${(items || []).map(i => `<option value="${i.id}" data-price="${i.unit_price}">${i.name} — $${i.unit_price}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Quantity / Amount</label><input id="m-qty" type="number" value="1" min="1" /></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="saveMiscPurchase()">+ Add purchase</button>
        <div id="misc-msg"></div>
      </div>
    </div>
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
                  <button class="btn btn-warning btn-xs" onclick='openEditMiscModal(${JSON.stringify(p)})'>Edit</button>
                  <button class="btn btn-danger btn-xs" onclick="deleteMiscPurchase('${p.id}')">Delete</button>
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
        <div class="form-group"><label>Quantity</label><input id="me-qty" type="number" min="1" /></div>
        <div class="form-group"><label>Unit price ($)</label><input id="me-price" type="number" /></div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('misc-edit-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveEditMisc()">Save</button>
        </div>
      </div>
    </div>
  `);
}

function openEditMiscModal(p) {
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
  const total_price = quantity * unit_price;
  const { error } = await sb.from('misc_purchases').update({ item_name, quantity, unit_price, total_price }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('misc-edit-modal');
  renderMisc();
}

async function deleteMiscPurchase(id) {
  if (!confirm('Delete this purchase? This cannot be undone.')) return;
  const { error } = await sb.from('misc_purchases').delete().eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  renderMisc();
}

async function saveMiscPurchase() {
  const bidderNum = parseInt(document.getElementById('m-bidder').value);
  const select = document.getElementById('m-item');
  const selectedOption = select.options[select.selectedIndex];
  const item_name = selectedOption.text.split(' — ')[0];
  const unit_price = parseFloat(selectedOption.dataset.price);
  const quantity = parseFloat(document.getElementById('m-qty').value) || 1;
  const total_price = unit_price * quantity;
  const msg = document.getElementById('misc-msg');
  if (!bidderNum) { msg.innerHTML = '<div class="alert alert-error">Please enter a bidder number.</div>'; return; }
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
  if (pw === appSettings.adminPassword) {
    adminLoggedIn = true;
    renderAdminPanel();
  } else {
    document.getElementById('admin-login-msg').innerHTML = '<div class="alert alert-error">Incorrect password.</div>';
  }
}

async function renderAdminPanel() {
  const { data: years } = await sb.from('settings').select('*').order('year', { ascending: false });
  setContent(`
    <div class="page-header">
      <div class="section-label">Admin panel</div>
      <button class="btn btn-outline btn-sm" onclick="adminLoggedIn=false;renderAdmin()">Log out</button>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-header-title">Auction years</div></div>
      <div class="card-body">
        <p style="font-size:13px;color:#666;margin-bottom:12px;">Select which year you are currently working on.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
          ${(years || []).map(y => `
            <div class="year-pill ${y.id === appSettings.activeYearId ? 'active' : ''}" onclick="switchYear('${y.id}')">
              ${y.year} ${y.id === appSettings.activeYearId ? '★ Active' : ''}
            </div>
          `).join('')}
        </div>
        <hr class="divider">
        <p style="font-size:13px;font-weight:bold;color:#0d3d52;margin-bottom:10px;">Create new auction year</p>
        <div class="form-group"><label>Year</label><input id="new-year" type="number" value="${new Date().getFullYear() + 1}" /></div>
        <div class="danger-zone">
          <h3>⚠️ Warning</h3>
          <p style="font-size:12px;color:#666;margin-bottom:10px;">Creating a new year will set it as the active year. All existing data stays saved and accessible by switching years above.</p>
          <button class="btn btn-danger btn-sm" onclick="createNewYear()">Create new auction year</button>
        </div>
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
        <p style="font-size:13px;color:#666;margin-bottom:12px;">Export current year data as CSV files.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="exportCSV('donors')">Export donors</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('fish')">Export fish</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('bidders')">Export bidders</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('sales')">Export sales</button>
          <button class="btn btn-outline btn-sm" onclick="exportCSV('misc_purchases')">Export misc</button>
        </div>
      </div>
    </div>
  `);
}

async function switchYear(yearId) {
  const { data } = await sb.from('settings').select('*').eq('id', yearId).single();
  if (!data) return;
  appSettings.activeYearId = data.id;
  appSettings.auctionYear = data.year;
  appSettings.auctionTitle = data.title;
  appSettings.adminPassword = data.admin_password || 'admin1234';
  document.getElementById('auction-subtitle').textContent = data.title;
  renderAdminPanel();
}

async function createNewYear() {
  const year = parseInt(document.getElementById('new-year').value);
  if (!year) { alert('Please enter a valid year.'); return; }
  if (!confirm(`Create a new auction year for ${year}? This will become the active year.`)) return;
  const title = `${year} Re-Homing Auction`;
  const { data, error } = await sb.from('settings').insert({
    year, title, admin_password: appSettings.adminPassword, is_active: true
  }).select().single();
  if (error) { alert('Error: ' + error.message); return; }
  await sb.from('settings').update({ is_active: false }).neq('id', data.id);
  appSettings.activeYearId = data.id;
  appSettings.auctionYear = data.year;
  appSettings.auctionTitle = data.title;
  document.getElementById('auction-subtitle').textContent = data.title;
  alert(`${year} auction year created and set as active!`);
  renderAdminPanel();
}

async function changePassword() {
  const current = document.getElementById('pw-current').value;
  const newPw = document.getElementById('pw-new').value;
  const confirm = document.getElementById('pw-confirm').value;
  const msg = document.getElementById('pw-msg');
  if (current !== appSettings.adminPassword) { msg.innerHTML = '<div class="alert alert-error">Current password is incorrect.</div>'; return; }
  if (newPw !== confirm) { msg.innerHTML = '<div class="alert alert-error">New passwords do not match.</div>'; return; }
  if (newPw.length < 6) { msg.innerHTML = '<div class="alert alert-error">Password must be at least 6 characters.</div>'; return; }
  const { error } = await sb.from('settings').update({ admin_password: newPw }).eq('id', appSettings.activeYearId);
  if (error) { msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }
  appSettings.adminPassword = newPw;
  msg.innerHTML = '<div class="alert alert-success">Password updated!</div>';
}

async function exportCSV(table) {
  let data, filename;
  if (table === 'donors') {
    const r = await sb.from('donors').select('*').eq('year_id', appSettings.activeYearId);
    data = r.data; filename = `donors_${appSettings.auctionYear}.csv`;
  } else if (table === 'fish') {
    const r = await sb.from('fish').select('*, tanks(letter), donors(first_name,last_name)').eq('year_id', appSettings.activeYearId);
    data = r.data; filename = `fish_${appSettings.auctionYear}.csv`;
  } else if (table === 'bidders') {
    const r = await sb.from('bidders').select('*').eq('year_id', appSettings.activeYearId);
    data = r.data; filename = `bidders_${appSettings.auctionYear}.csv`;
  } else if (table === 'sales') {
    const r = await sb.from('sales').select('*, fish(description,fish_number,tanks(letter)), bidders(first_name,last_name,bidder_number)').eq('year_id', appSettings.activeYearId);
    data = r.data; filename = `sales_${appSettings.auctionYear}.csv`;
  } else if (table === 'misc_purchases') {
    const r = await sb.from('misc_purchases').select('*, bidders(first_name,last_name,bidder_number)').eq('year_id', appSettings.activeYearId);
    data = r.data; filename = `misc_${appSettings.auctionYear}.csv`;
  }
  if (!data || data.length === 0) { alert('No data to export.'); return; }
  const keys = Object.keys(data[0]);
  const csv = [keys.join(','), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ============================================
// UTILITIES
// ============================================
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ============================================
// INIT
// ============================================
async function init() {
  await loadSettings();
  renderDashboard();
}

init();