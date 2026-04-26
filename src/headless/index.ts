/**
 * snapfeed/headless — public re-exports.
 *
 * Import from `snapfeed/headless` to access the customization layer:
 *   - `useFeedbackWidget()` — hook with form state + submit
 *   - Compound components (`FeedbackTrigger`, `FeedbackModal`, …)
 *   - `<FeedbackHeadless>` render-prop
 *   - `<FeedbackComponentsProvider>` for slot-based swaps
 *
 * Theme tokens live in `snapfeed/theme` (or the main `snapfeed` entry).
 */

// Hook
export { useFeedbackWidget } from './useFeedbackWidget'

// Types
export type {
  UseFeedbackResult,
  WidgetState,
  FeedbackFormState,
  FeedbackFormApi,
} from './types'

// Compound components
export {
  FeedbackRoot,
  FeedbackTrigger,
  FeedbackModal,
  FeedbackTextarea,
  FeedbackCategorySelect,
  FeedbackScreenshotPreview,
  FeedbackSubmitButton,
  FeedbackError,
  FeedbackSuccess,
} from './components'
export type {
  FeedbackRootProps,
  FeedbackTriggerProps,
  FeedbackModalProps,
  FeedbackTextareaProps,
  FeedbackCategorySelectProps,
  FeedbackScreenshotPreviewProps,
  FeedbackSubmitButtonProps,
  FeedbackErrorProps,
  FeedbackSuccessProps,
} from './components'

// Render-prop
export { FeedbackHeadless } from './render-props'
export type { FeedbackHeadlessProps, FeedbackRenderProps } from './render-props'

// Slot-based swappable components
export {
  FeedbackComponentsProvider,
  FeedbackComponentsContext,
  useFeedbackComponents,
} from './swappable'
export type {
  FeedbackComponents,
  FeedbackComponentsProviderProps,
} from './swappable'
