import { pageMetadata } from "@/lib/seo/metadata"

// The page is a client component, so its metadata lives here.
export const metadata = pageMetadata({
  title: "Treasury",
  description:
    "The Enjin treasury on chain: balance, spend tiers and treasury referenda. File a treasury request from the same place.",
  path: "/treasury",
})

export default function TreasuryLayout({ children }: { children: React.ReactNode }) {
  return children
}
