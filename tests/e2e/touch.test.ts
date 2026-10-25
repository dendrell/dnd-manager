import { afterEach, expect, test } from 'vitest'
import { cdp } from 'vitest/browser'
import { DragDropManager } from '../../dist/index.mjs'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Maps a point in the test iframe's viewport to the top-level page, where CDP input lands. */
function toPage(x: number, y: number): { x: number; y: number } {
  const frame = window.frameElement as HTMLElement | null
  if (!frame) return { x, y }
  const rect = frame.getBoundingClientRect()
  const scale = rect.width / frame.offsetWidth
  return { x: rect.left + x * scale, y: rect.top + y * scale }
}

/** Real touch input (CDP), which the browser may turn into a pan of the scroll container. */
async function touch(type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0): Promise<void> {
  await cdp().send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [toPage(x, y)],
  })
}

/** A finger on cell 3 of a scrollable list, held `holdMs`, then moving up to cell 1. */
async function swipeUp(holdMs: number): Promise<void> {
  await touch('touchStart', 100, 210)
  await wait(holdMs)
  for (let step = 1; step <= 12; step++) {
    await touch('touchMove', 100, 210 - step * 10)
    await wait(16)
  }
  await touch('touchEnd')
  await wait(50)
}

let destroy: (() => void) | null = null
afterEach(() => {
  destroy?.()
  destroy = null
})

function renderList(config: Record<string, unknown>, { detach = false } = {}) {
  document.body.innerHTML = `
    <div id="list" style="width: 200px; height: 240px; overflow-y: auto">
      ${Array.from(
        { length: 30 },
        (_, i) => `<div data-kind="cell" data-id="${i}" style="height: 60px">Cell ${i}</div>`,
      ).join('')}
    </div>
  `
  const list = document.querySelector<HTMLElement>('#list')!
  const log = { started: 0, dropped: [] as string[], cancels: 0 }
  const onCancel = (): void => void log.cancels++
  window.addEventListener('pointercancel', onCancel, true)
  const manager = new DragDropManager<string, string>(
    list,
    // No auto-scroll: any scroll below is the browser's pan.
    { draggableKind: 'cell', droppableKind: 'cell', scrollSpeed: 0, ...config },
    {
      getItemPosition: (el) => el.dataset.id ?? null,
      getItemData: (el) => el.dataset.id ?? null,
      onDragStart: (el) => {
        log.started++
        // A virtualized list unmounting the dragged row.
        if (detach) el.remove()
      },
      onDrop: (from, to) => void log.dropped.push(`${from}->${to}`),
    },
  )
  destroy = () => {
    window.removeEventListener('pointercancel', onCancel, true)
    manager.destroy()
  }
  return { list, log }
}

test('a touch drag in a scrollable list is not cancelled by the browser panning', async () => {
  const { list, log } = renderList({})

  await swipeUp(0)

  expect(log).toEqual({ started: 1, dropped: ['3->1'], cancels: 0 })
  expect(list.scrollTop).toBe(0)
})

test('a touch drag survives its source leaving the DOM', async () => {
  const { list, log } = renderList({}, { detach: true })

  await swipeUp(0)

  expect(log).toEqual({ started: 1, dropped: ['3->1'], cancels: 0 })
  expect(list.scrollTop).toBe(0)
})

test('with a touch dragDelay, a long press drags and a quick swipe scrolls the list', async () => {
  const { list, log } = renderList({ dragDelay: { touch: 300 } })

  await swipeUp(400)
  expect(log).toEqual({ started: 1, dropped: ['3->1'], cancels: 0 })
  expect(list.scrollTop).toBe(0)

  await swipeUp(0)
  expect(log.started).toBe(1)
  expect(list.scrollTop).toBeGreaterThan(50)
})
