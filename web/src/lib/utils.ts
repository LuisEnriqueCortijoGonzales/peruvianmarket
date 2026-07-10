import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPEN(amount: number | null | undefined, decimals = 2): string {
  if (amount == null) return (0).toLocaleString('es-PE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return amount.toLocaleString('es-PE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('es-PE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    general: 'General',
    deportes: 'Deportes',
    politica: 'Política',
    crypto: 'Crypto',
    economia: 'Economía',
    entretenimiento: 'Entretenimiento',
    ciencia: 'Ciencia',
    educacion: 'Educación',
  };
  return labels[cat] ?? cat;
}

export function categoryColor(cat: string): string {
  const colors: Record<string, string> = {
    general: 'bg-ink-muted text-cream',
    deportes: 'bg-terracotta text-cream',
    politica: 'bg-mustard text-ink',
    crypto: 'bg-purple-700 text-cream',
    economia: 'bg-blue-700 text-cream',
    entretenimiento: 'bg-pink-700 text-cream',
    ciencia: 'bg-teal-700 text-cream',
    educacion: 'bg-green-700 text-cream',
  };
  return colors[cat] ?? 'bg-ink-muted text-cream';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeJSON<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export function canonicalJSON(obj: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}
