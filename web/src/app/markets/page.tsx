import { createClient } from '@/lib/supabase/server';
import Navigation from '@/components/Navigation';
import MarketCard from '@/components/MarketCard';
import type { Market, Position } from '@/lib/types';
import { calcPrices } from '@/lib/amm';
import Link from 'next/link';
import { PlusCircle, Search } from 'lucide-react';

export const revalidate = 30;

const categories = [
  { value: '', label: 'Todos' },
  { value: 'deportes', label: '⚽ Deportes' },
  { value: 'politica', label: '🏛️ Política' },
  { value: 'crypto', label: '₿ Crypto' },
  { value: 'economia', label: '📈 Economía' },
  { value: 'entretenimiento', label: '🎬 Entretenimiento' },
  { value: 'educacion', label: '🎓 Educación' },
];

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; status?: string }>;
}) {
  const { q, cat, status } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Fetch markets
  let query = supabase
    .from('markets')
    .select('*')
    .order('created_at', { ascending: false });

  if (cat) query = query.eq('category', cat);
  if (status === 'resolved') {
    query = query.eq('status', 'resolved');
  } else {
    query = query.eq('status', 'open');
  }
  if (q) {
    query = query.ilike('question', `%${q}%`);
  }

  const { data: markets } = await query.returns<Market[]>();

  // Fetch user positions if logged in
  let userPositions: Record<string, Position> = {};
  if (user) {
    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', user.id)
      .single();

    if (wallet && markets?.length) {
      const { data: positions } = await supabase
        .from('positions')
        .select('*')
        .eq('address', wallet.address)
        .in('market_id', markets.map((m) => m.id))
        .returns<Position[]>();

      if (positions) {
        userPositions = Object.fromEntries(positions.map((p) => [p.market_id, p]));
      }
    }
  }

  // Enrich markets with prices
  const enriched = (markets ?? []).map((m) => {
    const prices = calcPrices(m.yes_reserve, m.no_reserve);
    return {
      ...m,
      yes_price: prices.yes,
      no_price: prices.no,
      total_liquidity: m.yes_reserve + m.no_reserve,
    };
  });

  return (
    <div className="min-h-screen bg-ink">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-cream">Mercados</h1>
            <p className="text-cream/50 text-sm mt-1">
              {enriched.length} mercado{enriched.length !== 1 ? 's' : ''} disponible{enriched.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Link href="/create" className="btn-primary flex items-center gap-2 self-start">
            <PlusCircle size={16} />
            Crear mercado
          </Link>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <form className="flex-1 relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-cream/30" />
            <input
              name="q"
              defaultValue={q}
              placeholder="Buscar mercados..."
              className="input pl-9"
            />
            {cat && <input type="hidden" name="cat" value={cat} />}
            {status && <input type="hidden" name="status" value={status} />}
          </form>

          <div className="flex gap-2 flex-wrap">
            {[
              { href: `?cat=&status=${status || ''}`, label: 'Abiertos', active: !status || status === 'open' },
              { href: `?cat=${cat || ''}&status=resolved`, label: 'Resueltos', active: status === 'resolved' },
            ].map(({ href, label, active }) => (
              <Link
                key={label}
                href={href}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  active
                    ? 'bg-terracotta/20 border-terracotta/40 text-terracotta'
                    : 'border-cream/10 text-cream/50 hover:border-cream/20 hover:text-cream'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap mb-6">
          {categories.map(({ value, label }) => (
            <Link
              key={value}
              href={`?cat=${value}&status=${status || ''}&q=${q || ''}`}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                (cat || '') === value
                  ? 'bg-mustard/20 border-mustard/40 text-mustard'
                  : 'border-cream/10 text-cream/40 hover:border-cream/20 hover:text-cream'
              }`}
            >
              {label}
            </Link>
          ))}
        </div>

        {/* Markets grid */}
        {enriched.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-cream/50 text-lg">No hay mercados aún</p>
            <p className="text-cream/30 text-sm mt-1">
              ¡{' '}
              <Link href="/create" className="text-terracotta hover:underline">
                Crea el primero
              </Link>{' '}
              !
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {enriched.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                userPosition={userPositions[market.id] ?? null}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
