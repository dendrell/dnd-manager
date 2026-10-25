/**
 * Framework-agnostic Drag and Drop Manager
 *
 * A data-driven drag-and-drop utility that works with React and vanilla JS.
 * Uses data attributes and direct DOM manipulation for optimal performance.
 *
 * @template TItem - The type of data associated with draggable items
 * @template TPosition - The type representing position/coordinates (e.g., {x, y}, {box, cell}, etc.)
 */

import { autoScrollStep } from './auto-scroll'

/**
 * Presses a manager took: with nested containers the inner manager hears the `pointerdown` first
 * and takes it, and the outer ones leave it alone.
 */
const claimedPresses = new WeakSet<Event>()

/** The pointer events of a press that a detached source still receives (see handlePointerDown). */
const SOURCE_POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel'] as const

export type DragDropConfig = {
  /**
   * Minimum distance in pixels the pointer must move before a drag operation starts.
   * Prevents accidental drags from small movements and allows normal scrolling on mobile.
   * Checked during `pointermove` before drag has started.
   * @default 10
   * @example
   * dragThreshold: 15  // Harder to start drag (better for mobile scroll)
   */
  dragThreshold?: number

  /**
   * Milliseconds a press must be held, moving at most `dragDelayTolerance`, before it becomes a
   * drag: a long press, so a touch list still scrolls under a swiping finger. A number applies to
   * every pointer type; an object sets it per type (`{ touch: 250 }`: a mouse still drags at once).
   * Moving further during the delay releases the press and leaves the gesture to the browser. Once
   * the delay passes the drag starts at once, without waiting for a move.
   * @default 0
   */
  dragDelay?: number | { mouse?: number; pen?: number; touch?: number }

  /**
   * Pixels a press may move during `dragDelay` before it is released.
   * @default 5
   */
  dragDelayTolerance?: number

  /**
   * Maximum distance in pixels between pointerdown and pointerup to treat as a click/tap.
   * Used to distinguish intentional clicks from cancelled drag attempts.
   * Only checked on `pointerup` if drag never started.
   * @default 10
   * @example
   * clickThreshold: 5   // Stricter click detection
   * clickThreshold: 15  // More forgiving for mobile taps
   */
  clickThreshold?: number

  /**
   * Distance in pixels from an edge that triggers auto-scrolling during drag.
   * Near an edge of the closest scroll container under the pointer that can still scroll that way
   * (an `overflow: auto | scroll` element), that container scrolls; its zone is at most a quarter
   * of its size. Otherwise the window scrolls near the viewport's edges. Scrolling continues while
   * the pointer rests in the zone.
   * @default 100
   * @example
   * scrollThreshold: 50   // Start scrolling closer to edges
   * scrollThreshold: 150  // Larger safe zone before scrolling
   */
  scrollThreshold?: number

  /**
   * Scroll speed in pixels per animation frame during auto-scroll (`0` disables it).
   * Higher values = faster scrolling when dragging near edges.
   * @default 10
   * @example
   * scrollSpeed: 5   // Slower, smoother scroll
   * scrollSpeed: 20  // Faster scroll
   */
  scrollSpeed?: number

  /**
   * Cancel the current drag operation when Escape is pressed.
   * Useful for explicit keyboard cancellation.
   * @default true
   */
  cancelOnEscape?: boolean

  /**
   * Cancel the current drag operation when the pointer leaves the browser window.
   * Prevents "stuck dragging" when pointerup happens outside the app/window.
   * @default true
   */
  cancelOnPointerLeave?: boolean

  /**
   * The `data-kind` value(s) for draggable elements.
   * Can be a single kind or multiple kinds.
   * Each draggable element should still expose a single `data-kind` value.
   * @example
   * draggableKind: 'cell'       // <div data-kind="cell">
   * draggableKind: ['quest', 'bounty'] // <div data-kind="quest">
   * draggableKind: 'card'       // <div data-kind="card">
   * draggableKind: 'list-item'  // <div data-kind="list-item">
   */
  draggableKind: string | string[]

  /**
   * The `data-kind` value(s) for droppable target elements.
   * Can be a single kind or multiple kinds.
   * Elements with matching kinds can receive dropped items.
   * Each droppable element should still expose a single `data-kind` value.
   * Often the same as `draggableKind` for reorderable lists.
   * @example
   * droppableKind: 'cell'   // Can drop on cells
   * droppableKind: ['quest', 'bounty'] // Can drop on either kind
   * droppableKind: 'zone'   // Can drop on zones
   */
  droppableKind: string | string[]

  /**
   * Where droppables are looked for under the pointer.
   * - `'document'`: anywhere in the page, so items can move to another manager's container (a box
   *   and a party panel each with its own manager).
   * - `'container'`: only inside this manager's container, for independent widgets on one page
   *   that share kinds.
   * @default 'document'
   */
  dropScope?: 'document' | 'container'

  /**
   * Keyboard pick-and-place. Space or Enter on a focused draggable (make it focusable: a
   * `<button>`, or `tabindex="0"`) picks it up; the arrow keys move the target to the nearest
   * droppable in that direction (scrolled into view); Space or Enter drops there (ignored on a
   * target `canDrop` rejects); Escape cancels (whatever `cancelOnEscape` says), and so do Tab and
   * focus leaving the source. The callbacks fire as for a pointer drag, `onDragMove` with the
   * target's center. Announce the moves from them in an `aria-live` region.
   * @default false
   */
  keyboard?: boolean

  /**
   * Let a press focus the draggable, as a click would. By default the manager cancels the
   * `pointerdown`, which keeps the browser from selecting text or dragging an image natively, but
   * also from moving focus. With `true` it cancels `selectstart` and `dragstart` during the press
   * instead: the source is focused (no focus ring for a mouse, per `:focus-visible`), so focus
   * styles, keyboard follow-ups and a virtual list that keeps its focused row rendered all work.
   * @default false
   */
  focusOnPress?: boolean
}

