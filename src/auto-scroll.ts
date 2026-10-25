import type { PointerPosition } from './drag-drop-manager'

export type AutoScrollOptions = {
  /** Px from an edge where scrolling starts (a scroll container's zone is at most a quarter of it). */
  threshold: number
  /** Px per frame. */
  speed: number
}

const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/

/** Whether `element` may scroll on an axis: its overflow allows it and its content overflows. */
function scrollsOn(element: Element, style: CSSStyleDeclaration, axis: 'x' | 'y'): boolean {
  return axis === 'y'
    ? SCROLLABLE_OVERFLOW.test(style.overflowY) && element.scrollHeight > element.clientHeight
    : SCROLLABLE_OVERFLOW.test(style.overflowX) && element.scrollWidth > element.clientWidth
}

/** The step on one axis: toward the edge the pointer is near, if the scroller can still go there. */
function stepOn(
  pointer: number,
  start: number,
  end: number,
  zone: number,
  speed: number,
  canGoBack: boolean,
  canGoForward: boolean,
): number {
  if (pointer < start + zone && canGoBack) return -speed
  if (pointer > end - zone && canGoForward) return speed
  return 0
}

/**
 * Scrolls one step toward the edge the pointer is near: the closest scroll container around
 * `hit` (the element under the pointer) that can still scroll that way, or else the window.
 * Returns whether anything scrolled, so the caller keeps going while the pointer rests there.
 */
export function autoScrollStep(
  pos: PointerPosition,
  hit: Element | null,
  { threshold, speed }: AutoScrollOptions,
): boolean {
  if (speed <= 0 || threshold <= 0) return false

  for (let element = hit; element; element = element.parentElement) {
    // The document's own scrolling is the window's, below.
    if (element === document.body || element === document.documentElement) break
    const style = getComputedStyle(element)
    const scrollsX = scrollsOn(element, style, 'x')
    const scrollsY = scrollsOn(element, style, 'y')
    if (!scrollsX && !scrollsY) continue

    const rect = element.getBoundingClientRect()
    const left = scrollsX
      ? stepOn(
          pos.x,
          rect.left,
          rect.right,
          Math.min(threshold, rect.width / 4),
          speed,
          element.scrollLeft > 0,
          element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
        )
      : 0
    const top = scrollsY
      ? stepOn(
          pos.y,
          rect.top,
          rect.bottom,
          Math.min(threshold, rect.height / 4),
          speed,
          element.scrollTop > 0,
          element.scrollTop + element.clientHeight < element.scrollHeight - 1,
        )
      : 0
    if (left !== 0 || top !== 0) {
      // `instant` so a `scroll-behavior: smooth` scroller does not restart an animation per frame.
      element.scrollBy({ left, top, behavior: 'instant' })
      return true
    }
  }

  const left = stepOn(pos.x, 0, window.innerWidth, threshold, speed, true, true)
  const top = stepOn(pos.y, 0, window.innerHeight, threshold, speed, true, true)
  if (left === 0 && top === 0) return false
  const before = [window.scrollX, window.scrollY]
  window.scrollBy({ left, top, behavior: 'instant' })
  return window.scrollX !== before[0] || window.scrollY !== before[1]
}
