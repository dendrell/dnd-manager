import { expect, test } from 'vitest'
import { DragDropManager } from '../../dist/index.mjs'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('a scroll container scrolls while the pointer rests near its edge', async () => {
  document.body.innerHTML = `
    <div data-testid="scroller" style="height: 200px; width: 300px; overflow-y: auto">
      ${Array.from(
        { length: 30 },
        (_, i) => `<div data-kind="cell" data-id="${i}" style="height: 40px">Cell ${i}</div>`,
      ).join('')}
    </div>
  `
  const scroller = document.querySelector<HTMLElement>('[data-testid="scroller"]')!
  const first = scroller.querySelector<HTMLElement>('[data-id="0"]')!
  const hovered: string[] = []
  const manager = new DragDropManager<string, string>(
    scroller,
    { draggableKind: 'cell', droppableKind: 'cell', dragThreshold: 4 },
    {
      getItemPosition: (element) => element.dataset.id ?? null,
      getItemData: (element) => element.dataset.id ?? null,
      onDragMove: (_pos, element) => {
        if (element?.dataset.id) hovered.push(element.dataset.id)
      },
    },
  )

  const rect = scroller.getBoundingClientRect()
  const x = rect.left + 100
  const nearBottom = rect.bottom - 10
  first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: 20 }))
  first.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: 30 }))
  first.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: nearBottom }),
  )

  // No more pointer moves: the scroller keeps going, and the hovered cell follows the content.
  await wait(150)
  const scrolledOnce = scroller.scrollTop
  await wait(150)
  expect(scrolledOnce).toBeGreaterThan(0)
  expect(scroller.scrollTop).toBeGreaterThan(scrolledOnce)
  expect(new Set(hovered).size).toBeGreaterThan(1)

  first.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: nearBottom }),
  )
  const stoppedAt = scroller.scrollTop
  await wait(100)
  expect(scroller.scrollTop).toBe(stoppedAt)
  manager.destroy()
})
