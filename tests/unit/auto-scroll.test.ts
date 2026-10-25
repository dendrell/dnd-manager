import { afterEach, describe, expect, test, vi } from 'vitest'
import { autoScrollStep } from '../../src/auto-scroll'

type ScrollerSetup = {
  top: number
  height: number
  scrollTop?: number
  scrollHeight?: number
  overflowY?: string
}

/** A vertical scroll container: jsdom lays nothing out, so its metrics are stubbed. */
function makeScroller(parent: HTMLElement, setup: ScrollerSetup): HTMLElement {
  const element = document.createElement('div')
  element.style.overflowY = setup.overflowY ?? 'auto'
  parent.appendChild(element)
  const rect = { left: 0, right: 400, top: setup.top, bottom: setup.top + setup.height }
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    width: 400,
    height: setup.height,
    x: 0,
    y: setup.top,
    toJSON: () => rect,
  })
  Object.defineProperty(element, 'clientHeight', { value: setup.height })
  Object.defineProperty(element, 'scrollHeight', { value: setup.scrollHeight ?? setup.height * 5 })
  element.scrollTop = setup.scrollTop ?? 0
  element.scrollBy = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options === 'object') element.scrollTop += options.top ?? 0
  }) as typeof element.scrollBy
  return element
}

const options = { threshold: 100, speed: 10 }

describe('autoScrollStep', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  test('scrolls the scroll container under the pointer near its edge', () => {
    const scroller = makeScroller(document.body, { top: 300, height: 200 })
    const hit = scroller.appendChild(document.createElement('span'))
    const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})

    expect(autoScrollStep({ x: 200, y: 490 }, hit, options)).toBe(true)
    expect(scroller.scrollBy).toHaveBeenCalledWith({ left: 0, top: 10, behavior: 'instant' })
    expect(windowScroll).not.toHaveBeenCalled()
  })

  test("caps a container's edge zone at a quarter of its size", () => {
    const scroller = makeScroller(document.body, { top: 300, height: 200, scrollTop: 50 })
    const hit = scroller.appendChild(document.createElement('span'))

    // 60px from the top: inside the 100px threshold, outside a quarter of 200px.
    expect(autoScrollStep({ x: 200, y: 360 }, hit, options)).toBe(false)
    expect(scroller.scrollBy).not.toHaveBeenCalled()
  })

  test('passes to the outer scroll container when the inner one is at its end', () => {
    const outer = makeScroller(document.body, { top: 0, height: 600, scrollTop: 100 })
    const inner = makeScroller(outer, { top: 400, height: 200, scrollTop: 0 })
    const hit = inner.appendChild(document.createElement('span'))

    // Near the top of both: the inner one is already at its top.
    expect(autoScrollStep({ x: 200, y: 410 }, hit, { threshold: 100, speed: 10 })).toBe(false)
    expect(autoScrollStep({ x: 200, y: 590 }, hit, options)).toBe(true)
    expect(inner.scrollBy).toHaveBeenCalledOnce()

    inner.scrollTop = 800 // its end: scrollHeight 1000 - clientHeight 200
    expect(autoScrollStep({ x: 200, y: 590 }, hit, options)).toBe(true)
    expect(outer.scrollBy).toHaveBeenCalledWith({ left: 0, top: 10, behavior: 'instant' })
  })

  test('ignores elements that do not scroll', () => {
    const box = makeScroller(document.body, { top: 300, height: 200, overflowY: 'visible' })
    const hit = box.appendChild(document.createElement('span'))
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})

    expect(autoScrollStep({ x: 200, y: 490 }, hit, options)).toBe(false)
    expect(box.scrollBy).not.toHaveBeenCalled()
  })

  test('falls back to the window and reports whether it moved', () => {
    let scrollY = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
    const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(((
      scroll: ScrollToOptions,
    ) => {
      scrollY += scroll.top ?? 0
    }) as typeof window.scrollBy)
    const bottom = window.innerHeight - 5

    expect(autoScrollStep({ x: 500, y: bottom }, null, options)).toBe(true)
    expect(windowScroll).toHaveBeenCalledWith({ left: 0, top: 10, behavior: 'instant' })

    // At the end of the page the step changes nothing: the caller stops asking.
    windowScroll.mockImplementation(() => {})
    expect(autoScrollStep({ x: 500, y: bottom }, null, options)).toBe(false)
  })

  test('does nothing with a zero speed', () => {
    const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    expect(autoScrollStep({ x: 0, y: 0 }, null, { threshold: 100, speed: 0 })).toBe(false)
    expect(windowScroll).not.toHaveBeenCalled()
  })
})
