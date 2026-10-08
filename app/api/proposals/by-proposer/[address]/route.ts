/**
 * GET /api/proposals/by-proposer/[address]?network=<chain-id>
 *
 * Lists proposals filed by an SS58 address on a specific network.
 * Used by the create wizard to show "Your drafts" so the user can
 * cancel stuck ones (e.g. a Stage that never finalised).
 *
 * Unsigned drafts are private: only the proposer, signed in, sees them.
 * Anyone else gets the proposals that reached the chain.
 *
 * The address may come in any SS58 format (an extension hands out its own,
 * often the generic `5…`); rows are found in the formats they are stored in.
 */

import { NextResponse, type NextRequest } from "next/server"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import { z } from "zod"
import { getCurrentUser } from "@/lib/auth/current-user"
import type { ChainId } from "@/lib/chain/chains"
import { encodeForChain, initializeWasm, isValidSs58, samePublicKey } from "@/lib/chain/ss58"
import { isDbConfigured } from "@/lib/db/client"
import { listProposalsByProposer } from "@/lib/db/proposals"
import { noStore } from "@/lib/http/no-store"

export const runtime = "nodejs"

/** The generic Substrate format (`5…`), the usual one from an extension. */
const GENERIC_SS58_PREFIX = 42

/**
 * The formats a proposer's address can be stored in. The composers store
 * the network's own (`encodeForChain`); advanced drafts from before that
 * kept the wallet's own, usually the generic one. The column is matched
 * exactly, so the query asks for each.
 */
function storedForms(address: string, network: ChainId): string[] {
  return [
    ...new Set([
      encodeForChain(address, network),
      encodeAddress(decodeAddress(address), GENERIC_SS58_PREFIX),
      address,
    ]),
  ]
}

const NETWORK_VALUES = [
  "enjin-relay",
  "enjin-matrix",
  "canary-relay",
  "canary-matrix",
] as const

async function getHandler(
  request: NextRequest,
  context: { params: Promise<{ address: string }> },
): Promise<NextResponse> {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured" },
      { status: 503 },
    )
  }

  const { address } = await context.params
  await initializeWasm()
  if (!address || !isValidSs58(address)) {
    return NextResponse.json(
      { ok: false, error: "Invalid address" },
      { status: 400 },
    )
  }

  const url = new URL(request.url)
  const network = z.enum(NETWORK_VALUES).safeParse(url.searchParams.get("network"))
  if (!network.success) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid `network` query param" },
      { status: 400 },
    )
  }

  const [rows, me] = await Promise.all([
    listProposalsByProposer(network.data, storedForms(address, network.data)),
    getCurrentUser().catch(() => null),
  ])
  let isOwner = false
  try {
    isOwner = me != null && samePublicKey(me.address, address)
  } catch {
    isOwner = false
  }
  return NextResponse.json({
    ok: true,
    items: rows
      .filter((r) => isOwner || r.status === "on_chain")
      .map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        referendum_index: r.referendum_index,
        tx_hash: r.tx_hash,
        json_url: r.json_url,
        created_at: r.created_at,
        // Treasury drafts resume in the wizard; advanced ones carry no spend.
        is_treasury: r.amount_planck != null,
      })),
  })
}

// Personal: depends on the session cookie.
export const GET = noStore(getHandler)
