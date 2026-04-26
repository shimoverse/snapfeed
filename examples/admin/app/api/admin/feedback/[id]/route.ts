import { NextResponse } from 'next/server'
import { requireUser, UnauthorizedError } from '../../../../../lib/auth'
import {
  updateFeedback,
  type AdminFeedbackStatus,
} from '../../../../../lib/data'

const VALID_STATUSES: AdminFeedbackStatus[] = [
  'open',
  'triaged',
  'resolved',
  'wontfix',
]

interface PostBody {
  status?: string
  notes?: string
  triagedAt?: string
  resolvedAt?: string
}

/**
 * POST /api/admin/feedback/[id]
 *
 * Updates the sidecar status / notes for a feedback record. Auth via the
 * placeholder `requireUser()` shim. Body: `{ status?, notes? }`. Returns the
 * updated record (with sidecar merged) or 404 if no matching id.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let user
  try {
    user = requireUser()
  } catch (e) {
    if (e instanceof UnauthorizedError) {
      return NextResponse.json({ error: e.message }, { status: 401 })
    }
    throw e
  }
  if (user.role !== 'admin') {
    return NextResponse.json(
      { error: 'Viewer accounts cannot mutate feedback.' },
      { status: 403 },
    )
  }

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const patch: Parameters<typeof updateFeedback>[1] = {}

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as AdminFeedbackStatus)) {
      return NextResponse.json(
        {
          error: `Invalid status "${body.status}". Expected one of ${VALID_STATUSES.join(', ')}.`,
        },
        { status: 400 },
      )
    }
    patch.status = body.status as AdminFeedbackStatus
    // Stamp who-did-what so the sidecar carries provenance even if the client
    // forgot to send it.
    if (patch.status === 'triaged') {
      patch.triagedBy = user.email
      patch.triagedAt = body.triagedAt ?? new Date().toISOString()
    }
    if (patch.status === 'resolved') {
      patch.resolvedBy = user.email
      patch.resolvedAt = body.resolvedAt ?? new Date().toISOString()
    }
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') {
      return NextResponse.json(
        { error: 'notes must be a string.' },
        { status: 400 },
      )
    }
    patch.notes = body.notes
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'No mutable fields supplied.' },
      { status: 400 },
    )
  }

  const updated = await updateFeedback(params.id, patch)
  if (!updated) {
    return NextResponse.json(
      { error: `No feedback found with id ${params.id}.` },
      { status: 404 },
    )
  }
  return NextResponse.json(updated)
}
