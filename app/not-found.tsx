import Link from "next/link"
import { ArrowLeft, FileQuestion } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center mx-auto mb-6">
          <FileQuestion className="w-8 h-8 text-muted-foreground" />
        </div>
        
        <h1 className="text-2xl font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-muted-foreground leading-relaxed mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-surface-1 hover:border-purple-border transition-all duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Go home
          </Link>
          <Link
            href="/proposals"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-purple-dim transition-all duration-200 glow-purple-sm"
          >
            View Proposals
          </Link>
        </div>
      </div>
    </div>
  )
}
