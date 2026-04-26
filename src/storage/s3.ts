/**
 * snapfeed — S3-Compatible Storage Adapter (Node only)
 *
 * Uploads bytes to any S3-API endpoint via PUT. Compatible with:
 *   - AWS S3
 *   - Cloudflare R2 (`region: 'auto'`, custom endpoint)
 *   - Backblaze B2 (S3-compatible API)
 *   - MinIO (`forcePathStyle: true`, custom endpoint)
 *   - DigitalOcean Spaces, Wasabi, etc.
 *
 * AWS Signature V4 is implemented in pure code with `node:crypto` — no SDK,
 * no extra runtime dependencies. The signing path is deliberately small and
 * mirrors the AWS reference implementation closely so it's easy to audit.
 *
 * **Node only** (uses `node:crypto`). Throws a clear error in browsers.
 */

import type { StorageAdapter, StorageUploadInput, StorageUploadResult } from './types'

export interface S3StorageOptions {
  bucket: string
  /** AWS region. For R2 use `'auto'`, for MinIO use the configured region. */
  region: string
  accessKeyId: string
  secretAccessKey: string
  /**
   * Override endpoint for non-AWS providers, e.g.
   * `'https://<account>.r2.cloudflarestorage.com'` for R2 or
   * `'http://localhost:9000'` for MinIO. Omit for AWS S3.
   */
  endpoint?: string
  /**
   * Use path-style URLs (`<endpoint>/<bucket>/<key>`) instead of
   * virtual-hosted-style (`<bucket>.<endpoint-host>/<key>`).
   * Required for MinIO; optional for R2 (R2 supports both).
   * @default false
   */
  forcePathStyle?: boolean
  /**
   * Generate the S3 object key for a given upload.
   * @default `(input) => input.filename`
   */
  toKey?: (input: StorageUploadInput) => string
  /**
   * Generate the public URL after a successful upload. By default returns
   * the request URL itself (works if the bucket / object is public).
   * Override to return a CDN URL or a presigned URL.
   */
  toUrl?: (key: string, region: string, bucket: string, endpoint?: string) => string
  /**
   * Optional `x-amz-acl` header value, e.g. `'public-read'`. Most modern
   * setups grant public access via bucket policy instead, so this is opt-in.
   */
  acl?: string
}

// ─── Node detection ──────────────────────────────────────────────────────────

function isNode(): boolean {
  return (
    typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node === 'string'
  )
}

// ─── Signing primitives ──────────────────────────────────────────────────────

type Crypto = typeof import('node:crypto')

