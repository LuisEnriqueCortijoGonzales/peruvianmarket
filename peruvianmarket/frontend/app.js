// ============ CRYPTO ============
// Libs cargadas vía /crypto.bundle.js (window.PMCrypto)
const { secp, sha256: nobleSha256, ripemd160: nobleRipemd160 } = window.PMCrypto;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function bytesToHex(b) {
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(h) {
  if (h.length % 2) throw new Error('odd hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i*2, 2), 16);
  return out;
}

function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    const r = Number(n % 58n);
    n = n / 58n;
    out = BASE58_ALPHABET[r] + out;
  }
  let pad = 0;
  for (const b of bytes) { if (b === 0) pad++; else break; }
  return '1'.repeat(pad) + out;
}

function sha256(b) { return nobleSha256(b); }
function ripemd160(b) { return nobleRipemd160(b); }
function hash160(b) { return ripemd160(sha256(b)); }

function pubkeyToAddress(pubkeyBytes64) {
  const h = hash160(pubkeyBytes64);
  const versionedPayload = new Uint8Array(21);
  versionedPayload[0] = 0x35;  // version "P"
  versionedPayload.set(h, 1);
  const checksum = sha256(sha256(versionedPayload)).slice(0, 4);
  const full = new Uint8Array(25);
  full.set(versionedPayload, 0);
  full.set(checksum, 21);
  return base58Encode(full);
}

// Generate random private key (32 bytes)
function generatePrivKey() {
  return secp.utils.randomPrivateKey();
}

// Get uncompressed public key (64 bytes, x||y) - matches python-ecdsa default
function getPubkey64(privKeyBytes) {
  // noble returns 65 bytes uncompressed (0x04 || x || y)
  const uncompressed = secp.getPublicKey(privKeyBytes, false);
  return uncompressed.slice(1); // strip 0x04 prefix
}

// Sign message: SHA256 the message, sign with deterministic ECDSA, return r||s (64 bytes hex)
function signMessage(privKeyBytes, msgBytes) {
  const msgHash = sha256(msgBytes);
  const sig = secp.sign(msgHash, privKeyBytes); // returns Signature object
  // toCompactRawBytes returns r||s as 64 bytes
  return bytesToHex(sig.toCompactRawBytes());
}

// Canonical JSON: sorted keys, no whitespace - MUST match Python's json.dumps(sort_keys=True, separators=(',', ':'))
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

// ============ WALLET STORAGE ============
const WALLET_KEY = 'pm_wallet_v1';

function loadWallet() {
  const raw = localStorage.getItem(WALLET_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function saveWallet(w) {
  localStorage.setItem(WALLET_KEY, JSON.stringify(w));
}

function clearWallet() {
  localStorage.removeItem(WALLET_KEY);
}

function newWallet() {
  const priv = generatePrivKey();
  const pub = getPubkey64(priv);
  const addr = pubkeyToAddress(pub);
  return {
    privateKey: bytesToHex(priv),
    publicKey: bytesToHex(pub),
    address: addr,
  };
}

function importWallet(privHex) {
  const priv = hexToBytes(privHex);
  const pub = getPubkey64(priv);
  const addr = pubkeyToAddress(pub);
  return {
    privateKey: privHex,
    publicKey: bytesToHex(pub),
    address: addr,
  };
}

// ============ API ============
const API = '/api';

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

// Build, sign, and submit a transaction
async function sendTx(wallet, type, data) {
  const { unsigned_tx } = await api('/tx/build', {
    method: 'POST',
    body: {
      type,
      sender_pubkey: wallet.publicKey,
      sender_address: wallet.address,
      data,
    },
  });

  // Sign canonical JSON of unsigned_tx
  const msgStr = canonicalJSON(unsigned_tx);
  const msgBytes = new TextEncoder().encode(msgStr);
  const signature = signMessage(hexToBytes(wallet.privateKey), msgBytes);

  const signedTx = { ...unsigned_tx, signature };
  return await api('/tx/submit', { method: 'POST', body: signedTx });
}

// ============ STATE ============
let currentView = 'markets';
let currentWallet = loadWallet();
let cachedInfo = null;
let cachedMarkets = [];
let cachedWalletInfo = null;
let oraclePubkey = null;

// ============ TOAST ============
function toast(msg, type = '') {
  const wrap = document.getElementById('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, 3500);
  setTimeout(() => t.remove(), 4000);
}

// ============ MODAL ============
function openModal(html) {
  const m = document.getElementById('modal');
  document.getElementById('modalCard').innerHTML = html;
  m.classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') closeModal();
});

// ============ TOPBAR ============
function shortAddr(a) {
  if (!a) return '';
  return a.slice(0, 6) + '…' + a.slice(-4);
}
function updateTopbar() {
  const pill = document.getElementById('walletPill');
  const addrEl = document.getElementById('walletAddrShort');
  const balEl = document.getElementById('walletBalance');
  if (!currentWallet) {
    addrEl.textContent = 'Sin wallet';
    balEl.textContent = '— PEN';
    pill.style.cursor = 'pointer';
    pill.onclick = () => switchView('wallet');
    return;
  }
  addrEl.textContent = shortAddr(currentWallet.address);
  if (cachedWalletInfo) {
    balEl.textContent = cachedWalletInfo.balance.toFixed(2) + ' PEN';
  }
  pill.onclick = () => switchView('wallet');
}

// ============ NAV ============
function switchView(v) {
  currentView = v;
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.view === v);
  });
  render();
}
document.querySelectorAll('.nav-btn').forEach(b => {
  b.addEventListener('click', () => switchView(b.dataset.view));
});

