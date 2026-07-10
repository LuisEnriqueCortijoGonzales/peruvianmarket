'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  generateWallet,
  encryptPrivateKey,
  getAddressFromPublicKey,
  getPublicKeyFromPrivateKey,
} from '@/lib/crypto';
import type { WalletKeypair } from '@/lib/types';
import {
  Key,
  Eye,
  EyeOff,
  Download,
  ShieldCheck,
  AlertTriangle,
  Copy,
  CheckCircle,
  RefreshCw,
  Upload,
  ArrowLeft,
  FileJson,
} from 'lucide-react';

type Step = 'generate' | 'import-review' | 'backup' | 'confirm' | 'password' | 'saving';

export default function SetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('generate');
  const [wallet, setWallet] = useState<WalletKeypair | null>(null);
  const [isImport, setIsImport] = useState(false);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGenerate = useCallback(() => {
    const kp = generateWallet();
    setWallet(kp);
    setIsImport(false);
    setStep('backup');
    setConfirmed(false);
    setShowPrivateKey(false);
  }, []);

  async function copyToClipboard(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadBackup() {
    if (!wallet) return;
    const data = {
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      warning: 'GUARDA ESTE ARCHIVO EN UN LUGAR SEGURO. QUIEN TENGA TU CLAVE PRIVADA CONTROLA TU DINERO.',
      generated: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peruvianmarket-wallet-${wallet.address.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseImportedWallet(json: Record<string, string>) {
    setImportError(null);
    try {
      const { privateKey } = json;
      let { publicKey, address } = json;

      if (!privateKey || !/^[0-9a-fA-F]{64}$/.test(privateKey)) {
        throw new Error('Clave privada inválida en el archivo (debe ser 64 caracteres hex)');
      }

      // Derive missing fields from privateKey
      if (!publicKey) publicKey = getPublicKeyFromPrivateKey(privateKey);
      if (!address) address = getAddressFromPublicKey(publicKey);

      // Validate consistency
      const expectedAddr = getAddressFromPublicKey(publicKey);
      if (expectedAddr !== address) {
        throw new Error('Archivo corrupto: la dirección no coincide con la clave pública');
      }

      setWallet({ privateKey, publicKey, address });
      setIsImport(true);
      setImportError(null);
      setStep('import-review');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Error procesando el archivo');
    }
  }

  function handleFileUpload(file: File) {
    setImportError(null);
    if (!file.name.endsWith('.json')) {
      setImportError('Sube un archivo .json de backup');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        parseImportedWallet(json);
      } catch {
        setImportError('Archivo inválido. ¿Es un backup .json de PeruvianMarket?');
      }
    };
    reader.readAsText(file);
  }

  async function handleSave() {
    if (!wallet) return;
    if (password !== passwordConfirm) { setError('Las contraseñas no coinciden'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres'); return; }

    setLoading(true);
    setError(null);
    setStep('saving');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa');

      if (isImport) {
        // Check if wallet already exists in DB
        const { data: existing } = await supabase
          .from('wallets')
          .select('user_id')
          .eq('address', wallet.address)
          .maybeSingle();

        if (existing) {
          if (existing.user_id !== user.id) {
            throw new Error('Esta dirección ya está registrada con otra cuenta');
          }
          // Already belongs to this user — just restore localStorage below
        } else {
          const { error: walletError } = await supabase.from('wallets').insert({
            user_id: user.id,
            address: wallet.address,
            public_key: wallet.publicKey,
          });
          if (walletError) throw new Error(`Error registrando wallet: ${walletError.message}`);
        }
      } else {
        const { error: walletError } = await supabase.from('wallets').insert({
          user_id: user.id,
          address: wallet.address,
          public_key: wallet.publicKey,
        });
        if (walletError) throw walletError;
      }

      // Ensure balance row exists
      await fetch('/api/wallet/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: wallet.address }),
      });

      // Encrypt and save to localStorage
      const encrypted = await encryptPrivateKey(wallet.privateKey, password);
      localStorage.setItem('pm_encrypted_key', encrypted);
      localStorage.setItem('pm_address', wallet.address);
      localStorage.setItem('pm_pubkey', wallet.publicKey);

      router.push(isImport ? '/wallet' : '/markets');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
      setStep('password');
    } finally {
      setLoading(false);
    }
  }

  const newWalletSteps = ['generate', 'backup', 'confirm', 'password'] as const;

  return (
    <div className="min-h-screen bg-ink flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-mustard/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Key size={30} className="text-mustard" />
          </div>
          <h1 className="text-2xl font-bold text-cream">Configura tu Wallet Crypto</h1>
          <p className="text-cream/50 mt-2 text-sm">
            Tu clave criptográfica es tu identidad en la plataforma
          </p>
        </div>

        {/* Progress bar — only for new wallet flow */}
        {!isImport && step !== 'saving' && (
          <div className="flex items-center gap-2 mb-8">
            {newWalletSteps.map((s, i) => {
              const stepOrder: Step[] = ['generate', 'backup', 'confirm', 'password', 'saving'];
              const currentIdx = stepOrder.indexOf(step);
              const isPast = i < currentIdx;
              const isCurrent = step === s;
              return (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                      isCurrent
                        ? 'bg-terracotta text-cream'
                        : isPast
                        ? 'bg-market-yes text-white'
                        : 'bg-ink-muted text-cream/40'
                    }`}
                  >
                    {isPast ? <CheckCircle size={14} /> : i + 1}
                  </div>
                  {i < 3 && <div className="flex-1 h-0.5 bg-cream/10" />}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Generate ── */}
        {step === 'generate' && (
          <div className="space-y-4 animate-fade-in">
            <div className="card space-y-5">
              <h2 className="text-lg font-semibold text-cream">Genera tu par de claves</h2>
              <div className="bg-mustard/10 border border-mustard/30 rounded-lg p-4 flex gap-3">
                <AlertTriangle size={18} className="text-mustard shrink-0 mt-0.5" />
                <div className="text-sm text-cream/70 space-y-1">
                  <p className="font-semibold text-mustard">¿Qué es una clave privada?</p>
                  <p>
                    Es la llave maestra de tu wallet. Quien la tenga controla tus fondos.{' '}
                    <strong className="text-cream">Nunca la compartas</strong>, ni siquiera con el
                    equipo de PeruvianMarket.
                  </p>
                </div>
              </div>
              <button
                onClick={handleGenerate}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Key size={18} />
                Generar mis claves SECP256K1
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-cream/10" />
              <span className="text-cream/30 text-xs uppercase tracking-widest">o</span>
              <div className="flex-1 h-px bg-cream/10" />
            </div>

            <div className="card space-y-4">
              <h2 className="text-lg font-semibold text-cream flex items-center gap-2">
                <Upload size={18} className="text-terracotta" />
                Importar wallet existente
              </h2>
              <p className="text-sm text-cream/60">
                Si ya tienes un archivo de backup (.json), súbelo para restaurar tu wallet en este
                navegador.
              </p>

              <div
                className="border-2 border-dashed border-cream/20 rounded-xl p-6 text-center cursor-pointer hover:border-terracotta/50 hover:bg-terracotta/5 transition-all"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileUpload(file);
                }}
              >
                <FileJson size={28} className="text-cream/30 mx-auto mb-2" />
                <p className="text-sm text-cream/50">
                  Arrastra tu archivo{' '}
                  <code className="text-terracotta">wallet-backup.json</code> aquí
                </p>
                <p className="text-xs text-cream/30 mt-1">o haz clic para seleccionar</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                />
              </div>

              {importError && (
                <p className="text-red-400 text-sm flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {importError}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Import Review ── */}
        {step === 'import-review' && wallet && (
          <div className="card space-y-5 animate-fade-in">
            <button
              onClick={() => { setStep('generate'); setWallet(null); setIsImport(false); }}
              className="flex items-center gap-1.5 text-sm text-cream/40 hover:text-cream/70 transition-colors"
            >
              <ArrowLeft size={14} />
              Volver
            </button>

            <h2 className="text-lg font-semibold text-cream flex items-center gap-2">
              <CheckCircle size={18} className="text-market-yes" />
              Wallet encontrada
            </h2>

            <div className="bg-ink rounded-xl p-4 space-y-3 border border-cream/10">
              <div>
                <p className="text-xs text-cream/40 uppercase tracking-wider mb-1">Dirección</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm text-mustard font-mono truncate">{wallet.address}</code>
                  <button
                    onClick={() => copyToClipboard(wallet.address, 'addr')}
                    className="shrink-0 p-1.5 rounded-md hover:bg-ink-soft transition-colors"
                  >
                    {copied === 'addr' ? (
                      <CheckCircle size={13} className="text-market-yes" />
                    ) : (
                      <Copy size={13} className="text-cream/40" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <p className="text-xs text-cream/40 uppercase tracking-wider mb-1">Clave pública</p>
                <code className="text-xs text-cream/50 font-mono break-all">{wallet.publicKey}</code>
              </div>
            </div>

            <div className="bg-mustard/10 border border-mustard/30 rounded-lg p-3 flex gap-2 text-xs text-cream/70">
              <AlertTriangle size={14} className="text-mustard shrink-0 mt-0.5" />
              Confirma que la dirección de arriba es la tuya antes de continuar.
            </div>

            <button
              onClick={() => {
                setError(null);
                setPassword('');
                setPasswordConfirm('');
                setStep('password');
              }}
              className="btn-primary w-full"
            >
              Usar esta wallet →
            </button>
          </div>
        )}

        {/* ── Backup ── */}
        {step === 'backup' && wallet && (
          <div className="card space-y-5 animate-fade-in">
            <h2 className="text-lg font-semibold text-cream">Guarda tu clave privada</h2>

            <div>
              <label className="label">Tu dirección pública (compártela libremente)</label>
              <div className="flex items-center gap-2">
                <code className="input font-mono text-sm text-mustard truncate">{wallet.address}</code>
                <button
                  onClick={() => copyToClipboard(wallet.address, 'address')}
                  className="p-2.5 rounded-lg bg-ink-muted hover:bg-ink-soft border border-cream/10 transition-colors shrink-0"
                >
                  {copied === 'address' ? (
                    <CheckCircle size={16} className="text-market-yes" />
                  ) : (
                    <Copy size={16} className="text-cream/50" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="label flex items-center gap-2">
                <AlertTriangle size={14} className="text-red-400" />
                Clave privada (¡CONFIDENCIAL!)
              </label>
              <div className="flex items-center gap-2">
                <code className="input font-mono text-xs text-red-400 truncate">
                  {showPrivateKey ? wallet.privateKey : '•'.repeat(64)}
                </code>
                <button
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="p-2.5 rounded-lg bg-ink-muted hover:bg-ink-soft border border-cream/10 transition-colors shrink-0"
                >
                  {showPrivateKey ? (
                    <EyeOff size={16} className="text-cream/50" />
                  ) : (
                    <Eye size={16} className="text-cream/50" />
                  )}
                </button>
                {showPrivateKey && (
                  <button
                    onClick={() => copyToClipboard(wallet.privateKey, 'privkey')}
                    className="p-2.5 rounded-lg bg-ink-muted hover:bg-ink-soft border border-cream/10 transition-colors shrink-0"
                  >
                    {copied === 'privkey' ? (
                      <CheckCircle size={16} className="text-market-yes" />
                    ) : (
                      <Copy size={16} className="text-cream/50" />
                    )}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={downloadBackup}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <Download size={16} />
                Descargar backup
              </button>
              <button
                onClick={handleGenerate}
                className="p-2.5 rounded-lg bg-ink-muted hover:bg-ink-soft border border-cream/10 transition-colors"
                title="Regenerar"
              >
                <RefreshCw size={16} className="text-cream/50" />
              </button>
            </div>

            <button onClick={() => setStep('confirm')} className="btn-primary w-full">
              Ya guardé mi clave privada →
            </button>
          </div>
        )}

        {/* ── Confirm ── */}
        {step === 'confirm' && wallet && (
          <div className="card space-y-5 animate-fade-in">
            <h2 className="text-lg font-semibold text-cream">Confirma que entiendes</h2>
            <div className="space-y-3">
              {[
                'Si pierdo mi clave privada, pierdo acceso a mis fondos para siempre',
                'El equipo de PeruvianMarket NUNCA me pedirá mi clave privada',
                'Guardé mi clave privada en un lugar seguro fuera del navegador',
              ].map((text, i) => (
                <label
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-lg border border-cream/10 hover:border-cream/20 cursor-pointer transition-colors"
                >
                  <input type="checkbox" className="mt-0.5 accent-terracotta" onChange={() => {}} />
                  <span className="text-sm text-cream/70">{text}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input
                id="confirm"
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="accent-terracotta"
              />
              <label htmlFor="confirm" className="text-sm text-cream cursor-pointer">
                Entiendo y acepto la responsabilidad de mis claves
              </label>
            </div>
            <button
              disabled={!confirmed}
              onClick={() => setStep('password')}
              className="btn-primary w-full disabled:opacity-40"
            >
              Continuar →
            </button>
          </div>
        )}

        {/* ── Password ── */}
        {step === 'password' && (
          <div className="card space-y-5 animate-fade-in">
            {isImport && (
              <button
                onClick={() => setStep('import-review')}
                className="flex items-center gap-1.5 text-sm text-cream/40 hover:text-cream/70 transition-colors"
              >
                <ArrowLeft size={14} />
                Volver
              </button>
            )}
            <h2 className="text-lg font-semibold text-cream">
              {isImport ? 'Crea una contraseña para esta wallet' : 'Protege tu clave privada'}
            </h2>
            <p className="text-sm text-cream/60">
              {isImport
                ? 'Tu clave privada se cifrará con esta contraseña y se guardará solo en este navegador.'
                : 'Crea una contraseña para cifrar tu clave en este navegador. La necesitarás cada vez que firmes transacciones.'}
            </p>

            <div>
              <label className="label">Contraseña (mín. 6 caracteres)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
                autoFocus
              />
            </div>
            <div>
              <label className="label">Confirmar contraseña</label>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="••••••••"
                className="input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password && passwordConfirm) handleSave();
                }}
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm flex items-center gap-2">
                <AlertTriangle size={14} />
                {error}
              </p>
            )}

            <div className="bg-ink-soft border border-cream/10 rounded-lg p-3 flex gap-2 text-xs text-cream/50">
              <ShieldCheck size={14} className="text-market-yes shrink-0 mt-0.5" />
              La clave se encripta con AES-256-GCM en tu navegador. Nosotros no la vemos.
            </div>

            <button
              onClick={handleSave}
              disabled={loading || !password || !passwordConfirm}
              className="btn-primary w-full"
            >
              {loading ? 'Guardando...' : isImport ? 'Restaurar wallet →' : 'Activar mi wallet →'}
            </button>
          </div>
        )}

        {/* ── Saving ── */}
        {step === 'saving' && (
          <div className="card text-center space-y-4 animate-fade-in">
            <div className="w-12 h-12 bg-terracotta/20 rounded-full flex items-center justify-center mx-auto">
              <div className="w-6 h-6 border-2 border-terracotta border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-cream/70">
              {isImport ? 'Restaurando tu wallet...' : 'Registrando tu wallet en la blockchain...'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
