import { describe, expect, it } from "vitest"
import {
  isTableSeparatorRow,
  parseMarkdownBlocks,
  splitTableRow,
} from "@/lib/governance/markdown-lite"

describe("splitTableRow", () => {
  it("strips outer pipes and trims cells", () => {
    expect(splitTableRow("| Stage | Block | Set |")).toEqual(["Stage", "Block", "Set"])
  })

  it("tolerates a missing trailing pipe", () => {
    expect(splitTableRow("| a | b")).toEqual(["a", "b"])
  })

  it("preserves empty cells", () => {
    expect(splitTableRow("| a |  | c |")).toEqual(["a", "", "c"])
  })
})

describe("isTableSeparatorRow", () => {
  it("accepts plain and aligned delimiters", () => {
    expect(isTableSeparatorRow("|---|---|")).toBe(true)
    expect(isTableSeparatorRow("| :-- | --: | :-: |")).toBe(true)
    expect(isTableSeparatorRow("|-|")).toBe(true)
  })

  it("rejects content rows", () => {
    expect(isTableSeparatorRow("| Stage | Block |")).toBe(false)
    expect(isTableSeparatorRow("| 1 | 2 |")).toBe(false)
    expect(isTableSeparatorRow("| --- | x |")).toBe(false)
  })
})

describe("parseMarkdownBlocks", () => {
  it("parses a GFM table into head + rows", () => {
    const blocks = parseMarkdownBlocks(
      [
        "| Stage | Block | Set |",
        "|---|---|---|",
        "| 1 | 16,950,720 | 27 |",
        "| 2 | 18,246,720 | 30 |",
      ].join("\n"),
    )
    expect(blocks).toEqual([
      {
        kind: "table",
        head: ["Stage", "Block", "Set"],
        rows: [
          ["1", "16,950,720", "27"],
          ["2", "18,246,720", "30"],
        ],
      },
    ])
  })

  it("does not swallow a table into a paragraph", () => {
    const blocks = parseMarkdownBlocks("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(blocks.some((b) => b.kind === "para")).toBe(false)
  })

  it("falls back to prose when the delimiter row is missing", () => {
    // Regression guard: pipe-led lines that aren't a table must still render
    // rather than disappear.
    const blocks = parseMarkdownBlocks("| not | really | a table")
    expect(blocks).toEqual([{ kind: "para", text: "| not | really | a table" }])
  })

  it("separates a table from the heading and prose around it", () => {
    const blocks = parseMarkdownBlocks(
      ["## Motions", "before", "| a | b |", "|---|---|", "| 1 | 2 |", "after"].join("\n"),
    )
    expect(blocks.map((b) => b.kind)).toEqual(["h2", "para", "table", "para"])
    expect(blocks[1]).toEqual({ kind: "para", text: "before" })
    expect(blocks[3]).toEqual({ kind: "para", text: "after" })
  })

  it("leaves pipes inside fenced code alone", () => {
    const blocks = parseMarkdownBlocks("```\n| a | b |\n|---|---|\n```")
    expect(blocks).toEqual([{ kind: "code", text: "| a | b |\n|---|---|" }])
  })

  it("still handles headings, lists and code", () => {
    const blocks = parseMarkdownBlocks(
      [
        "# Title",
        "",
        "para one",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "```",
        "code",
        "```",
      ].join("\n"),
    )
    expect(blocks).toEqual([
      { kind: "h1", text: "Title" },
      { kind: "para", text: "para one" },
      { kind: "ul", items: ["one", "two"] },
      { kind: "ol", items: ["first", "second"] },
      { kind: "code", text: "code" },
    ])
  })

  it("handles two tables in a row", () => {
    const blocks = parseMarkdownBlocks(
      ["| a |", "|---|", "| 1 |", "", "| b |", "|---|", "| 2 |"].join("\n"),
    )
    expect(blocks.map((b) => b.kind)).toEqual(["table", "table"])
  })
})
