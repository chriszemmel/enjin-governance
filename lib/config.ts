/**
 * App-wide constants that are not chain-network state.
 * Network state (RPC URLs, SS58 prefixes, chain IDs) lives in
 * lib/chain/chains.ts; env vars live in lib/env.ts.
 */

export const APP_NAME = "Enjin Governance"
/**
 * Long-form tagline used for the default `<title>` and og:title on the
 * root page. Aimed at the social-card sweet spot of 50-60 characters
 * so previews don't read as a bare app name. Per-route metadata
 * overrides this (e.g. `/proposals` → "Proposals - Enjin Governance").
 */
export const APP_TITLE =
  "Enjin Governance - On-chain proposals, voting & treasury"
export const APP_DESCRIPTION =
  "Participate in on-chain governance. Vote on proposals, manage treasury funds, and help guide the Enjin ecosystem forward."
