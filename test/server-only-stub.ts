// Stand-in for `server-only` under Vitest. The real module throws on
// import outside an RSC bundler so we'd never be able to test modules
// like lib/auth/siwe.ts that guard themselves with it.
export {}
