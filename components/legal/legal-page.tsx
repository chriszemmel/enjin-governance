import type { ReactNode } from "react"
import { Nav } from "@/components/layout/nav"
import { Footer } from "@/components/layout/footer"

/** Shared frame for Imprint, Privacy and Terms. */
export function LegalPage({
  title,
  subtitle,
  updated,
  children,
}: {
  title: string
  subtitle?: string
  updated: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Nav />
      <main className="pt-24 pb-24 px-4 sm:px-6 lg:px-8 flex-1">
        <article className="max-w-3xl mx-auto space-y-6 text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere] [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:pt-4 [&_h3]:font-semibold [&_h3]:text-foreground [&_a]:text-primary [&_a:hover]:text-purple-dim [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
            <p className="text-xs text-muted-foreground">Last updated: {updated}</p>
          </header>
          {children}
        </article>
      </main>
      <Footer />
    </div>
  )
}
