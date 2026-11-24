/**
 * Starts a Chopsticks fork of Enjin Relay for the fork checks and stops it
 * afterwards. Set FORK_WS to use a fork that is already running instead.
 */

import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import type { TestProject } from "vitest/node"

/** Pinned: 1.5.x is the last line that supports Node 22 (see .nvmrc). */
const CHOPSTICKS = "@acala-network/chopsticks@1.5.2"
const PORT = 8011
const START_TIMEOUT_MS = 240_000

declare module "vitest" {
  export interface ProvidedContext {
    forkWs: string
  }
}

let child: ChildProcess | null = null

export default async function setup(project: TestProject) {
  const existing = process.env.FORK_WS
  if (existing) {
    project.provide("forkWs", existing)
    return
  }

  const config = path.resolve(__dirname, "enjin-relay.yml")
  child = spawn("pnpm", ["dlx", CHOPSTICKS, `--config=${config}`], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  })

  await new Promise<void>((resolve, reject) => {
    let log = ""
    const timer = setTimeout(
      () => reject(new Error(`Chopsticks did not start in ${START_TIMEOUT_MS / 1000}s:\n${log}`)),
      START_TIMEOUT_MS,
    )
    const onData = (chunk: Buffer) => {
      log += chunk.toString()
      if (/RPC listening on/.test(log)) {
        clearTimeout(timer)
        resolve()
      }
    }
    child?.stdout?.on("data", onData)
    child?.stderr?.on("data", onData)
    child?.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`Chopsticks exited with ${code}:\n${log}`))
    })
  })

  project.provide("forkWs", `ws://127.0.0.1:${PORT}`)

  return () => {
    child?.kill("SIGTERM")
    child = null
  }
}
