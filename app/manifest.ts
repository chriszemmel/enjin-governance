import type { MetadataRoute } from "next"
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config"

/**
 * /manifest.webmanifest - lets browsers install the site. Colours match the
 * default dark theme (the dark themeColor in app/layout.tsx); the icon is
 * the site favicon, a square SVG that scales to any size.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: "Enjin Gov",
    description: APP_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0a0820",
    theme_color: "#0a0820",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  }
}
