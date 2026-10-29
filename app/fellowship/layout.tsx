import { pageMetadata } from "@/lib/seo/metadata"

export const metadata = pageMetadata({
  title: "Fellowship",
  description:
    "The Enjin Fellowship, live from the chain: members, ranks and every fellowship referendum. Members vote by rank; anyone can follow.",
  path: "/fellowship",
})

export default function FellowshipLayout({ children }: { children: React.ReactNode }) {
  return children
}
