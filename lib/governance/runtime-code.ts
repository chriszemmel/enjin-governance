/**
 * The runtime a proposal installs, read from its decoded call, so voters can
 * compare it with the srtool build hash in the release notes.
 *
 *   - `system.setCode(code)` (and `setCodeWithoutChecks`) carries the whole
 *     wasm: its hash is computed from the bytes on chain. Older referenda
 *     filed this way still show it.
 *   - `system.authorizeUpgrade(code_hash)` (and `...WithoutChecks`) carries
 *     only the hash. Once enacted, anyone applies the matching wasm with
 *     `system.applyAuthorizedUpgrade`; any other bytes are rejected.
 */

import { u8aToHex } from "@polkadot/util"
import { blake2AsHex } from "@polkadot/util-crypto"

export type RuntimeCode = {
  /** blake2-256 of the runtime wasm. */
  hash: `0x${string}`
  /** Size of the wasm in bytes - null when only its hash is on chain. */
  size: number | null
  via: "setCode" | "authorizeUpgrade"
}

type CallLike = {
  section: string
  method: string
  args: readonly { toU8a(isBare?: boolean): Uint8Array }[]
}

export function runtimeCodeOf(call: CallLike): RuntimeCode | null {
  if (call.section !== "system") return null
  const arg = call.args[0]?.toU8a(true)
  if (!arg) return null
  switch (call.method) {
    case "setCode":
    case "setCodeWithoutChecks":
      return { hash: blake2AsHex(arg, 256), size: arg.length, via: "setCode" }
    case "authorizeUpgrade":
    case "authorizeUpgradeWithoutChecks":
      return arg.length === 32 ? { hash: u8aToHex(arg), size: null, via: "authorizeUpgrade" } : null
    default:
      return null
  }
}
