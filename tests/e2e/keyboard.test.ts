import { expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { DragDropManager } from '../../dist/index.mjs'

test('keyboard pick-and-place on buttons, without clicking them', async () => {
  document.body.innerHTML = `
    <div id="grid" style="display: grid; grid-template-columns: repeat(2, 80px); gap: 20px">
      ${['a', 'b', 'c', 'd']
        .map((id) => `<button data-kind="cell" data-id="${id}" style="height: 80px">${id}</button>`)
        .join('')}
    </div>
  `
  const grid = document.querySelector<HTMLElement>('#grid')!
  const clicks: string[] = []
  grid.addEventListener('click', (event) => {
    clicks.push((event.target as HTMLElement).dataset.id ?? '?')
  })
  const drops: string[] = []
  const manager = new DragDropManager<string, string>(
    grid,
    { draggableKind: 'cell', droppableKind: 'cell', keyboard: true },
    {
      getItemPosition: (el) => el.dataset.id ?? null,
      getItemData: (el) => el.dataset.id ?? null,
      onDrop: (from, to) => void drops.push(`${from}->${to}`),
    },
  )
  const cell = (id: string): HTMLElement => grid.querySelector<HTMLElement>(`[data-id="${id}"]`)!

  cell('a').focus()
  await userEvent.keyboard('[Space]')
  expect(manager.isDragging()).toBe(true)
  await userEvent.keyboard('{ArrowDown}{ArrowRight}')
  expect(cell('d').getAttribute('data-hovered')).toBe('true')
  await userEvent.keyboard('[Space]')
  expect(drops).toEqual(['a->d'])

  // Enter both ways, and focus never left the source.
  await userEvent.keyboard('{Enter}{ArrowRight}{Enter}')
  expect(drops).toEqual(['a->d', 'a->b'])
  expect(document.activeElement).toBe(cell('a'))
  expect(clicks).toEqual([])

  // Without a drag, the buttons still click from the keyboard.
  cell('c').focus()
  await userEvent.keyboard('{Tab}')
  expect(document.activeElement).toBe(cell('d'))
  manager.destroy()
  await userEvent.keyboard('{Enter}')
  expect(clicks).toEqual(['d'])
})