// ============ RENDER ============
async function render() {
  const main = document.getElementById('mainView');
  const tpl = document.getElementById('tpl-' + currentView);
  if (!tpl) return;
  main.innerHTML = '';
  main.appendChild(tpl.content.cloneNode(true));

  if (currentView === 'markets') await renderMarkets();
  else if (currentView === 'wallet') await renderWallet();
  else if (currentView === 'create') renderCreate();
  else if (currentView === 'oracle') await renderOracle();
  else if (currentView === 'chain') await renderChain();
}

// ---------- MARKETS ----------
async function renderMarkets() {
  cachedInfo = await api('/info').catch(() => null);
  const heroStats = document.getElementById('heroStats');
  if (cachedInfo && heroStats) {
    heroStats.innerHTML = `
      <div><div class="stat-num">${cachedInfo.markets_count}</div><div class="stat-lbl">Mercados</div></div>
      <div><div class="stat-num">${cachedInfo.chain_height}</div><div class="stat-lbl">Bloques</div></div>
      <div><div class="stat-num">${cachedInfo.total_supply.toFixed(0)}</div><div class="stat-lbl">PEN circulante</div></div>
      <div><div class="stat-num">${cachedInfo.block_reward}</div><div class="stat-lbl">Reward / bloque</div></div>
    `;
  }

  const grid = document.getElementById('marketsGrid');
  try {
    const { markets } = await api('/markets');
    cachedMarkets = markets;
    if (markets.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; padding: 40px; text-align:center;" class="muted">No hay mercados todavía. <a href="#" onclick="event.preventDefault(); document.querySelector('[data-view=create]').click()">Crea el primero</a>.</div>`;
      return;
    }
    grid.innerHTML = markets.map(m => marketCard(m)).join('');
    grid.querySelectorAll('.market-card').forEach(c => {
      c.addEventListener('click', () => openMarket(c.dataset.id));
    });
  } catch (e) { toast(e.message, 'error'); }
}

