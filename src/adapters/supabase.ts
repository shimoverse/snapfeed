import type { FeedbackAdapter, FeedbackAdapterResult, FeedbackPayload } from './types'

export interface SupabaseAdapterOptions {
  /** Supabase project URL */
  url: string
  /**
   * Supabase anon key (for client-side use) or service role key (for server-side).
   * Use the service role key in server environments (Next.js API routes, Express).
   */
  anonKey?: string
  /**
   * Alias for anonKey. When running server-side, pass your service role key here.
   */
  serviceKey?: string
  /**
   * Table name to insert feedback into.
   * @default "feedback"
   */
  table?: string
}

interface SupabaseFeedbackRow {
  app_name: string
  text: string
  page_name: string | null
  page_url: string | null
  sender: string | null
  sender_email: string | null
  image_base64: string | null
  image_mime_type: string | null
  metadata: Record<string, unknown> | null
  delivered: boolean
  delivery_channel: string | null
  delivery_id: string | null
  category: string | null
  resolved: boolean
}

/**
 * Supabase adapter — inserts feedback into a Supabase table via the REST API.
 * Works on both client and server side.
 *
 * Required table schema:
 * ```sql
 * CREATE TABLE feedback (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   created_at timestamptz DEFAULT now(),
 *   app_name text NOT NULL,
 *   text text NOT NULL,
 *   page_name text,
 *   page_url text,
 *   sender text,
 *   sender_email text,
 *   image_base64 text,
 *   image_mime_type text,
 *   metadata jsonb,
 *   delivered boolean DEFAULT false,
 *   delivery_channel text,
 *   delivery_id text
 * );
 * ```
 *
 * @example
 * supabaseAdapter({
 *   url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *   anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
 * })
 */
export function supabaseAdapter(options: SupabaseAdapterOptions): FeedbackAdapter {
  const { url, table = 'feedback' } = options
  const key = options.serviceKey ?? options.anonKey

  if (!url || !key) {
    throw new Error('[supabaseAdapter] url and anonKey (or serviceKey) are required')
  }

  const insertUrl = `${url.replace(/\/$/, '')}/rest/v1/${table}`
  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=representation',
  }

  return {
    name: 'supabase',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const row: SupabaseFeedbackRow = {
        app_name: payload.appName,
        text: payload.text,
        page_name: payload.pageName ?? null,
        page_url: payload.pageUrl ?? null,
        sender: payload.user?.name ?? null,
        sender_email: payload.user?.email ?? null,
        image_base64: payload.screenshot?.base64 ?? null,
        image_mime_type: payload.screenshot?.mimeType ?? null,
        metadata: payload.metadata
          ? {
              viewport: payload.metadata.viewport,
              userAgent: payload.metadata.userAgent,
              consoleErrors: payload.metadata.consoleErrors,
            }
          : null,
        delivered: false,
        delivery_channel: null,
        delivery_id: null,
        category: payload.category ?? null,
        resolved: false,
      }

      try {
        const res = await fetch(insertUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(row),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `Supabase insert failed (${res.status}): ${text.slice(0, 300)}`,
          }
        }

        const data = (await res.json()) as Array<{ id?: string }>
        const insertedId = data?.[0]?.id

        return { ok: true, deliveryId: insertedId }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Supabase adapter error: ${message}` }
      }
    },
  }
}
