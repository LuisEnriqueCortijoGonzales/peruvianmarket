/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  serverExternalPackages: ['@noble/secp256k1', '@noble/hashes', '@noble/ed25519', '@pkmn/sim', '@pkmn/randoms'],
};

export default nextConfig;
