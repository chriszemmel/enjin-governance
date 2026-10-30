"use client"

import { createContext, useContext } from "react"
import type { ProposalPreview } from "./proposal-preview"

/**
 * What the server knows of a proposal before the chain is read, handed from
 * the referendum layout to its page: the preview itself for crawlers (so it
 * is in the HTML in place), a promise that resolves as it streams in for
 * browsers (so the page shell doesn't wait for the database), null when
 * there is nothing to know.
 */
export type ProposalPreviewSource = ProposalPreview | null | Promise<ProposalPreview | null>

const PreviewContext = createContext<ProposalPreviewSource>(null)

export function ProposalPreviewProvider({
  preview,
  children,
}: {
  preview: ProposalPreviewSource
  children: React.ReactNode
}) {
  return <PreviewContext.Provider value={preview}>{children}</PreviewContext.Provider>
}

export function useProposalPreviewSource(): ProposalPreviewSource {
  return useContext(PreviewContext)
}
