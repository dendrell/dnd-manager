import { expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { DragDropManager } from '../../dist/index.mjs'

const SPRITE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Ccircle cx='24' cy='24' r='20' fill='red'/%3E%3C/svg%3E"

test('with focusOnPress, a real mouse drag focuses the source, without a native drag or a selection', async () => {
  document.body.innerHTML = `
    <p>Text around the slots, which a drag must not select.</p>
    <div id="grid" style="display: flex; gap: 40px">
      ${['a', 'b']
        .map(
          (id) =>
            `<button data-kind="cell" data-id="${id}" style="width: 120px; height: 100px"><img src="${SPRITE}" width="48" height="48" alt=""> Slot ${id}</button>`,
        )
        .join('')}
    </div>
    <p>More text after the slots.</p>
  `
  const grid = document.querySelector<HTMLElement>('#grid')!
  const cell = (id: string): HTMLElement => grid.querySelector<HTMLElement>(`[data-id="${id}"]`)!
  const events: string[] = []
  const record = (event: Event): void => {
    events.push(`${event.type}${event.defaultPrevented ? ':prevented' : ''}`)
  }
  // Bubble phase on the window: after the manager's capture listeners.
  for (const type of ['dragstart', 'pointercancel']) window.addEventListener(type, record)
  const drops: string[] = []
  const manager = new DragDropManager<string, string>(
    grid,
    { draggableKind: 'cell', droppableKind: 'cell', focusOnPress: true },
    {
      getItemPosition: (el) => el.dataset.id ?? null,
      getItemData: (el) => el.dataset.id ?? null,
      onDrop: (from, to) => void drops.push(`${from}->${to}`),
    },
  )

  // From the sprite: an <img> the browser would drag natively.
  await userEvent.dragAndDrop(cell('a').querySelector('img')!, cell('b'))

  expect(drops).toEqual(['a->b'])
  expect(document.activeElement).toBe(cell('a'))
  expect(String(getSelection())).toBe('')
  expect(events.filter((event) => event !== 'dragstart:prevented')).toEqual([])

  for (const type of ['dragstart', 'pointercancel']) window.removeEventListener(type, record)
  manager.destroy()
})
