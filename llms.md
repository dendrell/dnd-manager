# dnd-manager

Lightweight, data-driven drag-and-drop for vanilla JS and any framework.

Repository: https://github.com/itsjavi/dnd-manager Demo: https://itsjavi.com/dnd-manager

## Exports

```typescript
import {
  DragDropManager,
  DragPreviewController,
  type DragDropCallbacks,
  type DragDropConfig,
  type DragEndResult,
  type PointerPosition,
  type DragPreviewControllerOptions,
} from 'dnd-manager'
```

---

## Types

### PointerPosition

```typescript
type PointerPosition = { x: number; y: number }
```

### DragEndResult

```typescript
type DragEndResult<TItem, TPosition> = {
  sourcePosition: TPosition
  targetPosition: TPosition
  sourceItem: TItem
}
```

### DragDropConfig

```typescript
type DragDropConfig = {
  draggableKind: string | string[] // Required. data-kind value(s) for draggable elements.
  droppableKind: string | string[] // Required. data-kind value(s) for droppable elements.
  dragThreshold?: number // Default: 10. Pixels before drag starts.
  dragDelay?: number | { mouse?: number; pen?: number; touch?: number } // Default: 0. Long-press ms before the drag starts.
  dragDelayTolerance?: number // Default: 5. Pixels a press may move during dragDelay before it is released.
  clickThreshold?: number // Default: 10. Max pixels to still count as click.
  scrollThreshold?: number // Default: 100. Pixels from a scroll container's or the viewport's edge to auto-scroll.
  scrollSpeed?: number // Default: 10. Pixels per frame during auto-scroll; 0 disables it.
  cancelOnEscape?: boolean // Default: true. Cancel drag on Escape key.
  cancelOnPointerLeave?: boolean // Default: true. Cancel drag when pointer leaves window.
  dropScope?: 'document' | 'container' // Default: 'document'. Where droppables are looked for.
  keyboard?: boolean // Default: false. Keyboard pick-and-place (see "Keyboard").
  focusOnPress?: boolean // Default: false. Let a press focus the draggable; cancel selectstart/dragstart instead of pointerdown.
}
```

### DragDropCallbacks

```typescript
type DragDropCallbacks<TItem, TPosition> = {
  // Required
  getItemPosition: (element: HTMLElement, kind: string) => TPosition | null

  // Optional
  getItemData?: (element: HTMLElement, position: TPosition) => TItem | null
  canDrag?: (element: HTMLElement, position: TPosition) => boolean
  // false rejects the droppable under the pointer (every frame, and at the drop)
  canDrop?: (sourcePosition: TPosition, targetPosition: TPosition, sourceItem: TItem) => boolean
  onDragStart?: (element: HTMLElement, position: TPosition, item: TItem) => void
  onDragMove?: (pos: PointerPosition, hoveredElement: HTMLElement | null) => void
  onDrop?: (sourcePosition: TPosition, targetPosition: TPosition, sourceItem: TItem) => void
  onDragEnd?: (result: DragEndResult<TItem, TPosition> | null) => void
  onClick?: (element: HTMLElement, position: TPosition) => void
}
```

### DragPreviewControllerOptions

```typescript
type DragPreviewControllerOptions = {
  zIndex?: number // Default: 9999
  opacity?: number // Default: 0.95
  centerOnCursor?: boolean // Default: true
  className?: string | string[]
  copyComputedStyles?: string[]
  appendTo?: HTMLElement // Default: document.body
}
```

---

## DragDropManager

### Constructor

```typescript
new DragDropManager<TItem, TPosition>(
  containerRef: { current: HTMLElement | null } | string | HTMLElement,
  config: DragDropConfig,
  callbacks: DragDropCallbacks<TItem, TPosition>,
)
```

`containerRef` accepts a CSS selector string, an HTMLElement, or a React-style ref object.

### Methods

- `getState()` — returns `Readonly<DragState<TItem, TPosition>>` (current drag state).
- `isDragging()` — returns `boolean`.
- `destroy()` — removes all event listeners; call on unmount/teardown.

---

## DragPreviewController

Creates a fixed-position clone of the dragged element that follows the cursor. Avoids drift in
scrolled containers by appending the clone to `document.body` and using transform-based movement.

### Constructor

```typescript
new DragPreviewController(options?: DragPreviewControllerOptions)
```

### Methods

