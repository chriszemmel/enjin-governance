/**
 * Which wallets on this device have signed in with a moderation role, so
 * the menu can show Moderation as soon as such a wallet connects, before it
 * signs in again. Kept in the browser only, by public key (one entry covers
 * every network prefix); the server is never asked about a wallet that
 * hasn't signed in. Only a hint for the menu: the moderation page and its
 * routes still check the session.
 */

import { u8aToHex } from "@polkadot/util"
import { decodeAddress } from "@polkadot/util-crypto"

const STORAGE_KEY = "enjin-governance:moderator-wallets"
/** Plenty for the few wallets one person uses; older entries drop out. */
const MAX_ENTRIES = 10

type HintStorage = Pick<Storage, "getItem" | "setItem">

function keyOf(address: string): string | null {
  try {
    return u8aToHex(decodeAddress(address))
  } catch {
    return null
  }
}

function read(storage: HintStorage): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []
  } catch {
    return []
  }
}

function write(storage: HintStorage, keys: string[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-MAX_ENTRIES)))
  } catch {
    /* private mode or full storage: the menu waits for the sign-in */
  }
}

/** True when this wallet signed in with a role on this device before. */
export function hasModeratorHint(storage: HintStorage, address: string): boolean {
  const key = keyOf(address)
  return key != null && read(storage).includes(key)
}

/**
 * Record what the signed-in session's role turned out to be: remember a
 * moderator or admin, forget a wallet whose role was taken away.
 */
export function rememberModeratorRole(
  storage: HintStorage,
  address: string,
  isModerator: boolean,
): void {
  const key = keyOf(address)
  if (!key) return
  const keys = read(storage).filter((k) => k !== key)
  if (isModerator) keys.push(key)
  write(storage, keys)
}

/** window.localStorage, or null where it can't be reached. */
export function browserHintStorage(): HintStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}
