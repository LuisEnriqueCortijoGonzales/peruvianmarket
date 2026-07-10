import type { Metadata, Viewport } from 'next';
import { WalletProvider } from '@/lib/wallet-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'PeruvianMarket — Predicciones Descentralizadas',
  description:
    'Plataforma de mercados de predicción entre amigos con criptografía real. Apuesta PEN, gana tokens.',
  keywords: ['predicciones', 'crypto', 'mercados', 'perú', 'apuestas'],
  openGraph: {
    title: 'PeruvianMarket',
    description: 'Mercados de predicción descentralizados — Perú',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#1A1A1A',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-ink text-cream antialiased">
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
