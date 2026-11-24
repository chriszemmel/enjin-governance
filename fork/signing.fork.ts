import { afterAll, beforeAll, describe, expect, inject, it } from "vitest"
import { stringToHex, stringToU8a, u8aConcat } from "@polkadot/util"
import {
  buildDelegate,
  buildRemoveVote,
  buildSplitAbstainVote,
  buildUndelegate,
  buildUnlock,
  buildVote,
  getAccountLocks,
  getDelegationsFor,
  getMyVotesOnPoll,
  listVotesOnPoll,
  sEnjCurrency,
} from "@/lib/governance/conviction-voting"
import { getPreimage } from "@/lib/governance/preimage"
import { buildRemarkPayload } from "@/lib/governance/proposal-metadata"
import {
  buildPlaceDecisionDeposit,
  buildSubmit,
  extractReferendumIndex,
  getReferendum,
  getReferendumCount,
  getReferendumMetadata,
} from "@/lib/governance/referenda"
import { buildTreasuryProposal } from "@/lib/governance/submit-treasury-proposal"
import { ENJIN_SPEND_LIMITS } from "@/lib/governance/treasury"
import { CHAINS } from "@/lib/chain/chains"
import { constEntry, txCall } from "@/lib/chain/runtime"
import { defined } from "@/test/defined"
import {
  connectFork,
  decodePayloadCall,
  ENJ,
  eventNames,
  signAndInclude,
  storedVote,
  type Fork,
} from "./chain"

/**
 * For each place the app signs, on a fork of Enjin Relay mainnet: the
 * values the UI shows are built with the app's own builder, signed through
 * a payload-signing wallet, included in a block, and read back with the
 * app's own readers. Three things must agree:
 *
 *   1. the payload the wallet signs carries exactly the built call;
 *   2. the block contains exactly that call;
 *   3. the chain state afterwards is what the UI said would happen.
 */

const ROOT_TRACK = 0
const SMALL_TIPPER = 200
const BIG_TIPPER = 201

let fork: Fork
let referendum: number

beforeAll(async () => {
  fork = await connectFork(inject("forkWs"))
  // A referendum of our own on the root track, so votes have a poll that
  // is Ongoing whatever mainnet has open right now.
  const remark = txCall(fork.api, "system", "remark")(stringToHex("fork check")).method
  const submitted = await signAndInclude(
    fork,
    buildSubmit(fork.api, {
      origin: { System: "Root" },
      proposal: { inline: remark.toU8a() },
      enactment: { type: "After", block: 0 },
    }),
    fork.alice,
  )
  expect(submitted.ok, submitted.error ?? "").toBe(true)
  referendum = defined(extractReferendumIndex(submitted.events), "referendum index")
})

afterAll(async () => {
  await fork?.api.disconnect()
})

/** The wallet saw the built call, and the block holds the same bytes. */
function expectSignedAsBuilt(
  tx: { method: { toHex: () => string } },
  included: Awaited<ReturnType<typeof signAndInclude>>,
) {
  expect(included.payload.method).toBe(tx.method.toHex())
  expect(included.includedMethod).toBe(tx.method.toHex())
  expect(included.ok, included.error ?? "").toBe(true)
}

