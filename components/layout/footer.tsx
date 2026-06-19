import Link from "next/link"
import { EnjinLogo } from "@/components/layout/enjin-logo"

export function Footer() {
  return (
    <footer className="border-t border-border px-4 sm:px-6 lg:px-8 py-8 mt-auto">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 opacity-60">
          <EnjinLogo className="h-4 w-auto" />
          <span className="text-xs text-muted-foreground">Governance</span>
        </div>
        <nav className="flex items-center gap-6 text-xs text-muted-foreground" aria-label="Footer navigation">
          <a 
            href="https://enjin.io" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="hover:text-foreground transition-colors"
          >
            Enjin.io
          </a>
          <Link href="/proposals" className="hover:text-foreground transition-colors">
            Proposals
          </Link>
          <Link href="/treasury" className="hover:text-foreground transition-colors">
            Treasury
          </Link>
          <Link href="/docs" className="hover:text-foreground transition-colors">
            Docs
          </Link>
          <Link href="/security" className="hover:text-foreground transition-colors">
            Security
          </Link>
        </nav>
      </div>
    </footer>
  )
}
