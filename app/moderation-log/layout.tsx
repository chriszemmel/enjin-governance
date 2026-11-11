import { pageMetadata } from "@/lib/seo/metadata"

// The page is a client component, so its metadata lives here.
export const metadata = pageMetadata({
  title: "Moderation log",
  description:
    "Every moderation action on this site, with its reason. Referenda, votes and on-chain records are never changed.",
  path: "/moderation-log",
})

export default function ModerationLogLayout({ children }: { children: React.ReactNode }) {
  return children
}