export type PointerPosition = {
  x: number
  y: number
}

/** Result passed to onDragEnd when the item was dropped on a valid target; null when drag was cancelled or dropped on invalid target. */
export type DragEndResult<TItem, TPosition> = {
  sourcePosition: TPosition
  targetPosition: TPosition
  sourceItem: TItem
}

export type DragDropCallbacks<TItem, TPosition> = {
  /** Called when determining if an element can be dragged */
  canDrag?: (element: HTMLElement, position: TPosition) => boolean
  /**
   * Called for the droppable under the pointer on every drag frame, and again at the drop: return
   * `false` to reject it. A rejected droppable gets `data-drop-invalid` instead of `data-hovered`,
   * and a drop on it ends the drag with `onDragEnd(null)`. Keep it cheap.
   */
  canDrop?: (sourcePosition: TPosition, targetPosition: TPosition, sourceItem: TItem) => boolean
  /** Called when drag starts (after threshold is met) */
  onDragStart?: (element: HTMLElement, position: TPosition, item: TItem) => void
  /** Called continuously during drag, with the droppable that would receive a drop (or null) */
  onDragMove?: (pos: PointerPosition, hoveredElement: HTMLElement | null) => void
  /** Called when item is dropped on a valid target */
  onDrop?: (sourcePosition: TPosition, targetPosition: TPosition, sourceItem: TItem) => void
  /** Called when drag ends (success or cancel). Receives drop result when dropped on valid target, null otherwise. Use for reordering DOM/state and cleanup. */
  onDragEnd?: (result: DragEndResult<TItem, TPosition> | null) => void
  /** Called on simple click/tap (no drag) */
  onClick?: (element: HTMLElement, position: TPosition) => void
  /** Called to extract item data from an element */
  getItemData?: (element: HTMLElement, position: TPosition) => TItem | null
  /** Called to get the custom position/coordinates of an element */
  getItemPosition: (element: HTMLElement, kind: string) => TPosition | null
}

type DragState<TItem, TPosition> = {
  startPosition: PointerPosition | null
  sourceElement: HTMLElement | null
  sourcePosition: TPosition | null
  sourceItem: TItem | null
  activePointerId: number | null
  /** What drives the current press or drag. */
  input: 'pointer' | 'keyboard' | null
  isDragging: boolean
  lastHoveredElement: HTMLElement | null
  /** The droppable under the pointer that `canDrop` rejected (marked `data-drop-invalid`). */
  lastInvalidElement: HTMLElement | null
  /** Set when drop on valid target; passed to onDragEnd in cleanup */
  lastDropResult: DragEndResult<TItem, TPosition> | null
}

/** Moves the boolean attribute `name` from `from` to `to`, and returns `to`. */
function moveMark(
  name: string,
  from: HTMLElement | null,
  to: HTMLElement | null,
): HTMLElement | null {
  if (from === to) return to
  from?.removeAttribute(name)
  to?.setAttribute(name, 'true')
  return to
}

function idleState<TItem, TPosition>(): DragState<TItem, TPosition> {
  return {
    startPosition: null,
    sourceElement: null,
    sourcePosition: null,
    sourceItem: null,
    activePointerId: null,
    input: null,
    isDragging: false,
    lastHoveredElement: null,
    lastInvalidElement: null,
    lastDropResult: null,
  }
}

