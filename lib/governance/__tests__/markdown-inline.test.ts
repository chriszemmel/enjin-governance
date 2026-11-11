import { describe, expect, it } from "vitest"
import { isSafeUrl, parseInline } from "@/lib/governance/markdown-inline"

const EN = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const CN = "cnTfU9odSe157jiEmsDGsQgBanpTXcDa2GJSJSB2oEdgMnwL9"
const DOT = "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB"

describe("parseInline", () => {
  it("keeps the existing marks", () => {
    expect(parseInline("a **b *c* d** `d` [e](https://x.io) <https://y.io>")).toEqual([
      { kind: "text", text: "a " },
      {
        kind: "strong",
        children: [
          { kind: "text", text: "b " },
          { kind: "em", children: [{ kind: "text", text: "c" }] },
          { kind: "text", text: " d" },
        ],
      },
      { kind: "text", text: " " },
      { kind: "code", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", href: "https://x.io", children: [{ kind: "text", text: "e" }] },
      { kind: "text", text: " " },
      { kind: "autolink", href: "https://y.io" },
    ])
  })

  it("turns checksum-valid addresses into address nodes", () => {
    expect(parseInline(`Pay ${EN}, then ${CN}.`)).toEqual([
      { kind: "text", text: "Pay " },
      { kind: "address", address: EN },
      { kind: "text", text: ", then " },
      { kind: "address", address: CN },
      { kind: "text", text: "." },
    ])
    expect(parseInline(DOT)).toEqual([{ kind: "address", address: DOT }])
  })

  it("leaves look-alike words alone", () => {
    const broken = EN.slice(0, -1) + (EN.endsWith("X") ? "Y" : "X")
    expect(parseInline(broken)).toEqual([{ kind: "text", text: broken }])
    // Part of a longer base58 run is not an address either.
    expect(parseInline(`${EN}abc`)).toEqual([{ kind: "text", text: `${EN}abc` }])
  })

  it("shows a code span that is exactly one address as an address", () => {
    expect(parseInline(`\`${EN}\``)).toEqual([{ kind: "address", address: EN }])
    expect(parseInline(`to \` ${CN} \` now`)).toEqual([
      { kind: "text", text: "to " },
      { kind: "address", address: CN },
      { kind: "text", text: " now" },
    ])
  })

  it("keeps other code spans and link labels as written", () => {
    // More than the address, a broken checksum, or an EVM address: still code.
    expect(parseInline(`\`send ${EN}\``)).toEqual([{ kind: "code", text: `send ${EN}` }])
    const broken = EN.slice(0, -1) + (EN.endsWith("X") ? "Y" : "X")
    expect(parseInline(`\`${broken}\``)).toEqual([{ kind: "code", text: broken }])
    const evm = "0x3e1f952c0167305996105df78c4d84afbca0e000"
    expect(parseInline(`\`${evm}\``)).toEqual([{ kind: "code", text: evm }])
    expect(parseInline(`[${EN}](/user/${EN})`)).toEqual([
      { kind: "link", href: `/user/${EN}`, children: [{ kind: "text", text: EN }] },
    ])
  })

  it("parses images and leaves the decision to the renderer", () => {
    expect(parseInline("![Roadmap](https://gov.example/r/x.png) after")).toEqual([
      { kind: "image", alt: "Roadmap", target: "https://gov.example/r/x.png" },
      { kind: "text", text: " after" },
    ])
    expect(parseInline("![chart](roadmap.png)")).toEqual([
      { kind: "image", alt: "chart", target: "roadmap.png" },
    ])
  })

  it("never makes images inside link labels", () => {
    expect(parseInline("[![a](b.png)](https://x.io)")).toEqual([
      { kind: "text", text: "[" },
      { kind: "image", alt: "a", target: "b.png" },
      { kind: "text", text: "](https://x.io)" },
    ])
  })

  it("drops unsafe link targets back to text", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([
      { kind: "text", text: "[x](javascript:alert(1))" },
    ])
  })
})

describe("isSafeUrl", () => {
  it("allows http(s) and same-site paths only", () => {
    expect(isSafeUrl("https://a.io")).toBe(true)
    expect(isSafeUrl("/proposals/1")).toBe(true)
    expect(isSafeUrl("//evil.io")).toBe(false)
    expect(isSafeUrl("/\\evil.io")).toBe(false)
    expect(isSafeUrl("/\t/evil.io")).toBe(false)
    expect(isSafeUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeUrl("data:image/png;base64,AA")).toBe(false)
  })
})
