/** @type {import('next').NextConfig} */
const nextConfig = {
  // Use server components for everything except dynamic routes
  reactStrictMode: true,
  
  // Optimize for Socket.io traffic
  async rewrites() {
    return [
      {
        source: '/socket.io/:path*',
        destination: '/socket.io/:path*',
      },
    ];
  },
  
  // Disable static optimization for routes that need dynamic data
  experimental: {
    // Treat all page.tsx files as server components by default
    serverComponentsExternalPackages: ['socket.io', 'socket.io-client', 'mongoose'],
  },

  // Optimize webpack by ignoring the static paths for dynamic routes
  webpack: (config, { isServer, nextRuntime }) => {
    if (!isServer) {
      // Don't resolve 'fs' module on the client to prevent build errors
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
