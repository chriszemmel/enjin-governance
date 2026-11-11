/**
 * Upload limits shared by the browser and the server.
 *
 * Vercel refuses request bodies over 4.5 MB before the app sees them, so
 * one file may be at most 4 MB (the rest is room for the multipart
 * framing). Larger photos are shrunk in the browser first (fitForUpload),
 * so in practice only big PDFs and GIFs run into the limit.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const MAX_UPLOAD_LABEL = "4 MB"

/** Stored images are scaled to fit this edge (media-processing.ts). */
export const MAX_IMAGE_EDGE_PX = 2560
