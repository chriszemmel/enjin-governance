import type { Metadata } from "next"
import { isValidSs58, shortenAddress } from "@/lib/chain/ss58"
import { TITLE_TEMPLATE } from "@/lib/seo/metadata"

type Props = { params: Promise<{ address: string }> }

// Profiles are open to anyone with the link, but a wallet's page isn't
// something to put in search results: noindex, while its links to
// proposals are still followed. No database read, to keep the page fast.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params
  const label = isValidSs58(address) ? shortenAddress(address) : null
  return {
    title: { default: label ? `Profile ${label}` : "Profile", template: TITLE_TEMPLATE },
    description: label
      ? `Governance profile of ${label}: display name and the proposals it submitted.`
      : "Governance profile: display name and submitted proposals.",
    alternates: { canonical: `/user/${encodeURIComponent(address)}` },
    robots: { index: false, follow: true },
  }
}

export default function UserLayout({ children }: { children: React.ReactNode }) {
  return children
}
