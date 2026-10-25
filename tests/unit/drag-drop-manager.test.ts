import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DragDropManager as BaseDragDropManager } from '../../src/index'

type Item = { id: string }

/** Every manager a test creates, destroyed after it so no window listener leaks into the next. */
const liveManagers = new Set<BaseDragDropManager<any, any>>()

class DragDropManager<TItem = unknown, TPosition = unknown> extends BaseDragDropManager<
  TItem,
  TPosition
> {
  constructor(...args: ConstructorParameters<typeof BaseDragDropManager<TItem, TPosition>>) {
    super(...args)
    liveManagers.add(this)
  }
}

function setupDom(): {
  container: HTMLElement
  source: HTMLElement
  target: HTMLElement
  empty: HTMLElement
} {
  document.body.innerHTML = `
    <div id="container">
      <div id="source" data-kind="item" data-id="source"></div>
      <div id="target" data-kind="item" data-id="target"></div>
      <div id="empty" data-kind="item" data-id="empty" data-empty="true"></div>
      <div id="wrapper"><span id="inner"></span></div>
    </div>
  `

  const container = document.querySelector<HTMLElement>('#container')
  const source = document.querySelector<HTMLElement>('#source')
  const target = document.querySelector<HTMLElement>('#target')
  const empty = document.querySelector<HTMLElement>('#empty')
  if (!container || !source || !target || !empty) {
    throw new Error('Test setup failed to build DOM')
  }

  return { container, source, target, empty }
}

function pointerEvent(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX, clientY })
}

function mockElementFromPoint(
  implementation: (x: number, y: number) => Element | null,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(implementation)
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: spy,
  })
  return spy
}

