/**
 * Helpers for the fork checks: a connection to the Chopsticks fork, funded
 * dev accounts, and `signAndInclude`, which signs an extrinsic the way a
 * wallet does (through `signPayload`, keeping the payload it was handed),
 * puts it in a block and returns what the chain made of it.
 */

import { ApiPromise, Keyring, WsProvider } from "@polkadot/api"
import type { SubmittableExtrinsic } from "@polkadot/api/types"
import type { Vec } from "@polkadot/types"
import type { EventRecord } from "@polkadot/types/interfaces"
import type { SignerPayloadJSON } from "@polkadot/types/types"
import { cryptoWaitReady } from "@polkadot/util-crypto"
import { decodeDispatchError } from "@/lib/chain/events"
import { queryEntry } from "@/lib/chain/runtime"

type KeyringPair = ReturnType<Keyring["addFromUri"]>

const ENJIN_SS58 = 2135
export const ENJ = 10n ** 18n

export type Fork = {
  api: ApiPromise
  provider: WsProvider
  alice: KeyringPair
  bob: KeyringPair
  charlie: KeyringPair
  dave: KeyringPair
}

export async function connectFork(ws: string): Promise<Fork> {
  await cryptoWaitReady()
  const provider = new WsProvider(ws)
  const api = await ApiPromise.create({ provider, noInitWarn: true })
  const keyring = new Keyring({ type: "sr25519", ss58Format: ENJIN_SS58 })
  const fork: Fork = {
    api,
    provider,
    alice: keyring.addFromUri("//Alice"),
    bob: keyring.addFromUri("//Bob"),
    charlie: keyring.addFromUri("//Charlie"),
    dave: keyring.addFromUri("//Dave"),
  }
  // Enough for the root track's decision deposit as well as the votes.
  await fund(fork, [fork.alice, fork.bob, fork.charlie, fork.dave], 100_000_000n * ENJ)
  return fork
}

/** Give each account `free` ENJ, straight into storage. */
async function fund(fork: Fork, pairs: KeyringPair[], free: bigint) {
  await fork.provider.send("dev_setStorage", [
    {
      System: {
        Account: pairs.map((p) => [[p.address], { providers: 1, data: { free: free.toString() } }]),
      },
    },
  ])
}

export async function newBlock(fork: Fork): Promise<`0x${string}`> {
  const hash = (await fork.provider.send("dev_newBlock", [{ count: 1 }])) as `0x${string}`
  return hash
}

export type Included = {
  /** The payload the "wallet" was asked to sign. */
  payload: SignerPayloadJSON
  /** The call bytes of the extrinsic found in the block. */
  includedMethod: `0x${string}`
  /** This extrinsic's events, in order (`section.method`). */
  events: EventRecord[]
  ok: boolean
  /** The dispatch error, decoded, when !ok. */
  error: string | null
}

/**
 * Sign `tx` as `pair` through a payload-signing wallet, include it in a new
 * block, and report the payload, the included call and its events.
 */
export async function signAndInclude(
  fork: Fork,
  tx: SubmittableExtrinsic<"promise">,
  pair: KeyringPair,
): Promise<Included> {
  const { api } = fork
  let payload: SignerPayloadJSON | null = null
  const signer = {
    signPayload: async (p: SignerPayloadJSON) => {
      payload = p
      const raw = api.registry.createType("ExtrinsicPayload", p, { version: p.version })
      return { id: 1, signature: raw.sign(pair).signature }
    },
  }
  await tx.signAsync(pair.address, { signer, era: 64 })
  const signedPayload: SignerPayloadJSON | null = payload
  if (!signedPayload) throw new Error("the signer was never asked to sign")
  const txHash = tx.hash.toHex()
  await tx.send()
  const blockHash = await newBlock(fork)

  const block = await api.rpc.chain.getBlock(blockHash)
  const index = block.block.extrinsics.findIndex((e) => e.hash.toHex() === txHash)
  const included = block.block.extrinsics[index]
  if (!included) throw new Error(`extrinsic ${txHash} is not in block ${blockHash}`)

  const at = await api.at(blockHash)
  const raw = await queryEntry(at, "system", "events")()
  const all = api.createType<Vec<EventRecord>>("Vec<EventRecord>", raw.toU8a())
  const events: EventRecord[] = all.filter(
    (r) => r.phase.isApplyExtrinsic && r.phase.asApplyExtrinsic.eq(index),
  )
  const failed = events.find(
    ({ event }) => event.section === "system" && event.method === "ExtrinsicFailed",
  )
  const error = failed
    ? decodeDispatchError(api, api.createType("DispatchError", failed.event.data[0]))
    : null
  return {
    payload: signedPayload,
    includedMethod: included.method.toHex(),
    events,
    ok: !failed,
    error,
  }
}