- `startFromElement(element: HTMLElement)` — clones element and shows preview. The clone (and its
  descendants) loses `id`, `name`, `data-kind`, `data-dragging`, `data-hovered` and
  `data-drop-invalid`, so it duplicates no ids, joins no radio group, is no draggable/droppable and
  does not match placeholder styles; it is `inert`, `aria-hidden` and marked `data-drag-preview` for
  styling. Classes and other attributes stay. In `document.body` it loses descendant selectors
  (`.box .slot`) and custom properties inherited from the source's ancestors: copy what it needs
  with `copyComputedStyles`, or render your own preview from the callbacks.
- `moveToPointer(pos: PointerPosition)` — updates position to follow cursor.
- `stop()` — removes preview element.
- `destroy()` — alias for `stop()`.

---

## Data attribute conventions

| Attribute           | Purpose                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `data-kind`         | Identifies draggable/droppable type. Must match `draggableKind`/`droppableKind` in config.                   |
| `data-empty`        | Presence of this attribute (any value) makes the element non-draggable.                                      |
| `data-dragging`     | Set to `"true"` by the manager on the source element during drag. Removed on end/cancel.                     |
| `data-hovered`      | Set to `"true"` by the manager on the currently hovered droppable. Removed when pointer leaves or drag ends. |
| `data-drop-invalid` | Set to `"true"` instead of `data-hovered` on a hovered droppable that `canDrop` rejects.                     |

Style drag/hover feedback using `[data-dragging="true"]`, `[data-hovered="true"]` and
`[data-drop-invalid="true"]` selectors.

---

## Callback lifecycle

1. **pointerdown** on element with matching `data-kind`:
   - Only the main button of the primary pointer counts: right/middle clicks and extra touches are
     ignored.
   - `getItemPosition(element, kind)` resolves position.
   - If `data-empty` is present → stop (not draggable).
   - `canDrag(element, position)` → if `false`, stop.
   - `getItemData(element, position)` resolves item data.
   - The press is claimed: `pointerdown` is cancelled (no text selection, native drag or focus), or,
     with `focusOnPress`, `selectstart` and `dragstart` are cancelled while it is held and the
     draggable gets focus.
2. **Pointer moves past `dragThreshold`** (or, with a `dragDelay` for this pointer type, the press
   is held that long without moving past `dragDelayTolerance`; moving further first releases the
   press to the browser) → drag starts:
   - `data-dragging="true"` set on source element.
   - `onDragStart(element, position, item)` fires.
3. **Pointer moves during drag** (RAF-throttled):
   - `canDrop(sourcePosition, targetPosition, sourceItem)` (if given) checks the hovered droppable.
   - `data-hovered="true"` toggled on an accepted hovered droppable, `data-drop-invalid="true"` on a
     rejected one.
   - `onDragMove(pointerPosition, hoveredDroppable)` fires (`null` over a rejected droppable).
4. **pointerup on valid droppable target** (`canDrop` checked again):
   - `onDrop(sourcePosition, targetPosition, sourceItem)` fires.
   - `onDragEnd({ sourcePosition, targetPosition, sourceItem })` fires.
5. **Drag cancelled** (Escape, pointer leave, `pointercancel`, or drop on a non-target or a rejected
   one):
   - `onDragEnd(null)` fires.
6. **Click** (pointer up before `dragThreshold` and within `clickThreshold`):
   - `onClick(element, position)` fires.

`data-dragging`, `data-hovered` and `data-drop-invalid` are always cleaned up on drag end/cancel.

---

## Usage patterns

### Vanilla JS — basic grid

```typescript
import { DragDropManager, type DragDropCallbacks } from 'dnd-manager'

type Item = { id: string; name: string; color: string }
type Position = { row: number; col: number }

const container = document.getElementById('grid')!
const preview = document.getElementById('preview')!

const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => {
    const row = el.dataset.row,
      col = el.dataset.col
    return row != null && col != null ? { row: +row, col: +col } : null
  },
  getItemData: (el) => {
    const id = el.dataset.itemId,
      name = el.dataset.name,
      color = el.style.background
    return id && name && color ? { id, name, color } : null
  },
  onDragStart: (el, _pos, item) => {
    const rect = el.getBoundingClientRect()
    Object.assign(preview.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      background: item.color,
      opacity: '0.9',
    })
    preview.textContent = item.name
  },
  onDragMove: (pos) => {
    preview.style.left = `${pos.x}px`
    preview.style.top = `${pos.y}px`
  },
  onDrop: (from, to) => {
    const srcEl = container.querySelector(
      `[data-row="${from.row}"][data-col="${from.col}"]`,
    ) as HTMLElement
    const tgtEl = container.querySelector(
      `[data-row="${to.row}"][data-col="${to.col}"]`,
    ) as HTMLElement
    if (srcEl && tgtEl) swapCells(srcEl, tgtEl)
  },
  onDragEnd: () => {
    preview.style.opacity = '0'
  },
  onClick: (el) => console.log('clicked', el.dataset.itemId),
}

const manager = new DragDropManager<Item, Position>(
  container,
  {
    draggableKind: 'cell',
    droppableKind: 'cell',
  },
  callbacks,
)
```

