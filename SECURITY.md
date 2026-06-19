# Security Policy

Thanks for helping keep Enjin Governance and its users safe. This document
explains how to report a vulnerability, what is in scope, the protections the
client already ships, and the hardening steps an operator should apply before
running it in production.

## Reporting a vulnerability

Please report privately and give us a chance to fix the issue before it is
public.

- **Preferred:** use the in-app form at **`/security`**. It is open to
  everyone (no account or wallet required) and delivers your report straight
  to the maintainers (and, when configured, a private team channel). Include
  impact, reproduction steps, and the affected component.
- Do **not** open a public GitHub issue, pull request, or social post for a
  security bug, and please do not share exploit details publicly until a fix
  has shipped.

We aim to acknowledge a report quickly and will coordinate a disclosure
timeline with you. If you leave a contact, we will keep you updated and credit
you (with your consent) once the issue is resolved.

## Scope

**In scope** (this client):

- Authentication and session handling (sign-in by signature, nonces, cookies).
- Authorization on the API routes (proposal create/edit/withdraw/cancel,
  comments, profile, uploads).
- The off-chain metadata pipeline (EGOV1 JSON, R2 storage, the Neon mirror).
- Cross-site request forgery, injection, XSS, SSRF, open redirects, secret
  exposure, and access-control flaws in the web app and its API.

**Out of scope:**

- The Enjin Relay / Canary runtime and its pallets (`referenda`,
  `convictionVoting`, `treasury`, `preimage`, etc.). Report chain-level issues
  to Enjin directly.
- Third-party wallets and browser extensions, and the WalletConnect protocol.
- Third-party infrastructure (Cloudflare R2, Neon, Subscan, CoinGecko, RPC
  providers).
- Volumetric denial of service, and findings that require a compromised
  device, a malicious browser extension, or social engineering of a user.

## Security model

The client is built defensively. Key properties:

- **Sign-in by signature.** A SIWE-style flow issues a single-use, server-
  stored nonce; the wallet signs the exact server-supplied message. Sessions
  are httpOnly cookies, and only a SHA-256 of the bearer token is persisted,
  never the token itself.
- **Authorization by public key.** Every mutating route verifies the caller
  owns the resource by comparing **public-key bytes** (so an `en…` and a `cn…`
  encoding of the same key match), not by string equality.
- **CSRF protection.** State-changing API requests are checked for same-origin
  in middleware (`lib/auth/csrf.ts`): a cross-site `Origin`/`Referer` is
  rejected with `403`. Requests with no browser-attributable origin (which
  cannot ride a victim's cookie) are allowed.
- **Input validation.** Every request body is validated with Zod; addresses
  are checked as real SS58 before any user row is created; batch endpoints cap
  their input arrays.
- **XSS.** User markdown renders to React nodes (never `dangerouslySetInnerHTML`
  for user content) with an `https`/relative-only URL allowlist; comments are
  plain text. Uploads accept a strict MIME allowlist (no SVG/HTML) and avatars
  are transcoded server-side.
- **Rate limiting and a honeypot.** Write and auth endpoints carry per-IP /
  per-user fixed-window limits (`429 + Retry-After`); the public disclosure
  form additionally drops bots via a honeypot field.
- **Secrets.** No secret is exposed to the client bundle; server and client env
  vars are separated in `lib/env.ts`. All database access is parameterized.

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |

Security fixes are applied to the current `1.0.x` line.
