import { describe, expect, it } from "vitest"
import type { Verdict } from "@/lib/governance/verdict"
import { durationWords, type VerdictFormat, verdictCopy } from "@/lib/governance/verdict-copy"

const ENJ = 10n ** 18n
const f: VerdictFormat = {
  when: (b) => `when(${b})`,
  day: (b) => `day(${b})`,
  amount: (p) => `${(p / ENJ).toLocaleString("en-US")} ENJ`,
  pct: (v) => `${Number((v * 100).toPrecision(3))}%`,
  decisionDeposit: 12_500n * ENJ,
  maxDeciding: 10,
}

const base: Verdict = {
  kind: "on-course",
  approval: 1,
  support: 0.000331,
  approvalNeededNow: 0.5,
  supportNeededNow: 0.0048,
  approvalNeededAtEnd: 0.5,
  supportNeededAtEnd: 0.000249999,
  supportFloor: 509_655n * ENJ,
  supportMissing: 0n,
  approvalShort: false,
  supportShort: false,
  decidingSince: 1000,
  decisionEnd: 202_600,
  meetsCurvesAt: 200_000,
  passesAt: 207_200,
  timeoutAt: null,
  prepareEnd: null,
  confirmPeriod: 7200,
}

describe("durationWords", () => {
  it("names confirm periods in words", () => {
    expect(durationWords(100)).toBe("10 minutes")
    expect(durationWords(600)).toBe("1 hour")
    expect(durationWords(1800)).toBe("3 hours")
    expect(durationWords(7200)).toBe("12 hours")
    expect(durationWords(14_400)).toBe("1 day")
    expect(durationWords(28_800)).toBe("2 days")
  })
})

describe("verdictCopy", () => {
  it("on course: names when it meets the curves, the confirm period and the pass date", () => {
    const c = verdictCopy(base, f, 100_000)
    expect(c.tone).toBe("course")
    expect(c.label).toBe("On course")
    expect(c.sub).toBe("Passes around day(207200) if votes hold")
    expect(c.body).toContain(
      "around when(200000), confirms for 12 hours and passes around when(207200)",
    )
    expect(c.note).toContain("less than 509,655 ENJ")
  })

  it("short on support: says how much is missing and by when", () => {
    const c = verdictCopy(
      {
        ...base,
        kind: "short",
        supportShort: true,
        supportFloor: 1_019_314n * ENJ,
        supportMissing: 799_757n * ENJ,
        meetsCurvesAt: null,
        passesAt: null,
      },
      f,
      100_000,
    )
    expect(c.tone).toBe("short")
    expect(c.label).toBe("Short on support")
    expect(c.sub).toBe("Needs 799,757 ENJ more support by day(202600)")
    expect(c.body).toContain("It has 219,557 ENJ")
  })

  it("short on approval: leads with approval and mentions support too", () => {
    const c = verdictCopy(
      {
        ...base,
        kind: "short",
        approval: 0.386,
        approvalShort: true,
        supportShort: true,
        supportFloor: 1_019_314n * ENJ,
        supportMissing: 819_312n * ENJ,
      },
      f,
      100_000,
    )
    expect(c.label).toBe("Short on approval")
    expect(c.sub).toBe("Needs 50% aye by day(202600)")
    expect(c.body).toContain("It's at 38.6%")
    expect(c.note).toBe("Support is short too: 200,002 ENJ of 1,019,314 ENJ needed.")
  })

  it("says it's rejected at the next check once the decision period is over", () => {
    const c = verdictCopy(
      { ...base, kind: "short", supportShort: true, supportMissing: 1n * ENJ },
      f,
      202_600,
    )
    expect(c.sub).toBe("Rejected at the next check")
  })

  it("needs a deposit: names the deposit and the timeout", () => {
    const c = verdictCopy(
      {
        ...base,
        kind: "needs-deposit",
        decidingSince: null,
        decisionEnd: null,
        meetsCurvesAt: null,
        passesAt: null,
        timeoutAt: 300_000,
      },
      f,
      100_000,
    )
    expect(c.tone).toBe("idle")
    expect(c.label).toBe("Not deciding yet")
    expect(c.body).toContain("decision deposit of 12,500 ENJ")
    expect(c.note).toContain("times out around when(300000)")
  })

  it("confirming after the decision period warns that dropping now rejects it", () => {
    const c = verdictCopy({ ...base, kind: "confirming", passesAt: 203_000 }, f, 202_700)
    expect(c.label).toBe("Confirming")
    expect(c.note).toContain("rejects it")
  })

  it("covers queue, preparing, no votes, on track and slipping", () => {
    expect(verdictCopy({ ...base, kind: "queued" }, f, 1).body).toContain("all 10 decision slots")
    expect(verdictCopy({ ...base, kind: "preparing", prepareEnd: 5 }, f, 1).sub).toBe(
      "Decision starts around when(5)",
    )
    expect(verdictCopy({ ...base, kind: "no-votes" }, f, 1).label).toBe("No votes yet")
    expect(verdictCopy({ ...base, kind: "on-track" }, f, 1).tone).toBe("pass")
    expect(verdictCopy({ ...base, kind: "slipping" }, f, 1).tone).toBe("short")
  })
})