type KindMatch = { element: HTMLElement; kind: string }

const centerOf = (rect: DOMRect): PointerPosition => ({
  x: rect.left + rect.width / 2,
  y: rect.top + rect.height / 2,
})

const ARROWS: Record<string, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
  ArrowLeft: { axis: 'x', sign: -1 },
  ArrowRight: { axis: 'x', sign: 1 },
  ArrowUp: { axis: 'y', sign: -1 },
  ArrowDown: { axis: 'y', sign: 1 },
}

const isActionKey = (e: KeyboardEvent): boolean =>
  (e.key === ' ' || e.key === 'Enter') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey

export class DragDropManager<TItem = unknown, TPosition = unknown> {
  private container: HTMLElement
  private config: Required<DragDropConfig>
  private draggableKinds: string[]
  private droppableKinds: string[]
  private callbacks: DragDropCallbacks<TItem, TPosition>
  private state: DragState<TItem, TPosition> = idleState()
  private rafId: number | null = null
  private lastPointerPos: PointerPosition | null = null
  /**
   * Set while a drag holds the pointer down: the browser follows the release with a native
   * `click` (on the source element under pointer capture), which must not activate it.
   */
  private suppressClickOnRelease = false
  private releaseClickBlocker: (() => void) | null = null
  /** The pending `dragDelay` of the current press. */
  private delayTimer: ReturnType<typeof setTimeout> | null = null
  private activePointerType = ''
  /** The droppable a keyboard drag points at. */
  private keyboardTarget: KindMatch | null = null
  /**
   * The key that picked up or dropped: its `keyup` would activate a focused button (Space clicks
   * on keyup), so it is swallowed.
   */
  private swallowKeyUp: string | null = null
  private boundHandlers: {
    pointerDown: (e: PointerEvent) => void
    pointerMove: (e: PointerEvent) => void
    pointerUp: (e: PointerEvent) => void
    pointerCancel: (e: PointerEvent) => void
    keyDown: (e: KeyboardEvent) => void
    mouseOut: (e: MouseEvent) => void
    touchMove: (e: TouchEvent) => void
    detachedSourcePointer: (e: PointerEvent) => void
    contextMenu: (e: MouseEvent) => void
    preventDefault: (e: Event) => void
    pickUpKey: (e: KeyboardEvent) => void
    keyboardDragKey: (e: KeyboardEvent) => void
    keyUp: (e: KeyboardEvent) => void
    focusOut: (e: FocusEvent) => void
  }

  constructor(
    containerRef: { current: HTMLElement | null } | string | HTMLElement,
    config: DragDropConfig,
    callbacks: DragDropCallbacks<TItem, TPosition>,
  ) {
    // Resolve container element
    if (typeof containerRef === 'string') {
      const element = document.querySelector<HTMLElement>(containerRef)
      if (!element) {
        throw new Error(`DragDropManager: Could not find element with selector "${containerRef}"`)
      }
      this.container = element
    } else if (typeof containerRef === 'object' && 'current' in containerRef) {
      if (!containerRef.current) {
        throw new Error('DragDropManager: Ref.current is null')
      }
      this.container = containerRef.current
    } else {
      this.container = containerRef as HTMLElement
    }

    this.config = {
      dragThreshold: config.dragThreshold ?? 10,
      dragDelay: config.dragDelay ?? 0,
      dragDelayTolerance: config.dragDelayTolerance ?? 5,
      clickThreshold: config.clickThreshold ?? 10,
      scrollThreshold: config.scrollThreshold ?? 100,
      scrollSpeed: config.scrollSpeed ?? 10,
      cancelOnEscape: config.cancelOnEscape ?? true,
      cancelOnPointerLeave: config.cancelOnPointerLeave ?? true,
      draggableKind: config.draggableKind,
      droppableKind: config.droppableKind,
      dropScope: config.dropScope ?? 'document',
      keyboard: config.keyboard ?? false,
      focusOnPress: config.focusOnPress ?? false,
    }
    this.draggableKinds = this.normalizeKindList(this.config.draggableKind)
    this.droppableKinds = this.normalizeKindList(this.config.droppableKind)

    this.callbacks = callbacks

    // Bind handlers to preserve context
    this.boundHandlers = {
      pointerDown: this.handlePointerDown.bind(this),
      pointerMove: this.handlePointerMove.bind(this),
      pointerUp: this.handlePointerUp.bind(this),
      pointerCancel: this.handlePointerCancel.bind(this),
      keyDown: this.handleKeyDown.bind(this),
      mouseOut: this.handleMouseOut.bind(this),
      touchMove: this.handleTouchMove.bind(this),
      detachedSourcePointer: this.handleDetachedSourcePointer.bind(this),
      contextMenu: this.handleContextMenu.bind(this),
      preventDefault: (e: Event) => e.preventDefault(),
      pickUpKey: this.handlePickUpKey.bind(this),
      keyboardDragKey: this.handleKeyboardDragKey.bind(this),
      keyUp: this.handleKeyUp.bind(this),
      focusOut: this.handleFocusOut.bind(this),
    }

    this.attachListeners()
  }

