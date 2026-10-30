import type { Metadata } from "next"

// The page sets its title and description; this adds the canonical URL.
export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return children
}
