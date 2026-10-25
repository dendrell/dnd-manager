import { expect, test } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderCrossContainerHarness, renderHarness } from './render-harness.js'

test('loads the static dist harness', async () => {
  const harness = renderHarness()

  await expect
    .element(page.getByRole('heading', { name: 'dnd-manager static harness' }))
    .toBeInTheDocument()
  await expect.element(page.getByTestId('status')).toHaveTextContent('Library loaded from dist.')

  harness.destroy()
})

test('clicking a cell updates status', async () => {
  const harness = renderHarness()
  const cellA = page.getByTestId('cell-a')

  await cellA.click()

  await expect.element(page.getByTestId('status')).toHaveTextContent('Clicked Alpha')
  harness.destroy()
})

test('pointer movement starts dragging and shows preview', async () => {
  const harness = renderHarness()
  const sourceCellA = page.getByTestId('grid').getByTestId('cell-a')
  const previewClone = page.getByTestId('cell-a').nth(1)

  harness.dragStartCellA()

  await expect.element(sourceCellA).toHaveAttribute('data-dragging', 'true')
  await expect.element(previewClone).toBeInTheDocument()
  await expect.element(previewClone).toHaveAttribute('aria-hidden', 'true')
  await expect.element(page.getByTestId('status')).toHaveTextContent('Dragging Alpha')

  harness.destroy()
})

test('dragging A to B drops, swaps labels, and cleans up drag state', async () => {
  const harness = renderHarness()

  harness.dragCellAToCellBAndDrop()

  await expect.element(page.getByTestId('status')).toHaveTextContent('Ready')
  await expect.element(page.getByTestId('cell-a').nth(1)).not.toBeInTheDocument()
  await expect.element(page.getByTestId('grid').getByTestId('cell-a')).toHaveTextContent('Beta')
  await expect.element(page.getByTestId('grid').getByTestId('cell-b')).toHaveTextContent('Alpha')
  await expect
    .element(page.getByTestId('grid').getByTestId('cell-a'))
    .not.toHaveAttribute('data-dragging')

  harness.destroy()
})

test('a real mouse drag drops without a native click on the source', async () => {
  const harness = renderHarness()
  const nativeClicks: string[] = []
  const countClick = (event: MouseEvent): void => {
    nativeClicks.push((event.target as HTMLElement).dataset.testid ?? 'other')
  }
  document.addEventListener('click', countClick)

  await userEvent.dragAndDrop(
    page.getByTestId('grid').getByTestId('cell-a'),
    page.getByTestId('grid').getByTestId('cell-b'),
  )

  await expect.element(page.getByTestId('grid').getByTestId('cell-b')).toHaveTextContent('Alpha')
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(nativeClicks).toEqual([])

  document.removeEventListener('click', countClick)
  harness.destroy()
})

test('small move below drag threshold is treated as click and does not start drag', async () => {
  const harness = renderHarness()

  harness.smallMoveFromCellAThenRelease()

  await expect.element(page.getByTestId('status')).toHaveTextContent('Clicked Alpha')
  await expect.element(page.getByTestId('cell-a').nth(1)).not.toBeInTheDocument()
  await expect
    .element(page.getByTestId('grid').getByTestId('cell-a'))
    .not.toHaveAttribute('data-dragging')

  harness.destroy()
})

test('pointer cancel clears active drag state', async () => {
  const harness = renderHarness()

  harness.cancelDragFromCellA()

  await expect.element(page.getByTestId('status')).toHaveTextContent('Ready')
  await expect.element(page.getByTestId('cell-a').nth(1)).not.toBeInTheDocument()
  await expect
    .element(page.getByTestId('grid').getByTestId('cell-a'))
    .not.toHaveAttribute('data-dragging')

  harness.destroy()
})

test('dragging across two manager containers moves items between lanes', async () => {
  const harness = renderCrossContainerHarness()

  harness.dragLeftAToRightBAndDrop()

  await expect
    .element(page.getByTestId('status'))
    .toHaveTextContent('Moved Alpha from left to right')
  await expect.element(page.getByTestId('left-cell-a')).toHaveTextContent('Delta')
  await expect.element(page.getByTestId('right-cell-b')).toHaveTextContent('Alpha')

  harness.destroy()
})
