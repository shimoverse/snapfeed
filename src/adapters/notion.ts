/**
 * snapfeed — Notion Adapter
 *
 * Server-side only. Creates a page in a Notion database for each feedback
 * submission. The database must have a title property (default "Name") and
 * optionally `select`-typed Category and Status properties.
 *
 * Screenshots are embedded as inline image blocks using a `data:` URI.
 * Notion's renderer accepts data URIs up to ~1MB — anything larger is
 * skipped with a warning, and the page is still created.
 *
 * @example
 * import { notionAdapter } from 'snapfeed/adapters'
 *
 * notionAdapter({
 *   apiKey: process.env.NOTION_INTEGRATION_SECRET!,
 *   databaseId: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
 *   titleProperty: 'Name',
 *   categoryProperty: 'Category',
 *   statusProperty: 'Status',
 *   defaultStatus: 'Triage',
 * })
 */

import type {
  FeedbackAdapter,
  FeedbackAdapterResult,
  FeedbackPayload,
} from './types'

export interface NotionAdapterOptions {
  /** Notion internal integration secret (`secret_...`). */
  apiKey: string
  /** Database id (with or without dashes) the page is created in. */
  databaseId: string
  /**
   * Title property name on the database.
   * @default "Name"
   */
  titleProperty?: string
  /**
   * Select-typed property used for the feedback category.
   * @default "Category"
   */
  categoryProperty?: string
  /**
   * Select-typed property used for the initial status.
   * @default "Status"
   */
  statusProperty?: string
  /**
   * Initial status value.
   * @default "Triage"
   */
  defaultStatus?: string
  /**
   * Notion API version header.
   * @default "2022-06-28"
   */
  notionVersion?: string
}

const NOTION_PAGES_URL = 'https://api.notion.com/v1/pages'

/** Notion's renderer rejects data URIs above ~1MB. */
const SCREENSHOT_DATA_URI_LIMIT_BYTES = 1024 * 1024

const CATEGORY_EMOJIS: Record<string, string> = {
  bug: '🐛',
  idea: '💡',
  question: '❓',
  praise: '🙌',
  other: '📝',
}

function buildTitle(payload: FeedbackPayload): string {
  const emoji = payload.category ? (CATEGORY_EMOJIS[payload.category] ?? '') : ''
  const head = emoji ? `${emoji} ` : ''
  const truncated =
    payload.text.length > 80 ? `${payload.text.slice(0, 80)}…` : payload.text
  return `[Feedback] ${head}${truncated}`.trim()
}

interface RichText {
  type: 'text'
  text: { content: string; link?: { url: string } | null }
}

function richText(content: string): RichText[] {
  return [{ type: 'text', text: { content } }]
}

interface NotionBlock {
  object: 'block'
  type: string
  [key: string]: unknown
}

function paragraphBlock(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: richText(content) },
  }
}

function dividerBlock(): NotionBlock {
  return { object: 'block', type: 'divider', divider: {} }
}

function heading3Block(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'heading_3',
    heading_3: { rich_text: richText(content) },
  }
}

function bulletedItem(content: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: richText(content) },
  }
}

function codeBlock(content: string, language = 'plain text'): NotionBlock {
  return {
    object: 'block',
    type: 'code',
    code: { rich_text: richText(content), language },
  }
}

function imageBlock(dataUri: string): NotionBlock {
  return {
    object: 'block',
    type: 'image',
    image: { type: 'external', external: { url: dataUri } },
  }
}

/**
 * Notion adapter — creates a page in a database for each feedback submission.
 *
 * **Server-side only.** Never use this in a client-side bundle.
 *
 * The Notion API sometimes returns HTTP 200 with `{ object: "error", ... }`
 * in the body — this adapter detects that and returns `ok: false`.
 *
 * @example
 * notionAdapter({
 *   apiKey: process.env.NOTION_INTEGRATION_SECRET!,
 *   databaseId: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
 * })
 */
export function notionAdapter(options: NotionAdapterOptions): FeedbackAdapter {
  const {
    apiKey,
    databaseId,
    titleProperty = 'Name',
    categoryProperty = 'Category',
    statusProperty = 'Status',
    defaultStatus = 'Triage',
    notionVersion = '2022-06-28',
  } = options

  if (!apiKey || !databaseId) {
    throw new Error('[notionAdapter] apiKey and databaseId are required')
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': notionVersion,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  return {
    name: 'notion',
    async send(payload: FeedbackPayload): Promise<FeedbackAdapterResult> {
      const warnings: string[] = []

      try {
        const sender = payload.user?.name
          ? `${payload.user.name}${payload.user.email ? ` <${payload.user.email}>` : ''}`
          : 'Anonymous'

        const properties: Record<string, unknown> = {
          [titleProperty]: {
            title: [{ type: 'text', text: { content: buildTitle(payload) } }],
          },
          [categoryProperty]: {
            select: { name: payload.category ?? 'other' },
          },
          [statusProperty]: {
            select: { name: defaultStatus },
          },
        }

        const children: NotionBlock[] = []
        // Body text first.
        children.push(paragraphBlock(payload.text))
        children.push(dividerBlock())
        children.push(heading3Block('Context'))
        children.push(bulletedItem(`URL: ${payload.pageUrl}`))
        children.push(
          bulletedItem(`Reporter: ${sender}`)
        )
        if (payload.metadata?.viewport) {
          children.push(bulletedItem(`Viewport: ${payload.metadata.viewport}`))
        }
        children.push(bulletedItem(`Timestamp: ${payload.timestamp}`))

        const errors = payload.metadata?.consoleErrors?.slice(-5) ?? []
        if (errors.length > 0) {
          children.push(heading3Block('Console errors'))
          children.push(codeBlock(errors.join('\n')))
        }

        if (payload.screenshot?.base64) {
          const approxBytes = Math.floor(payload.screenshot.base64.length * 0.75)
          if (approxBytes > SCREENSHOT_DATA_URI_LIMIT_BYTES) {
            warnings.push(
              `screenshot skipped: data URI ${approxBytes} bytes exceeds Notion limit (~1MB)`
            )
          } else {
            const mime = payload.screenshot.mimeType || 'image/png'
            const dataUri = `data:${mime};base64,${payload.screenshot.base64}`
            children.push(imageBlock(dataUri))
          }
        }

        const body = {
          parent: { database_id: databaseId },
          properties,
          children,
        }

        const res = await fetch(NOTION_PAGES_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })

        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {
            ok: false,
            error: `${res.status}: ${text.slice(0, 500)}`,
          }
        }

        const json = (await res.json()) as {
          object?: string
          id?: string
          message?: string
          code?: string
        }

        // Notion sometimes returns 200 with { object: "error" } — treat as failure.
        if (json.object === 'error') {
          const detail = json.message ?? json.code ?? 'unknown Notion error'
          return { ok: false, error: `Notion API error: ${detail}` }
        }

        if (!json.id) {
          return {
            ok: false,
            error: 'Notion returned 2xx but no page id in response body',
          }
        }

        return {
          ok: true,
          deliveryId: json.id,
          ...(warnings.length > 0 ? { warnings } : {}),
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, error: `Notion adapter error: ${message}` }
      }
    },
  }
}
