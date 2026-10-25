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

    expect(addSpy).toHaveBeenCalledTimes(3)
    expect(manager.isDragging()).toBe(false)
    manager.destroy()
    expect(removeSpy).toHaveBeenCalledTimes(3)
  })

  test('follows the pointer outside the container, and only while a press is held', () => {
    const { container, source, target } = setupDom()
    const outside = document.body.appendChild(document.createElement('div'))
    const frames: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb): number => {
      frames.push(cb)
      return frames.length
    })
    mockElementFromPoint(() => target)
    const onDragStart = vi.fn()
    const onDragMove = vi.fn()
    new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 5 },
      {
        onDragStart,
        onDragMove,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    // Moves before any press do not matter.
    outside.dispatchEvent(pointerEvent('pointermove', 400, 400))
    expect(frames).toHaveLength(0)

    // The source leaves the DOM mid-press (a virtualized row unmounting): pointer capture ends and
    // the moves arrive on whatever is under the pointer.
    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.remove()
    outside.dispatchEvent(pointerEvent('pointermove', 400, 400))
    expect(onDragStart).toHaveBeenCalledOnce()
    outside.dispatchEvent(pointerEvent('pointermove', 410, 400))
    frames.shift()?.(0)
    expect(onDragMove).toHaveBeenCalledWith({ x: 410, y: 400 }, target)

    outside.dispatchEvent(pointerEvent('pointerup', 410, 400))
    outside.dispatchEvent(pointerEvent('pointermove', 420, 400))
    expect(frames).toHaveLength(0)
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
    Object.defineProperties(secondTouch, {
      pointerType: { value: 'touch' },
      isPrimary: { value: false },
    })
    source.dispatchEvent(secondTouch)
    expect(manager.getState().startPosition).toBeNull()
  })

  test('accepts constructed pointer events, which default to isPrimary false', () => {
    const { container, source } = setupDom()
    const manager = new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item' },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    const event = new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })
    Object.defineProperties(event, { pointerType: { value: '' }, isPrimary: { value: false } })
    source.dispatchEvent(event)
    expect(manager.getState().startPosition).toEqual({ x: 5, y: 5 })
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

  test('lets only the innermost of nested managers take a press', () => {
    document.body.innerHTML = `
      <div id="outer">
        <div id="outer-item" data-kind="item" data-id="outer-item"></div>
        <div id="inner">
          <div id="inner-item" data-kind="item" data-id="inner-item"></div>
        </div>
      </div>
    `
    const element = (id: string): HTMLElement => document.querySelector<HTMLElement>(`#${id}`)!
    const callbacks = {
      getItemPosition: (el: HTMLElement) => el.dataset.id ?? null,
      getItemData: (el: HTMLElement) => ({ id: el.dataset.id ?? 'unknown' }),
    }
    const config = { draggableKind: 'item', droppableKind: 'item' }
    const outer = new DragDropManager<Item, string>(element('outer'), config, callbacks)
    const inner = new DragDropManager<Item, string>(element('inner'), config, callbacks)

    element('inner-item').dispatchEvent(pointerEvent('pointerdown', 0, 0))
    expect(inner.getState().sourcePosition).toBe('inner-item')
    expect(outer.getState().startPosition).toBeNull()
    element('inner-item').dispatchEvent(pointerEvent('pointerup', 0, 0))

    // The outer manager still takes presses outside the inner container.
    element('outer-item').dispatchEvent(pointerEvent('pointerdown', 0, 0))
    expect(outer.getState().sourcePosition).toBe('outer-item')
    expect(inner.getState().startPosition).toBeNull()
  })

  test('drops outside the container by default, and not with dropScope "container"', () => {
    const { container, source } = setupDom()
    const outside = document.body.appendChild(document.createElement('div'))
    outside.dataset.kind = 'item'
    outside.dataset.id = 'outside'
    mockElementFromPoint(() => outside)
    const drop = (dropScope?: 'document' | 'container') => {
      const onDrop = vi.fn()
      const onDragEnd = vi.fn()
      const manager = new DragDropManager<Item, string>(
        container,
        { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1, dropScope },
        {
          onDrop,
          onDragEnd,
          getItemPosition: (element) => element.dataset.id ?? null,
          getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
        },
      )
      source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      source.dispatchEvent(pointerEvent('pointermove', 2, 0))
      source.dispatchEvent(pointerEvent('pointerup', 300, 300))
      manager.destroy()
      return { onDrop, onDragEnd }
    }

    expect(drop().onDrop).toHaveBeenCalledWith('source', 'outside', { id: 'source' })
    const scoped = drop('container')
    expect(scoped.onDrop).not.toHaveBeenCalled()
    expect(scoped.onDragEnd).toHaveBeenCalledWith(null)
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

  test('with focusOnPress, lets the press through and cancels selection and native drags instead', () => {
    const { container, source } = setupDom()
    new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', focusOnPress: true },
      {
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )
    const cancelable = (type: string): Event => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      source.dispatchEvent(event)
      return event
    }

    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
    source.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(false)
    expect(cancelable('selectstart').defaultPrevented).toBe(true)
    expect(cancelable('dragstart').defaultPrevented).toBe(true)

    source.dispatchEvent(pointerEvent('pointerup', 0, 0))
    expect(cancelable('selectstart').defaultPrevented).toBe(false)
    expect(cancelable('dragstart').defaultPrevented).toBe(false)
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
    expect(scrollSpy).toHaveBeenCalledWith({ left: -7, top: -7, behavior: 'instant' })

    source.dispatchEvent(pointerEvent('pointermove', 500, 500))
    const secondRafCallback = rafCallback
    if (!secondRafCallback) throw new Error('RAF callback was not scheduled for second move')
    ;(secondRafCallback as FrameRequestCallback)(1)
    expect(target.hasAttribute('data-hovered')).toBe(false)
  })

  describe('dragDelay', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const touchEvent = (type: string, x: number, y: number): MouseEvent => {
      const event = pointerEvent(type, x, y)
      Object.defineProperties(event, {
        pointerType: { value: 'touch' },
        isPrimary: { value: true },
      })
      return event
    }

    const createManager = (
      container: HTMLElement,
      dragDelay: NonNullable<ConstructorParameters<typeof BaseDragDropManager>[1]['dragDelay']>,
      callbacks: Partial<ConstructorParameters<typeof BaseDragDropManager<Item, string>>[2]> = {},
    ) =>
      new DragDropManager<Item, string>(
        container,
        { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1, dragDelay },
        {
          getItemPosition: (element) => element.dataset.id ?? null,
          getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
          ...callbacks,
        },
      )

    test('starts the drag once the press is held, without a move', () => {
      const { container, source } = setupDom()
      const onDragStart = vi.fn()
      const manager = createManager(container, 200, { onDragStart })

      source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      // Within the tolerance, and past dragThreshold: still waiting.
      source.dispatchEvent(pointerEvent('pointermove', 3, 0))
      vi.advanceTimersByTime(199)
      expect(manager.isDragging()).toBe(false)

      vi.advanceTimersByTime(1)
      expect(manager.isDragging()).toBe(true)
      expect(onDragStart).toHaveBeenCalledOnce()
      expect(source.getAttribute('data-dragging')).toBe('true')
    })

    test('releases the press when it moves past the tolerance during the delay', () => {
      const { container, source } = setupDom()
      const onDragStart = vi.fn()
      const manager = createManager(container, 200, { onDragStart })

      source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      source.dispatchEvent(pointerEvent('pointermove', 0, 8))
      vi.advanceTimersByTime(500)

      expect(manager.getState().startPosition).toBeNull()
      expect(onDragStart).not.toHaveBeenCalled()
      // The rest of the gesture is the browser's: no drag starts later either.
      source.dispatchEvent(pointerEvent('pointermove', 0, 40))
      expect(manager.isDragging()).toBe(false)
    })

    test('a tap during the delay is a click', () => {
      const { container, source } = setupDom()
      const onClick = vi.fn()
      const manager = createManager(container, 200, { onClick })

      source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      source.dispatchEvent(pointerEvent('pointerup', 1, 0))
      vi.advanceTimersByTime(500)

      expect(onClick).toHaveBeenCalledOnce()
      expect(manager.isDragging()).toBe(false)
    })

    test('applies a per-type delay only to that pointer type', () => {
      const { container, source } = setupDom()
      const manager = createManager(container, { touch: 200 })

      source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
      source.dispatchEvent(pointerEvent('pointermove', 3, 0))
      expect(manager.isDragging()).toBe(true)
      source.dispatchEvent(pointerEvent('pointerup', 3, 0))

      source.dispatchEvent(touchEvent('pointerdown', 0, 0))
      source.dispatchEvent(touchEvent('pointermove', 3, 0))
      expect(manager.isDragging()).toBe(false)
      vi.advanceTimersByTime(200)
      expect(manager.isDragging()).toBe(true)
    })

    test('keeps the page from panning and from opening a context menu during a touch drag', () => {
      const { container, source } = setupDom()
      createManager(container, { touch: 200 })
      const cancelable = (type: string): Event => new Event(type, { cancelable: true })

      source.dispatchEvent(touchEvent('pointerdown', 0, 0))
      const earlyMove = cancelable('touchmove')
      window.dispatchEvent(earlyMove)
      expect(earlyMove.defaultPrevented).toBe(false)
      const earlyMenu = cancelable('contextmenu')
      window.dispatchEvent(earlyMenu)
      expect(earlyMenu.defaultPrevented).toBe(true)

      vi.advanceTimersByTime(200)
      const dragMove = cancelable('touchmove')
      window.dispatchEvent(dragMove)
      expect(dragMove.defaultPrevented).toBe(true)

      source.dispatchEvent(touchEvent('pointerup', 0, 0))
      const afterMove = cancelable('touchmove')
      window.dispatchEvent(afterMove)
      expect(afterMove.defaultPrevented).toBe(false)
    })
  })

  describe('keyboard', () => {
    /** A 2×2 grid of 80px buttons, 100px apart: a b / c d. jsdom has no layout, so rects are stubbed. */
    function setupGrid(): Record<'grid' | 'a' | 'b' | 'c' | 'd' | 'elsewhere', HTMLElement> {
      document.body.innerHTML = `
        <div id="grid">
          ${['a', 'b', 'c', 'd'].map((id) => `<button id="${id}" data-kind="item" data-id="${id}"></button>`).join('')}
        </div>
        <button id="elsewhere"></button>
      `
      const byId = (id: string): HTMLElement => document.getElementById(id)!
      const corners: Record<string, [number, number]> = {
        a: [0, 0],
        b: [100, 0],
        c: [0, 100],
        d: [100, 100],
      }
      for (const [id, [left, top]] of Object.entries(corners)) {
        const rect = { left, top, width: 80, height: 80, right: left + 80, bottom: top + 80 }
        vi.spyOn(byId(id), 'getBoundingClientRect').mockReturnValue({
          ...rect,
          x: left,
          y: top,
          toJSON: () => rect,
        })
      }
      return {
        grid: byId('grid'),
        a: byId('a'),
        b: byId('b'),
        c: byId('c'),
        d: byId('d'),
        elsewhere: byId('elsewhere'),
      }
    }

    const press = (target: EventTarget, key: string, type = 'keydown'): KeyboardEvent => {
      const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event
    }

    const createManager = (
      grid: HTMLElement,
      callbacks: Partial<ConstructorParameters<typeof BaseDragDropManager<Item, string>>[2]> = {},
      keyboard = true,
    ) =>
      new DragDropManager<Item, string>(
        grid,
        { draggableKind: 'item', droppableKind: 'item', keyboard },
        {
          getItemPosition: (element) => element.dataset.id ?? null,
          getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
          ...callbacks,
        },
      )

    test('is off unless enabled', () => {
      const { grid, a } = setupGrid()
      const manager = createManager(grid, {}, false)

      const space = press(a, ' ')
      expect(manager.isDragging()).toBe(false)
      expect(space.defaultPrevented).toBe(false)
    })

    test('picks up with Space, moves with the arrows, drops with Enter', () => {
      const { grid, a, b, c, d } = setupGrid()
      const onDragStart = vi.fn()
      const onDragMove = vi.fn()
      const onDrop = vi.fn()
      const onDragEnd = vi.fn()
      const manager = createManager(grid, { onDragStart, onDragMove, onDrop, onDragEnd })

      const space = press(a, ' ')
      expect(space.defaultPrevented).toBe(true)
      expect(press(a, ' ', 'keyup').defaultPrevented).toBe(true)
      expect(manager.getState().input).toBe('keyboard')
      expect(onDragStart).toHaveBeenCalledWith(a, 'a', { id: 'a' })
      expect(a.getAttribute('data-dragging')).toBe('true')
      expect(a.getAttribute('data-hovered')).toBe('true')

      expect(press(a, 'ArrowRight').defaultPrevented).toBe(true)
      expect(b.getAttribute('data-hovered')).toBe('true')
      expect(a.hasAttribute('data-hovered')).toBe(false)
      expect(onDragMove).toHaveBeenLastCalledWith({ x: 140, y: 40 }, b)

      press(a, 'ArrowDown')
      expect(d.getAttribute('data-hovered')).toBe('true')
      press(a, 'ArrowLeft')
      expect(c.getAttribute('data-hovered')).toBe('true')
      press(a, 'ArrowUp')
      press(a, 'ArrowRight')
      // Nothing further right: the target stays.
      press(a, 'ArrowRight')
      expect(b.getAttribute('data-hovered')).toBe('true')

      press(a, 'Enter')
      expect(onDrop).toHaveBeenCalledWith('a', 'b', { id: 'a' })
      expect(onDragEnd).toHaveBeenCalledWith({
        sourcePosition: 'a',
        targetPosition: 'b',
        sourceItem: { id: 'a' },
      })
      expect(manager.isDragging()).toBe(false)
      expect(b.hasAttribute('data-hovered')).toBe(false)
      expect(press(a, 'Enter', 'keyup').defaultPrevented).toBe(true)
      // Only that keyup.
      expect(press(a, 'Enter', 'keyup').defaultPrevented).toBe(false)
    })

    test('ignores a drop canDrop rejects, and Escape cancels', () => {
      const { grid, a, b } = setupGrid()
      const onDrop = vi.fn()
      const onDragEnd = vi.fn()
      const manager = createManager(grid, {
        canDrop: (_from, to) => to !== 'b',
        onDrop,
        onDragEnd,
      })
      const outerEscape = vi.fn()
      const onOuterKey = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') outerEscape()
      }
      window.addEventListener('keydown', onOuterKey)

      press(a, 'Enter')
      press(a, 'ArrowRight')
      expect(b.getAttribute('data-drop-invalid')).toBe('true')
      press(a, 'Enter')
      expect(onDrop).not.toHaveBeenCalled()
      expect(manager.isDragging()).toBe(true)

      press(a, 'Escape')
      expect(onDragEnd).toHaveBeenCalledWith(null)
      expect(manager.isDragging()).toBe(false)
      // The drag's keys stop there: a dialog around the grid does not close on that Escape.
      expect(outerEscape).not.toHaveBeenCalled()
      window.removeEventListener('keydown', onOuterKey)
    })

    test('a pointer release does not drop it, and focus leaving the source cancels it', () => {
      const { grid, a, elsewhere } = setupGrid()
      mockElementFromPoint(() => document.getElementById('d'))
      const onDrop = vi.fn()
      const onDragEnd = vi.fn()
      const manager = createManager(grid, { onDrop, onDragEnd })

      press(a, ' ')
      window.dispatchEvent(pointerEvent('pointerup', 150, 150))
      expect(onDrop).not.toHaveBeenCalled()
      expect(manager.isDragging()).toBe(true)

      a.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: elsewhere }))
      expect(onDragEnd).toHaveBeenCalledWith(null)
      expect(manager.isDragging()).toBe(false)
    })
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

  test('marks a droppable canDrop rejects as invalid, and does not drop on it', () => {
    const { container, source, target } = setupDom()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb): number => {
      frames.push(cb)
      return frames.length
    })
    let underPointer: HTMLElement = target
    mockElementFromPoint(() => underPointer)
    const canDrop = vi.fn((_from: string, to: string) => to !== 'target')
    const onDragMove = vi.fn()
    const onDrop = vi.fn()
    const onDragEnd = vi.fn()
    new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1, scrollSpeed: 0 },
      {
        canDrop,
        onDragMove,
        onDrop,
        onDragEnd,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointermove', 50, 50))
    frames.shift()?.(0)
    expect(canDrop).toHaveBeenLastCalledWith('source', 'target', { id: 'source' })
    expect(target.getAttribute('data-drop-invalid')).toBe('true')
    expect(target.hasAttribute('data-hovered')).toBe(false)
    expect(onDragMove).toHaveBeenLastCalledWith({ x: 50, y: 50 }, null)

    // Over an accepted droppable (here the source itself) the marks swap.
    underPointer = source
    source.dispatchEvent(pointerEvent('pointermove', 5, 5))
    frames.shift()?.(0)
    expect(target.hasAttribute('data-drop-invalid')).toBe(false)
    expect(source.getAttribute('data-hovered')).toBe('true')

    underPointer = target
    source.dispatchEvent(pointerEvent('pointermove', 50, 50))
    frames.shift()?.(0)
    source.dispatchEvent(pointerEvent('pointerup', 50, 50))
    expect(onDrop).not.toHaveBeenCalled()
    expect(onDragEnd).toHaveBeenCalledWith(null)
    expect(target.hasAttribute('data-drop-invalid')).toBe(false)
  })

  test('drops where canDrop accepts', () => {
    const { container, source, target } = setupDom()
    mockElementFromPoint(() => target)
    const onDrop = vi.fn()
    new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1 },
      {
        canDrop: () => true,
        onDrop,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    source.dispatchEvent(pointerEvent('pointerdown', 0, 0))
    source.dispatchEvent(pointerEvent('pointermove', 2, 0))
    source.dispatchEvent(pointerEvent('pointerup', 50, 50))
    expect(onDrop).toHaveBeenCalledWith('source', 'target', { id: 'source' })
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
    expect(scrollSpy).toHaveBeenCalledWith({ left: 9, top: 9, behavior: 'instant' })

    source.dispatchEvent(pointerEvent('pointercancel', 1, 1))
    expect(target.hasAttribute('data-hovered')).toBe(false)
    expect(manager.isDragging()).toBe(false)
  })

  test('keeps auto-scrolling while the pointer rests at an edge, hit-testing after each step', () => {
    const { container, source, target } = setupDom()
    const frames: FrameRequestCallback[] = []
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb): number => {
      frames.push(cb)
      return frames.length
    })
    const runFrame = (): void => {
      const frame = frames.shift()
      if (!frame) throw new Error('No frame scheduled')
      frame(0)
    }
    let scrollY = 0
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
    const scrollSpy = vi.spyOn(window, 'scrollBy').mockImplementation(((
      scroll: ScrollToOptions,
    ) => {
      // The page ends after two steps.
      scrollY = Math.min(20, scrollY + (scroll.top ?? 0))
    }) as typeof window.scrollBy)
    // The content moves under the resting pointer: first the source, then the target.
    const underPointer = [source, target, target]
    mockElementFromPoint(() => underPointer.shift() ?? target)
    const onDragMove = vi.fn()

    new DragDropManager<Item, string>(
      container,
      { draggableKind: 'item', droppableKind: 'item', dragThreshold: 1, scrollSpeed: 10 },
      {
        onDragMove,
        getItemPosition: (element) => element.dataset.id ?? null,
        getItemData: (element) => ({ id: element.dataset.id ?? 'unknown' }),
      },
    )

    const edge = window.innerHeight - 5
    source.dispatchEvent(pointerEvent('pointerdown', 50, edge - 200))
    source.dispatchEvent(pointerEvent('pointermove', 50, edge - 190))
    source.dispatchEvent(pointerEvent('pointermove', 400, edge))
    runFrame()
    expect(source.getAttribute('data-hovered')).toBe('true')

    // No further pointer move: the loop goes on by itself while the scroll moves.
    runFrame()
    expect(target.getAttribute('data-hovered')).toBe('true')
    expect(source.hasAttribute('data-hovered')).toBe(false)
    runFrame()
    expect(scrollSpy).toHaveBeenCalledTimes(3)
    expect(onDragMove).toHaveBeenCalledTimes(3)
    // The last step hit the end of the page: no more frames until the pointer moves.
    expect(frames).toHaveLength(0)
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
