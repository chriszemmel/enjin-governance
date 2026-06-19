"use client"

import { useCallback, useRef, useState } from "react"
import { Loader2, Paperclip, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import type { ChainId } from "@/lib/chain/chains"
import { cn } from "@/lib/utils"
import { formatError } from "@/lib/utils/format-error"

export type UploadedAttachment = {
  bucket_key: string
  url: string
  sha256: string
  size_bytes: number
  content_type: string
  name: string
}

type Props = {
  proposalId: string
  network: ChainId
  attachments: UploadedAttachment[]
  onChange: (next: UploadedAttachment[]) => void
  disabled?: boolean
  /**
   * Gate run before any upload. The media endpoint requires an
   * authenticated proposer, so this returns false (and aborts the
   * upload) if the user cancels or fails the sign-in prompt.
   */
  beforeUpload?: () => Promise<boolean>
}

const MAX_FILES = 8

export function AttachmentDropzone({
  proposalId,
  network,
  attachments,
  onChange,
  disabled,
  beforeUpload,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)

  const upload = useCallback(
    async (files: FileList) => {
      if (disabled) return
      // Snapshot the FileList synchronously, before any await. The file
      // <input>'s onChange resets input.value right after calling us,
      // which empties this live FileList - so reading it only after the
      // async `beforeUpload()` sign-in gate would leave nothing to upload.
      const selected = Array.from(files)
      if (beforeUpload && !(await beforeUpload())) return
      const remaining = MAX_FILES - attachments.length
      if (remaining <= 0) {
        toast.error(`Max ${MAX_FILES} attachments`)
        return
      }
      const accepted = selected.slice(0, remaining)
      if (accepted.length === 0) return

      setUploading(true)
      const next: UploadedAttachment[] = [...attachments]
      for (const file of accepted) {
        const form = new FormData()
        form.set("file", file)
        try {
          const res = await fetch(
            `/api/proposals/${proposalId}/media?network=${network}`,
            { method: "POST", body: form },
          )
          const json = (await res.json()) as
            | { ok: true; bucket_key: string; url: string; sha256: string; size_bytes: number; content_type: string; name: string }
            | { ok: false; error: string }
          if (!res.ok || !("ok" in json) || !json.ok) {
            const err = "error" in json ? json.error : `HTTP ${res.status}`
            toast.error(`Upload failed: ${file.name}`, { description: err })
            continue
          }
          next.push({
            bucket_key: json.bucket_key,
            url: json.url,
            sha256: json.sha256,
            size_bytes: json.size_bytes,
            content_type: json.content_type,
            name: json.name,
          })
        } catch (e) {
          toast.error(`Upload failed: ${file.name}`, {
            description: formatError(e),
          })
        }
      }
      setUploading(false)
      onChange(next)
    },
    [attachments, beforeUpload, disabled, network, onChange, proposalId],
  )

  const remove = (key: string) =>
    onChange(attachments.filter((a) => a.bucket_key !== key))

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          if (e.dataTransfer.files.length) {
            void upload(e.dataTransfer.files)
          }
        }}
        className={cn(
          "w-full rounded-xl border-2 border-dashed p-6 flex flex-col items-center justify-center gap-2 text-sm transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-surface-1 hover:bg-surface-2",
          (disabled || uploading) && "opacity-60 cursor-not-allowed",
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="text-muted-foreground">Uploading…</span>
          </>
        ) : (
          <>
            <Upload className="w-5 h-5 text-muted-foreground" />
            <span className="text-foreground font-medium">
              Drop images or PDFs here, or click to browse
            </span>
            <span className="text-[11px] text-muted-foreground">
              PNG / JPG / WEBP / GIF / PDF · up to 20 MB · max {MAX_FILES} files
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files)
            e.currentTarget.value = ""
          }}
        />
      </button>

      {attachments.length > 0 && (
        <ul className="space-y-2">
          {attachments.map((att) => (
            <li
              key={att.bucket_key}
              className="flex items-center gap-3 p-3 rounded-lg bg-surface-1 border border-border"
            >
              <Paperclip className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-foreground hover:text-primary truncate block"
                >
                  {att.name}
                </a>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {(att.size_bytes / 1024).toFixed(1)} KB · sha256:{" "}
                  {att.sha256.slice(0, 12)}…
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(att.bucket_key)}
                disabled={disabled}
                className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                title="Remove attachment"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
