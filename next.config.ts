import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['mysql2', 'bcryptjs'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
