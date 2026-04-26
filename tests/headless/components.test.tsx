// @vitest-environment jsdom
/**
 * Tests for src/headless/components.
 *
 * NOTE: All cases here are currently `it.todo` for the same reasons as
 * useFeedbackWidget.test.tsx — see that file's header for the full list:
 *   1. devDep: jsdom
 *   2. devDep: @testing-library/react
 *   3. vitest.config.ts: include `tests/**\/*.test.tsx`
 *
 * The hook-level coverage in useFeedbackWidget.test.tsx exercises the
 * core state machine; these tests cover render contract + slot swap.
 */

import { describe, it } from 'vitest'

describe('FeedbackTrigger', () => {
  it.todo(
    'renders a <button> by default and opens the widget on click'
    //   render(
    //     <FeedbackProvider adapters={[consoleAdapter()]}>
    //       <FeedbackTrigger>Open</FeedbackTrigger>
    //     </FeedbackProvider>
    //   )
    //   const btn = screen.getByRole('button', { name: 'Open' })
    //   fireEvent.click(btn)
    //   // Modal should now be in the document — assert via FeedbackModal.
  )

  it.todo(
    'asChild clones the single child and attaches onClick'
    //   const MyButton = ({ onClick, children }) => (
    //     <a href="#" onClick={onClick}>{children}</a>
    //   )
    //   render(
    //     <FeedbackProvider …>
    //       <FeedbackTrigger asChild><MyButton>Open</MyButton></FeedbackTrigger>
    //     </FeedbackProvider>
    //   )
    //   const link = screen.getByText('Open')
    //   expect(link.tagName).toBe('A')
    //   fireEvent.click(link)
    //   // Widget should now be open.
  )
})

describe('FeedbackModal', () => {
  it.todo(
    'renders nothing while widget state is "idle"'
    //   const { container } = render(
    //     <FeedbackProvider …>
    //       <FeedbackModal>hi</FeedbackModal>
    //     </FeedbackProvider>
    //   )
    //   expect(container.firstChild).toBeNull()
  )

  it.todo(
    'renders content once open() is called'
    //   const onClose = vi.fn()
    //   render(
    //     <FeedbackProvider …>
    //       <FeedbackTrigger>Open</FeedbackTrigger>
    //       <FeedbackModal onClose={onClose}>panel</FeedbackModal>
    //     </FeedbackProvider>
    //   )
    //   fireEvent.click(screen.getByText('Open'))
    //   expect(screen.getByText('panel')).toBeInTheDocument()
  )

  it.todo(
    'ESC key calls the onClose prop'
    //   fireEvent.keyDown(document, { key: 'Escape' })
    //   expect(onClose).toHaveBeenCalledTimes(1)
  )
})

describe('FeedbackTextarea', () => {
  it.todo(
    'renders with the given placeholder and tracks form.text via context'
    //   render(<FeedbackProvider …><FeedbackTextarea placeholder="hi" /></FeedbackProvider>)
    //   const ta = screen.getByPlaceholderText('hi') as HTMLTextAreaElement
    //   fireEvent.change(ta, { target: { value: 'typing' } })
    //   expect(ta.value).toBe('typing')
  )
})

describe('FeedbackComponentsProvider', () => {
  it.todo(
    'swaps in a custom Trigger component when provided'
    //   const MyTrigger = ({ onOpen, children }) => (
    //     <button data-custom onClick={onOpen}>{children}</button>
    //   )
    //   render(
    //     <FeedbackProvider …>
    //       <FeedbackComponentsProvider components={{ Trigger: MyTrigger }}>
    //         <FeedbackTrigger>Open</FeedbackTrigger>
    //       </FeedbackComponentsProvider>
    //     </FeedbackProvider>
    //   )
    //   expect(screen.getByText('Open').dataset.custom).toBe('')
  )
})
