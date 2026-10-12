import { pageMetadata } from "@/lib/seo/metadata"

// The page is a client component, so its metadata lives here.
export const metadata = pageMetadata({
  title: "Report a security issue",
  description:
    "Found a vulnerability in this governance interface? Report it privately, so it can be fixed before the details are public.",
  path: "/security",
})

export default function SecurityLayout({ children }: { children: React.ReactNode }) {
  return children
}