  private attachListeners(): void {
    this.container.addEventListener('pointerdown', this.boundHandlers.pointerDown)
    this.container.addEventListener('pointerup', this.boundHandlers.pointerUp)
    this.container.addEventListener('pointercancel', this.boundHandlers.pointerCancel)
    window.addEventListener('pointerup', this.boundHandlers.pointerUp)
    window.addEventListener('pointercancel', this.boundHandlers.pointerCancel)
    window.addEventListener('keydown', this.boundHandlers.keyDown)
    window.addEventListener('mouseout', this.boundHandlers.mouseOut)
    // Non-passive and there from the start: iOS Safari only lets a touch sequence's `touchmove`
    // be cancelled (handleTouchMove) when a non-passive listener was in place at `touchstart`.
    // A listener added at the press is ignored there, so the browser pans and cancels the drag.
    this.container.addEventListener('touchmove', this.boundHandlers.touchMove, { passive: false })
    if (this.config.keyboard) {
      this.container.addEventListener('keydown', this.boundHandlers.pickUpKey)
      // Capture phase: the drag's keys come first, before a roving-focus grid or a dialog.
      window.addEventListener('keydown', this.boundHandlers.keyboardDragKey, true)
      window.addEventListener('keyup', this.boundHandlers.keyUp, true)
      window.addEventListener('focusout', this.boundHandlers.focusOut, true)
    }
  }

  /**
   * The source position and item of the draggable `match`, if it may be dragged: it has a
   * position, is not `data-empty`, `canDrag` allows it and it has item data.
   */
  private resolveSource(match: KindMatch): { position: TPosition; item: TItem } | null {
    const position = this.callbacks.getItemPosition(match.element, match.kind)
    if (!position) return null

    // Check if element is empty (convention: data-empty="any-value")
    if (match.element.dataset.empty !== undefined) return null

    // Check canDrag callback
    if (this.callbacks.canDrag && !this.callbacks.canDrag(match.element, position)) return null

    // Get item data
    const item = this.callbacks.getItemData?.(match.element, position) ?? null
    if (!item) return null
    return { position, item }
  }

  private handlePointerDown(e: PointerEvent): void {
    if (this.state.startPosition) return
    // Only the main button (or a touch/pen contact) drags: a right-click opens a context menu and a
    // middle-click auto-scrolls. An extra finger is part of a pinch, not a drag. (Only touch has
    // non-primary pointers; a constructed PointerEvent defaults to `isPrimary: false`.)
    if (e.button !== 0 || (e.pointerType === 'touch' && !e.isPrimary)) return
    if (claimedPresses.has(e)) return

    const draggableMatch = this.findElementByKinds(e.target as HTMLElement, this.draggableKinds)
    if (!draggableMatch) return
    const source = this.resolveSource(draggableMatch)
    if (!source) return
    const draggableElement = draggableMatch.element

    claimedPresses.add(e)

    // Prevent text selection and native image/link drags during potential drag: by cancelling
    // the press (no focus either), or, with focusOnPress, what the press would start.
    if (!this.config.focusOnPress) e.preventDefault()
    window.addEventListener('selectstart', this.boundHandlers.preventDefault, true)
    window.addEventListener('dragstart', this.boundHandlers.preventDefault, true)

    // Store start position and element info
    this.state.startPosition = { x: e.clientX, y: e.clientY }
    this.state.sourceElement = draggableElement
    this.state.sourcePosition = source.position
    this.state.sourceItem = source.item
    this.state.input = 'pointer'
    this.state.activePointerId = this.getPointerId(e)
    this.activePointerType = e.pointerType ?? ''
    this.lastPointerPos = this.state.startPosition

    // Capture pointer events outside container boundaries when supported.
    if (
      this.state.activePointerId !== null &&
      typeof draggableElement.setPointerCapture === 'function'
    ) {
      try {
        draggableElement.setPointerCapture(this.state.activePointerId)
      } catch {
        // Ignore unsupported/inactive-pointer capture errors.
      }
    }

    // Follow the pointer anywhere in the page: capture ends when the source element leaves the DOM
    // (a virtualized list unmounting it, a framework moving it), and moves outside the container
    // would otherwise go unseen.
    window.addEventListener('pointermove', this.boundHandlers.pointerMove)
    // A touch's events keep their first target: once the source leaves the DOM (a virtualized list
    // unmounting the row), its touch and pointer events reach no container or window listener,
    // only the detached source's own. Without these the drag would never end.
    draggableElement.addEventListener('touchmove', this.boundHandlers.touchMove, { passive: false })
    for (const type of SOURCE_POINTER_EVENTS) {
      draggableElement.addEventListener(type, this.boundHandlers.detachedSourcePointer)
    }
    window.addEventListener('contextmenu', this.boundHandlers.contextMenu)

    const delay = this.delayFor(this.activePointerType)
    if (delay > 0) {
      this.delayTimer = setTimeout(() => {
        this.delayTimer = null
        this.startDrag()
        this.scheduleFrame()
      }, delay)
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.isActivePointer(e)) return

    const currentPos: PointerPosition = { x: e.clientX, y: e.clientY }

    // Check if we should start dragging (threshold not yet met)
    if (this.state.startPosition && !this.state.isDragging) {
      const distance = this.getDistance(this.state.startPosition, currentPos)

      if (this.delayTimer !== null) {
        // A long press stays put: moving away is a scroll or a swipe, which the browser handles.
        if (distance > this.config.dragDelayTolerance) this.cleanup()
        else this.lastPointerPos = currentPos
        return
      }

      if (distance >= this.config.dragThreshold) this.startDrag()
      return
    }

    if (!this.state.isDragging) return

    // Store latest position for RAF
    this.lastPointerPos = currentPos

    // Throttle updates to 60fps using RAF
    this.scheduleFrame()
  }

