export interface Profile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  address: string;
  public_key: string;
  created_at: string;
}

export interface Balance {
  address: string;
  amount: number;
  nonce: number;
  updated_at: string;
}

export type MarketStatus = 'open' | 'resolved' | 'cancelled';
export type MarketType = 'binary' | 'multi';
export type MarketOutcome = 'YES' | 'NO';

export interface MultiOutcome {
  id: string;
  market_id: string;
  label: string;
  seed: number;
  display_order: number;
  is_winner: boolean;
  created_at: string;
  total_bet: number;         // sum of bets on this outcome
  probability: number;       // displayed probability (override if set, else calculated)
  probability_override: number | null; // admin-set probability (null = use calculated)
  calc_probability: number;  // always the bet-calculated probability
}

export interface OutcomeBet {
  id: string;
  outcome_id: string;
  market_id: string;
  address: string;
  amount: number;
  created_at: string;
}
export type MarketCategory =
  | 'general'
  | 'deportes'
  | 'politica'
  | 'crypto'
  | 'economia'
  | 'entretenimiento'
  | 'ciencia'
  | 'educacion';

export interface Market {
  id: string;
  question: string;
  description: string | null;
  creator_address: string;
  creator_user_id: string | null;
  market_type: MarketType;
  yes_reserve: number;
  no_reserve: number;
  status: MarketStatus;
  resolution: MarketOutcome | null;
  category: MarketCategory;
  end_date: string | null;
  created_at: string;
  resolved_at: string | null;
  admin_probability: number | null;
  admin_confidence: number;
  yes_price?: number;
  no_price?: number;
  total_liquidity?: number;
}

export interface Position {
  address: string;
  market_id: string;
  yes_shares: number;
  no_shares: number;
  updated_at: string;
}

export type TransactionType =
  | 'FAUCET'
  | 'MINE'
  | 'TRANSFER'
  | 'CREATE_MARKET'
  | 'BUY'
  | 'SELL'
  | 'RESOLVE'
  | 'CLAIM';

export interface Transaction {
  id: string;
  type: TransactionType;
  from_address: string | null;
  to_address: string | null;
  market_id: string | null;
  amount: number | null;
  outcome: string | null;
  shares: number | null;
  signature: string | null;
  nonce: number | null;
  status: string;
  created_at: string;
}

export interface FaucetClaim {
  address: string;
  claimed_at: string;
}

export interface EarnTask {
  id: string;
  title: string;
  description: string | null;
  reward_pen: number | null;
  task_type: string;
  requirements: Record<string, unknown> | null;
  is_active: boolean;
  icon: string | null;
  created_at: string;
}

export interface TaskCompletion {
  user_id: string;
  task_id: string;
  completed_at: string;
  reward_paid: number | null;
}

export interface AddressStats {
  balance: number;
  nonce: number;
  has_faucet: boolean;
  trade_count: number;
  market_count: number;
}

export interface TradeQuote {
  outcome: MarketOutcome;
  amount_in: number;
  shares_out: number;
  price_per_share: number;
  price_impact: number;
  new_yes_price: number;
  new_no_price: number;
}

export interface WalletKeypair {
  privateKey: string;
  publicKey: string;
  address: string;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };
