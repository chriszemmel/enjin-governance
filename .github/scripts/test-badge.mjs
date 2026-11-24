#!/usr/bin/env node
/**
 * Turn Vitest's JSON report into a shields.io endpoint badge.
 *
 *   node .github/scripts/test-badge.mjs <vitest-results.json> <badge.json>
 *
 * The README's test badge reads the result from the `badges` branch, so the
 * number it shows is the one CI counted on the last push to main - never a
 * figure someone typed in. A run without tests is an error, not "0 passing".
 */

import { readFileSync, writeFileSync } from "node:fs"

const [input, output] = process.argv.slice(2)
if (!input || !output) {
  console.error("usage: test-badge.mjs <vitest-results.json> <badge.json>")
  process.exit(2)
}

const report = JSON.parse(readFileSync(input, "utf8"))
const total = Number(report.numTotalTests)
const passed = Number(report.numPassedTests)
const failed = Number(report.numFailedTests)

if (!Number.isInteger(total) || total <= 0) {
  console.error(`no tests in ${input}`)
  process.exit(1)
}

const badge = {
  schemaVersion: 1,
  label: "tests",
  message: failed > 0 ? `${failed} failing` : `${passed} passing`,
  color: failed > 0 ? "ef4444" : "22c55e",
  style: "flat-square",
}

writeFileSync(output, `${JSON.stringify(badge)}\n`)
console.log(`${output}: ${badge.message}`)