describe('DragDropManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    for (const manager of liveManagers) manager.destroy()
    liveManagers.clear()
    document.body.innerHTML = ''
  })

  test('throws when selector container does not exist', () => {
    expect(() => {
      new DragDropManager(
        '#missing',
        { draggableKind: 'item', droppableKind: 'item' },
        { getItemPosition: () => 1 },
      )
    }).toThrow('Could not find element')
  })

  test('throws when ref current is null', () => {
    expect(() => {
      new DragDropManager(
        { current: null },
        { draggableKind: 'item', droppableKind: 'item' },
        { getItemPosition: () => 1 },
      )
    }).toThrow('Ref.current is null')
  })

  test('resolves container from selector when element exists', () => {
    const { container } = setupDom()
    container.setAttribute('id', 'selector-container')

    const manager = new DragDropManager(
      '#selector-container',
      { draggableKind: 'item', droppableKind: 'item' },
      { getItemPosition: () => null },
    )

    expect(manager.getState().startPosition).toBeNull()
    manager.destroy()
  })

  test('attaches and detaches listeners', () => {
    const { container } = setupDom()
    const addSpy = vi.spyOn(container, 'addEventListener')
    const removeSpy = vi.spyOn(container, 'removeEventListener')

    const manager = new DragDropManager(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      { getItemPosition: () => 1 },
    )

    expect(addSpy).toHaveBeenCalledTimes(4)
    expect(manager.isDragging()).toBe(false)
    manager.destroy()
    expect(removeSpy).toHaveBeenCalledTimes(4)
  })

  test('supports container refs with current element', () => {
    const { container } = setupDom()
    const manager = new DragDropManager(
      { current: container },
      { draggableKind: 'item', droppableKind: 'item' },
      { getItemPosition: () => 'ok' },
    )
    expect(manager.getState().startPosition).toBeNull()
  })

  test('ignores pointer down when target is not draggable', () => {
    const { container } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    const nonDraggable = document.querySelector<HTMLElement>('#inner')
    if (!nonDraggable) throw new Error('Missing non-draggable node')
    nonDraggable.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    expect(manager.getState().startPosition).toBeNull()
  })

  test('ignores pointer down from a secondary button or a non-primary pointer', () => {
    const { container, source } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    for (const button of [1, 2]) {
      const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button })
      source.dispatchEvent(event)
      expect(manager.getState().startPosition).toBeNull()
      expect(event.defaultPrevented).toBe(false)
    }

    const secondTouch = new MouseEvent('pointerdown', { bubbles: true })
    Object.defineProperty(secondTouch, 'isPrimary', { value: false })
    source.dispatchEvent(secondTouch)
    expect(manager.getState().startPosition).toBeNull()
  })

  test('ignores pointer down when element is marked empty', () => {
    const { container, empty } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    empty.dispatchEvent(pointerEvent('pointerdown', 11, 11))
    expect(manager.getState().startPosition).toBeNull()
  })

  test('ignores pointer down when canDrag returns false', () => {
    const { container, source } = setupDom()
    const canDrag = vi.fn(() => false)
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        canDrag,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 12, 12))
    expect(canDrag).toHaveBeenCalledOnce()
    expect(manager.getState().startPosition).toBeNull()
  })

  test('ignores pointer down when item data is missing', () => {
    const { container, source } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: () => null,
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 13, 13))
    expect(manager.getState().startPosition).toBeNull()
  })

  test('captures source state on valid pointer down', () => {
    const { container, source } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 20, 30))
    const state = manager.getState()
    expect(state.startPosition).toEqual({ x: 20, y: 30 })
    expect(state.sourceElement).toBe(source)
    expect(state.sourcePosition).toBe('source')
    expect(state.sourceItem).toEqual({ id: 'source' })
  })

  test('supports multiple draggable and droppable kinds', () => {
    document.body.innerHTML = `
      <div id="container">
        <div id="source" data-kind="quest" data-id="source"></div>
        <div id="target" data-kind="slot-active" data-id="target"></div>
      </div>
    `
    const container = document.querySelector<HTMLElement>('#container')
    const source = document.querySelector<HTMLElement>('#source')
    const target = document.querySelector<HTMLElement>('#target')
    if (!container || !source || !target) throw new Error('Test setup failed')

    const onDrop = vi.fn()
    mockElementFromPoint(() => target)

    const manager = new DragDropManager<Item, string>(
      container,
      {
        draggableKind: ['quest', 'bounty'],
        droppableKind: ['slot-backlog', 'slot-active'],
        dragThreshold: 1,
      },
      {
        onDrop,
        getItemPosition: (element, kind) => `${kind}:${element.dataset.id ?? 'unknown'}`,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointerup', 2, 0))

    expect(onDrop).toHaveBeenCalledWith('quest:source', 'slot-active:target', { id: 'source' })
    manager.destroy()
  })

  test('prevents default on valid pointer down', () => {
    const { container, source } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    const event = pointerEvent('pointerdown', 20, 30)
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
    source.dispatchEvent(event)

    expect(preventDefaultSpy).toHaveBeenCalledOnce()
    manager.destroy()
  })

  test('starts dragging after threshold and calls onDragStart', () => {
    const { container, source } = setupDom()
    const onDragStart = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 10 },
      {
        onDragStart,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 5, 0))
    expect(manager.isDragging()).toBe(false)

    source.dispatchEvent(pointerEvent('pointermove', 10, 0))
    expect(manager.isDragging()).toBe(true)
    expect(source.getAttribute('data-dragging')).toBe('true')
    expect(onDragStart).toHaveBeenCalledOnce()
  })

  test('processes drag move with hover updates, auto-scroll, and onDragMove', () => {
    const { container, source, target } = setupDom()
    const onDragMove = vi.fn()
    let rafCallback: FrameRequestCallback | null = null
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback): number => {
        rafCallback = cb
        return 1
      })
    const scrollSpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const elementFromPointSpy = mockElementFromPoint(() => null).mockReturnValueOnce(target)

    const manager = new DragDropManager<Item, string>(
      container,
      {
        draggableKind: 'item',
        droppableKind: 'item',
        scrollThreshold: 50,
        scrollSpeed: 7,
        dragThreshold: 1,
      },
      {
        onDragMove,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 100, 100))
    source.dispatchEvent(pointerEvent('pointermove', 102, 100))
    source.dispatchEvent(pointerEvent('pointermove', 10, 10))
    const firstRafCallback = rafCallback
    if (!firstRafCallback) throw new Error('RAF callback was not scheduled')
    ;(firstRafCallback as FrameRequestCallback)(0)

    expect(rafSpy).toHaveBeenCalled()
    expect(elementFromPointSpy).toHaveBeenCalled()
    expect(target.getAttribute('data-hovered')).toBe('true')
    expect(onDragMove).toHaveBeenCalled()
    expect(scrollSpy).toHaveBeenCalledWith(-7, -7)

    source.dispatchEvent(pointerEvent('pointermove', 500, 500))
    const secondRafCallback = rafCallback
    if (!secondRafCallback) throw new Error('RAF callback was not scheduled for second move')
    ;(secondRafCallback as FrameRequestCallback)(1)
    expect(target.hasAttribute('data-hovered')).toBe(false)
  })

  test('treats short movement as click and calls onClick', () => {
    const { container, source } = setupDom()
    const onClick = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', clickThreshold: 10 },
      {
        onClick,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 10, 10))
    source.dispatchEvent(pointerEvent('pointerup', 12, 12))

    expect(onClick).toHaveBeenCalledOnce()
    expect(manager.getState().startPosition).toBeNull()
    expect(manager.isDragging()).toBe(false)
  })

  test('does not treat movement equal to click threshold as click', () => {
    const { container, source } = setupDom()
    const onClick = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', clickThreshold: 10, dragThreshold: 1000 },
      {
        onClick,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointerup', 10, 0))

    expect(onClick).not.toHaveBeenCalled()
    expect(manager.isDragging()).toBe(false)
  })

  test('drops on valid target and calls onDrop plus onDragEnd', () => {
    const { container, source, target } = setupDom()
    const onDrop = vi.fn()
    const onDragEnd = vi.fn()
    mockElementFromPoint(() => target)

    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
      {
        onDrop,
        onDragEnd,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointerup', 10, 10))

    expect(onDrop).toHaveBeenCalledWith('source', 'target', { id: 'source' })
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith({
      sourcePosition: 'source',
      targetPosition: 'target',
      sourceItem: { id: 'source' },
    })
    expect(source.hasAttribute('data-dragging')).toBe(false)
    expect(manager.isDragging()).toBe(false)
  })

  test('does not call onDrop when drop target has no position', () => {
    const { container, source, target } = setupDom()
    const onDrop = vi.fn()
    const onDragEnd = vi.fn()
    mockElementFromPoint(() => target)

    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
      {
        onDrop,
        onDragEnd,
        getItemPosition: (element, kind) => {
          if (kind === 'item' && element.dataset.id === 'source') return 'source'
          return null
        },
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointerup', 10, 10))

    expect(onDrop).not.toHaveBeenCalled()
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(null)
    expect(manager.isDragging()).toBe(false)
  })

  test('cleans up on pointer up when drag never started and no click should fire', () => {
    const { container, source } = setupDom()
    const onClick = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', clickThreshold: 10, dragThreshold: 1000 },
      {
        onClick,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointerup', 30, 0))

    expect(onClick).not.toHaveBeenCalled()
    expect(manager.getState().startPosition).toBeNull()
  })

  test('pointer cancel and destroy both cleanup and cancel pending RAF', () => {
    const { container, source } = setupDom()
    const onDragEnd = vi.fn()
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((): number => 99)

    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
      {
        onDragEnd,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointermove', 3, 0))

    container.dispatchEvent(pointerEvent('pointercancel', 3, 3))
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(null)
    expect(cancelSpy).toHaveBeenCalledWith(99)

    manager.destroy()
    expect(manager.getState().startPosition).toBeNull()
  })

  test('auto-scrolls toward bottom-right and clears hovered element during cleanup', () => {
    const { container, source, target } = setupDom()
    const scrollSpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    let rafCallback: FrameRequestCallback | null = null
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (cb: FrameRequestCallback): number => {
        rafCallback = cb
        return 2
      },
    )
    mockElementFromPoint(() => target)

    const manager = new DragDropManager<Item, string>(
      container,
      {
        draggableKind: 'item',
        droppableKind: 'item',
        dragThreshold: 1,
        scrollThreshold: 50,
        scrollSpeed: 9,
      },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointermove', window.innerWidth - 1, window.innerHeight - 1))
    const runRaf = rafCallback
    if (!runRaf) throw new Error('RAF callback missing')
    ;(runRaf as FrameRequestCallback)(0)

    expect(target.getAttribute('data-hovered')).toBe('true')
    expect(scrollSpy).toHaveBeenCalledWith(9, 9)

    source.dispatchEvent(pointerEvent('pointercancel', 1, 1))
    expect(target.hasAttribute('data-hovered')).toBe(false)
    expect(manager.isDragging()).toBe(false)
  })

  test('cancels an active drag when Escape is pressed', () => {
    const { container, source } = setupDom()
    const onDragEnd = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1, cancelOnEscape: true },
      {
        onDragEnd,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    expect(manager.isDragging()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(null)
    expect(manager.isDragging()).toBe(false)
    expect(source.hasAttribute('data-dragging')).toBe(false)
  })

  test('does not cancel on Escape when cancelOnEscape is false', () => {
    const { container, source } = setupDom()
    const onDragEnd = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1, cancelOnEscape: false },
      {
        onDragEnd,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    expect(manager.isDragging()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onDragEnd).not.toHaveBeenCalled()
    expect(manager.isDragging()).toBe(true)
  })

  test('swallows the native click that follows a drop', () => {
    const { container, source, target } = setupDom()
    mockElementFromPoint(() => target)
    const onNativeClick = vi.fn()
    source.addEventListener('click', onNativeClick)
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointerup', 10, 10))
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    source.dispatchEvent(click)

    expect(onNativeClick).not.toHaveBeenCalled()
    expect(click.defaultPrevented).toBe(true)

    // Only that one click: the next one goes through.
    source.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onNativeClick).toHaveBeenCalledOnce()
    manager.destroy()
  })

  test('swallows the click after Escape cancels a drag while the pointer is still down', () => {
    const { container, source } = setupDom()
    const onNativeClick = vi.fn()
    source.addEventListener('click', onNativeClick)
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    source.dispatchEvent(pointerEvent('pointerup', 2, 0))
    source.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onNativeClick).not.toHaveBeenCalled()
    manager.destroy()
  })

  test('lets the click of a press that never dragged through', () => {
    const { container, source } = setupDom()
    const onNativeClick = vi.fn()
    source.addEventListener('click', onNativeClick)
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointerup', 1, 0))
    source.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(onNativeClick).toHaveBeenCalledOnce()
    manager.destroy()
  })

  test('stops blocking clicks when none follows the drop', () => {
    vi.useFakeTimers()
    try {
      const { container, source } = setupDom()
      mockElementFromPoint(() => null)
      const onNativeClick = vi.fn()
      source.addEventListener('click', onNativeClick)
      const manager = new DragDropManager<Item, string>(
        container,
        { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
        {
          getItemPosition: (element) => element.dataset.id ?? null,
          getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
        },
      )

      source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      source.dispatchEvent(pointerEvent('pointermove', 2, 0))
      source.dispatchEvent(pointerEvent('pointerup', 2, 0))
      vi.runAllTimers()
      source.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      expect(onNativeClick).toHaveBeenCalledOnce()
      manager.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  test('cancels an active drag when pointer leaves the window', () => {
    const { container, source } = setupDom()
    const onDragEnd = vi.fn()
    const manager = new DragDropManager<Item, string>(
      container,
      {
        draggableKind: 'item',
        droppableKind: 'item',
        dragThreshold: 1,
        cancelOnPointerLeave: true,
      },
      {
        onDragEnd,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    expect(manager.isDragging()).toBe(true)

    const leaveEvent = new MouseEvent('mouseout', { bubbles: true })
    Object.defineProperty(leaveEvent, 'relatedTarget', { value: null })
    window.dispatchEvent(leaveEvent)

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(onDragEnd).toHaveBeenCalledWith(null)
    expect(manager.isDragging()).toBe(false)
  })
})
