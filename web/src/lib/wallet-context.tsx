'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Position, Market } from './types';

export type WalletPosition = Position & { market?: Market | null };

export interface WalletState {
  address: string | null;
  publicKey: string | null;
  balance: number | null;
  scc: number;
  nonce: number;
  hasFaucet: boolean;
  positions: WalletPosition[];
  /** true if pm_encrypted_key is in localStorage — user can sign transactions */
  canSign: boolean;
  hasWallet: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const WalletContext = createContext<WalletState>({
  address: null,
  publicKey: null,
  balance: null,
  scc: 0,
  nonce: 0,
  hasFaucet: false,
  positions: [],
  canSign: false,
  hasWallet: false,
  loading: true,
  refresh: async () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<WalletState, 'loading' | 'refresh'>>({
    address: null,
    publicKey: null,
    balance: null,
    scc: 0,
    nonce: 0,
    hasFaucet: false,
    positions: [],
    canSign: false,
    hasWallet: false,
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/wallet/me');
      const json = await res.json();

      if (json.success) {
        const { address, publicKey, balance, nonce, hasFaucet, positions, scc } = json.data;

        // Sync public data to localStorage so signing code can read it
        localStorage.setItem('pm_address', address);
        localStorage.setItem('pm_pubkey', publicKey);

        const canSign = !!localStorage.getItem('pm_encrypted_key');

        setState({ address, publicKey, balance, scc: Number(scc ?? 0), nonce, hasFaucet, positions: positions ?? [], canSign, hasWallet: true });
      } else {
        const address = localStorage.getItem('pm_address');
        const publicKey = localStorage.getItem('pm_pubkey');
        const canSign = !!localStorage.getItem('pm_encrypted_key');
        setState((prev) => ({ ...prev, address, publicKey, canSign, hasWallet: false }));
      }
    } catch {
      // Network error — fall back to localStorage
      const address = localStorage.getItem('pm_address');
      const publicKey = localStorage.getItem('pm_pubkey');
      const canSign = !!localStorage.getItem('pm_encrypted_key');
      setState((prev) => ({ ...prev, address, publicKey, canSign }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <WalletContext.Provider value={{ ...state, loading, refresh }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  return useContext(WalletContext);
}
