'use client';

// Mercados P2P privados — apuestas personales entre dos wallets.
// Toda la criptografía ocurre en el navegador:
//   ECDH(mi privada, su pública) → AES-256-GCM sobre los términos
//   ECDSA sobre el hash de los términos (crear/aceptar) y el veredicto
import { useState, useEffect, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { useWallet } from '@/lib/wallet-context';
import {
  decryptPrivateKey, deriveSharedKey, encryptShared, decryptShared,
  hashCiphertext, signTransaction,
} from '@/lib/crypto';
import { Loader2, Lock, Handshake, ShieldCheck, Hourglass, Scale, CheckCircle, AlertCircle, X } from 'lucide-react';

interface P2PMarket {
  id: string; creator_address: string; opponent_address: string;
  amount: number; ciphertext: string; terms_hash: string; deadline: string;
  status: string; verdict_creator: string | null; verdict_opponent: string | null;
  winner_address: string | null; oracle_sig: string | null; created_at: string;
}

const short = (a: string | null) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
const hoursLeft = (deadline: string) => Math.max(0, (new Date(deadline).getTime() - Date.now()) / 3600_000);

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pendiente de aceptación', cls: 'bg-mustard/15 text-mustard border-mustard/30' },
  active:    { label: 'Activo', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  disputed:  { label: '⚖️ En disputa — oráculo', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  resolved:  { label: 'Resuelto', cls: 'bg-cream/10 text-cream/60 border-cream/20' },
  cancelled: { label: 'Cancelado', cls: 'bg-cream/5 text-cream/30 border-cream/10' },
};

async function getPrivKey(password: string): Promise<string> {
  const enc = localStorage.getItem('pm_encrypted_key');
  if (!enc) throw new Error('Clave privada no encontrada en este navegador');
  return decryptPrivateKey(enc, password);
}

async function freshNonce(): Promise<number> {
  const r = await fetch('/api/wallet/me');
  const d = await r.json();
  if (!d.success) throw new Error('No se pudo leer el nonce');
  return Number(d.data.nonce ?? 0);
}

export default function P2PPage() {
  const { address, refresh } = useWallet();
  const [markets, setMarkets] = useState<P2PMarket[]>([]);
  const [pubkeys, setPubkeys] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [globalMsg, setGlobalMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/p2p/list');
      const d = await r.json();
      if (d.success) { setMarkets(d.data.markets); setPubkeys(d.data.pubkeys); }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-2xl mx-auto px-3 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-cream flex items-center gap-2">
            <Handshake size={22} className="text-terracotta" /> Mercados P2P privados
          </h1>
          <p className="text-cream/40 text-xs mt-1 leading-relaxed">
            Apuestas personales 1-a-1. Los términos viajan cifrados con <span className="text-cream/60 font-mono">ECDH + AES-256-GCM</span> — ni el servidor puede leerlos. Ambos depositan, ambos firman, y si no se ponen de acuerdo antes del plazo, el oráculo resuelve.
          </p>
        </div>

        {globalMsg && (
          <p className={`text-sm flex items-center gap-1.5 ${globalMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {globalMsg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />} {globalMsg.text}
          </p>
        )}

        <CreateForm myAddress={address ?? ''} onDone={(ok, text) => { setGlobalMsg({ ok, text }); load(); refresh(); }} />

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-cream/30" /></div>
        ) : markets.length === 0 ? (
          <p className="text-center text-cream/25 text-sm py-8">Aún no tienes mercados P2P</p>
        ) : (
          <div className="space-y-3">
            {markets.map(m => (
              <MarketCard key={m.id} market={m} myAddress={address ?? ''} pubkeys={pubkeys}
                onChanged={(ok, text) => { setGlobalMsg({ ok, text }); load(); refresh(); }} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Crear ─────────────────────────────────────────────────────────────────────
function CreateForm({ myAddress, onDone }: { myAddress: string; onDone: (ok: boolean, text: string) => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [rival, setRival] = useState('');
  const [terms, setTerms] = useState('');
  const [amount, setAmount] = useState('50');
  const [hours, setHours] = useState('72');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const amt = parseFloat(amount);
      if (isNaN(amt) || amt < 1) throw new Error('Depósito inválido');
      if (!terms.trim()) throw new Error('Escribe los términos de la apuesta');

      // 1. Llave pública del rival (para ECDH)
      const lk = await fetch(`/api/p2p/lookup?address=${encodeURIComponent(rival.trim())}`);
      const lkd = await lk.json();
      if (!lkd.success) throw new Error(lkd.error);

      // 2. Descifrar mi privada + derivar clave compartida + cifrar términos
      const privKey = await getPrivKey(password);
      const sharedKey = await deriveSharedKey(privKey, lkd.data.public_key);
      const ciphertext = await encryptShared(sharedKey, terms.trim());
      const termsHash = hashCiphertext(ciphertext);

      // 3. Firmar ECDSA sobre el hash de los términos + escrow
      const nonce = (await freshNonce()) + 1;
      const timestamp = Date.now();
      const signedMsg = {
        type: 'P2P_CREATE', from: myAddress, to: rival.trim(), amount: amt,
        terms_hash: termsHash, deadline: parseInt(hours, 10), nonce, timestamp,
      };
      const signature = signTransaction(signedMsg, privKey);
      const pubkey = localStorage.getItem('pm_pubkey') ?? '';

      const r = await fetch('/api/p2p/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: rival.trim(), amount: amt, terms_hash: termsHash, ciphertext,
          deadline_hours: parseInt(hours, 10), nonce, timestamp, signature, public_key: pubkey,
        }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);

      setOpenForm(false); setRival(''); setTerms(''); setPassword('');
      onDone(true, `Reto enviado — ${amt} CHC en escrow, firmado y cifrado`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      setErr(msg.toLowerCase().includes('operation') ? 'Contraseña incorrecta' : msg);
    }
    setBusy(false);
  }

  if (!openForm) {
    return (
      <button onClick={() => setOpenForm(true)} className="btn-primary w-full flex items-center justify-center gap-2">
        <Lock size={15} /> Crear apuesta privada
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-terracotta/25 bg-ink-soft p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-cream font-semibold text-sm flex items-center gap-2"><Lock size={14} className="text-terracotta" /> Nueva apuesta privada</h2>
        <button type="button" onClick={() => setOpenForm(false)} className="text-cream/30 hover:text-cream"><X size={15} /></button>
      </div>

      <div>
        <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">Dirección del rival</label>
        <input value={rival} onChange={e => setRival(e.target.value)} required placeholder="N..."
          className="input text-sm font-mono" />
      </div>
      <div>
        <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">
          Términos de la apuesta <span className="text-emerald-400/60 normal-case">(se cifran — solo ustedes dos podrán leerlos)</span>
        </label>
        <textarea value={terms} onChange={e => setTerms(e.target.value)} required rows={3} maxLength={2000}
          placeholder='Ej: "Apuesto a que apruebo Cripto con 17+. Si gano yo, cobro el pot."'
          className="input text-sm resize-none" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">Depósito c/u (CHC)</label>
          <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} required
            className="input text-sm" style={{ colorScheme: 'dark' }} />
        </div>
        <div>
          <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">Plazo</label>
          <select value={hours} onChange={e => setHours(e.target.value)} className="input text-sm">
            <option value="24">24 horas</option>
            <option value="72">3 días</option>
            <option value="168">7 días</option>
            <option value="720">30 días</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] text-cream/30 uppercase tracking-wider block mb-1">Tu contraseña</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
            placeholder="para firmar" className="input text-sm" />
        </div>
      </div>

      {err && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle size={11} /> {err}</p>}

      <button type="submit" disabled={busy} className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        Cifrar, firmar y depositar {amount || '—'} CHC
      </button>
      <p className="text-[10px] text-cream/25 text-center">
        ECDH secp256k1 → AES-256-GCM · firma ECDSA sobre SHA-256(ciphertext) · nonce anti-replay
      </p>
    </form>
  );
}

// ── Card de mercado ───────────────────────────────────────────────────────────
function MarketCard({ market: m, myAddress, pubkeys, onChanged }: {
  market: P2PMarket; myAddress: string; pubkeys: Record<string, string>;
  onChanged: (ok: boolean, text: string) => void;
}) {
  const iAmCreator = m.creator_address === myAddress;
  const other = iAmCreator ? m.opponent_address : m.creator_address;
  const myVerdict = iAmCreator ? m.verdict_creator : m.verdict_opponent;
  const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.cancelled;
  const expired = hoursLeft(m.deadline) <= 0;

  const [password, setPassword] = useState('');
  const [action, setAction] = useState<'none' | 'view' | 'accept' | 'verdict'>('none');
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [pickedVerdict, setPickedVerdict] = useState<'creator' | 'opponent' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function unlockTerms(pw: string): Promise<string> {
    const privKey = await getPrivKey(pw);
    const theirPub = pubkeys[other];
    if (!theirPub) throw new Error('Llave pública del rival no disponible');
    const key = await deriveSharedKey(privKey, theirPub);
    const text = await decryptShared(key, m.ciphertext);
    setDecrypted(text);
    return privKey;
  }

  async function run() {
    setBusy(true); setErr(null);
    try {
      if (action === 'view') {
        await unlockTerms(password);
      } else if (action === 'accept') {
        const privKey = await unlockTerms(password);
        const nonce = (await freshNonce()) + 1;
        const timestamp = Date.now();
        const signedMsg = { type: 'P2P_ACCEPT', market_id: m.id, terms_hash: m.terms_hash, from: myAddress, nonce, timestamp };
        const signature = signTransaction(signedMsg, privKey);
        const r = await fetch('/api/p2p/accept', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market_id: m.id, terms_hash: m.terms_hash, nonce, timestamp, signature, public_key: localStorage.getItem('pm_pubkey') ?? '' }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        onChanged(true, `Aceptaste el reto — ${Number(m.amount)} CHC depositados. Pot: ${Number(m.amount) * 2} CHC`);
      } else if (action === 'verdict' && pickedVerdict) {
        const privKey = await getPrivKey(password);
        const timestamp = Date.now();
        const signedMsg = { type: 'P2P_VERDICT', market_id: m.id, verdict: pickedVerdict, from: myAddress, timestamp };
        const signature = signTransaction(signedMsg, privKey);
        const r = await fetch('/api/p2p/verdict', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market_id: m.id, verdict: pickedVerdict, timestamp, signature, public_key: localStorage.getItem('pm_pubkey') ?? '' }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.error);
        const state = d.data.state;
        onChanged(true,
          state === 'resolved' ? '¡Veredictos coinciden! Escrow liberado al ganador'
          : state === 'disputed' ? 'Veredictos en conflicto — el oráculo decidirá'
          : 'Veredicto firmado — esperando a la otra parte');
        setAction('none');
      }
      setPassword('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error';
      setErr(msg.toLowerCase().includes('operation') ? 'Contraseña incorrecta' : msg);
    }
    setBusy(false);
  }

  async function cancel() {
    if (!confirm(iAmCreator ? '¿Cancelar tu reto? Se te devuelve el depósito.' : '¿Rechazar el reto?')) return;
    const r = await fetch('/api/p2p/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: m.id }),
    });
    const d = await r.json();
    onChanged(d.success, d.success ? 'Mercado cancelado — escrow devuelto al creador' : d.error);
  }

  return (
    <div className="rounded-2xl border border-cream/10 bg-ink-soft p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-cream/80 text-sm font-mono">
            {iAmCreator ? 'Tú' : short(m.creator_address)} <span className="text-cream/25">vs</span> {iAmCreator ? short(m.opponent_address) : 'Tú'}
          </p>
          <p className="text-mustard text-xs font-mono font-bold mt-0.5">
            {Number(m.amount).toFixed(2)} CHC c/u · pot {(Number(m.amount) * 2).toFixed(2)} CHC
          </p>
        </div>
        <span className={`shrink-0 text-[10px] px-2 py-1 rounded-full font-bold border ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-cream/30 font-mono">
        <span className="flex items-center gap-1"><Hourglass size={10} />
          {m.status === 'active' || m.status === 'pending'
            ? expired ? 'VENCIDO — el oráculo puede intervenir' : `${hoursLeft(m.deadline).toFixed(0)}h restantes`
            : new Date(m.created_at).toLocaleDateString('es-PE')}
        </span>
        <span title="SHA-256 de los términos cifrados">🔗 {m.terms_hash.slice(0, 12)}…</span>
        {m.oracle_sig && <span className="text-purple-300" title="Resuelto y firmado por el oráculo (Ed25519)">⚖️ oráculo</span>}
      </div>

      {/* Términos descifrados */}
      {decrypted && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <p className="text-[9px] text-emerald-400/60 uppercase tracking-wider mb-1">🔓 Términos (descifrados localmente)</p>
          <p className="text-cream/80 text-sm whitespace-pre-wrap">{decrypted}</p>
        </div>
      )}

      {/* Resuelto */}
      {m.status === 'resolved' && (
        <p className={`text-sm font-bold ${m.winner_address === myAddress ? 'text-emerald-400' : 'text-red-400'}`}>
          {m.winner_address === myAddress ? `🏆 Ganaste ${(Number(m.amount) * 2).toFixed(2)} CHC` : `Ganó ${short(m.winner_address)}`}
        </p>
      )}

      {/* Veredictos en curso */}
      {m.status === 'active' && (
        <div className="flex gap-2 text-[10px] font-mono">
          <span className={m.verdict_creator ? 'text-emerald-400' : 'text-cream/25'}>
            {iAmCreator ? 'Tu veredicto' : 'Creador'}: {m.verdict_creator ?? 'pendiente'}
          </span>
          <span className={m.verdict_opponent ? 'text-emerald-400' : 'text-cream/25'}>
            {!iAmCreator ? 'Tu veredicto' : 'Rival'}: {m.verdict_opponent ?? 'pendiente'}
          </span>
        </div>
      )}

      {/* Acciones */}
      {(m.status === 'pending' || m.status === 'active') && (
        <div className="flex gap-2 flex-wrap">
          {!decrypted && (
            <button onClick={() => setAction(action === 'view' ? 'none' : 'view')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-cream/15 text-cream/60 hover:border-cream/30 transition-all">
              🔓 Ver términos
            </button>
          )}
          {m.status === 'pending' && !iAmCreator && (
            <button onClick={() => setAction(action === 'accept' ? 'none' : 'accept')}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all">
              ✍️ Aceptar y depositar {Number(m.amount).toFixed(0)} CHC
            </button>
          )}
          {m.status === 'pending' && (
            <button onClick={cancel}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/25 text-red-400/70 hover:bg-red-500/10 transition-all">
              {iAmCreator ? 'Cancelar' : 'Rechazar'}
            </button>
          )}
          {m.status === 'active' && !myVerdict && (
            <button onClick={() => setAction(action === 'verdict' ? 'none' : 'verdict')}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-terracotta/20 text-terracotta border border-terracotta/40 hover:bg-terracotta/30 transition-all">
              <Scale size={11} className="inline mr-1" /> Dar veredicto
            </button>
          )}
        </div>
      )}

      {/* Formulario de acción (contraseña + veredicto) */}
      {action !== 'none' && (
        <div className="rounded-lg border border-cream/10 bg-ink p-3 space-y-2">
          {action === 'verdict' && (
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setPickedVerdict('creator')}
                className={`py-2 rounded-lg text-xs font-bold border transition-all ${pickedVerdict === 'creator' ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-cream/10 text-cream/50'}`}>
                Ganó {iAmCreator ? 'YO' : short(m.creator_address)}
              </button>
              <button onClick={() => setPickedVerdict('opponent')}
                className={`py-2 rounded-lg text-xs font-bold border transition-all ${pickedVerdict === 'opponent' ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-cream/10 text-cream/50'}`}>
                Ganó {!iAmCreator ? 'YO' : short(m.opponent_address)}
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Contraseña de tu wallet" className="input text-sm flex-1" />
            <button onClick={run} disabled={busy || !password || (action === 'verdict' && !pickedVerdict)}
              className="btn-primary text-sm px-4 disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : action === 'view' ? 'Descifrar' : 'Firmar'}
            </button>
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
        </div>
      )}
    </div>
  );
}