  private startDrag(): void {
    this.state.isDragging = true
    // Only a pointer release is followed by a click.
    this.suppressClickOnRelease = this.state.input === 'pointer'

    if (this.state.sourceElement && this.state.sourcePosition && this.state.sourceItem) {
      // Set data-dragging attribute on source
      this.state.sourceElement.setAttribute('data-dragging', 'true')

      // Notify drag start
      this.callbacks.onDragStart?.(
        this.state.sourceElement,
        this.state.sourcePosition,
        this.state.sourceItem,
      )
    }
  }

  /** The `dragDelay` for a pointer type (`''` from a constructed event counts as a mouse). */
  private delayFor(pointerType: string): number {
    const { dragDelay } = this.config
    if (typeof dragDelay === 'number') return dragDelay
    return dragDelay[pointerType === 'touch' || pointerType === 'pen' ? pointerType : 'mouse'] ?? 0
  }

  /**
   * Once a touch press is a drag, the finger moves the item, not the page: a browser that starts
   * panning would cancel the pointer. Before that, touches stay the browser's.
   */
  private handleTouchMove(e: TouchEvent): void {
    if (this.state.isDragging && e.cancelable) e.preventDefault()
  }

  /**
   * The press's pointer events, heard on the source itself. While it is in the DOM they also reach
   * the window's listeners, which handle them; once it is detached only these hear them.
   */
  private handleDetachedSourcePointer(e: PointerEvent): void {
    if (this.state.sourceElement?.isConnected !== false) return
    if (e.type === 'pointermove') this.handlePointerMove(e)
    else if (e.type === 'pointerup') this.handlePointerUp(e)
    else this.handlePointerCancel()
  }

  /** A long press opens no context menu (Android, iOS) while it is a drag or about to be one. */
  private handleContextMenu(e: MouseEvent): void {
    const pendingTouch = this.delayTimer !== null && this.activePointerType === 'touch'
    if (this.state.isDragging || pendingTouch) e.preventDefault()
  }

