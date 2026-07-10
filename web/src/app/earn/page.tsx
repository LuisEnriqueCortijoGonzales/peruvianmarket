'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { createClient } from '@/lib/supabase/client';
import { formatPEN } from '@/lib/utils';
import type { EarnTask } from '@/lib/types';
import {
  Award,
  CheckCircle,
  Loader2,
  Zap,
  Trophy,
} from 'lucide-react';
import { useWallet } from '@/lib/wallet-context';

interface TaskWithStatus extends EarnTask {
  completed: boolean;
}

interface MiningConfig {
  rate_per_click: number;
  cooldown_seconds: number;
  is_active: boolean;
}

// ── Mining clicker ────────────────────────────────────────────────────────────
function MiningClicker() {
  const { address, refresh } = useWallet();
  const [config, setConfig] = useState<MiningConfig | null>(null);
  const [sessionEarned, setSessionEarned] = useState(0);
  const [sessionClicks, setSessionClicks] = useState(0);
  const [cooldownPct, setCooldownPct] = useState(100);
  const [onCooldown, setOnCooldown] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [popup, setPopup] = useState<{ id: number; text: string } | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const popupCounter = useRef(0);

  useEffect(() => {
    fetch('/api/mine')
      .then(r => r.json())
      .then(d => { if (d.success) setConfig(d.data); })
      .catch(() => setConfig({ rate_per_click: 0.01, cooldown_seconds: 2, is_active: true }));
  }, []);

  useEffect(() => {
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  function startCooldown(seconds: number) {
    setOnCooldown(true);
    setCooldownPct(0);
    const start = Date.now();
    const duration = seconds * 1000;
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / duration) * 100);
      setCooldownPct(pct);
      if (pct >= 100) {
        clearInterval(cooldownTimer.current!);
        setOnCooldown(false);
        setCooldownPct(100);
      }
    }, 50);
  }

  async function handleMine() {
    if (onCooldown || isClicking || !address || !config?.is_active) return;
    setIsClicking(true);
    try {
      const res = await fetch('/api/mine', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        const reward = Number(data.data.reward);
        setSessionEarned(e => +(e + reward).toFixed(6));
        setSessionClicks(c => c + 1);
        popupCounter.current += 1;
        const pid = popupCounter.current;
        setPopup({ id: pid, text: `+${reward.toFixed(4)}` });
        setTimeout(() => setPopup(p => p?.id === pid ? null : p), 1200);
        refresh();
        startCooldown(config.cooldown_seconds);
      } else if (res.status === 429 && data.wait_ms) {
        startCooldown(data.wait_ms / 1000);
      }
    } catch {
      // silent
    } finally {
      setIsClicking(false);
    }
  }

  const ready = !onCooldown && !isClicking && !!address && !!config?.is_active;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-cream flex items-center gap-2">
        <span className="text-xl">⛏️</span>
        Minar Bloques
      </h2>

      <div className="card flex flex-col items-center py-10 gap-6 relative overflow-hidden">

        {/* Floating reward popup */}
        {popup && (
          <div
            key={popup.id}
            className="absolute top-6 left-1/2 text-mustard font-bold text-xl pointer-events-none animate-float-up z-10"
            style={{ whiteSpace: 'nowrap' }}
          >
            {popup.text} CHC
          </div>
        )}

        {/* Mine button */}
        <button
          onClick={handleMine}
          disabled={!ready}
          className={`relative w-40 h-40 rounded-full border-4 flex flex-col items-center justify-center gap-2 font-bold text-sm transition-all duration-150 select-none
            ${ready
              ? 'border-mustard/60 bg-mustard/10 hover:bg-mustard/20 hover:scale-105 active:scale-90 text-mustard shadow-lg shadow-mustard/10 cursor-pointer'
              : 'border-cream/10 bg-ink-soft text-cream/20 cursor-not-allowed'
            }
            ${isClicking ? 'animate-mine-click' : ''}
            ${ready && !isClicking ? 'animate-pulse-slow' : ''}
          `}
        >
          <span className="text-5xl leading-none">
            {isClicking ? '✨' : onCooldown ? '⏳' : '⛏️'}
          </span>
          <span className="text-xs font-semibold tracking-widest uppercase">
            {isClicking ? 'Minando' : onCooldown ? 'Espera' : 'Minar'}
          </span>
        </button>

        {/* Cooldown bar */}
        <div className="w-full max-w-xs space-y-1.5">
          <div className="h-1.5 bg-ink rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-none ${onCooldown ? 'bg-terracotta/60' : 'bg-mustard'}`}
              style={{ width: `${cooldownPct}%` }}
            />
          </div>
          <p className="text-center text-xs text-cream/40">
            {!address
              ? 'Tu sesión no tiene wallet activa'
              : !config?.is_active
              ? 'Minería pausada por el administrador'
              : onCooldown
              ? `Enfriando — ${(((100 - cooldownPct) / 100) * (config?.cooldown_seconds ?? 2)).toFixed(1)}s`
              : '¡Listo para minar!'
            }
          </p>
        </div>

        {/* Session stats */}
        <div className="flex gap-10 text-center">
          <div>
            <p className="text-3xl font-bold text-mustard font-mono">{sessionClicks}</p>
            <p className="text-xs text-cream/40 mt-0.5">bloques minados</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-mustard font-mono">{sessionEarned.toFixed(4)}</p>
            <p className="text-xs text-cream/40 mt-0.5">CHC esta sesión</p>
          </div>
        </div>

        {config && (
          <p className="text-xs text-cream/25 font-mono">
            {config.rate_per_click} CHC / bloque · cooldown {config.cooldown_seconds}s
          </p>
        )}
      </div>

      {/* SuperChamoCoins — minado desbloqueable */}
      <SuperCoinCard />
    </div>
  );
}

