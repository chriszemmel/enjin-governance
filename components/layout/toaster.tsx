"use client"

import { useTheme } from "next-themes"
import { Toaster as SonnerToaster } from "sonner"

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
      toastOptions={{
        classNames: {
          toast: "rounded-xl",
        },
      }}
    />
  )
}
