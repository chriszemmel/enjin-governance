import { Suspense } from "react"
import { pageMetadata } from "@/lib/seo/metadata"

export const metadata = pageMetadata({
  title: "Fellowship",
  description:
    "The Enjin Fellowship, live from the chain: members, ranks and every fellowship referendum. Members vote by rank; anyone can follow.",
  path: "/fellowship",
})

export default function FellowshipLayout({ children }: { children: React.ReactNode }) {
  // The pages read ?network= (useSearchParams), which needs a boundary.
  return <Suspense>{children}</Suspense>
}
