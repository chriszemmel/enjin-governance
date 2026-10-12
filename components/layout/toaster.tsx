"use client"

import { CircleAlert, CircleCheck, Info, Loader2, TriangleAlert } from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as SonnerToaster } from "sonner"

// The app's own icon set (lucide) instead of sonner's built-in glyphs.
const ICONS = {
  success: <CircleCheck className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  warning: <TriangleAlert className="h-4 w-4" />,
  error: <CircleAlert className="h-4 w-4" />,
  loading: <Loader2 className="h-4 w-4 animate-spin" />,
}

/**
 * Wraps sonner's Toaster so it follows the active next-themes color scheme.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme()
  return (
    <SonnerToaster
      theme={(resolvedTheme === "light" ? "light" : "dark") as "light" | "dark"}
      position="bottom-right"
      richColors
      closeButton
      icons={ICONS}
      toastOptions={{
        classNames: {
          toast: "rounded-xl font-sans",
        },
      }}
    />
  )
}
