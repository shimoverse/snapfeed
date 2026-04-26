'use client'

/**
 * snapfeed/headless — render-props escape hatch.
 *
 * For consumers who want maximum control: render any UI you like, given
 * the full widget state. Equivalent to calling `useFeedbackWidget()`
 * directly, but lets you compose without writing a wrapper component.
 *
 *   <FeedbackHeadless>
 *     {({ state, open, form, submit }) => (
 *       <YourCustomUI ... />
 *     )}
 *   </FeedbackHeadless>
 */

import * as React from 'react'
import { useFeedbackWidget } from './useFeedbackWidget'
import type { UseFeedbackResult } from './types'

export type FeedbackRenderProps = UseFeedbackResult

export interface FeedbackHeadlessProps {
  children: (state: FeedbackRenderProps) => React.ReactNode
}

export function FeedbackHeadless(props: FeedbackHeadlessProps): JSX.Element {
  const state = useFeedbackWidget()
  return <>{props.children(state)}</>
}
