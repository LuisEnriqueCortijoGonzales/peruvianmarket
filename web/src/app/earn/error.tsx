'use client';

import { useEffect } from 'react';

export default function EarnError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Earn page error]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-ink flex flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-lg rounded-2xl border border-red-500/30 bg-red-500/10 p-6 space-y-4">
        <h2 className="text-red-400 font-bold text-lg">Error en la página Ganar</h2>
        <pre className="text-red-300/80 text-xs font-mono whitespace-pre-wrap break-all bg-ink rounded-lg p-3">
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg bg-terracotta/20 text-terracotta hover:bg-terracotta/30 transition-colors text-sm font-medium"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
