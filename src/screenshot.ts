import type { FeedbackScreenshot } from './types'

/**
 * Captures a screenshot of the current page using html2canvas (if available).
 * Falls back gracefully if html2canvas is not installed.
 *
 * html2canvas is an optional peer dependency. Install it separately:
 * ```
 * npm install html2canvas
 * ```
 */
export async function captureScreenshot(): Promise<FeedbackScreenshot | null> {
  if (typeof window === 'undefined') return null

  try {
    // Dynamic import — html2canvas is optional
    const html2canvas = await import('html2canvas').then(m => m.default ?? m)

    const canvas = await html2canvas(document.body, {
      logging: false,
      useCORS: true,
      allowTaint: true,
      scale: Math.min(window.devicePixelRatio, 2), // cap at 2x for size
    })

    return new Promise(resolve => {
      canvas.toBlob(
        blob => {
          if (!blob) {
            resolve(null)
            return
          }
          const reader = new FileReader()
          reader.onload = ev => {
            const dataUrl = ev.target?.result as string
            const base64 = dataUrl.split(',')[1]
            if (!base64) {
              resolve(null)
              return
            }
            resolve({ base64, mimeType: 'image/jpeg' })
          }
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        },
        'image/jpeg',
        0.8
      )
    })
  } catch {
    // html2canvas not installed, or capture failed
    return null
  }
}

/**
 * Converts a File object to a FeedbackScreenshot.
 */
export async function fileToScreenshot(file: File): Promise<FeedbackScreenshot | null> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      const base64 = dataUrl.split(',')[1]
      if (!base64) {
        resolve(null)
        return
      }
      resolve({ base64, mimeType: file.type || 'image/png' })
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Extracts an image from a ClipboardEvent's items.
 * Returns null if no image was found.
 */
export function extractImageFromClipboard(
  event: ClipboardEvent
): File | null {
  const items = event.clipboardData?.items
  if (!items) return null
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  return null
}
