/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/shared"],
  images: {
    remotePatterns: [
      { hostname: "cdn.discordapp.com" },
    ],
  },
};

export default nextConfig;
