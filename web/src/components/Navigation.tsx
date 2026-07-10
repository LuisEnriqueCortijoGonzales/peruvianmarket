'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useWallet } from '@/lib/wallet-context';
import {
  TrendingUp,
  Wallet,
  PlusCircle,
  Award,
  Scroll,
  Activity,
  Dices,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ShieldCheck,
  CircleDot,
  Plane,
  Spade,
  Gamepad2,
  Lightbulb,
  Egg,
  Ticket,
  Bomb,
  Swords,
  Handshake,
} from 'lucide-react';
import { shortAddress, formatPEN } from '@/lib/utils';

const GAME_LINKS = [
  { href: '/slots',            label: 'Slots',     icon: Dices,      desc: 'Tragamonedas cascade' },
  { href: '/casino/roulette',  label: 'Ruleta',    icon: CircleDot,  desc: 'Ruleta europea' },
  { href: '/casino/crash',     label: 'El Avión',  icon: Plane,      desc: 'Crash — cobrar antes de explotar' },
  { href: '/casino/blackjack', label: 'Blackjack',    icon: Spade,   desc: '21 · dealer planta en 17' },
  { href: '/casino/chicken',  label: 'La Gallina',   icon: Egg,     desc: 'Avanza por la pista sin que te atropellen' },
  { href: '/casino/mines',    label: 'Minas',        icon: Bomb,    desc: 'Revela diamantes sin pisar una bomba' },
  { href: '/casino/scratch',  label: 'Raspa y Gana', icon: Ticket,  desc: 'Compra un boleto y raspa tu premio' },
  { href: '/casino/pokemon',  label: 'Pokémon',      icon: Swords,  desc: 'Batallas 1v1 apostando CHC' },
];

