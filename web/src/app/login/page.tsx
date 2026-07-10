'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { TrendingUp, Mail, Lock, AlertCircle, CheckCircle } from 'lucide-react';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || password.length < 6) return;
    setLoading(true);
    setMessage(null);

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          const raw = error.message || error.name || ((error as unknown) as Record<string,unknown>).code as string || JSON.stringify(error) || 'Error al iniciar sesión';
          const msg = raw === '{}' ? 'Error al iniciar sesión. Verifica tus credenciales.' : raw;
          setMessage({
            type: 'error',
            text: msg.includes('Invalid') || msg.includes('credentials') || msg.includes('invalid')
              ? 'Correo o contraseña incorrectos'
              : msg.includes('confirmed') || msg.includes('Email not confirmed')
              ? 'Debes confirmar tu email primero (o desactiva "Confirm email" en Supabase)'
              : msg,
          });
        } else {
          window.location.href = '/markets';
          return;
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) {
          const raw = error.message || error.name || JSON.stringify(error) || 'Error al registrarse';
          setMessage({ type: 'error', text: raw === '{}' ? 'Error al registrarse. Intenta de nuevo.' : raw });
        } else if (data.user && !data.session) {
          setMessage({ type: 'success', text: 'Revisa tu correo para confirmar la cuenta, o desactiva "Confirm email" en Supabase.' });
        } else {
          setMessage({ type: 'success', text: '¡Cuenta creada! Ahora entra con tus credenciales.' });
          setMode('signin');
          setPassword('');
        }
      }
    } catch (err) {
      let msg = 'Error de conexión';
      if (err instanceof Error) msg = err.message;
      else if (err && typeof err === 'object') msg = JSON.stringify(err);
      setMessage({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setMessage(null);
    setPassword('');
  }

  return (
    <div className="min-h-screen bg-ink flex flex-col items-center justify-center p-4">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 bg-terracotta rounded-xl flex items-center justify-center">
            <TrendingUp size={28} className="text-cream" />
          </div>
          <h1 className="text-3xl font-bold text-cream tracking-tight">
            Peruvian<span className="text-terracotta">Market</span>
          </h1>
        </div>
        <p className="text-cream/60 text-base max-w-sm mx-auto">
          Mercados de predicción entre amigos. Apuesta CHcoins, gana crypto real.
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm card space-y-5">
        {/* Tabs */}
        <div className="flex rounded-lg bg-ink p-1 gap-1">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
              mode === 'signin' ? 'bg-terracotta text-cream' : 'text-cream/50 hover:text-cream'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${
              mode === 'signup' ? 'bg-terracotta text-cream' : 'text-cream/50 hover:text-cream'
            }`}
          >
            Registrarse
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="label">Correo electrónico</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/30 pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                className="input pl-9"
                required
                disabled={loading}
                autoComplete="email"
              />
            </div>
          </div>

          <div>
            <label className="label">Contraseña</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/30 pointer-events-none" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pl-9"
                required
                minLength={6}
                disabled={loading}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </div>
            {mode === 'signup' && (
              <p className="text-cream/30 text-xs mt-1">Mínimo 6 caracteres</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !email.trim() || password.length < 6}
            className="btn-primary w-full"
          >
            {loading ? 'Cargando...' : mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        {message && (
          <div
            className={`flex items-start gap-2.5 p-3.5 rounded-lg text-sm animate-fade-in ${
              message.type === 'success'
                ? 'bg-market-yes/10 border border-market-yes/30 text-market-yes'
                : 'bg-market-no/10 border border-market-no/30 text-market-no'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle size={16} className="shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
            )}
            {message.text}
          </div>
        )}

        <p className="text-cream/30 text-xs text-center">
          Solo para uso entre amigos. Al entrar aceptas las reglas del juego.
        </p>
      </div>

      {/* Features */}
      <div className="mt-10 grid grid-cols-3 gap-4 max-w-sm w-full">
        {[
          { emoji: '🔐', text: 'Tu llave,\ntu dinero' },
          { emoji: '📊', text: 'AMM como\nUniswap' },
          { emoji: '🪙', text: 'Gana\nCHcoins' },
        ].map((f) => (
          <div key={f.text} className="text-center p-3 rounded-lg bg-ink-soft border border-cream/5">
            <div className="text-2xl mb-1.5">{f.emoji}</div>
            <p className="text-cream/50 text-xs leading-tight whitespace-pre-line">{f.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
