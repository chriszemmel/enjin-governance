"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileText, X } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import type { ProposalMedia } from "@/lib/governance/proposal-media"
import { cn } from "@/lib/utils"

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Thumbnail that falls back to the full image when no thumbnail exists
 * (uploads from before thumbnails were generated).
 */
export function MediaThumb({ media, className }: { media: ProposalMedia; className?: string }) {
  const [src, setSrc] = useState(media.thumbSrc ?? media.src)
  return (
    <img
      src={src}
      alt={media.name}
      loading="lazy"
      onError={() => {
        if (src !== media.src) setSrc(media.src)
      }}
      className={className}
    />
  )
}

/**
 * Attachments of a proposal: images as a thumbnail grid that opens the
 * full-screen viewer, other files (PDFs) as tiles that open the file.
 */
export function AttachmentGallery({
  media,
  onOpenImage,
}: {
  media: readonly ProposalMedia[]
  onOpenImage: (m: ProposalMedia) => void
}) {
  if (media.length === 0) return null
  return (
    <div className="pt-3 border-t border-border">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Attachments ({media.length})
      </p>
      <ul className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {media.map((m) => (
          <li key={m.key}>
            {m.isImage ? (
              <button
                type="button"
                onClick={() => onOpenImage(m)}
                title={m.name}
                className="block w-full aspect-square rounded-xl overflow-hidden border border-border bg-surface-1 hover:border-primary/50 transition-colors cursor-zoom-in"
              >
                <MediaThumb media={m} className="w-full h-full object-cover" />
              </button>
            ) : (
              <a
                href={m.src}
                target="_blank"
                rel="noopener noreferrer"
                title={m.name}
                className="flex w-full aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-surface-1 p-2 hover:border-primary/50 transition-colors"
              >
                <span className="flex h-9 w-8 items-center justify-center rounded-md border border-red-500/30 bg-red-500/10">
                  <FileText className="w-4 h-4 text-red-500" />
                </span>
                <span className="w-full truncate text-center text-[11px] text-foreground">{m.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{formatBytes(m.size_bytes)}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Full-screen image viewer: swipe or arrow keys between the proposal's
 * images, caption with file details, open or download the original.
 */
export function ImageLightbox({
  images,
  current,
  onChange,
}: {
  images: readonly ProposalMedia[]
  current: ProposalMedia | null
  onChange: (m: ProposalMedia | null) => void
}) {
  const index = current ? images.findIndex((m) => m.key === current.key) : -1
  const touchX = useRef<number | null>(null)
  const go = (delta: number) => {
    if (index < 0 || images.length < 2) return
    onChange(images[(index + delta + images.length) % images.length]!)
  }

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const m = index >= 0 ? images[index]! : null

  return (
    <Dialog open={m != null} onOpenChange={(open) => !open && onChange(null)}>
      <DialogContent
        showCloseButton={false}
        className="max-w-none sm:max-w-none w-screen h-[100dvh] p-0 gap-0 rounded-none border-0 bg-black/95 text-white flex flex-col"
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(e) => {
          const start = touchX.current
          const end = e.changedTouches[0]?.clientX
          touchX.current = null
          if (start == null || end == null) return
          if (Math.abs(end - start) > 50) go(end < start ? 1 : -1)
        }}
      >
        {m && (
          <>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="text-sm text-white/70">
                {index + 1} of {images.length}
              </span>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative flex-1 min-h-0 flex items-center justify-center px-2">
              <img
                src={m.src}
                alt={m.name}
                className="max-w-full max-h-full object-contain select-none"
                draggable={false}
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center"
                    aria-label="Next image"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            <div className="px-5 pt-3 pb-6 space-y-3">
              {images.length > 1 && (
                <div className="flex justify-center gap-1.5">
                  {images.map((img, i) => (
                    <span
                      key={img.key}
                      className={cn("w-1.5 h-1.5 rounded-full", i === index ? "bg-white" : "bg-white/35")}
                    />
                  ))}
                </div>
              )}
              <div>
                <DialogTitle className="text-base font-semibold text-white break-all">{m.name}</DialogTitle>
                <DialogDescription className="font-mono text-xs text-white/60 mt-0.5">
                  {formatBytes(m.size_bytes)} · sha256 {m.sha256.slice(0, 4)}…{m.sha256.slice(-4)}
                </DialogDescription>
              </div>
              <div className="grid grid-cols-2 gap-2 max-w-md">
                <a
                  href={m.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm hover:bg-white/20"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open original
                </a>
                <a
                  href={m.src}
                  download={m.name}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm hover:bg-white/20"
                >
                  <Download className="w-4 h-4" />
                  Download
                </a>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