Required markup: elements with `data-kind="cell"`, `data-row`, `data-col`, and item data attributes.
Use `data-empty` on empty slots. Preview element uses
`position: fixed; pointer-events: none; transform: translate(-50%, -50%)`.

### Vanilla JS — with DragPreviewController

```typescript
import { DragDropManager, DragPreviewController, type DragDropCallbacks } from 'dnd-manager'

const preview = new DragPreviewController({ zIndex: 9999, opacity: 0.95, className: 'shadow-xl' })

const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => {
    /* ... */
  },
  getItemData: (el, pos) => {
    /* ... */
  },
  onDragStart: (el) => preview.startFromElement(el),
  onDragMove: (pos) => preview.moveToPointer(pos),
  onDrop: (from, to, item) => {
    /* swap/update DOM */
  },
  onDragEnd: () => preview.stop(),
}

const manager = new DragDropManager(container, config, callbacks)

// Cleanup:
preview.destroy()
manager.destroy()
```

### React

```tsx
const containerRef = useRef<HTMLDivElement>(null)
const [gridData, setGridData] = useState<(GridItem | null)[][]>(INITIAL_DATA)
const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null)

useEffect(() => {
  if (!containerRef.current) return
  const callbacks: DragDropCallbacks<GridItem, GridPosition> = {
    getItemPosition: (el) => {
      const row = el.dataset.row,
        col = el.dataset.col
      return row != null && col != null ? { row: +row, col: +col } : null
    },
    getItemData: (_, pos) => gridData[pos.row]?.[pos.col] ?? null,
    onDragStart: (el, _pos, item) => {
      const rect = el.getBoundingClientRect()
      setDragPreview({ item, position: null, width: rect.width, height: rect.height })
    },
    onDragMove: (pos) => setDragPreview((p) => (p ? { ...p, position: pos } : p)),
    onDrop: (from, to, item) => {
      setGridData((prev) => {
        const next = prev.map((row) => [...row])
        next[to.row][to.col] = item
        next[from.row][from.col] = prev[to.row][to.col]
        return next
      })
    },
    onDragEnd: () => setDragPreview(null),
    onClick: (_, pos) => console.log('clicked', gridData[pos.row]?.[pos.col]),
  }
  const manager = new DragDropManager<GridItem, GridPosition>(
    containerRef,
    { draggableKind: 'cell', droppableKind: 'cell' },
    callbacks,
  )
  return () => manager.destroy()
}, [gridData])
```

Render cells with `data-kind="cell"`, `data-row`, `data-col`. Render a fixed-position preview
element from `dragPreview` state. The manager accepts a React ref
(`{ current: HTMLElement | null }`).

### Multiple managers (cross-container drag)

Create separate `DragDropManager` instances with **compatible `data-kind`** and **shared
callbacks**. Positions must identify items globally (e.g. `{ containerId, itemId }`).

`onDrop` fires on the manager where the drag started. Droppables are found anywhere in the page by
default (`dropScope: 'document'`); `dropScope: 'container'` keeps a manager's drops inside its own
container. With nested containers, a press belongs to the innermost manager that accepts it.

```typescript
type Position = { containerId: 'left' | 'right'; itemId: string }

const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => {
    const containerId = el.closest<HTMLElement>('[data-container]')?.dataset
      .container as Position['containerId']
    const itemId = el.dataset.id
    return containerId && itemId ? { containerId, itemId } : null
  },
  getItemData: (el) => ({ id: el.dataset.id!, label: el.dataset.label! }),
  onDrop: (from, to, item) => {
    /* update both containers */
  },
}

const leftManager = new DragDropManager(
  leftEl,
  { draggableKind: 'cell', droppableKind: 'cell' },
  callbacks,
)
const rightManager = new DragDropManager(
  rightEl,
  { draggableKind: 'cell', droppableKind: 'cell' },
  callbacks,
)
```