describe("vote panel", () => {
  it("Aye 12.5 ENJ at 3x: signed, included, and stored as shown", async () => {
    const tx = buildVote(fork.api, {
      pollIndex: referendum,
      aye: true,
      balance: (125n * ENJ) / 10n,
      conviction: "Locked3x",
    })
    const included = await signAndInclude(fork, tx, fork.alice)
    expectSignedAsBuilt(tx, included)
    expect(decodePayloadCall(fork, included.payload)).toMatchObject({
      section: "convictionVoting",
      method: "vote",
    })
    expect(eventNames(included)).toContain("convictionVoting.Voted")

    expect(await storedVote(fork, fork.alice.address, ROOT_TRACK, referendum)).toEqual({
      type: "Standard",
      aye: true,
      conviction: "Locked3x",
      balance: (125n * ENJ) / 10n,
    })
  })

  it("Abstain 20 ENJ: a SplitAbstain of the full amount, no conviction", async () => {
    const tx = buildSplitAbstainVote(fork.api, {
      pollIndex: referendum,
      aye: 0n,
      nay: 0n,
      abstain: 20n * ENJ,
    })
    const included = await signAndInclude(fork, tx, fork.bob)
    expectSignedAsBuilt(tx, included)

    expect(await storedVote(fork, fork.bob.address, ROOT_TRACK, referendum)).toEqual({
      type: "SplitAbstain",
      aye: 0n,
      nay: 0n,
      abstain: 20n * ENJ,
    })
  })

  // Spec 1082 stores a casting vote as `{ vote, counted }`; the app's own
  // readers must see the same votes as the independent decoder above
  // (docs/security/tx-signing-review.md, F1).
  it("the app reads the stored vote back: vote panel, voter list, locks", async () => {
    const [mine] = await getMyVotesOnPoll(fork.api, fork.alice.address, ROOT_TRACK, referendum)
    expect(defined(mine).vote).toEqual({
      type: "Standard",
      pollIndex: referendum,
      trackId: ROOT_TRACK,
      aye: true,
      balance: (125n * ENJ) / 10n,
      conviction: "Locked3x",
    })

    const voters = await listVotesOnPoll(fork.api, referendum)
    const byVoter = new Map(voters.map((v) => [v.voter, v.vote]))
    expect(byVoter.get(fork.alice.address)).toMatchObject({ type: "Standard", aye: true })
    expect(byVoter.get(fork.bob.address)).toMatchObject({
      type: "SplitAbstain",
      abstain: 20n * ENJ,
    })

    const bobLock = defined(
      (await getAccountLocks(fork.api, fork.bob.address)).find((l) => l.trackId === ROOT_TRACK),
    )
    expect(bobLock.activeVotes).toEqual([
      { pollIndex: referendum, balance: 20n * ENJ, conviction: "None", aye: false },
    ])
  })

  it("encodes an sENJ vote with the pool's token id as the currency", () => {
    const tx = buildVote(fork.api, {
      pollIndex: referendum,
      aye: false,
      balance: 1n * ENJ,
      conviction: "Locked1x",
      currency: sEnjCurrency(7),
    })
    const call = fork.api.createType("Call", tx.method.toHex())
    expect(call.args[2]?.toJSON()).toEqual({ sEnj: { tokenId: 7 } })
  })

  it("removes the vote on its track and in its currency", async () => {
    const tx = buildRemoveVote(fork.api, ROOT_TRACK, referendum, { Enj: null })
    const included = await signAndInclude(fork, tx, fork.alice)
    expectSignedAsBuilt(tx, included)

    expect(await storedVote(fork, fork.alice.address, ROOT_TRACK, referendum)).toBeNull()
    // The class lock stays until unlock is called.
    const locks = await getAccountLocks(fork.api, fork.alice.address)
    const lock = defined(
      locks.find((l) => l.trackId === ROOT_TRACK),
      "root lock",
    )
    expect(lock.locked).toBe((125n * ENJ) / 10n)
    expect(lock.activeVotes).toEqual([])
  })

  it("unlock frees it: a vote removed while the referendum is ongoing leaves no conviction lock", async () => {
    const tx = buildUnlock(fork.api, ROOT_TRACK, fork.alice.address)
    const included = await signAndInclude(fork, tx, fork.alice)
    expectSignedAsBuilt(tx, included)
    const locks = await getAccountLocks(fork.api, fork.alice.address)
    expect(locks.find((l) => l.trackId === ROOT_TRACK)).toBeUndefined()
  })
})

describe("delegation panel", () => {
  it("All tracks: one batchAll of a delegate per track, stored as shown", async () => {
    const delegate = (trackId: number) =>
      buildDelegate(fork.api, {
        trackId,
        to: fork.dave.address,
        conviction: "Locked2x",
        balance: 10n * ENJ,
      })
    // What useExtrinsic does with the form's array of calls.
    const tx = txCall(
      fork.api,
      "utility",
      "batchAll",
    )([delegate(SMALL_TIPPER), delegate(BIG_TIPPER)])
    const included = await signAndInclude(fork, tx, fork.charlie)
    expectSignedAsBuilt(tx, included)
    expect(eventNames(included).filter((n) => n === "convictionVoting.Delegated")).toHaveLength(2)

    const delegations = await getDelegationsFor(fork.api, fork.charlie.address)
    expect(
      delegations.map(({ trackId, target, balance, conviction }) => ({
        trackId,
        target,
        balance,
        conviction,
      })),
    ).toEqual([
      {
        trackId: SMALL_TIPPER,
        target: fork.dave.address,
        balance: 10n * ENJ,
        conviction: "Locked2x",
      },
      {
        trackId: BIG_TIPPER,
        target: fork.dave.address,
        balance: 10n * ENJ,
        conviction: "Locked2x",
      },
    ])
  })

  it("Undelegate removes only that track's delegation", async () => {
    const tx = buildUndelegate(fork.api, SMALL_TIPPER, { Enj: null })
    const included = await signAndInclude(fork, tx, fork.charlie)
    expectSignedAsBuilt(tx, included)
    const delegations = await getDelegationsFor(fork.api, fork.charlie.address)
    expect(delegations.map((d) => d.trackId)).toEqual([BIG_TIPPER])
  })
})