/** `section.method` of each event, in order. */
export function eventNames(included: Included): string[] {
  return included.events.map(({ event }) => `${event.section}.${event.method}`)
}

/** The call a payload carries, decoded with the fork's metadata, as JSON. */
export function decodePayloadCall(fork: Fork, payload: SignerPayloadJSON) {
  const call = fork.api.createType("Call", payload.method)
  return { section: call.section, method: call.method, args: call.args.map((a) => a.toJSON()) }
}

const CONVICTIONS = ["None", "Locked1x", "Locked2x", "Locked3x", "Locked4x", "Locked5x", "Locked6x"]

type StoredVote =
  | { type: "Standard"; aye: boolean; conviction: string; balance: bigint }
  | { type: "Split"; aye: bigint; nay: bigint }
  | { type: "SplitAbstain"; aye: bigint; nay: bigint; abstain: bigint }

/**
 * The vote `who` has stored on `poll`, read from `convictionVoting.votingFor`
 * as JSON and decoded here - independently of the app's readers, so a check
 * doesn't lean on the code it checks. Handles both record shapes: a bare
 * `AccountVote` (spec 1080 and before) and `{ vote, counted }` (spec 1082).
 */
export async function storedVote(
  fork: Fork,
  who: string,
  track: number,
  poll: number,
): Promise<StoredVote | null> {
  const raw = await fork.api.query.convictionVoting?.votingFor?.(who, track, { Enj: null })
  const json = raw?.toJSON() as
    | { casting?: { votes: Array<[number, Record<string, unknown>]> } }
    | undefined
  const entry = json?.casting?.votes.find(([p]) => p === poll)
  if (!entry) return null
  const record = entry[1]
  const accountVote = (("vote" in record ? record.vote : record) ?? {}) as Record<
    string,
    Record<string, string>
  >
  const big = (x: string | undefined) => BigInt(x ?? "0")
  if (accountVote.standard) {
    const byte = Number(accountVote.standard.vote)
    return {
      type: "Standard",
      aye: (byte & 0x80) !== 0,
      conviction: CONVICTIONS[byte & 0x7f] ?? `#${byte & 0x7f}`,
      balance: big(accountVote.standard.balance),
    }
  }
  if (accountVote.split) {
    return { type: "Split", aye: big(accountVote.split.aye), nay: big(accountVote.split.nay) }
  }
  if (accountVote.splitAbstain) {
    const v = accountVote.splitAbstain
    return { type: "SplitAbstain", aye: big(v.aye), nay: big(v.nay), abstain: big(v.abstain) }
  }
  throw new Error(`unknown vote record: ${JSON.stringify(record)}`)
}

/**
 * Run `tx`'s call at the next block as `origin` (a `PalletsOrigin`, e.g.
 * `{ origins: "MediumSpender" }`), the way a passed referendum's enactment
 * would, by putting it in the scheduler's agenda. Returns the scheduler's
 * dispatch result for it.
 */
export async function dispatchAsOrigin(
  fork: Fork,
  tx: SubmittableExtrinsic<"promise">,
  origin: Record<string, unknown>,
): Promise<{ ok: boolean; events: string[] }> {
  const head = (await fork.api.rpc.chain.getHeader()).number.toNumber()
  const at = head + 1
  await fork.provider.send("dev_setStorage", [
    {
      Scheduler: {
        Agenda: [
          [
            [at],
            [
              {
                maybeId: null,
                priority: 0,
                call: { inline: tx.method.toHex() },
                maybePeriodic: null,
                origin,
              },
            ],
          ],
        ],
      },
    },
  ])
  const hash = await newBlock(fork)
  const atHash = await fork.api.at(hash)
  const raw = await queryEntry(atHash, "system", "events")()
  const events = fork.api.createType<Vec<EventRecord>>("Vec<EventRecord>", raw.toU8a())
  const dispatched = events.find(
    ({ event }) => event.section === "scheduler" && event.method === "Dispatched",
  )
  const result = (dispatched?.event.data as unknown as { result?: { isOk?: boolean } } | undefined)
    ?.result
  return {
    ok: result?.isOk === true,
    events: events.map(({ event }) => `${event.section}.${event.method}`),
  }
}
