import type { Metadata } from "next"
import { APP_DESCRIPTION, APP_TITLE } from "@/lib/config"
import { HomePage } from "./home-page"

// The page is a client component, so its metadata lives in this wrapper.
export const metadata: Metadata = {
  // The tagline as it is, without the " | Enjin Governance" template.
  title: { absolute: APP_TITLE },
  description: APP_DESCRIPTION,
  alternates: { canonical: "/" },
}

export default function Page() {
  return <HomePage />
}