function marketCard(m) {
  const yesPct = (m.yes_price * 100).toFixed(1);
  const noPct = (m.no_price * 100).toFixed(1);
  const status = m.status === 'OPEN' ? 'open' : 'resolved';
  const label = m.status === 'OPEN' ? 'ABIERTO' : 'RESUELTO';
  const liq = (m.yes_reserve + m.no_reserve).toFixed(0);
  return `
    <div class="market-card ${m.status === 'RESOLVED' ? 'resolved' : ''}" data-id="${m.id}">
      <span class="market-status ${status}">${label}</span>
      <h3 class="market-question">${escapeHtml(m.question)}</h3>
      <div class="market-prob-bar">
        <div class="market-prob-yes" style="width:${yesPct}%">${yesPct}% YES</div>
        <div class="market-prob-no"  style="width:${noPct}%">${noPct}% NO</div>
      </div>
      <div class="market-meta">
        <span>ID ${m.id.slice(0,8)}</span>
        <span>Liq ${liq} PEN</span>
      </div>
      ${m.status === 'RESOLVED' ? `<div class="market-resolution">Resultado: ${m.resolution}</div>` : ''}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function openMarket(id) {
  const m = await api('/markets/' + id);
  const yesPct = (m.yes_price * 100).toFixed(2);
  const noPct = (m.no_price * 100).toFixed(2);
  const status = m.status === 'OPEN' ? 'open' : 'resolved';

  let userPos = { YES: 0, NO: 0 };
  if (currentWallet && cachedWalletInfo) {
    const p = cachedWalletInfo.positions.find(x => x.market_id === id);
    if (p) userPos = { YES: p.yes_shares, NO: p.no_shares };
  }

  openModal(`
    <button class="close" onclick="document.getElementById('modal').classList.add('hidden')">×</button>
    <h2>${escapeHtml(m.question)}</h2>
    <p class="muted">${escapeHtml(m.description || '')}</p>

    <div class="market-prob-bar" style="margin-top: 16px;">
      <div class="market-prob-yes" style="width:${yesPct}%">${yesPct}%</div>
      <div class="market-prob-no" style="width:${noPct}%">${noPct}%</div>
    </div>

    <div class="kv"><label>Estado</label><code>${m.status}${m.resolution ? ' — '+m.resolution : ''}</code></div>
    <div class="kv"><label>Reservas</label><code>YES: ${m.yes_reserve.toFixed(2)} | NO: ${m.no_reserve.toFixed(2)}</code></div>
    <div class="kv"><label>Tu posición</label><code>YES: ${userPos.YES.toFixed(4)} | NO: ${userPos.NO.toFixed(4)}</code></div>

    ${m.status === 'OPEN' && currentWallet ? renderTradePanel(m, userPos) : ''}
    ${m.status === 'RESOLVED' && currentWallet && userPos[m.resolution] > 0 ? `
      <button class="btn primary big" onclick="window._claim('${id}')" style="width:100%; margin-top:16px;">
        Reclamar ${userPos[m.resolution].toFixed(4)} PEN ganados
      </button>
    ` : ''}
    ${!currentWallet ? `<p class="muted" style="margin-top:16px;">Crea o importa una wallet para operar.</p>` : ''}
  `);

  if (m.status === 'OPEN' && currentWallet) attachTradeHandlers(m);
}

function renderTradePanel(m, userPos) {
  return `
    <div class="trade-tabs">
      <button class="trade-tab yes active" data-tab="buy-yes">Comprar YES</button>
      <button class="trade-tab no" data-tab="buy-no">Comprar NO</button>
      <button class="trade-tab" data-tab="sell-yes" ${userPos.YES <= 0 ? 'disabled style="opacity:0.4"' : ''}>Vender YES</button>
      <button class="trade-tab" data-tab="sell-no" ${userPos.NO <= 0 ? 'disabled style="opacity:0.4"' : ''}>Vender NO</button>
    </div>
    <div class="form">
      <label id="amountLbl">Monto en PEN
        <input type="number" id="tradeAmount" step="0.01" min="0" value="10">
      </label>
      <div class="trade-summary" id="tradeSummary">Calculando…</div>
      <button class="btn primary big" id="btnTrade">Firmar transacción</button>
    </div>
  `;
}

let currentTrade = { side: 'YES', action: 'BUY' };

function attachTradeHandlers(m) {
  const tabs = document.querySelectorAll('.trade-tab');
  tabs.forEach(t => {
    t.addEventListener('click', () => {
      if (t.disabled) return;
      tabs.forEach(x => x.classList.remove('active', 'yes', 'no'));
      t.classList.add('active');
      const [action, side] = t.dataset.tab.split('-');
      currentTrade = { action: action.toUpperCase(), side: side.toUpperCase() };
      if (currentTrade.side === 'YES') t.classList.add('yes');
      else t.classList.add('no');
      document.getElementById('amountLbl').firstChild.textContent =
        action === 'buy' ? 'Monto en PEN' : `Cantidad de shares ${side.toUpperCase()}`;
      updateQuote(m);
    });
  });
  document.getElementById('tradeAmount').addEventListener('input', () => updateQuote(m));
  document.getElementById('btnTrade').addEventListener('click', () => executeTrade(m));
  updateQuote(m);
}

async function updateQuote(m) {
  const amount = parseFloat(document.getElementById('tradeAmount').value);
  const summary = document.getElementById('tradeSummary');
  if (!amount || amount <= 0) { summary.innerHTML = '<div class="muted">Ingresa un monto</div>'; return; }
  try {
    const q = await api(`/markets/${m.id}/quote`, {
      method: 'POST',
      body: { action: currentTrade.action, side: currentTrade.side, amount },
    });
    if (currentTrade.action === 'BUY') {
      summary.innerHTML = `
        <div class="row"><span>Pagas</span><strong>${amount.toFixed(2)} PEN</strong></div>
        <div class="row"><span>Recibes (${currentTrade.side})</span><strong class="big-num">${q.shares_out.toFixed(4)}</strong></div>
        <div class="row"><span>Precio promedio</span><strong>${q.avg_price.toFixed(4)} PEN/share</strong></div>
        <div class="row"><span>Comisión (2%)</span><strong>${q.fee.toFixed(4)} PEN</strong></div>
        <div class="row muted"><span>Si gana, valdrá</span><strong>${q.shares_out.toFixed(2)} PEN</strong></div>
      `;
    } else {
      summary.innerHTML = `
        <div class="row"><span>Vendes</span><strong>${amount.toFixed(4)} shares ${currentTrade.side}</strong></div>
        <div class="row"><span>Recibes</span><strong class="big-num">${q.pen_out.toFixed(4)} PEN</strong></div>
        <div class="row"><span>Precio promedio</span><strong>${q.avg_price.toFixed(4)} PEN/share</strong></div>
        <div class="row"><span>Comisión (2%)</span><strong>${q.fee.toFixed(4)} PEN</strong></div>
      `;
    }
    summary._quote = q;
  } catch (e) { summary.innerHTML = `<div style="color:var(--no)">${escapeHtml(e.message)}</div>`; }
}

async function executeTrade(m) {
  const amount = parseFloat(document.getElementById('tradeAmount').value);
  const q = document.getElementById('tradeSummary')._quote;
  if (!amount || !q) return toast('Cotización inválida', 'error');
  const btn = document.getElementById('btnTrade');
  btn.disabled = true; btn.textContent = 'Firmando...';
  try {
    if (currentTrade.action === 'BUY') {
      await sendTx(currentWallet, 'BUY', {
        market_id: m.id,
        side: currentTrade.side,
        pen_in: amount,
        min_shares: q.shares_out * 0.95,
      });
    } else {
      await sendTx(currentWallet, 'SELL', {
        market_id: m.id,
        side: currentTrade.side,
        shares_in: amount,
        min_pen: q.pen_out * 0.95,
      });
    }
    toast('Transacción enviada — minando…', 'success');
    closeModal();
    setTimeout(() => { refreshWallet(); render(); }, 2500);
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.textContent = 'Firmar transacción';
  }
}

window._claim = async (mid) => {
  try {
    await sendTx(currentWallet, 'CLAIM', { market_id: mid });
    toast('Claim enviado', 'success');
    closeModal();
    setTimeout(() => { refreshWallet(); render(); }, 2500);
  } catch (e) { toast(e.message, 'error'); }
};

// ---------- WALLET ----------
async function refreshWallet() {
  if (!currentWallet) { cachedWalletInfo = null; updateTopbar(); return; }
  try {
    cachedWalletInfo = await api('/wallet/' + currentWallet.address);
    updateTopbar();
  } catch (e) {/* ignore */}
}

async function renderWallet() {
  const empty = document.getElementById('walletEmpty');
  const loaded = document.getElementById('walletLoaded');
  if (!currentWallet) {
    empty.classList.remove('hidden');
    loaded.classList.add('hidden');
    document.getElementById('btnNewWallet').addEventListener('click', () => {
      const w = newWallet();
      currentWallet = w;
      saveWallet(w);
      toast('Wallet generada — guarda tu llave privada', 'success');
      render();
    });
    document.getElementById('btnImportWallet').addEventListener('click', () => {
      const hex = prompt('Pega tu llave privada (hex, 64 caracteres):');
      if (!hex) return;
      try {
        const w = importWallet(hex.trim());
        currentWallet = w;
        saveWallet(w);
        toast('Wallet importada', 'success');
        render();
      } catch (e) { toast('Llave inválida: ' + e.message, 'error'); }
    });
    return;
  }
  empty.classList.add('hidden');
  loaded.classList.remove('hidden');
  document.getElementById('walletAddrFull').textContent = currentWallet.address;
  document.getElementById('walletPubFull').textContent = currentWallet.publicKey;
  document.getElementById('walletPrivFull').textContent = currentWallet.privateKey;

  await refreshWallet();
  document.getElementById('walletBalFull').textContent =
    (cachedWalletInfo?.balance ?? 0).toFixed(4) + ' PEN';
  document.getElementById('walletFaucetStatus').textContent =
    cachedWalletInfo?.faucet_claimed ? 'YA RECLAMADO' : 'DISPONIBLE';
  document.getElementById('btnClaimFaucet').disabled = !!cachedWalletInfo?.faucet_claimed;

  // copy buttons
  document.querySelectorAll('[data-copy]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.dataset.copy;
      navigator.clipboard.writeText(document.getElementById(id).textContent);
      toast('Copiado', 'success');
    });
  });
  document.getElementById('btnRevealPriv').addEventListener('click', (e) => {
    const el = document.getElementById('walletPrivFull');
    el.classList.toggle('shown');
    e.target.textContent = el.classList.contains('shown') ? 'ocultar' : 'mostrar';
  });
  document.getElementById('btnLogout').addEventListener('click', () => {
    if (!confirm('¿Cerrar sesión? Si no guardaste tu llave privada perderás acceso a tus fondos.')) return;
    clearWallet();
    currentWallet = null;
    cachedWalletInfo = null;
    render();
  });
  document.getElementById('btnClaimFaucet').addEventListener('click', async () => {
    try {
      await sendTx(currentWallet, 'FAUCET', {});
      toast('Faucet reclamado — minando…', 'success');
      setTimeout(() => render(), 2500);
    } catch (e) { toast(e.message, 'error'); }
  });
  document.getElementById('btnTransfer').addEventListener('click', () => {
    openModal(`
      <button class="close" onclick="document.getElementById('modal').classList.add('hidden')">×</button>
      <h2>Transferir PEN</h2>
      <div class="form">
        <label>Destinatario (address)<input type="text" id="txTo"></label>
        <label>Monto (PEN)<input type="number" id="txAmt" step="0.01"></label>
        <button class="btn primary" id="txSend">Firmar &amp; enviar</button>
      </div>
    `);
    document.getElementById('txSend').addEventListener('click', async () => {
      try {
        const to = document.getElementById('txTo').value.trim();
        const amt = parseFloat(document.getElementById('txAmt').value);
        await sendTx(currentWallet, 'TRANSFER', { to, amount: amt });
        toast('Transferencia enviada', 'success');
        closeModal();
        setTimeout(() => render(), 2500);
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  // positions
  const list = document.getElementById('positionsList');
  if (!cachedWalletInfo?.positions?.length) {
    list.innerHTML = '<div class="muted">No tienes posiciones abiertas.</div>';
  } else {
    list.innerHTML = cachedWalletInfo.positions.map(p => `
      <div class="position-item">
        <div>
          <div class="q">${escapeHtml(p.question)}</div>
          <div class="meta">${p.status} ${p.resolution ? '• ganador: ' + p.resolution : ''} • precio YES ${(p.current_yes_price*100).toFixed(1)}%</div>
        </div>
        <div class="position-shares">
          <div class="yes">${p.yes_shares.toFixed(4)} YES</div>
          <div class="no">${p.no_shares.toFixed(4)} NO</div>
        </div>
      </div>
    `).join('');
  }
}

// ---------- CREATE MARKET ----------
function renderCreate() {
  document.getElementById('btnCreateMarket').addEventListener('click', async () => {
    if (!currentWallet) return toast('Necesitas wallet', 'error');
    const data = {
      question: document.getElementById('mkQuestion').value.trim(),
      description: document.getElementById('mkDesc').value.trim(),
      initial_yes_prob: parseFloat(document.getElementById('mkProb').value),
      liquidity: parseFloat(document.getElementById('mkLiq').value),
      close_timestamp: parseInt(document.getElementById('mkClose').value || '0'),
    };
    if (!data.question) return toast('Pregunta requerida', 'error');
    try {
      await sendTx(currentWallet, 'CREATE_MARKET', data);
      toast('Mercado creado — minando…', 'success');
      setTimeout(() => switchView('markets'), 2500);
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------- ORACLE ----------
async function renderOracle() {
  if (!oraclePubkey) {
    const info = await api('/info');
    oraclePubkey = info.oracle_public_key;
  }
  document.getElementById('oraclePub').textContent = oraclePubkey;

  const { markets } = await api('/markets');
  const open = markets.filter(m => m.status === 'OPEN');
  const list = document.getElementById('resolveList');
  if (!open.length) { list.innerHTML = '<div class="muted">No hay mercados abiertos.</div>'; return; }
  list.innerHTML = open.map(m => `
    <div class="resolve-item">
      <div>${escapeHtml(m.question)}<br><small class="muted">YES ${(m.yes_price*100).toFixed(1)}%</small></div>
      <button class="btn yes small" data-id="${m.id}" data-out="YES">Resolver YES</button>
      <button class="btn no small" data-id="${m.id}" data-out="NO">Resolver NO</button>
    </div>
  `).join('');
  list.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => resolveMarket(b.dataset.id, b.dataset.out));
  });
}

async function resolveMarket(id, outcome) {
  if (!currentWallet) return toast('Necesitas wallet para enviar la tx RESOLVE', 'error');
  try {
    const { signed_resolution } = await api('/oracle/resolve', {
      method: 'POST', body: { market_id: id, outcome },
    });
    await sendTx(currentWallet, 'RESOLVE', { market_id: id, resolution: signed_resolution });
    toast('Resolución firmada y enviada', 'success');
    setTimeout(() => render(), 2500);
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- CHAIN ----------
async function renderChain() {
  const info = await api('/info');
  const { chain } = await api('/chain');
  const { transactions: mempoolTxs } = await api('/mempool');
  document.getElementById('chainStats').innerHTML = `
    <div class="chain-stat"><div class="num">${info.chain_height}</div><div class="lbl">Altura</div></div>
    <div class="chain-stat"><div class="num">${info.mempool_size}</div><div class="lbl">Mempool</div></div>
    <div class="chain-stat"><div class="num">${info.markets_count}</div><div class="lbl">Mercados</div></div>
    <div class="chain-stat"><div class="num">${info.total_supply.toFixed(0)}</div><div class="lbl">Supply</div></div>
    <div class="chain-stat"><div class="num">${info.block_reward}</div><div class="lbl">Reward</div></div>
    <div class="chain-stat"><div class="num">${info.difficulty}</div><div class="lbl">Dificultad</div></div>
  `;
  const mp = document.getElementById('mempoolList');
  if (!mempoolTxs.length) mp.innerHTML = '<div class="muted">Mempool vacío</div>';
  else mp.innerHTML = mempoolTxs.map(tx => `
    <div class="block-item">
      <div class="head"><span>${tx.type}</span><span>${shortAddr(tx.sender_address)}</span></div>
      <div class="muted" style="font-size:10px">nonce ${tx.nonce} • ${new Date(tx.timestamp).toLocaleTimeString()}</div>
    </div>
  `).join('');
  const blocks = chain.slice().reverse();
  document.getElementById('blockList').innerHTML = blocks.map(b => `
    <div class="block-item">
      <div class="head"><span>Block #${b.index}</span><span>nonce ${b.nonce}</span></div>
      <div class="hash">${b.hash}</div>
      <div class="txs">${b.transactions.length} tx${b.transactions.length !== 1 ? 's' : ''} • miner ${shortAddr(b.miner_address)} • ${new Date(b.timestamp).toLocaleTimeString()}</div>
    </div>
  `).join('');
}

// ============ INIT ============
async function init() {
  // sanity check: address derivation matches backend
  try {
    if (currentWallet) {
      const derived = pubkeyToAddress(hexToBytes(currentWallet.publicKey));
      if (derived !== currentWallet.address) {
        console.warn('Address derivation mismatch, regenerating');
        clearWallet();
        currentWallet = null;
      }
    }
  } catch (e) { console.error(e); }
  await refreshWallet();
  await render();
  // periodic refresh
  setInterval(async () => {
    if (currentView === 'markets' || currentView === 'chain') render();
    refreshWallet();
  }, 5000);
}
init();
