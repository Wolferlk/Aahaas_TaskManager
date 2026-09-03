import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['mysql2', 'bcryptjs'],
};

export default nextConfig;
