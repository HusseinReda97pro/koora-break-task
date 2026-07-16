import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @koora/shared ships TypeScript source (types only), so Next must compile it
  transpilePackages: ['@koora/shared'],
  // monorepo root (keeps Next from guessing from stray lockfiles further up)
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
};

export default nextConfig;