const navLinks = [
  { href: '/markets',    label: 'Mercados',   icon: TrendingUp },
  { href: '/p2p',        label: 'P2P',        icon: Handshake },
  { href: '/earn',       label: 'Ganar CHC',  icon: Award },
  { href: '/oracle',     label: 'Oráculo',    icon: Scroll },
  { href: '/blockchain', label: 'Blockchain', icon: Activity },
];

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  const { address, balance, refresh } = useWallet();
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [userOpen, setUserOpen]       = useState(false);
  const [gamesOpen, setGamesOpen]     = useState(false);
  const [isAdmin, setIsAdmin]         = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState(0);
  const gamesRef = useRef<HTMLDivElement>(null);

  const isGamesActive = GAME_LINKS.some(g => pathname.startsWith(g.href));

  useEffect(() => {
    refresh();
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('profiles').select('is_admin').eq('id', user.id).single()
        .then(({ data }) => {
          if (data?.is_admin) {
            setIsAdmin(true);
            fetch('/api/suggestions?status=pending')
              .then(r => r.json())
              .then(d => { if (d.success) setPendingSuggestions(d.data.length); })
              .catch(() => {});
          }
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Close games dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (gamesRef.current && !gamesRef.current.contains(e.target as Node)) setGamesOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem('pm_encrypted_key');
    localStorage.removeItem('pm_address');
    localStorage.removeItem('pm_pubkey');
    router.push('/login');
  }

  return (
    <nav className="bg-ink-soft border-b border-cream/10 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Logo */}
        <Link href="/markets" className="flex items-center gap-2 group">
          <div className="w-8 h-8 bg-terracotta rounded-lg flex items-center justify-center group-hover:bg-terracotta-light transition-colors">
            <TrendingUp size={18} className="text-cream" />
          </div>
          <span className="font-bold text-cream hidden sm:block">
            Peruvian<span className="text-terracotta">Market</span>
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname.startsWith(href)
                  ? 'bg-terracotta/20 text-terracotta'
                  : 'text-cream/60 hover:text-cream hover:bg-ink-muted'
              }`}>
              <Icon size={15} />
              {label}
            </Link>
          ))}

          {/* Games dropdown */}
          <div className="relative" ref={gamesRef}>
            <button
              onClick={() => setGamesOpen(v => !v)}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                isGamesActive
                  ? 'bg-terracotta/20 text-terracotta'
                  : 'text-cream/60 hover:text-cream hover:bg-ink-muted'
              }`}>
              <Gamepad2 size={15} />
              Juegos
              <ChevronDown size={12} className={`transition-transform ${gamesOpen ? 'rotate-180' : ''}`} />
            </button>
            {gamesOpen && (
              <div className="absolute left-0 top-full mt-1.5 w-56 bg-ink-soft border border-cream/10 rounded-xl shadow-xl overflow-hidden animate-slide-up">
                {GAME_LINKS.map(({ href, label, icon: Icon, desc }) => (
                  <Link key={href} href={href} onClick={() => setGamesOpen(false)}
                    className={`flex items-start gap-3 px-4 py-3 transition-colors border-b border-cream/5 last:border-0 ${
                      pathname.startsWith(href)
                        ? 'bg-terracotta/10 text-terracotta'
                        : 'text-cream/70 hover:text-cream hover:bg-ink-muted'
                    }`}>
                    <Icon size={16} className="mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold leading-none">{label}</p>
                      <p className="text-xs text-cream/30 mt-0.5">{desc}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Suggest / Admin */}
          {!isAdmin && (
            <Link href="/suggest"
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                pathname.startsWith('/suggest')
                  ? 'bg-mustard/20 text-mustard'
                  : 'text-cream/60 hover:text-cream hover:bg-ink-muted'
              }`}>
              <Lightbulb size={15} />
              Sugerir
            </Link>
          )}
          {isAdmin && (
            <>
              <Link href="/suggest"
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname.startsWith('/suggest')
                    ? 'bg-mustard/20 text-mustard'
                    : 'text-cream/60 hover:text-cream hover:bg-ink-muted'
                }`}>
                <PlusCircle size={15} />
                Crear
              </Link>
              <Link href="/admin"
                className={`relative flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pathname.startsWith('/admin')
                    ? 'bg-terracotta/20 text-terracotta'
                    : 'text-terracotta/60 hover:text-terracotta hover:bg-terracotta/10'
                }`}>
                <ShieldCheck size={15} />
                Admin
                {pendingSuggestions > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-mustard text-ink text-[10px] font-black rounded-full flex items-center justify-center">
                    {pendingSuggestions > 9 ? '9+' : pendingSuggestions}
                  </span>
                )}
              </Link>
            </>
          )}
        </div>

        {/* Right: wallet + user */}
        <div className="flex items-center gap-2">
          <Link href="/wallet"
            className={`hidden sm:flex items-center gap-2 px-3.5 py-2 rounded-lg border text-sm font-medium transition-colors ${
              pathname.startsWith('/wallet')
                ? 'border-mustard/50 text-mustard'
                : 'border-cream/20 text-cream/60 hover:border-cream/30 hover:text-cream'
            }`}>
            <Wallet size={15} />
            {balance !== null ? (
              <span className="font-mono">{formatPEN(balance)} CHC</span>
            ) : address ? (
              <span className="font-mono">{shortAddress(address)}</span>
            ) : (
              'Wallet'
            )}
          </Link>

          <div className="relative">
            <button onClick={() => setUserOpen(!userOpen)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-cream/20 hover:border-cream/30 text-cream/60 hover:text-cream transition-colors text-sm">
              <div className="w-5 h-5 bg-terracotta rounded-full" />
              <ChevronDown size={14} />
            </button>
            {userOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 bg-ink-soft border border-cream/10 rounded-xl shadow-xl overflow-hidden animate-slide-up">
                {address && (
                  <div className="px-4 py-3 border-b border-cream/10">
                    <p className="text-xs text-cream/40">Dirección</p>
                    <p className="text-xs font-mono text-mustard truncate">{shortAddress(address)}</p>
                  </div>
                )}
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-cream/70 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                  <LogOut size={14} />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>

          <button onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-lg border border-cream/20 text-cream/60">
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-cream/10 bg-ink-soft animate-slide-up">
          {navLinks.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-4 py-3.5 text-sm font-medium border-b border-cream/5 transition-colors ${
                pathname.startsWith(href) ? 'text-terracotta bg-terracotta/10' : 'text-cream/70 hover:text-cream'
              }`}>
              <Icon size={16} />
              {label}
            </Link>
          ))}

          {/* Games section in mobile */}
          <div className="px-4 py-2 border-b border-cream/5">
            <p className="text-[10px] text-cream/30 font-semibold uppercase tracking-wider mb-1.5">Juegos</p>
            {GAME_LINKS.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 py-2.5 text-sm font-medium transition-colors ${
                  pathname.startsWith(href) ? 'text-terracotta' : 'text-cream/70 hover:text-cream'
                }`}>
                <Icon size={16} />
                {label}
              </Link>
            ))}
          </div>

          <Link href="/wallet" onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-cream/70 hover:text-cream border-b border-cream/5">
            <Wallet size={16} />
            Wallet{balance !== null ? ` — ${formatPEN(balance)} CHC` : ''}
          </Link>

          <Link href="/suggest" onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-4 py-3.5 text-sm font-medium border-b border-cream/5 transition-colors ${
              pathname.startsWith('/suggest') ? 'text-mustard bg-mustard/10' : 'text-cream/70 hover:text-cream'
            }`}>
            <Lightbulb size={16} />
            {isAdmin ? 'Crear mercado' : 'Sugerir mercado'}
          </Link>

          {isAdmin && (
            <Link href="/admin" onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-terracotta/70 hover:text-terracotta">
              <ShieldCheck size={16} />
              Panel Admin
              {pendingSuggestions > 0 && (
                <span className="ml-auto px-1.5 py-0.5 bg-mustard text-ink text-[10px] font-black rounded-full">
                  {pendingSuggestions}
                </span>
              )}
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
