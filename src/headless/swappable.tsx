'use client'

/**
 * snapfeed/headless — Swappable component slots.
 *
 * Lets a consumer keep snapfeed's compound components but replace any one
 * of them with their own implementation. Useful for matching a design
 * system: drop in your own <Textarea> / <Button> / <Modal> while leaving
 * the rest of the widget intact.
 *
 * Usage:
 *   <FeedbackProvider>
 *     <FeedbackComponentsProvider components={{ Textarea: MyTextarea }}>
 *       <FeedbackTrigger>Open</FeedbackTrigger>
 *     </FeedbackComponentsProvider>
 *   </FeedbackProvider>
 */

import * as React from 'react'

export interface FeedbackComponents {
  Trigger?: React.ComponentType<{ onOpen: () => void; children?: React.ReactNode }>
  Modal?: React.ComponentType<{ onClose: () => void; children: React.ReactNode }>
  Textarea?: React.ComponentType<{
    value: string
    onChange: (v: string) => void
    placeholder?: string
  }>
  CategoryChip?: React.ComponentType<{
    label: string
    emoji?: string
    selected: boolean
    onClick: () => void
  }>
  SubmitButton?: React.ComponentType<{
    onClick: () => void
    loading: boolean
    disabled: boolean
    children?: React.ReactNode
  }>
}

export const FeedbackComponentsContext = React.createContext<FeedbackComponents>({})

export interface FeedbackComponentsProviderProps {
  components: FeedbackComponents
  children: React.ReactNode
}

export function FeedbackComponentsProvider(
  props: FeedbackComponentsProviderProps
): JSX.Element {
  // Memo so unchanged `components` references don't churn consumers.
  const value = React.useMemo(() => props.components, [props.components])
  return (
    <FeedbackComponentsContext.Provider value={value}>
      {props.children}
    </FeedbackComponentsContext.Provider>
  )
}

export function useFeedbackComponents(): FeedbackComponents {
  return React.useContext(FeedbackComponentsContext)
}