// ── SuperChamoCoins ───────────────────────────────────────────────────────────
const SCC_THRESHOLD = 5_000_000;

function SuperCoinCard() {
  const { balance, scc } = useWallet();
  const chc = balance ?? 0;
  const unlocked = chc >= SCC_THRESHOLD;
  const progress = Math.min(100, (chc / SCC_THRESHOLD) * 100);

  return (
    <div className={`card space-y-3 ${unlocked ? 'border-purple-500/40 bg-purple-500/5' : 'opacity-80'}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-cream flex items-center gap-2">
          <span className="text-xl">⚡</span>
          SuperChamoCoins
          {!unlocked && <span className="text-xs">🔒</span>}
        </h3>
        {unlocked ? (
          <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">
            DESBLOQUEADO
          </span>
        ) : (
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-ink text-cream/30 border border-cream/10">
            Requiere 5M CHC
          </span>
        )}
      </div>

      {unlocked ? (
        <>
          <p className="text-cream/50 text-sm">
            Tu minería ahora también produce <span className="text-purple-300 font-bold">SCC</span> — la moneda élite del ecosistema. Cada clic de minado otorga <span className="font-mono text-purple-300">0.001 SCC</span> adicional.
          </p>
          <p className="text-2xl font-bold text-purple-300 font-mono">
            {scc.toFixed(4)} <span className="text-sm">SCC</span>
          </p>
        </>
      ) : (
        <>
          <p className="text-cream/40 text-sm">
            Supera los <span className="text-mustard font-bold">5,000,000 CHC</span> para desbloquear el minado de SuperChamoCoins — se activa automáticamente y cada clic de minería produce SCC además de CHC.
          </p>
          <div className="space-y-1">
            <div className="h-2 bg-ink rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all"
                style={{ width: `${progress.toFixed(2)}%` }} />
            </div>
            <p className="text-xs text-cream/30 font-mono text-right">
              {chc.toLocaleString('es-PE', { maximumFractionDigits: 0 })} / 5,000,000 CHC ({progress.toFixed(2)}%)
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EarnPage() {
  const [tasks, setTasks] = useState<TaskWithStatus[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [claimingTask, setClaimingTask] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [totalEarned, setTotalEarned] = useState(0);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ address: string; amount: number }[]>([]);

  const { address, refresh } = useWallet();

  const fetchTasks = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingTasks(false); return; }

      const res = await fetch(`/api/tasks?user_id=${user.id}`);
      if (!res.ok) throw new Error('tasks error');
      const data = await res.json();
      if (data.success) {
        setTasks(data.data.tasks ?? []);
        setTotalEarned(data.data.total_earned ?? 0);
      }
    } catch {
      // table may not exist yet
    } finally {
      setLoadingTasks(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBalance = useCallback(() => {
    if (!address) return;
    fetch(`/api/wallet/${address}`)
      .then(r => r.json())
      .then(d => { if (d.success) setBalance(d.data?.balance ?? null); })
      .catch(() => null);
  }, [address]);

  useEffect(() => {
    fetchTasks();
    fetchBalance();
    fetch('/api/leaderboard')
      .then(r => r.json())
      .then(d => { if (d.success) setLeaderboard(d.data ?? []); })
      .catch(() => null);
  }, [address, fetchTasks, fetchBalance]);

  async function claimTask(taskId: string) {
    setClaimingTask(taskId);
    setSuccessMsg(null);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !address) return;

      const res = await fetch('/api/tasks/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, user_id: user.id, address }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setSuccessMsg(`¡Ganaste ${formatPEN(data.data.reward ?? 0)} CHC!`);
      await fetchTasks();
      fetchBalance();
      refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setClaimingTask(null);
    }
  }

  const completedCount = tasks.filter(t => t.completed).length;
  const totalTasks = tasks.length;

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-cream flex items-center gap-2">
              <Award size={24} className="text-mustard" />
              Ganar CHC
            </h1>
            <p className="text-cream/50 text-sm mt-1">
              Mina bloques y completa misiones para acumular CHCoins
            </p>
          </div>
          {balance !== null && (
            <div className="text-right">
              <p className="text-2xl font-bold text-cream">{formatPEN(balance)}</p>
              <p className="text-terracotta text-sm">CHC disponibles</p>
            </div>
          )}
        </div>

        {/* Mining clicker */}
        <MiningClicker />

        {/* Task progress */}
        {!loadingTasks && totalTasks > 0 && (
          <div className="card bg-gradient-to-r from-terracotta/10 to-mustard/10 border-terracotta/20">
            <div className="flex items-center justify-between mb-3">
              <p className="text-cream font-semibold">Progreso de misiones</p>
              <p className="text-cream/60 text-sm">{completedCount}/{totalTasks} completadas</p>
            </div>
            <div className="w-full h-3 bg-ink rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-terracotta to-mustard rounded-full transition-all duration-500"
                style={{ width: `${totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0}%` }}
              />
            </div>
            {totalEarned > 0 && (
              <p className="text-cream/50 text-xs mt-2">
                Total ganado con misiones: <span className="text-mustard">{formatPEN(totalEarned)} CHC</span>
              </p>
            )}
          </div>
        )}

        {successMsg && (
          <div className="bg-market-yes/10 border border-market-yes/30 rounded-lg p-3 flex items-center gap-2 text-market-yes text-sm animate-fade-in">
            <CheckCircle size={14} />
            {successMsg}
          </div>
        )}

        {/* Missions */}
        <div>
          <h2 className="text-lg font-semibold text-cream mb-4 flex items-center gap-2">
            <Zap size={18} className="text-mustard" />
            Misiones
          </h2>
          {loadingTasks ? (
            <div className="flex justify-center py-10">
              <Loader2 size={24} className="animate-spin text-terracotta" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="card text-center py-10">
              <p className="text-3xl mb-3">🎯</p>
              <p className="text-cream/50 text-sm">No hay misiones disponibles por el momento.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tasks.map(task => (
                <div
                  key={task.id}
                  className={`card flex items-start gap-4 transition-all ${
                    task.completed ? 'opacity-60 border-cream/5' : 'hover:border-cream/20'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                    task.completed ? 'bg-market-yes/20' : 'bg-mustard/10'
                  }`}>
                    {task.completed ? '✓' : (task.icon ?? '🎯')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`font-semibold text-sm ${
                        task.completed ? 'text-cream/40 line-through' : 'text-cream'
                      }`}>
                        {task.title}
                      </p>
                      <span className="text-mustard font-bold text-sm shrink-0">
                        +{formatPEN(task.reward_pen ?? 0)} CHC
                      </span>
                    </div>
                    <p className="text-cream/50 text-xs mt-0.5">{task.description}</p>
                    {!task.completed && (
                      <button
                        onClick={() => claimTask(task.id)}
                        disabled={claimingTask === task.id}
                        className="mt-2 text-xs btn-primary px-3 py-1.5 flex items-center gap-1"
                      >
                        {claimingTask === task.id && <Loader2 size={11} className="animate-spin" />}
                        Verificar y reclamar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-cream mb-4 flex items-center gap-2">
              <Trophy size={18} className="text-mustard" />
              Top Predictores
            </h2>
            <div className="card space-y-2">
              {leaderboard.slice(0, 10).map((entry, i) => (
                <div key={entry.address ?? i} className="flex items-center justify-between py-2 border-b border-cream/5 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      i === 0 ? 'bg-yellow-500/20 text-yellow-400'
                      : i === 1 ? 'bg-gray-300/20 text-gray-300'
                      : i === 2 ? 'bg-orange-600/20 text-orange-400'
                      : 'bg-ink text-cream/30'
                    }`}>
                      {i + 1}
                    </span>
                    <code className="font-mono text-xs text-cream/60">
                      {entry.address ? `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}` : '---'}
                    </code>
                  </div>
                  <span className="text-mustard font-semibold text-sm font-mono">
                    {formatPEN(entry.amount ?? 0)} CHC
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
