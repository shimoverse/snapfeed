'use client'

import { useFeedbackContext } from './FeedbackProvider'
import type { FeedbackContextValue } from './types'

/**
 * Hook for programmatic control of the feedback widget.
 *
 * Must be used inside a `<FeedbackProvider>`.
 *
 * @example
 * const { open, close, toggle, submit, isOpen } = useDevFeedback()
 *
 * // Open the widget
 * open()
 *
 * // Submit feedback programmatically
 * await submit({
 *   text: 'Something broke',
 *   pageUrl: window.location.href,
 *   pageName: 'Dashboard',
 * })
 */
export function useDevFeedback(): FeedbackContextValue {
  return useFeedbackContext()
}
