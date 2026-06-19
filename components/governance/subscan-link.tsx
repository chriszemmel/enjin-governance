import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"

interface SubscanLinkProps {
  href: string
  /** Accessible label / tooltip. Defaults to "View on Subscan". */
  label?: string
  className?: string
}

/**
 * Small icon-only chip linking to a Subscan page. The icon-button
 * styling marks it as a deliberate destination affordance; the label
 * is exposed via title + aria-label rather than visible text so the
 * chip stays compact in tight badge rows.
 */
export function SubscanLink({
  href,
  label = "View on Subscan",
  className,
}: SubscanLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center rounded-full border border-border bg-surface-1 w-7 h-7 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground",
        className,
      )}
    >
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  )
}
