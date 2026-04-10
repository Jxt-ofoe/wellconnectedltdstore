/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@libsql/client', 'express', 'express-rate-limit', 'express-validator'],
};

module.exports = nextConfig;