function sha256Hex(crypto: Crypto, data: string | Uint8Array): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function hmac(crypto: Crypto, key: Uint8Array | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function hmacHex(crypto: Crypto, key: Uint8Array | string, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

/** RFC 3986 unreserved-character encoding used in canonical URIs. */
function uriEncode(str: string, encodeSlash: boolean): string {
  let out = ''
  for (const ch of str) {
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '_' ||
      ch === '-' ||
      ch === '~' ||
      ch === '.'
    ) {
      out += ch
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/'
    } else {
      const bytes = Buffer.from(ch, 'utf8')
      for (const b of bytes) {
        out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`
      }
    }
  }
  return out
}

interface SignInput {
  method: string
  host: string
  path: string                        // already-encoded path portion of URL
  region: string
  service: string                     // 's3'
  accessKeyId: string
  secretAccessKey: string
  payloadHash: string                 // sha256 hex of body
  headers: Record<string, string>     // case-insensitive; will be lowercased
  now?: Date                          // injectable for tests
}

interface SignOutput {
  authorization: string
  amzDate: string                     // YYYYMMDDTHHMMSSZ
  signedHeaders: string
  /** Map of headers (lowercased keys) that the caller should attach. */
  headersToSend: Record<string, string>
}

function signRequest(crypto: Crypto, input: SignInput): SignOutput {
  const now = input.now ?? new Date()
  const amzDate =
    `${now.getUTCFullYear()}` +
    `${String(now.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(now.getUTCDate()).padStart(2, '0')}` +
    'T' +
    `${String(now.getUTCHours()).padStart(2, '0')}` +
    `${String(now.getUTCMinutes()).padStart(2, '0')}` +
    `${String(now.getUTCSeconds()).padStart(2, '0')}` +
    'Z'
  const dateStamp = amzDate.slice(0, 8)

  // Lowercase header keys, trim values, and inject the required signing
  // headers. Caller's headers win for `Content-Type` etc.
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.headers)) {
    headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ')
  }
  headers['host'] = input.host
  headers['x-amz-date'] = amzDate
  headers['x-amz-content-sha256'] = input.payloadHash

  const sortedHeaderKeys = Object.keys(headers).sort()
  const canonicalHeaders =
    sortedHeaderKeys.map((k) => `${k}:${headers[k]}\n`).join('')
  const signedHeaders = sortedHeaderKeys.join(';')

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    '',                       // canonical query string (empty for our PUTs)
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(crypto, canonicalRequest),
  ].join('\n')

  const kDate = hmac(crypto, `AWS4${input.secretAccessKey}`, dateStamp)
  const kRegion = hmac(crypto, kDate, input.region)
  const kService = hmac(crypto, kRegion, input.service)
  const kSigning = hmac(crypto, kService, 'aws4_request')
  const signature = hmacHex(crypto, kSigning, stringToSign)

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`

  return {
    authorization,
    amzDate,
    signedHeaders,
    headersToSend: headers,
  }
}

// ─── URL construction ────────────────────────────────────────────────────────

interface BuiltUrl {
  url: string                  // full URL incl. scheme + path
  host: string                 // for the Host header
  pathForSigning: string       // canonical path used in sigv4
}

function buildUrl(args: {
  bucket: string
  region: string
  key: string
  endpoint?: string
  forcePathStyle: boolean
}): BuiltUrl {
  const encodedKey = uriEncode(args.key, false /* keep '/' as-is */)

  // Resolve base endpoint (no trailing slash).
  const base = args.endpoint
    ? args.endpoint.replace(/\/+$/, '')
    : `https://s3.${args.region}.amazonaws.com`

  const baseUrl = new URL(base)
  let host: string
  let pathForSigning: string
  let url: string

  if (args.forcePathStyle) {
    host = baseUrl.host
    pathForSigning = `/${args.bucket}/${encodedKey}`
    url = `${baseUrl.origin}${pathForSigning}`
  } else {
    // Virtual-hosted style: `<bucket>.<host>`.
    host = `${args.bucket}.${baseUrl.host}`
    pathForSigning = `/${encodedKey}`
    url = `${baseUrl.protocol}//${host}${pathForSigning}`
  }

  return { url, host, pathForSigning }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/**
 * S3-compatible storage adapter.
 *
 * @example
 * // AWS S3
 * s3Storage({
 *   bucket: 'my-bucket',
 *   region: 'us-east-1',
 *   accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
 *   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
 * })
 *
 * @example
 * // Cloudflare R2
 * s3Storage({
 *   bucket: 'feedback',
 *   region: 'auto',
 *   accessKeyId: process.env.R2_KEY!,
 *   secretAccessKey: process.env.R2_SECRET!,
 *   endpoint: `https://${ACCOUNT}.r2.cloudflarestorage.com`,
 *   toUrl: (key) => `https://cdn.example.com/${key}`,
 * })
 *
 * @example
 * // MinIO (path-style required)
 * s3Storage({
 *   bucket: 'feedback',
 *   region: 'us-east-1',
 *   endpoint: 'http://localhost:9000',
 *   forcePathStyle: true,
 *   accessKeyId: 'minioadmin',
 *   secretAccessKey: 'minioadmin',
 * })
 */
export function s3Storage(options: S3StorageOptions): StorageAdapter {
  const {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
    forcePathStyle = false,
    toKey,
    toUrl,
    acl,
  } = options

  // Validate at construction time that the endpoint host doesn't already
  // include the bucket prefix (`<bucket>.host`) — otherwise `buildUrl()`
  // would produce a doubled `<bucket>.<bucket>.host` and every PUT would
  // 404 with a confusing signing-mismatch error. Cleanest to fail early.
  if (endpoint) {
    try {
      const parsed = new URL(endpoint)
      if (parsed.host.startsWith(`${bucket}.`)) {
        throw new Error('s3Storage: endpoint must not include the bucket name')
      }
    } catch (err) {
      // Re-throw our own assertion verbatim, but surface URL parse errors
      // as a clearer adapter-construction error.
      if (err instanceof Error && err.message.startsWith('s3Storage:')) throw err
      throw new Error(`s3Storage: endpoint is not a valid URL: ${endpoint}`)
    }
  }

  return {
    name: 's3',
    async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
      if (!isNode()) {
        throw new Error('s3Storage requires Node (uses node:crypto)')
      }

      const crypto = await import('node:crypto')

      const key = toKey ? toKey(input) : input.filename
      const { url, host, pathForSigning } = buildUrl({
        bucket,
        region,
        key,
        endpoint,
        forcePathStyle,
      })

      const payloadHash = sha256Hex(crypto, input.bytes)

      const baseHeaders: Record<string, string> = {
        'content-type': input.mimeType,
        'content-length': String(input.bytes.byteLength),
      }
      if (acl) baseHeaders['x-amz-acl'] = acl

      const signed = signRequest(crypto, {
        method: 'PUT',
        host,
        path: pathForSigning,
        region,
        service: 's3',
        accessKeyId,
        secretAccessKey,
        payloadHash,
        headers: baseHeaders,
      })

      const finalHeaders: Record<string, string> = {
        ...signed.headersToSend,
        Authorization: signed.authorization,
      }

      const response = await fetch(url, {
        method: 'PUT',
        headers: finalHeaders,
        // Cast: Node 20+ fetch accepts Uint8Array bodies, but the TS lib types
        // pin BodyInit to the DOM definition which excludes it. Runtime is fine.
        body: input.bytes as unknown as BodyInit,
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text
        throw new Error(
          `s3Storage upload failed: ${response.status} ${response.statusText}` +
            (truncated ? ` — ${truncated}` : '')
        )
      }

      const publicUrl = toUrl ? toUrl(key, region, bucket, endpoint) : url

      return {
        url: publicUrl,
        deliveryId: key,
      }
    },
  }
}