  private scheduleFrame(): void {
    if (this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      this.runFrame()
    })
  }

  /** One drag frame: hover feedback, auto-scroll and `onDragMove` at the latest pointer position. */
  private runFrame(): void {
    const pos = this.lastPointerPos
    if (!pos || !this.state.isDragging) return

    // Find hovered droppable element
    const elementUnderCursor = document.elementFromPoint(pos.x, pos.y) as HTMLElement | null
    this.markTarget(this.findDroppable(elementUnderCursor))

    const scrolled = autoScrollStep(pos, elementUnderCursor, {
      threshold: this.config.scrollThreshold,
      speed: this.config.scrollSpeed,
    })

    // Notify drag move
    this.callbacks.onDragMove?.(pos, this.state.lastHoveredElement)

    // Keep scrolling while the pointer rests in an edge zone: the next frame also hit-tests again,
    // since the content moved under the pointer.
    if (scrolled) this.scheduleFrame()
  }

  private handlePointerUp(e: PointerEvent): void {
    // A stray release does not drop a keyboard drag where the mouse happens to be.
    if (this.state.input === 'keyboard') return
    if (!this.isActivePointer(e)) return

    // Also after a drag that Escape cancelled while the pointer stayed down.
    if (this.suppressClickOnRelease) {
      this.suppressClickOnRelease = false
      this.blockNextClick()
    }

    // Handle click/tap if we never started dragging
    if (this.state.startPosition && !this.state.isDragging) {
      const currentPos = { x: e.clientX, y: e.clientY }
      const distance = this.getDistance(this.state.startPosition, currentPos)

      // If distance is very small, treat as click
      if (
        distance < this.config.clickThreshold &&
        this.state.sourceElement &&
        this.state.sourcePosition
      ) {
        this.callbacks.onClick?.(this.state.sourceElement, this.state.sourcePosition)
      }

      this.cleanup()
      return
    }

    if (!this.state.isDragging || !this.state.sourcePosition || !this.state.sourceItem) {
      this.cleanup()
      return
    }

    // Find drop target
    const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement
    const droppableMatch = this.findDroppable(target)
    const droppableElement = droppableMatch?.element ?? null

    if (droppableElement && droppableMatch) {
      const targetPosition = this.acceptedPosition(droppableMatch)

      if (targetPosition) {
        const result: DragEndResult<TItem, TPosition> = {
          sourcePosition: this.state.sourcePosition,
          targetPosition,
          sourceItem: this.state.sourceItem,
        }
        this.state.lastDropResult = result
        this.callbacks.onDrop?.(result.sourcePosition, result.targetPosition, result.sourceItem)
      }
    }

    this.cleanup()
  }

  private handlePointerCancel(): void {
    if (this.state.input === 'keyboard') return
    // No click follows a cancelled pointer.
    this.suppressClickOnRelease = false
    this.cleanup()
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.config.cancelOnEscape) return
    if (e.key !== 'Escape') return
    if (!this.state.startPosition) return
    this.cleanup()
  }

  private handleMouseOut(e: MouseEvent): void {
    if (e.relatedTarget !== null) return
    // A release outside the window clicks nothing in the page.
    this.suppressClickOnRelease = false
    if (!this.config.cancelOnPointerLeave) return
    if (this.state.input !== 'pointer') return
    this.cleanup()
  }

  /** Space or Enter on a focused draggable picks it up (`keyboard: true`). */
  private handlePickUpKey(e: KeyboardEvent): void {
    if (this.state.startPosition || e.repeat || !isActionKey(e) || claimedPresses.has(e)) return
    const match = this.findElementByKinds(e.target as HTMLElement, this.draggableKinds)
    if (!match) return
    const source = this.resolveSource(match)
    if (!source) return

    claimedPresses.add(e)
    // No button activation, no page scroll on Space.
    e.preventDefault()
    this.swallowKeyUp = e.key

    this.state.startPosition = centerOf(match.element.getBoundingClientRect())
    this.state.sourceElement = match.element
    this.state.sourcePosition = source.position
    this.state.sourceItem = source.item
    this.state.input = 'keyboard'
    this.startDrag()
    // The first target is the source itself when it is a droppable, as a pointer drag hovers it.
    this.pointKeyboardAt(this.findDroppable(match.element))
  }

  /** The keys of a keyboard drag, ahead of anything else on the page. */
  private handleKeyboardDragKey(e: KeyboardEvent): void {
    if (this.state.input !== 'keyboard') {
      // A new key press: the keyup of an earlier pick-up or drop is no longer coming.
      if (!e.repeat) this.swallowKeyUp = null
      return
    }
    const arrow = ARROWS[e.key]
    if (arrow) {
      this.pointKeyboardAt(this.nearestDroppable(arrow.axis, arrow.sign) ?? this.keyboardTarget)
    } else if (isActionKey(e)) {
      // Swallowed whether or not it drops: its keyup must not click the focused source either.
      this.swallowKeyUp = e.key
      if (!e.repeat) this.dropWithKeyboard()
    } else if (e.key === 'Escape') {
      this.cleanup()
    } else {
      // Tab moves focus away (focusout cancels); other keys are the page's.
      return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (this.swallowKeyUp === null || e.key !== this.swallowKeyUp) return
    this.swallowKeyUp = null
    e.preventDefault()
    e.stopPropagation()
  }

  /** Focus leaving the source (Tab, a click elsewhere) cancels a keyboard drag. */
  private handleFocusOut(e: FocusEvent): void {
    const source = this.state.sourceElement
    if (this.state.input !== 'keyboard' || !source) return
    if (!source.contains(e.target as Node)) return
    if (source.contains(e.relatedTarget as Node | null)) return
    this.cleanup()
  }

  /** Makes `match` the keyboard drag's target: marked, scrolled into view, sent to `onDragMove`. */
  private pointKeyboardAt(match: KindMatch | null): void {
    this.keyboardTarget = match
    this.markTarget(match)
    if (!match) return
    match.element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    this.callbacks.onDragMove?.(
      centerOf(match.element.getBoundingClientRect()),
      this.state.lastHoveredElement,
    )
  }

  /**
   * The droppable nearest the current target (or the source) in a direction: its center lies that
   * way, and it is closest along the axis, with distance across the axis counting double, so the
   * next cell in the same row or column wins over a diagonal one.
   */
  private nearestDroppable(axis: 'x' | 'y', sign: 1 | -1): KindMatch | null {
    const from = this.keyboardTarget?.element ?? this.state.sourceElement
    if (!from) return null
    const origin = centerOf(from.getBoundingClientRect())
    const root = this.config.dropScope === 'container' ? this.container : document
    let best: KindMatch | null = null
    let bestScore = Infinity
    for (const element of root.querySelectorAll<HTMLElement>('[data-kind]')) {
      const kind = element.dataset.kind
      if (!kind || element === from || !this.droppableKinds.includes(kind)) continue
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const center = centerOf(rect)
      const along = (axis === 'x' ? center.x - origin.x : center.y - origin.y) * sign
      const across = Math.abs(axis === 'x' ? center.y - origin.y : center.x - origin.x)
      if (along < 1) continue
      const score = along + across * 2
      if (score < bestScore) {
        best = { element, kind }
        bestScore = score
      }
    }
    return best
  }

  /** Drops a keyboard drag on its target, unless there is none or `canDrop` rejects it. */
  private dropWithKeyboard(): void {
    const target = this.keyboardTarget
    const targetPosition = target && this.acceptedPosition(target)
    const { sourcePosition, sourceItem } = this.state
    if (!targetPosition || sourcePosition === null || sourceItem === null) return
    this.state.lastDropResult = { sourcePosition, targetPosition, sourceItem }
    this.callbacks.onDrop?.(sourcePosition, targetPosition, sourceItem)
    this.cleanup()
  }

  /**
   * Swallows the `click` the browser dispatches right after the release that ended a drag, in the
   * same task; a timeout lets the blocker go when no click comes.
   */
  private blockNextClick(): void {
    this.releaseClickBlocker?.()
    const block = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
      release()
    }
    const release = (): void => {
      window.removeEventListener('click', block, true)
      clearTimeout(timer)
      if (this.releaseClickBlocker === release) this.releaseClickBlocker = null
    }
    window.addEventListener('click', block, true)
    const timer = setTimeout(release, 0)
    this.releaseClickBlocker = release
  }

  private cleanup(): void {
    window.removeEventListener('pointermove', this.boundHandlers.pointerMove)
    this.state.sourceElement?.removeEventListener('touchmove', this.boundHandlers.touchMove)
    for (const type of SOURCE_POINTER_EVENTS) {
      this.state.sourceElement?.removeEventListener(type, this.boundHandlers.detachedSourcePointer)
    }
    window.removeEventListener('contextmenu', this.boundHandlers.contextMenu)
    window.removeEventListener('selectstart', this.boundHandlers.preventDefault, true)
    window.removeEventListener('dragstart', this.boundHandlers.preventDefault, true)
    if (this.delayTimer !== null) {
      clearTimeout(this.delayTimer)
      this.delayTimer = null
    }
    this.activePointerType = ''

    // Release pointer capture if we own it.
    if (
      this.state.sourceElement &&
      this.state.activePointerId !== null &&
      typeof this.state.sourceElement.hasPointerCapture === 'function' &&
      typeof this.state.sourceElement.releasePointerCapture === 'function' &&
      this.state.sourceElement.hasPointerCapture(this.state.activePointerId)
    ) {
      try {
        this.state.sourceElement.releasePointerCapture(this.state.activePointerId)
      } catch {
        // Ignore release errors for inactive pointer.
      }
    }

    // Remove data-dragging attribute
    if (this.state.sourceElement) {
      this.state.sourceElement.removeAttribute('data-dragging')
    }

    // Remove hover attributes
    this.markTarget(null)

    // Cancel RAF
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    // Notify drag end (pass drop result when drop was valid, null when cancelled or invalid)
    if (this.state.isDragging) {
      this.callbacks.onDragEnd?.(this.state.lastDropResult)
    }

    // Reset state
    this.state = idleState()
    this.lastPointerPos = null
    this.keyboardTarget = null
  }

  private getPointerId(e: PointerEvent): number | null {
    return typeof e.pointerId === 'number' ? e.pointerId : null
  }

  private isActivePointer(e: PointerEvent): boolean {
    if (this.state.activePointerId === null) {
      return true
    }
    const pointerId = this.getPointerId(e)
    return pointerId === null || pointerId === this.state.activePointerId
  }

  private normalizeKindList(kinds: string | string[]): string[] {
    const values = Array.isArray(kinds) ? kinds : [kinds]
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  }

  /** The target position of the droppable `match` if the current source may drop there. */
  private acceptedPosition(match: { element: HTMLElement; kind: string }): TPosition | null {
    const { sourcePosition, sourceItem } = this.state
    const targetPosition = this.callbacks.getItemPosition(match.element, match.kind)
    if (targetPosition === null || sourcePosition === null || sourceItem === null) return null
    if (
      this.callbacks.canDrop &&
      !this.callbacks.canDrop(sourcePosition, targetPosition, sourceItem)
    ) {
      return null
    }
    return targetPosition
  }

  /**
   * Marks the droppable under the pointer: `data-hovered` when it would receive a drop (also the
   * source itself, for "drag over itself" styling), `data-drop-invalid` when `canDrop` rejects it.
   * Without `canDrop` every droppable is marked hovered.
   */
  private markTarget(match: { element: HTMLElement; kind: string } | null): void {
    const accepted =
      match && (!this.callbacks.canDrop || this.acceptedPosition(match) !== null)
        ? match.element
        : null
    const rejected = match && !accepted ? match.element : null
    this.state.lastHoveredElement = moveMark(
      'data-hovered',
      this.state.lastHoveredElement,
      accepted,
    )
    this.state.lastInvalidElement = moveMark(
      'data-drop-invalid',
      this.state.lastInvalidElement,
      rejected,
    )
  }

  /** The droppable around `element` (the one under the pointer), within `dropScope`. */
  private findDroppable(
    element: HTMLElement | null,
  ): { element: HTMLElement; kind: string } | null {
    if (this.config.dropScope === 'container' && !(element && this.container.contains(element))) {
      return null
    }
    return this.findElementByKinds(element, this.droppableKinds)
  }

  /**
   * Find closest ancestor element with a `data-kind` matching any expected kind.
   */
  private findElementByKinds(
    element: HTMLElement | null,
    kinds: string[],
  ): { element: HTMLElement; kind: string } | null {
    let current = element
    while (current && current !== this.container) {
      const elementKind = current.dataset.kind
      if (elementKind && kinds.includes(elementKind)) {
        return { element: current, kind: elementKind }
      }
      current = current.parentElement
    }
    return null
  }

  /**
   * Calculate distance between two points
   */
  private getDistance(p1: PointerPosition, p2: PointerPosition): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
  }

  /**
   * Get current drag state (read-only)
   */
  public getState(): Readonly<DragState<TItem, TPosition>> {
    return { ...this.state }
  }

  /**
   * Check if currently dragging
   */
  public isDragging(): boolean {
    return this.state.isDragging
  }

  /**
   * Cleanup and remove event listeners
   */
  public destroy(): void {
    this.cleanup()
    this.suppressClickOnRelease = false
    this.releaseClickBlocker?.()
    this.container.removeEventListener('pointerdown', this.boundHandlers.pointerDown)
    this.container.removeEventListener('pointerup', this.boundHandlers.pointerUp)
    this.container.removeEventListener('pointercancel', this.boundHandlers.pointerCancel)
    this.container.removeEventListener('touchmove', this.boundHandlers.touchMove)
    window.removeEventListener('pointerup', this.boundHandlers.pointerUp)
    window.removeEventListener('pointercancel', this.boundHandlers.pointerCancel)
    window.removeEventListener('keydown', this.boundHandlers.keyDown)
    window.removeEventListener('mouseout', this.boundHandlers.mouseOut)
    if (this.config.keyboard) {
      this.container.removeEventListener('keydown', this.boundHandlers.pickUpKey)
      window.removeEventListener('keydown', this.boundHandlers.keyboardDragKey, true)
      window.removeEventListener('keyup', this.boundHandlers.keyUp, true)
      window.removeEventListener('focusout', this.boundHandlers.focusOut, true)
    }
  }
}
