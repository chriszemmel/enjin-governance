import { afterEach, describe, expect, it, vi } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { fetchTokenMetadata, getCollectionUriTemplate } from "@/lib/governance/multi-tokens"

/** The chain read and the metadata fetch behind token labels. */

const asApi = (fake: object) => fake as unknown as ApiPromise
const hex = (s: string) => `0x${Buffer.from(s, "utf8").toString("hex")}`

function attributesApi(value: unknown) {
  const calls: unknown[][] = []
  const api = asApi({
    query: {
      multiTokens: {
        attributes: async (...a: unknown[]) => {
          calls.push(a)
          return { toJSON: () => value }
        },
      },
    },
  })
  return { api, calls }
}

describe("getCollectionUriTemplate", () => {
  it("reads the collection-level `uri` attribute and decodes its hex bytes", async () => {
    const { api, calls } = attributesApi({ value: hex(" https://cdn/{id}.json ") })
    expect(await getCollectionUriTemplate(api, 2n)).toBe("https://cdn/{id}.json")
    expect(calls).toEqual([["2", null, hex("uri")]])
  })

  it("accepts a plain string or a byte array as the value", async () => {
    expect(await getCollectionUriTemplate(attributesApi({ value: "https://x/{id}" }).api, 1n)).toBe(
      "https://x/{id}",
    )
    const bytes = Array.from(Buffer.from("https://y/{id}", "utf8"))
    expect(await getCollectionUriTemplate(attributesApi({ value: bytes }).api, 1n)).toBe(
      "https://y/{id}",
    )
  })

  it("is null when the attribute, its value or the pallet is missing", async () => {
    expect(await getCollectionUriTemplate(attributesApi(null).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi("not an object").api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi({ value: null }).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi({ value: "" }).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi({ value: "0x" }).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi({ value: hex("   ") }).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi({ value: [32, 32] }).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(attributesApi({ value: 42 }).api, 1n)).toBeNull()
    expect(await getCollectionUriTemplate(asApi({ query: {} }), 1n)).toBeNull()
  })
})

describe("fetchTokenMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches JSON and normalises it", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: "Degen #1", image: "https://cdn/1.png" }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchTokenMetadata("https://cdn/1.json")).toEqual({
      name: "Degen #1",
      description: null,
      image: "https://cdn/1.png",
      externalUrl: null,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn/1.json",
      expect.objectContaining({ headers: { accept: "application/json" } }),
    )
  })

  it("is null on a non-200, a network error or bad JSON", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, json: async () => ({}) }))
    expect(await fetchTokenMetadata("https://cdn/404.json")).toBeNull()

    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network")
    })
    expect(await fetchTokenMetadata("https://cdn/down.json")).toBeNull()

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("bad json")
      },
    }))
    expect(await fetchTokenMetadata("https://cdn/bad.json")).toBeNull()
  })
})
