/**
 * snapfeed — Storage Adapter Types
 *
 * A `StorageAdapter` uploads feedback media (screenshots, voice clips) to
 * remote storage and returns a public URL, so the URL can be embedded in the
 * feedback payload instead of base64. Keeps payloads small and lets reviewers
 * stream large attachments instead of decoding them inline.
 */

export interface StorageUploadInput {
  /** Raw bytes to upload (base64-decoded, or any `Uint8Array`/`Buffer`). */
  bytes: Uint8Array
  /** MIME type of the bytes, e.g. `'image/png'` or `'audio/webm;codecs=opus'`. */
  mimeType: string
  /** Suggested file name (no leading slash). The provider may prefix it. */
  filename: string
  /** Optional metadata pairs the provider may attach. Providers may ignore. */
  metadata?: Record<string, string>
}

export interface StorageUploadResult {
  /** Public URL where the uploaded asset can be fetched. */
  url: string
  /** Provider-specific identifier (e.g. S3 object key, blob id, file path). */
  deliveryId: string
  /**
   * Set when `url` is a presigned URL that expires. Epoch milliseconds.
   * Callers should re-presign or proxy if they need the URL to outlive this.
   */
  expiresAt?: number
}

export interface StorageAdapter {
  /** Short identifier for logs (e.g. `'file'`, `'s3'`, `'r2'`). */
  name: string
  upload(input: StorageUploadInput): Promise<StorageUploadResult>
}
