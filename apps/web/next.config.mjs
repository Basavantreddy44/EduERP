/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN ?? 'http://localhost:4000';

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@eduerp/shared'],
  // Same-origin proxy: the browser only talks to the web origin, so the refresh cookie stays first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};