describe("deposits", () => {
  it("places the decision deposit on exactly the referendum shown", async () => {
    const tx = buildPlaceDecisionDeposit(fork.api, referendum)
    const included = await signAndInclude(fork, tx, fork.bob)
    expectSignedAsBuilt(tx, included)
    const ref = await getReferendum(fork.api, referendum)
    const status = defined(ref).status
    expect(status.type).toBe("Ongoing")
    if (status.type !== "Ongoing") return
    expect(defined(status.decisionDeposit).who).toBe(fork.bob.address)
  })
})

describe("treasury proposal", () => {
  it("files the spend, its preimage and its metadata in one batch, as previewed", async () => {
    const tier = defined(defined(ENJIN_SPEND_LIMITS.at(-1)).tiers[0], "SmallTipper tier")
    const amount = 50n * ENJ
    const index = await getReferendumCount(fork.api)
    const envelope = buildRemarkPayload("https://example.org/p.json", "ab".repeat(32))
    const built = buildTreasuryProposal(fork.api, {
      amount,
      beneficiary: fork.dave.address,
      tier,
      remarkPayload: envelope,
      referendumIndex: index,
    })
    const tx = txCall(fork.api, "utility", "batchAll")(built.calls)
    const included = await signAndInclude(fork, tx, fork.alice)
    expectSignedAsBuilt(tx, included)

    // The referendum: on the tier's track, pointing at the previewed preimage.
    const ref = defined(await getReferendum(fork.api, index))
    expect(ref.trackId).toBe(SMALL_TIPPER)
    if (ref.status.type !== "Ongoing") throw new Error("not ongoing")
    expect(ref.status.proposal).toEqual({ hash: built.preimageHash, len: built.preimageLen })

    // The preimage is the spend the user saw: spendLocal(amount, beneficiary).
    const preimage = defined(
      await getPreimage(fork.api, { hash: built.preimageHash, len: built.preimageLen }),
    )
    const spend = fork.api.createType("Call", preimage.bytes)
    expect(`${spend.section}.${spend.method}`).toBe("treasury.spendLocal")
    expect(BigInt(spend.args[0]?.toString() ?? "0")).toBe(amount)
    expect(fork.api.createType("AccountId", spend.args[1]?.toU8a().slice(-32)).toString()).toBe(
      fork.api.createType("AccountId", fork.dave.publicKey).toString(),
    )

    // The metadata binds the envelope the app wrote.
    expect(await getReferendumMetadata(fork.api, index)).toEqual({
      u: "https://example.org/p.json",
      h: "ab".repeat(32),
    })
  })
})

describe("treasury top-up", () => {
  it("the configured treasury address is the treasury pallet's account, and gets the exact amount", async () => {
    const palletId = defined(constEntry(fork.api, "treasury", "palletId"), "treasury.palletId")
    const account = new Uint8Array(32)
    account.set(u8aConcat(stringToU8a("modl"), palletId.toU8a()))
    const treasury = fork.api.createType("AccountId", account).toString()
    const configured = CHAINS["enjin-relay"].treasuryAddress
    expect(fork.api.createType("AccountId", configured).toString()).toBe(treasury)

    // What TopUpTreasuryButton builds for "0.123456789123456789".
    const amount = 123_456_789_123_456_789n
    const tx = txCall(fork.api, "balances", "transferKeepAlive")(configured, amount)
    const included = await signAndInclude(fork, tx, fork.bob)
    expectSignedAsBuilt(tx, included)
    // The transfer itself, exactly. (The treasury's balance grows by more:
    // part of every fee goes to it as well.)
    const transfer = defined(
      included.events.find(
        ({ event }) => event.section === "balances" && event.method === "Transfer",
      ),
      "balances.Transfer",
    ).event.data.map((field) => field.toString())
    expect(transfer).toEqual([fork.bob.address, treasury, amount.toString()])
  })
})
