import type { FeedbackTargetContext } from './types'

const MAX_TEXT_LENGTH = 120
const MAX_CLASSES = 5
const SNAPFEED_UI_SELECTOR = '[data-snapfeed-ui]'

const DEFAULT_STYLE_PROPS = [
  'display',
  'position',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'padding',
  'margin',
  'border-radius',
] as const

/** @internal */
export function shouldIgnoreElementForSnapfeedContext(element: Element | null): boolean {
  if (!element) return true
  return Boolean(element.closest(SNAPFEED_UI_SELECTOR))
}

/** @internal */
export function buildElementContext(
  element: Element | null,
  options: { styleProperties?: readonly string[] } = {}
): FeedbackTargetContext | undefined {
  if (!element || shouldIgnoreElementForSnapfeedContext(element)) return undefined

  const html = element as HTMLElement
  const rect = html.getBoundingClientRect?.()
  const classes = Array.from(element.classList ?? [])
    .filter(Boolean)
    .slice(0, MAX_CLASSES)
  const attributes = collectAgentUsefulAttributes(element)
  const visibleText =
    typeof html.innerText === 'string' ? html.innerText : (element.textContent ?? '')
  const text = truncate(normalizeWhitespace(visibleText), MAX_TEXT_LENGTH)
  const componentName = findComponentName(element)
  const computedStyles = collectComputedStyles(
    element,
    options.styleProperties ?? DEFAULT_STYLE_PROPS
  )

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: classes.length ? classes : undefined,
    role: element.getAttribute('role') ?? inferImplicitRole(element),
    ariaLabel: element.getAttribute('aria-label') ?? undefined,
    text: text || undefined,
    selector: buildSelector(element),
    domPath: buildDomPath(element),
    componentName,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    boundingRect: rect
      ? {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
        }
      : undefined,
    computedStyles,
  }
}

function collectAgentUsefulAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const name of [
    'data-testid',
    'data-test-id',
    'data-cy',
    'name',
    'type',
    'href',
    'title',
  ]) {
    const value = element.getAttribute(name)
    if (value) attrs[name] = value
  }
  return attrs
}

function findComponentName(element: Element): string | undefined {
  const componentEl = element.closest('[data-component], [data-snapfeed-component]')
  return (
    componentEl?.getAttribute('data-component') ??
    componentEl?.getAttribute('data-snapfeed-component') ??
    undefined
  )
}

function collectComputedStyles(
  element: Element,
  properties: readonly string[]
): Record<string, string> | undefined {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return undefined
  }

  const styles = window.getComputedStyle(element)
  const out: Record<string, string> = {}
  for (const prop of properties) {
    const value = styles.getPropertyValue(prop)
    if (value) out[prop] = value
  }
  return Object.keys(out).length ? out : undefined
}

function buildSelector(element: Element): string {
  const testIdSelector = dataAttributeSelector(element, 'data-testid')
  if (testIdSelector) return testIdSelector

  const testIdAltSelector = dataAttributeSelector(element, 'data-test-id')
  if (testIdAltSelector) return testIdAltSelector

  const cySelector = dataAttributeSelector(element, 'data-cy')
  if (cySelector) return cySelector

  if (element.id) return `#${cssEscape(element.id)}`

  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.documentElement) {
    parts.unshift(selectorPart(current))
    const candidate = parts.join(' > ')
    if (isUniqueSelector(candidate, element)) return candidate
    current = current.parentElement
  }
  return parts.join(' > ')
}

function dataAttributeSelector(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)
  return value ? `[${name}="${cssEscape(value)}"]` : undefined
}

function selectorPart(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const classPart = Array.from(element.classList ?? [])
    .filter(Boolean)
    .slice(0, 3)
    .map(cls => `.${cssEscape(cls)}`)
    .join('')

  if (!element.parentElement) return `${tag}${classPart}`

  const sameTagSiblings = Array.from(element.parentElement.children).filter(
    sibling => sibling.tagName === element.tagName
  )
  if (sameTagSiblings.length <= 1) return `${tag}${classPart}`

  const nth = sameTagSiblings.indexOf(element) + 1
  return `${tag}${classPart}:nth-of-type(${nth})`
}

function isUniqueSelector(selector: string, element: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === element
  } catch {
    return false
  }
}

function buildDomPath(element: Element): string {
  const parts: string[] = []
  let current: Element | null = element
  while (current && current !== document.documentElement) {
    parts.unshift(domPathPart(current))
    current = current.parentElement
  }
  return parts.join(' > ')
}

function domPathPart(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const id = element.id ? `#${element.id}` : ''
  const classes = Array.from(element.classList ?? [])
    .filter(Boolean)
    .slice(0, 3)
    .map(cls => `.${cls}`)
    .join('')
  return `${tag}${id}${classes}`
}

function inferImplicitRole(element: Element): string | undefined {
  const tag = element.tagName.toLowerCase()
  if (tag === 'button') return 'button'
  if (tag === 'a' && element.hasAttribute('href')) return 'link'
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase()
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'button' || type === 'submit') return 'button'
    return 'textbox'
  }
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return 'combobox'
  return undefined
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
