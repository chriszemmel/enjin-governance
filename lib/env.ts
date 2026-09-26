import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

const wssUrl = z.string().regex(/^wss:\/\//, "must be a wss:// URL")
const httpsUrl = z.string().regex(/^https:\/\//, "must be an https:// URL")
const httpOrHttpsUrl = z.string().regex(/^https?:\/\//, "must be an http(s):// URL")

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().optional(),
    DATABASE_URL_UNPOOLED: z.string().url().optional(),
    SUBSCAN_API_KEY: z.string().optional(),
    KV_REST_API_URL: z.string().url().optional(),
    KV_REST_API_TOKEN: z.string().optional(),
    CRON_SECRET: z.string().min(16).optional(),
    SITE_PASSWORD: z.string().min(1).optional(),
    SITE_PASSWORD_STATUS: z.enum(["ON", "OFF"]).default("OFF"),

    // Optional Telegram notification for new security disclosures. When both
    // are set, each report is also posted to the chat (e.g. a shared Enjin
    // team group). Unset = disclosures persist to the DB only.
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_CHAT_ID: z.string().optional(),

    // Moderation: comma-separated wallets (SS58 on any network, or 0x public
    // keys) that are always admins. Admins grant moderator / admin roles to
    // others from /moderation; those grants live in the database.
    GOVERNANCE_ADMIN_PUBLIC_KEYS: z.string().optional(),

    // Legal pages (Imprint / Privacy / Terms). The operator's details live
    // in the environment, not in the repository.
    LEGAL_OPERATOR_NAME: z.string().optional(),
    LEGAL_OPERATOR_ADDRESS: z.string().optional(),
    LEGAL_CONTACT_EMAIL: z.string().default("chris@zyric.de"),
    LEGAL_CONTACT_PHONE: z.string().optional(),
    LEGAL_VAT_ID: z.string().optional(),

    // Automatic content checks (Claude). Needs the key; admins switch the
    // checks on and pick the model at /moderation -> Settings. Uploads are
    // checked before they are stored; text is only flagged for moderators,
    // never hidden automatically.
    ANTHROPIC_API_KEY: z.string().optional(),

    // Cloudflare R2 - bucket `enjin-governance` holds:
    //   proposals/{network}/{uuid}/proposal.json
    //   proposals/{network}/{uuid}/media/{filename}
    //   proposals/{network}/index/{referendum_index}.json
    //   user-avatars/{user_uuid}.png
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().default("enjin-governance"),
    R2_ENDPOINT: httpsUrl.optional(),
    R2_PUBLIC_URL: httpsUrl.optional(),
  },

  client: {
    NEXT_PUBLIC_APP_URL: httpOrHttpsUrl.default("http://localhost:3000"),

    // Shown in the footer. The source link is required by the AGPL for
    // people using the running site.
    NEXT_PUBLIC_SITE_MAINTAINER: z.string().default("Chris Zemmel"),
    NEXT_PUBLIC_SOURCE_URL: httpOrHttpsUrl.default("https://github.com/chriszemmel/enjin-governance"),

    NEXT_PUBLIC_DEFAULT_NETWORK: z
      .enum(["enjin-relay", "canary-relay"])
      .default("canary-relay"),

    NEXT_PUBLIC_ENJIN_RELAY_WSS: wssUrl.default("wss://rpc.relay.blockchain.enjin.io"),
    NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS: wssUrl.default(
      "wss://enjin-relay-rpc.n.dwellir.com",
    ),
    NEXT_PUBLIC_ENJIN_MATRIX_WSS: wssUrl.default("wss://rpc.matrix.blockchain.enjin.io"),
    NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS: wssUrl.default(
      "wss://enjin-matrix-rpc.n.dwellir.com",
    ),
    NEXT_PUBLIC_CANARY_RELAY_WSS: wssUrl.default("wss://rpc.relay.canary.enjin.io"),
    NEXT_PUBLIC_CANARY_MATRIX_WSS: wssUrl.default("wss://rpc.matrix.canary.enjin.io"),

    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
    NEXT_PUBLIC_WALLETCONNECT_RELAY_URL: wssUrl.default("wss://relay.walletconnect.com"),

    NEXT_PUBLIC_ENJIN_SUBSCAN_URL: httpsUrl.default("https://enjin.subscan.io"),
    NEXT_PUBLIC_MATRIX_SUBSCAN_URL: httpsUrl.default("https://matrix.subscan.io"),
    NEXT_PUBLIC_CANARY_SUBSCAN_URL: httpsUrl.default("https://canary.subscan.io"),
    NEXT_PUBLIC_CANARY_MATRIX_SUBSCAN_URL: httpsUrl.default(
      "https://canary-matrix.subscan.io",
    ),
  },

  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    SUBSCAN_API_KEY: process.env.SUBSCAN_API_KEY,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    CRON_SECRET: process.env.CRON_SECRET,
    SITE_PASSWORD: process.env.SITE_PASSWORD,
    SITE_PASSWORD_STATUS: process.env.SITE_PASSWORD_STATUS,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
    GOVERNANCE_ADMIN_PUBLIC_KEYS: process.env.GOVERNANCE_ADMIN_PUBLIC_KEYS,
    LEGAL_OPERATOR_NAME: process.env.LEGAL_OPERATOR_NAME,
    LEGAL_OPERATOR_ADDRESS: process.env.LEGAL_OPERATOR_ADDRESS,
    LEGAL_CONTACT_EMAIL: process.env.LEGAL_CONTACT_EMAIL,
    LEGAL_CONTACT_PHONE: process.env.LEGAL_CONTACT_PHONE,
    LEGAL_VAT_ID: process.env.LEGAL_VAT_ID,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,

    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: process.env.R2_BUCKET,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,

    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SITE_MAINTAINER: process.env.NEXT_PUBLIC_SITE_MAINTAINER,
    NEXT_PUBLIC_SOURCE_URL: process.env.NEXT_PUBLIC_SOURCE_URL,
    NEXT_PUBLIC_DEFAULT_NETWORK: process.env.NEXT_PUBLIC_DEFAULT_NETWORK,
    NEXT_PUBLIC_ENJIN_RELAY_WSS: process.env.NEXT_PUBLIC_ENJIN_RELAY_WSS,
    NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS: process.env.NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS,
    NEXT_PUBLIC_ENJIN_MATRIX_WSS: process.env.NEXT_PUBLIC_ENJIN_MATRIX_WSS,
    NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS:
      process.env.NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS,
    NEXT_PUBLIC_CANARY_RELAY_WSS: process.env.NEXT_PUBLIC_CANARY_RELAY_WSS,
    NEXT_PUBLIC_CANARY_MATRIX_WSS: process.env.NEXT_PUBLIC_CANARY_MATRIX_WSS,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    NEXT_PUBLIC_WALLETCONNECT_RELAY_URL:
      process.env.NEXT_PUBLIC_WALLETCONNECT_RELAY_URL,
    NEXT_PUBLIC_ENJIN_SUBSCAN_URL: process.env.NEXT_PUBLIC_ENJIN_SUBSCAN_URL,
    NEXT_PUBLIC_MATRIX_SUBSCAN_URL: process.env.NEXT_PUBLIC_MATRIX_SUBSCAN_URL,
    NEXT_PUBLIC_CANARY_SUBSCAN_URL: process.env.NEXT_PUBLIC_CANARY_SUBSCAN_URL,
    NEXT_PUBLIC_CANARY_MATRIX_SUBSCAN_URL:
      process.env.NEXT_PUBLIC_CANARY_MATRIX_SUBSCAN_URL,
  },

  emptyStringAsUndefined: true,

  skipValidation:
    process.env.SKIP_ENV_VALIDATION === "true" ||
    process.env.npm_lifecycle_event === "lint",
})
