import { pageMetadata } from "@/lib/seo/metadata"

// The list page is a client component, so its metadata lives here. The
// referendum pages below set their own (see [index]/layout.tsx).
export const metadata = pageMetadata({
  title: "Proposals",
  description:
    "Every Enjin referendum, live from the chain: status, tally, voters and conviction. Browse without connecting a wallet.",
  path: "/proposals",
})

export default function ProposalsLayout({ children }: { children: React.ReactNode }) {
  return children
}
