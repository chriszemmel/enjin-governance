import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "@/components/layout/toaster"
import { QueryProvider } from "@/lib/query/provider"
import { WalletRestoreMounter } from "@/lib/wallet/restore-mounter"
import { env } from "@/lib/env"
import { APP_DESCRIPTION, APP_NAME, APP_TITLE } from "@/lib/config"
import { JsonLd, siteJsonLd } from "@/lib/seo/json-ld"
import { OPEN_GRAPH_BASE, TITLE_TEMPLATE } from "@/lib/seo/metadata"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  // The default title is the long-form tagline - that's what social
  // unfurlers see for the root page and what falls back through the
  // template for anything without a per-route override. Per-route
  // pages set their own short title (e.g. "Proposals") which the
  // template renders as "Proposals | Enjin Governance".
  title: {
    default: APP_TITLE,
    template: TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  keywords: [
    "Enjin",
    "governance",
    "OpenGov",
    "Polkadot",
    "Substrate",
    "blockchain",
    "voting",
    "proposals",
    "treasury",
    "referenda",
    "ENJ",
  ],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
  // No title, description or url here: Next fills og:title/description and
  // the Twitter ones from each page's own title and description, and the
  // image from the nearest opengraph-image. Setting them here would give
  // every page the home page's preview (and og:url would point shares of
  // any page at the home page).
  openGraph: OPEN_GRAPH_BASE,
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0820" },
  ],
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="font-sans antialiased min-h-screen bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <WalletRestoreMounter />
            {children}
            <Toaster />
          </QueryProvider>
        </ThemeProvider>
        {/* Names the site and its publisher for search engines. */}
        <JsonLd data={siteJsonLd()} />
      </body>
    </html>
  )
}
