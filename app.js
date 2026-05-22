// ============================================
// SUPABASE CONNECTION
// ============================================
const SUPABASE_URL = 'https://ilrnqxgojgrpkkinaapm.supabase.co';
const SUPABASE_KEY = 'sb_publishable__rKIdmzzCEZnRFhOUn6nAQ_yOt6bOwk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// NAVIGATION
// ============================================
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    loadPage(page);
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
  }
}

function setContent(html) {
  document.getElementById('main-content').innerHTML = html;
}

// ============================================
// DASHBOARD
// ============================================
async function renderDashboard() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading dashboard...</p>');

  const [{ count: fishCount }, { count: bidderCount }, { data: sales }, { data: misc }] = await Promise.all([
    sb.from('fish').select('*', { count: 'exact', head: true }),
    sb.from('bidders').select('*', { count: 'exact', head: true }),
    sb.from('sales').select('sale_price'),
    sb.from('misc_purchases').select('total_price'),
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
      <div class="card-header">
        <div class="card-header-title">Grand total</div>
      </div>
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
  const { data: donors } = await sb.from('donors').select('*').order('last_name');

  setContent(`
    <div class="page-header">
      <div class="section-label">Koi donors</div>
      <button class="btn btn-primary btn-sm" onclick="openDonorModal()">+ Add donor</button>
    </div>
    <div class="card">
      <div class="card-body">
        ${donors && donors.length > 0 ? `
        <table class="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Type</th><th>Fish</th></tr></thead>
          <tbody>
            ${donors.map(d => `
              <tr>
                <td>${d.first_name} ${d.last_name}</td>
                <td>${d.phone || '—'}</td>
                <td>${d.email || '—'}</td>
                <td><span class="badge badge-${d.type.toLowerCase()}">${d.type}</span></td>
                <td>${d.num_fish}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No donors yet. Add your first donor!</div>'}
      </div>
    </div>

    <div class="modal-overlay" id="donor-modal">
      <div class="modal">
        <div class="modal-title">Add donor</div>
        <div class="form-row">
          <div class="form-group"><label>First name</label><input id="d-first" type="text" /></div>
          <div class="form-group"><label>Last name</label><input id="d-last" type="text" /></div>
        </div>
        <div class="form-group"><label>Phone</label><input id="d-phone" type="text" /></div>
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
}

function openDonorModal() {
  document.getElementById('donor-modal').classList.add('open');
}

async function saveDonor() {
  const first_name = document.getElementById('d-first').value.trim();
  const last_name = document.getElementById('d-last').value.trim();
  const phone = document.getElementById('d-phone').value.trim();
  const email = document.getElementById('d-email').value.trim();
  const type = document.getElementById('d-type').value;
  const num_fish = parseInt(document.getElementById('d-fish').value) || 0;

  if (!first_name || !last_name) { alert('Please enter first and last name.'); return; }

  const { error } = await sb.from('donors').insert({ first_name, last_name, phone, email, type, num_fish });
  if (error) { alert('Error saving donor: ' + error.message); return; }
  closeModal('donor-modal');
  renderDonors();
}

// ============================================
// FISH & TANKS
// ============================================
let activeTank = 'all';

async function renderFish() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading fish...</p>');
  const { data: tanks } = await sb.from('tanks').select('*').order('letter');
  const { data: fish } = await sb.from('fish').select('*, tanks(letter), donors(first_name, last_name), sales(sale_price)').order('fish_number');

  const tankFish = (tankLetter) => fish ? fish.filter(f => f.tanks?.letter === tankLetter) : [];
  const allTanks = tanks || [];

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
              <div class="card-header-title">Tank ${tank.letter}${tank.description ? ' — ' + tank.description : ''} <span style="font-size:12px;color:#4db8d4;font-weight:normal;">${tf.length} fish</span></div>
              <button class="btn btn-primary btn-sm" onclick="openFishModal('${tank.id}','${tank.letter}')">+ Add fish</button>
            </div>
            <div class="card-body">
              ${tf.length === 0
                ? '<div class="empty-state">No fish in this tank yet.</div>'
                : `<table class="table">
                    <thead><tr><th>ID</th><th>Description</th><th>Donor</th><th>Type</th><th>Status</th></tr></thead>
                    <tbody>
                      ${tf.map(f => `
                        <tr>
                          <td><span class="fish-id">${tank.letter}${f.fish_number}</span></td>
                          <td>${f.description}</td>
                          <td>${f.donors ? f.donors.last_name : '—'}</td>
                          <td><span class="badge badge-${(f.type||'').toLowerCase()}">${f.type || '—'}</span></td>
                          <td>${f.sales && f.sales.length > 0
                            ? `<span class="badge badge-sold">Sold $${f.sales[0].sale_price}</span>`
                            : '<span class="badge badge-unsold">Available</span>'}</td>
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
        <div class="modal-title">Add fish to Tank <span id="fish-modal-tank-label"></span></div>
        <input type="hidden" id="fish-modal-tank-id" />
        <div class="form-group"><label>Fish #</label><input id="f-num" type="number" min="1" /></div>
        <div class="form-group"><label>Description</label><input id="f-desc" type="text" placeholder="e.g. Kohaku, Tancho..." /></div>
        <div class="form-group"><label>Donor</label>
          <select id="f-donor"></select>
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
          <button class="btn btn-primary btn-sm" onclick="saveFish()">Add fish</button>
        </div>
      </div>
    </div>
  `);
}

function setActiveTank(letter) {
  activeTank = letter;
  renderFish();
}

function openTankModal() {
  document.getElementById('tank-modal').classList.add('open');
}

async function openFishModal(tankId, tankLetter) {
  document.getElementById('fish-modal-tank-id').value = tankId;
  document.getElementById('fish-modal-tank-label').textContent = tankLetter;
  const { data: donors } = await sb.from('donors').select('id, first_name, last_name').order('last_name');
  const select = document.getElementById('f-donor');
  select.innerHTML = (donors || []).map(d => `<option value="${d.id}">${d.first_name} ${d.last_name}</option>`).join('');
  document.getElementById('fish-modal').classList.add('open');
}

async function saveTank() {
  const letter = document.getElementById('t-letter').value.trim().toUpperCase();
  const description = document.getElementById('t-desc').value.trim();
  if (!letter) { alert('Please enter a tank letter.'); return; }
  const { error } = await sb.from('tanks').insert({ letter, description });
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('tank-modal');
  activeTank = letter;
  renderFish();
}

async function saveFish() {
  const tank_id = document.getElementById('fish-modal-tank-id').value;
  const fish_number = parseInt(document.getElementById('f-num').value);
  const description = document.getElementById('f-desc').value.trim();
  const donor_id = document.getElementById('f-donor').value;
  const type = document.getElementById('f-type').value;
  const donor_percent = type === 'Pickup' ? 0.4 : type === 'Dropoff' ? 0.5 : 0;
  if (!fish_number || !description) { alert('Please fill in fish # and description.'); return; }
  const { error } = await sb.from('fish').insert({ tank_id, fish_number, description, donor_id, type, donor_percent });
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('fish-modal');
  renderFish();
}

// ============================================
// BIDDERS
// ============================================
async function renderBidders() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading bidders...</p>');
  const { data: bidders } = await sb.from('bidders').select('*').order('bidder_number');

  setContent(`
    <div class="page-header">
      <div class="section-label">Bidder registry</div>
      <button class="btn btn-primary btn-sm" onclick="openBidderModal()">+ Register bidder</button>
    </div>
    <div class="card">
      <div class="card-body">
        ${bidders && bidders.length > 0 ? `
        <table class="table">
          <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>Member</th><th>Payment</th><th>Status</th></tr></thead>
          <tbody>
            ${bidders.map(b => `
              <tr>
                <td style="font-weight:bold;color:#1a5f7a;">${b.bidder_number}</td>
                <td>${b.first_name} ${b.last_name}</td>
                <td>${b.phone || '—'}</td>
                <td><span class="badge ${b.is_member ? 'badge-member' : ''}">${b.is_member ? 'Yes' : 'No'}</span></td>
                <td>${b.payment_method ? `<span class="badge badge-${b.payment_method === 'Cash' ? 'cash' : b.payment_method === 'Credit Card' ? 'cc' : 'check'}">${b.payment_method}</span>` : '—'}</td>
                <td><span class="badge ${b.is_paid ? 'badge-paid' : 'badge-unpaid'}">${b.is_paid ? 'Paid' : 'Unpaid'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No bidders registered yet.</div>'}
      </div>
    </div>

    <div class="modal-overlay" id="bidder-modal">
      <div class="modal">
        <div class="modal-title">Register bidder</div>
        <div class="form-group"><label>Bidder #</label><input id="b-num" type="number" min="1" /></div>
        <div class="form-row">
          <div class="form-group"><label>First name</label><input id="b-first" type="text" /></div>
          <div class="form-group"><label>Last name</label><input id="b-last" type="text" /></div>
        </div>
        <div class="form-group"><label>Phone</label><input id="b-phone" type="text" /></div>
        <div class="form-group"><label>Email</label><input id="b-email" type="email" /></div>
        <div class="form-group"><label>Club member?</label>
          <select id="b-member">
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline btn-sm" onclick="closeModal('bidder-modal')">Cancel</button>
          <button class="btn btn-primary btn-sm" onclick="saveBidder()">Register</button>
        </div>
      </div>
    </div>
  `);
}

function openBidderModal() {
  document.getElementById('bidder-modal').classList.add('open');
}

async function saveBidder() {
  const bidder_number = parseInt(document.getElementById('b-num').value);
  const first_name = document.getElementById('b-first').value.trim();
  const last_name = document.getElementById('b-last').value.trim();
  const phone = document.getElementById('b-phone').value.trim();
  const email = document.getElementById('b-email').value.trim();
  const is_member = document.getElementById('b-member').value === 'true';
  if (!bidder_number || !first_name || !last_name) { alert('Please fill in bidder #, first and last name.'); return; }
  const { error } = await sb.from('bidders').insert({ bidder_number, first_name, last_name, phone, email, is_member });
  if (error) { alert('Error: ' + error.message); return; }
  closeModal('bidder-modal');
  renderBidders();
}

// ============================================
// SCRIBE
// ============================================
async function renderScribe() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading scribe...</p>');
  const { data: sales } = await sb.from('sales').select('*, fish(description, fish_number, tanks(letter)), bidders(first_name, last_name, bidder_number)').order('created_at', { ascending: false });

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

  if (!fishIdInput || !bidderNum || !salePrice) {
    msg.innerHTML = '<div class="alert alert-error">Please fill in all fields.</div>'; return;
  }

  const tankLetter = fishIdInput.charAt(0);
  const fishNum = parseInt(fishIdInput.slice(1));

  const { data: tankData } = await sb.from('tanks').select('id').eq('letter', tankLetter).single();
  if (!tankData) { msg.innerHTML = '<div class="alert alert-error">Tank not found.</div>'; return; }

  const { data: fishData } = await sb.from('fish').select('id').eq('tank_id', tankData.id).eq('fish_number', fishNum).single();
  if (!fishData) { msg.innerHTML = '<div class="alert alert-error">Fish not found.</div>'; return; }

  const { data: bidderData } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).single();
  if (!bidderData) { msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; return; }

  const { error } = await sb.from('sales').insert({ fish_id: fishData.id, bidder_id: bidderData.id, sale_price: salePrice });
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

  const { data: bidder } = await sb.from('bidders').select('*').eq('bidder_number', bidderNum).single();
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
        </table>` : '<p style="color:#888;font-size:13px;">No auction fish.</p>'}

        ${misc && misc.length > 0 ? `
        <hr class="divider">
        <table class="table">
          <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>
            ${misc.map(m => `
              <tr>
                <td>${m.item_name}</td>
                <td>${m.quantity}</td>
                <td style="text-align:right;">$${m.total_price}</td>
              </tr>
            `).join('')}
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
        <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="markPaid('${bidder.id}')">✓ Mark as paid</button>
        <div id="checkout-msg"></div>
      </div>
    </div>
  `;
}

async function markPaid(bidderId) {
  const payment_method = document.getElementById('co-payment').value;
  const payment_reference = document.getElementById('co-ref').value.trim();
  const { error } = await sb.from('bidders').update({ is_paid: true, payment_method, payment_reference }).eq('id', bidderId);
  if (error) { document.getElementById('checkout-msg').innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }
  document.getElementById('checkout-msg').innerHTML = '<div class="alert alert-success">Payment recorded!</div>';
  setTimeout(() => loadCheckout(), 1000);
}

// ============================================
// MISC PURCHASES
// ============================================
async function renderMisc() {
  setContent('<p style="color:#4db8d4;padding:1rem;">Loading...</p>');
  const [{ data: items }, { data: purchases }] = await Promise.all([
    sb.from('misc_items').select('*').order('name'),
    sb.from('misc_purchases').select('*, bidders(first_name, last_name, bidder_number)').order('created_at', { ascending: false }),
  ]);

  setContent(`
    <div class="section-label">Miscellaneous purchases</div>
    <div class="card">
      <div class="card-header"><div class="card-header-title">Add purchase</div></div>
      <div class="card-body">
        <div class="form-group"><label>Bidder #</label><input id="m-bidder" type="number" placeholder="Bidder number" /></div>
        <div class="form-group"><label>Item</label>
          <select id="m-item" onchange="updateMiscPrice()">
            ${(items || []).map(i => `<option value="${i.id}" data-price="${i.unit_price}" data-qty="${i.is_quantity_based}">${i.name} — $${i.unit_price}</option>`).join('')}
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
          <thead><tr><th>Bidder</th><th>Item</th><th>Qty</th><th style="text-align:right;">Total</th></tr></thead>
          <tbody>
            ${purchases.map(p => `
              <tr>
                <td>#${p.bidders?.bidder_number} ${p.bidders?.last_name || ''}</td>
                <td>${p.item_name}</td>
                <td>${p.quantity}</td>
                <td style="text-align:right;font-weight:bold;">$${p.total_price}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty-state">No misc purchases yet.</div>'}
      </div>
    </div>
  `);
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

  const { data: bidder } = await sb.from('bidders').select('id').eq('bidder_number', bidderNum).single();
  if (!bidder) { msg.innerHTML = '<div class="alert alert-error">Bidder not found.</div>'; return; }

  const { error } = await sb.from('misc_purchases').insert({ bidder_id: bidder.id, item_name, quantity, unit_price, total_price });
  if (error) { msg.innerHTML = '<div class="alert alert-error">Error: ' + error.message + '</div>'; return; }

  msg.innerHTML = '<div class="alert alert-success">Purchase added!</div>';
  setTimeout(() => renderMisc(), 1000);
}

// ============================================
// UTILITIES
// ============================================
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Load dashboard on start
renderDashboard();