"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import useEmblaCarousel from "embla-carousel-react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface SwiperSlide {
  /** Stable key + accessible label; also drives the tab text. */
  id: string
  label: string
  header: React.ReactNode
  content: React.ReactNode
}

/**
 * Swipeable carousel that replaces the stacked detail-page cards. Each
 * slide is a self-contained block the caller supplies, so this component
 * stays presentational. Handles any number of slides (Tally · Decision ·
 * Votes today).
 *
 * Mobile: swipe left/right between slides.
 * Desktop: dot indicators + arrow buttons.
 *
 * Heights differ a lot between slides (Tally is short, the Votes slide
 * carries the full voter list). Embla's default flex layout stretches
 * every slide to the tallest, leaving a huge empty column under the short
 * ones. We observe the active slide's height and set the slides-track to
 * match, so the card collapses to the live slide's natural height.
 */
export function TallyVotesSwiper({ slides }: { slides: SwiperSlide[] }) {
  const [emblaRef, embla] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    loop: false,
  })
  const [selected, setSelected] = useState(0)
  const lastIndex = slides.length - 1

  const onSelect = useCallback(() => {
    if (!embla) return
    setSelected(embla.selectedScrollSnap())
  }, [embla])

  useEffect(() => {
    if (!embla) return
    onSelect()
    embla.on("select", onSelect)
    embla.on("reInit", onSelect)
    return () => {
      embla.off("select", onSelect)
      embla.off("reInit", onSelect)
    }
  }, [embla, onSelect])

  const scrollTo = useCallback(
    (idx: number) => {
      embla?.scrollTo(idx)
    },
    [embla],
  )

  // Track the active slide's content height and apply it to the
  // slides-track so embla doesn't stretch the short slide.
  const slideRefs = useRef<Array<HTMLDivElement | null>>([])
  const [trackHeight, setTrackHeight] = useState<number | null>(null)
  useEffect(() => {
    const node = slideRefs.current[selected]
    if (!node || typeof ResizeObserver === "undefined") return
    const measure = () => setTrackHeight(node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [selected])

  // Re-init embla after each height change so the drag bounds match the
  // new track height - without this, the swipe gesture can feel glitchy
  // right after switching slides.
  useEffect(() => {
    embla?.reInit()
  }, [embla, trackHeight])

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {slides.map((slide, i) => (
            <SlideTab
              key={slide.id}
              label={slide.label}
              active={selected === i}
              onClick={() => scrollTo(i)}
            />
          ))}
        </div>
        <div className="hidden sm:flex items-center gap-1">
          <ArrowBtn
            dir="left"
            disabled={selected === 0}
            onClick={() => scrollTo(Math.max(0, selected - 1))}
          />
          <ArrowBtn
            dir="right"
            disabled={selected === lastIndex}
            onClick={() => scrollTo(Math.min(lastIndex, selected + 1))}
          />
        </div>
      </div>

      <div className="overflow-hidden" ref={emblaRef}>
        <div
          className="flex items-start transition-[height] duration-200 ease-out"
          style={trackHeight != null ? { height: trackHeight } : undefined}
        >
          {slides.map((slide, i) => (
            <div key={slide.id} className="flex-[0_0_100%] min-w-0 px-6 pb-6">
              <div
                ref={(el) => {
                  slideRefs.current[i] = el
                }}
                className="space-y-5"
              >
                <div className="flex items-center justify-between">
                  {slide.header}
                </div>
                {slide.content}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dots */}
      <div className="px-6 pt-3 pb-5 flex items-center justify-center gap-1.5">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            onClick={() => scrollTo(i)}
            aria-label={`Slide ${i + 1}: ${slide.label}`}
            className={cn(
              "h-1.5 rounded-full transition-all",
              selected === i ? "w-6 bg-primary" : "w-1.5 bg-border",
            )}
          />
        ))}
      </div>
    </div>
  )
}

function SlideTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
        active
          ? "bg-primary/10 text-foreground border border-purple-border"
          : "text-muted-foreground hover:text-foreground border border-transparent",
      )}
    >
      {label}
    </button>
  )
}

function ArrowBtn({
  dir,
  disabled,
  onClick,
}: {
  dir: "left" | "right"
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-purple-border disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {dir === "left" ? (
        <ChevronLeft className="w-3.5 h-3.5" />
      ) : (
        <ChevronRight className="w-3.5 h-3.5" />
      )}
    </button>
  )
}
