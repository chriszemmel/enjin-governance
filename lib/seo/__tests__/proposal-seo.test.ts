/**
 * What a referendum page says about itself before the chain is read: the
 * loader (database mocked), the metadata and JSON-LD built from it, the
 * no-JavaScript fallback, and the layout's generateMetadata with and
 * without `?network=`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

const io = vi.hoisted(() => ({
  dbConfigured: true,
  row: null as null | Record<string, unknown>,
  rowHangs: false,
  rowFails: false,
  state: null as null | { state: string },
  stateFails: false,
  user: null as null | { display_name: string | null; handle: string | null },
  requested: [] as Array<[string, number]>,
  hint: null as string | null,
  ua: "Mozilla/5.0",
}))

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => io.dbConfigured,
  getSql: () => {
    throw new Error("no SQL in tests")
  },
}))
vi.mock("@/lib/db/proposals", () => ({
  getProposalByIndex: async (network: string, index: number) => {
    io.requested.push([network, index])
    if (io.rowFails) throw new Error("db down")
    if (io.rowHangs) return new Promise(() => {})
    return io.row
  },
}))
vi.mock("@/lib/db/moderation", () => ({
  getState: async () => {
    if (io.stateFails) throw new Error('relation "moderation_state" does not exist')
    return io.state
  },
}))
vi.mock("@/lib/db/users", () => ({ getUserByAddress: async () => io.user }))
vi.mock("next/headers", () => ({
  headers: async () => {
    const h = new Headers({ "user-agent": io.ua })
    if (io.hint) h.set("x-proposal-network", io.hint)
    return h
  },
}))

import { generateMetadata } from "@/app/proposals/[index]/layout"
import { enabledChains } from "@/lib/chain/chains"
import { proposalJsonLd, serializeJsonLd, siteJsonLd } from "@/lib/seo/json-ld"
import {
  clip,
  pageMetadata,
  proposalDescription,
  proposalMetadata,
  TITLE_TEMPLATE,
} from "@/lib/seo/metadata"
import { loadProposalSeo } from "@/lib/seo/proposal"
import { ProposalSeoFallback } from "@/lib/seo/proposal-fallback"
import {
  chainFromHint,
  defaultChain,
  parseReferendumIndex,
  proposalPath,
  siteUrl,
} from "@/lib/seo/site"

const PROPOSER = "enD9wdMEaQa3MEDUc7dtsCC86JYGMN5JBE2NBRoMyC37dX4iA"
const CREATED = new Date("2026-08-01T12:00:00Z")
const EDITED = new Date("2026-08-03T08:30:00Z")
const other = enabledChains().find((c) => c.id !== defaultChain().id)!

function publishedRow(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    network: defaultChain().id,
    referendum_index: 42,
    proposer_address: PROPOSER,
    title: "Fund the community tooling grant",
    summary: "Six months of maintenance for the open-source governance tools.",
    status: "on_chain",
    created_at: CREATED,
    edited_at: null,
    withdrawn_at: null,
    ...over,
  }
}

const load = (index = 42, chain = defaultChain()) => loadProposalSeo(chain.id, index)
const render = async (index = 42, chain = defaultChain()) =>
  renderToStaticMarkup(await ProposalSeoFallback({ chainId: chain.id, index }))
const ldScripts = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  )

beforeEach(() => {
  io.dbConfigured = true
  io.row = publishedRow()
  io.rowHangs = false
  io.rowFails = false
  io.state = null
  io.stateFails = false
  io.user = { display_name: "Alice", handle: "alice" }
  io.requested = []
  io.hint = null
  io.ua = "Mozilla/5.0"
})
afterEach(() => {
  vi.useRealTimers()
})

describe("site helpers", () => {
  it("reads the referendum index the way the page does", () => {
    expect(parseReferendumIndex("42")).toBe(42)
    expect(parseReferendumIndex("042")).toBe(42)
    expect(parseReferendumIndex("0")).toBe(0)
    for (const raw of ["", " ", "-1", "1.5", "abc", "1e400", "9007199254740993"]) {
      expect(parseReferendumIndex(raw), raw).toBeNull()
    }
  })

  it("only accepts an enabled chain from ?network=", () => {
    expect(chainFromHint(null).id).toBe(defaultChain().id)
    expect(chainFromHint(other.id).id).toBe(other.id)
    for (const hint of ["enjin-matrix", "canary-matrix", "nope", "constructor", "__proto__"]) {
      expect(chainFromHint(hint).id, hint).toBe(defaultChain().id)
    }
  })

  it("keeps ?network= in the canonical path only for another network", () => {
    expect(proposalPath(7, defaultChain())).toBe("/proposals/7")
    expect(proposalPath(7, other)).toBe(`/proposals/7?network=${other.id}`)
  })

  it("clips long text at a word boundary", () => {
    expect(clip("short  text\n", 20)).toBe("short text")
    const long = "word ".repeat(60)
    const out = clip(long, 160)
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith("word…")).toBe(true)
  })
})

describe("loadProposalSeo", () => {
  it("uses the published title, summary, dates and the proposer's display name", async () => {
    io.row = publishedRow({ edited_at: EDITED })
    const p = await load()
    expect(io.requested).toEqual([[defaultChain().id, 42]])
    expect(p).toMatchObject({
      index: 42,
      isDefaultNetwork: true,
      path: "/proposals/42",
      title: "Fund the community tooling grant",
      summary: "Six months of maintenance for the open-source governance tools.",
      proposer: { address: PROPOSER, name: "Alice" },
      createdAt: CREATED,
      editedAt: EDITED,
      withdrawn: false,
    })
  })

  it("falls back to the handle, then to no name", async () => {
    io.user = { display_name: " ", handle: "alice" }
    expect((await load()).proposer?.name).toBe("@alice")
    io.user = null
    expect((await load()).proposer?.name).toBeNull()
  })

  it("says nothing of a proposal moderators hid, beyond who proposed it", async () => {
    io.state = { state: "hidden" }
    const p = await load()
    expect(p.title).toBeNull()
    expect(p.summary).toBeNull()
    expect(p.createdAt).toBeNull()
    expect(p.proposer?.address).toBe(PROPOSER)
  })

  it("treats a missing moderation table as visible, like the public state route", async () => {
    io.stateFails = true
    expect((await load()).title).toBe("Fund the community tooling grant")
  })

  it("ignores rows that never reached the chain", async () => {
    io.row = publishedRow({ status: "cancelled" })
    expect((await load()).title).toBeNull()
  })

  it("falls back to the bare referendum without a database, on errors and when slow", async () => {
    io.dbConfigured = false
    expect(await load()).toMatchObject({ title: null, proposer: null })
    expect(io.requested).toEqual([])

    io.dbConfigured = true
    io.rowFails = true
    expect(await load()).toMatchObject({ title: null, proposer: null })

    io.rowFails = false
    io.rowHangs = true
    vi.useFakeTimers()
    const pending = load()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await pending).toMatchObject({ title: null, proposer: null })
  })
})

describe("proposal metadata", () => {
  it("titles, describes and canonicalises the page from the published text", async () => {
    const m = proposalMetadata(await load())
    expect(m.title).toEqual({
      default: "Fund the community tooling grant",
      template: TITLE_TEMPLATE,
    })
    expect(m.description).toBe("Six months of maintenance for the open-source governance tools.")
    expect(m.alternates).toEqual({ canonical: "/proposals/42" })
    expect(m.openGraph).toMatchObject({ type: "article", siteName: "Enjin Governance" })
    // Next fills og:image from the route's opengraph-image only when none is set here.
    expect(m.openGraph).not.toHaveProperty("images")
    expect(m.robots).toBeUndefined()
  })

  it("falls back to the referendum number and says when it was withdrawn", async () => {
    io.row = publishedRow({ summary: null, withdrawn_at: EDITED })
    const withdrawn = proposalDescription(await load())
    expect(withdrawn).toMatch(/^Withdrawn by the proposer\. Referendum #42 on the /)

    io.row = null
    const m = proposalMetadata(await load())
    expect(m.title).toEqual({ default: "Referendum #42", template: TITLE_TEMPLATE })
    expect(m.description).toBe(
      `Referendum #42 on the ${defaultChain().name}: live status, tally, votes and the proposed call.`,
    )
  })

  it("keeps another network's page out of the index, canonical to itself", async () => {
    const m = proposalMetadata(await load(42, other))
    expect(io.requested).toEqual([[other.id, 42]])
    expect(m.alternates).toEqual({ canonical: `/proposals/42?network=${other.id}` })
    expect(m.robots).toEqual({ index: false, follow: true })
  })

  it("gives public pages a clipped description and a canonical path", () => {
    const m = pageMetadata({ title: "Treasury", description: "x ".repeat(200), path: "/treasury" })
    expect(m.title).toEqual({ default: "Treasury", template: TITLE_TEMPLATE })
    expect((m.description as string).length).toBeLessThanOrEqual(160)
    expect(m.alternates).toEqual({ canonical: "/treasury" })
  })
})

describe("the proposal layout's generateMetadata", () => {
  const meta = (index: string) => generateMetadata({ params: Promise.resolve({ index }) })

  it("reads the network from the proxy's hint header", async () => {
    io.hint = other.id
    expect((await meta("42")).alternates).toEqual({
      canonical: `/proposals/42?network=${other.id}`,
    })
    expect(io.requested).toEqual([[other.id, 42]])

    io.requested = []
    io.hint = "enjin-matrix" // not enabled: the default network
    expect((await meta("042")).alternates).toEqual({ canonical: "/proposals/42" })
    expect(io.requested).toEqual([[defaultChain().id, 42]])
  })

  it("marks a segment that isn't a referendum number noindex without a database read", async () => {
    const m = await meta("not-a-number")
    expect(m.title).toBe("Referendum not found")
    expect(m.robots).toEqual({ index: false, follow: true })
    expect(io.requested).toEqual([])
  })
})

describe("structured data", () => {
  it("names the site and its maintainer, never Enjin itself", () => {
    const [site, publisher] = siteJsonLd()["@graph"]
    expect(site).toMatchObject({
      "@type": "WebSite",
      url: `${siteUrl()}/`,
      name: "Enjin Governance",
      publisher: { "@id": `${siteUrl()}/#publisher` },
    })
    expect(publisher["@type"]).toBe("Person")
    expect(publisher.name).not.toMatch(/^Enjin/)
  })

  it("describes a published proposal as an Article with only the facts we have", async () => {
    io.row = publishedRow({ edited_at: EDITED })
    const [crumbs, article] = proposalJsonLd(await load())["@graph"]
    expect(crumbs["@type"]).toBe("BreadcrumbList")
    expect((crumbs.itemListElement as Array<{ item: string }>).map((i) => i.item)).toEqual([
      `${siteUrl()}/`,
      `${siteUrl()}/proposals`,
      `${siteUrl()}/proposals/42`,
    ])
    expect(article).toEqual({
      "@type": "Article",
      "@id": `${siteUrl()}/proposals/42#proposal`,
      headline: "Fund the community tooling grant",
      description: "Six months of maintenance for the open-source governance tools.",
      url: `${siteUrl()}/proposals/42`,
      mainEntityOfPage: `${siteUrl()}/proposals/42`,
      inLanguage: "en",
      isPartOf: { "@id": `${siteUrl()}/#website` },
      dateCreated: CREATED.toISOString(),
      dateModified: EDITED.toISOString(),
      author: {
        "@type": "Person",
        name: "Alice",
        identifier: PROPOSER,
        url: `${siteUrl()}/user/${PROPOSER}`,
      },
    })
    // No publication date: we don't know when the referendum was submitted.
    expect(article).not.toHaveProperty("datePublished")
  })

  it("has only breadcrumbs for a referendum without published text", async () => {
    io.row = null
    const nodes = proposalJsonLd(await load())["@graph"]
    expect(nodes.map((n) => n["@type"])).toEqual(["BreadcrumbList"])
  })

  it("can't be broken out of by a hostile title", async () => {
    const title = "</script><script>alert(1)</script> & co"
    const summary = "line\u2028separator"
    io.row = publishedRow({ title, summary })
    const json = serializeJsonLd(proposalJsonLd(await load()))
    expect(json).not.toMatch(/[<>&\u2028]/)
    const article = JSON.parse(json)["@graph"][1]
    expect(article.headline).toBe(title)
    expect(article.description).toBe(summary)
  })
})

describe("the no-JavaScript fallback", () => {
  it("renders the title, summary and status inside <noscript>, and the JSON-LD", async () => {
    io.row = publishedRow({ withdrawn_at: EDITED })
    const html = await render()
    const noscript = html.match(/<noscript>(.*)<\/noscript>/s)?.[1] ?? ""
    expect(noscript).toContain("<h1")
    expect(noscript).toContain("Fund the community tooling grant</h1>")
    expect(noscript).toContain("Six months of maintenance")
    expect(noscript).toContain(
      `Referendum #42 on the ${defaultChain().name}, proposed by Alice. The proposer has withdrawn it; voting stays open on chain.`,
    )
    expect(noscript).toMatch(
      /<a href="https:\/\/[^"]+\/referenda_v2\/42"[^>]*>View referendum #42 on Subscan<\/a>/,
    )
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(ldScripts(html)[0]["@graph"][1].headline).toBe("Fund the community tooling grant")
  })

  it("escapes user text", async () => {
    io.row = publishedRow({ summary: "<img src=x onerror=alert(1)>" })
    const html = await render()
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;")
  })
})
