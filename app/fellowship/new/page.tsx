import { redirect } from "next/navigation"

/**
 * Fellowship referenda are filed in the advanced composer's Fellowship
 * chamber, with their EGOV1 record like any proposal.
 */
export default async function NewFellowshipReferendumPage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string }>
}) {
  const { network } = await searchParams
  const q = new URLSearchParams({ chamber: "fellowship" })
  if (network) q.set("network", network)
  redirect(`/create/advanced?${q}`)
}
