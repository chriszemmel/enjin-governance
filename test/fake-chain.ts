/**
 * A fake ApiPromise for component tests that drive the real `useExtrinsic`.
 *
 * Every `api.tx.<pallet>.<call>(...)` returns a fake extrinsic that remembers
 * its call and arguments. `signAsync` records exactly which extrinsic was
 * handed to the signer (and for which address), then `send` reports it in a
 * block. So a test can assert on the call the user actually signs, not on
 * what a component meant to build.
 */

import type { ApiPromise } from "@polkadot/api"

type FakeExtrinsic = {
  call: string
  args: unknown[]
  hash: { toHex: () => string }
  signAsync: (
    address: string,
    options: unknown,
  ) => Promise<{ send: (cb: (r: unknown) => void) => Promise<() => void> }>
}

type SignedRecord = { extrinsic: FakeExtrinsic; address: string; options: unknown }

/** Arity per call, as the Enjin runtime declares it (multi-token conviction voting). */
const ENJIN_ARITY: Record<string, Record<string, number>> = {
  convictionVoting: { vote: 3, removeVote: 3, delegate: 5, undelegate: 2, unlock: 3 },
  fellowshipCollective: { vote: 2 },
}

const IN_BLOCK = {
  dispatchError: undefined,
  isError: false,
  events: [],
  status: {
    isBroadcast: false,
    isInBlock: true,
    asInBlock: { toHex: () => "0xb10c" },
    isFinalized: false,
  },
}

export function createFakeChain(opts: { voteLockingPeriod?: number; specVersion?: number } = {}) {
  const signed: SignedRecord[] = []
  /** Make the next N signatures fail, as a wallet rejecting the request would. */
  const controls = { rejectNextSigns: 0 }

  const extrinsic = (call: string, args: unknown[]): FakeExtrinsic => {
    const ex: FakeExtrinsic = {
      call,
      args,
      hash: { toHex: () => `0x${call.replace(/\W/g, "")}` },
      signAsync: async (address, options) => {
        if (controls.rejectNextSigns > 0) {
          controls.rejectNextSigns -= 1
          throw new Error("Rejected in wallet")
        }
        signed.push({ extrinsic: ex, address, options })
        return {
          send: async (cb) => {
            cb(IN_BLOCK)
            return () => {}
          },
        }
      },
    }
    return ex
  }

  const tx: Record<string, Record<string, unknown>> = {}
  for (const [pallet, calls] of Object.entries(ENJIN_ARITY)) {
    tx[pallet] = Object.fromEntries(
      Object.entries(calls).map(([call, arity]) => [
        call,
        Object.assign((...args: unknown[]) => extrinsic(`${pallet}.${call}`, args), {
          meta: { args: { length: arity } },
        }),
      ]),
    )
  }
  tx.utility = { batchAll: (calls: FakeExtrinsic[]) => extrinsic("utility.batchAll", [calls]) }

  const api = {
    isConnected: true,
    tx,
    consts: {
      convictionVoting: {
        voteLockingPeriod: { toNumber: () => opts.voteLockingPeriod ?? 100_800 },
      },
    },
    runtimeVersion: { specVersion: { toNumber: () => opts.specVersion ?? 1080 } },
  } as unknown as ApiPromise

  return { api, signed, controls }
}
