import Link from "next/link"
import { EnjinLogo } from "@/components/layout/enjin-logo"
import { env } from "@/lib/env"

const linkClass = "hover:text-foreground transition-colors"

export function Footer() {
  return (
    <footer className="border-t border-border px-4 sm:px-6 lg:px-8 py-8 mt-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 opacity-60">
            <EnjinLogo className="h-4 w-auto" />
            <span className="text-xs text-muted-foreground">Governance</span>
          </div>
          <nav
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground"
            aria-label="Footer navigation"
          >
            <a
              href="https://enjin.io"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Enjin.io
            </a>
            <Link href="/proposals" className={linkClass}>
              Proposals
            </Link>
            <Link href="/treasury" className={linkClass}>
              Treasury
            </Link>
            <Link href="/docs" className={linkClass}>
              Docs
            </Link>
            <Link href="/security" className={linkClass}>
              Security
            </Link>
          </nav>
        </div>

        <div className="flex flex-col items-center gap-3 border-t border-border pt-5 text-center">
          <nav
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground"
            aria-label="Legal"
          >
            <Link href="/imprint" className={linkClass}>
              Imprint
            </Link>
            <Link href="/privacy" className={linkClass}>
              Privacy
            </Link>
            <Link href="/terms" className={linkClass}>
              Terms
            </Link>
            <Link href="/docs#content-policy" className={linkClass}>
              Content policy
            </Link>
            <Link href="/moderation-log" className={linkClass}>
              Moderation log
            </Link>
            <a
              href={env.NEXT_PUBLIC_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              Source code (AGPL-3.0)
            </a>
          </nav>
          <p className="max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
            Independent community interface for Enjin on-chain governance, maintained by{" "}
            {env.NEXT_PUBLIC_SITE_MAINTAINER}. The Enjin Blockchain is developed by Atlas
            Development Services, a core contributor. Not financial advice - transactions are signed
            in your wallet and are final.
          </p>
        </div>
      </div>
    </footer>
  )
}