### Dynamic drag ability (canDrag)

`canDrag` is called on **every pointer down** before drag starts. It reads current state at
interaction time, so the manager doesn't need to be recreated when permissions or item state change.

**Vanilla JS** — mutate `callbacks.canDrag`:

```typescript
const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => ({ index: +el.dataset.index! }),
  getItemData: (el) => ({ id: el.dataset.id!, locked: el.dataset.locked === 'true' }),
  canDrag: () => true,
}

// Update predicate without recreating manager:
callbacks.canDrag = (el, pos) => {
  const item = callbacks.getItemData?.(el, pos)
  return Boolean(userCanEdit && item && !item.locked)
}
```

**React** — use a ref so `canDrag` always reads current state:

```tsx
const itemsRef = useRef(items)
itemsRef.current = items

const callbacksRef = useRef<DragDropCallbacks<Item, Position>>({
  getItemPosition: (el) => ({ index: +el.dataset.index! }),
  getItemData: (_, pos) => itemsRef.current[pos.index] ?? null,
  canDrag: (_, pos) => {
    const item = itemsRef.current[pos.index]
    return Boolean(hasPermission && item && !item.locked)
  },
})
```

### Reordering in onDragEnd

Use `onDragEnd(result)` instead of `onDrop` to keep reordering and cleanup in one place:

```typescript
onDragEnd: (result) => {
  if (result) {
    const { sourcePosition, targetPosition, sourceItem } = result
    swapElements(container, sourcePosition, targetPosition, sourceItem)
  }
  preview.stop()
}
```

`result` is `DragEndResult<TItem, TPosition>` on valid drop, `null` on cancel/invalid.

### Keyboard (pick-and-place)

With `keyboard: true` (draggables must be focusable: `<button>` or `tabindex="0"`):

- **Space / Enter** on a focused draggable picks it up: `onDragStart`, `data-dragging`; the first
  target is the source itself when it is a droppable.
- **Arrow keys** move the target to the nearest droppable whose center lies in that direction
  (distance across the axis counts double), within `dropScope`, scrolled into view
  (`block: 'nearest'`). `onDragMove(targetCenter, acceptedTarget)` fires per move; `data-hovered` /
  `data-drop-invalid` mark the target.
- **Space / Enter** drops: `onDrop`, then `onDragEnd(result)`. Ignored on a target `canDrop`
  rejects.
- **Escape** cancels (regardless of `cancelOnEscape`; propagation stops). **Tab** or focus leaving
  the source cancels. Pointer releases do not drop a keyboard drag.
- The keydown and the following keyup of Space/Enter are prevented, so a draggable `<button>` is not
  clicked. Focus stays on the source; move it to the item's new element in `onDragEnd`.
- `getState().input` is `'keyboard'` or `'pointer'`. Announce progress from the callbacks into an
  `aria-live` region.

---

## Behavioral notes

- Uses `requestAnimationFrame` for 60fps drag updates.
- Uses pointer events (works with touch, mouse, and pen).
- Touch: while a press is a drag, a non-passive `touchmove` listener prevents the browser's pan
  (which would fire `pointercancel`) and `contextmenu` is prevented. Without `dragDelay`, swiping on
  a draggable drags instead of scrolling; use `dragDelay: { touch: 250 }` for touch lists that must
  scroll. On iOS add `-webkit-touch-callout: none; user-select: none` to draggables.
- Uses `setPointerCapture` / `releasePointerCapture` when available.
- Listens to `pointermove` on the window while a press is held, so a drag keeps working outside the
  container even after the source element leaves the DOM (a virtualized list unmounting the row, a
  framework moving the node), which ends pointer capture.
- Swallows the native `click` that follows the release ending a drag (also after Escape cancelled it
  while the pointer was down), so draggable buttons and links are not activated by a drop.
- `data-dragging`, `data-hovered` and `data-drop-invalid` attributes are always cleaned up
  automatically.
- Auto-scroll: within `scrollThreshold` px of an edge of the closest scroll container under the
  pointer (`overflow: auto | scroll`, nested ones first; the zone is at most a quarter of the
  container's size) that can still scroll that way, that container scrolls; otherwise the window
  scrolls near the viewport's edges. It continues while the pointer rests in the zone (no pointer
  move needed), and the hovered droppable and `onDragMove` update after each step.
- `onDrop` fires before `onDragEnd` on successful drops.
