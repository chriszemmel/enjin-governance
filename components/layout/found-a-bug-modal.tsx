"use client"

import { useState } from "react"
import { ExternalLink, Github, Send } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * "Found a bug?" trigger for the docs Links section. Points to the
 * maintainer's contact channels for general bugs and feedback; security
 * vulnerabilities are routed to the dedicated /security disclosure form.
 */
export function FoundABugModal() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-primary hover:text-purple-dim cursor-pointer"
      >
        Found a bug?
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-3rem)] max-w-[calc(100%-3rem)] sm:max-w-md p-5 sm:p-6 gap-4 rounded-2xl">
          <DialogHeader>
            <DialogTitle>Found a bug?</DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed">
              This Enjin community governance client is maintained by Chris
              Zemmel. For bugs or feedback, the fastest route is direct contact
              below. Found a security vulnerability? Please use the{" "}
              <a href="/security" className="text-primary hover:text-purple-dim">
                security disclosure form
              </a>{" "}
              instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <a
              href="https://t.me/wisdompanda"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-purple-border bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Send className="w-4 h-4 text-primary" />
                <span className="text-foreground">
                  <span className="font-medium">Telegram</span>
                  <span className="text-muted-foreground"> &middot; @wisdompanda</span>
                </span>
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
            <a
              href="https://github.com/chriszemmel"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3 text-sm hover:bg-surface-2 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Github className="w-4 h-4 text-foreground" />
                <span className="text-foreground">
                  <span className="font-medium">GitHub</span>
                  <span className="text-muted-foreground"> &middot; @chriszemmel</span>
                </span>
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
