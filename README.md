# dnd-manager

Lightweight, data-driven drag-and-drop for vanilla JS and any framework. Full control over UX
without opinionated component patterns.

**Live demo:** [itsjavi.com/dnd-manager](https://itsjavi.com/dnd-manager) · **Source:**
[demo/](demo/) in this repo · **LLM-optimized docs:** [llms.md](llms.md)

---

## Table of Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Clone preview helper](#clone-preview-helper)
- [Vanilla JS](#vanilla-js)
- [React](#react)
- [Multiple managers](#multiple-managers)
- [Dynamic drag ability](#dynamic-drag-ability)
- [API overview](#api-overview)

---

## Installation

```bash
pnpm add dnd-manager
# or: npm install dnd-manager
```

---

## Quick start

1. Mark draggable/droppable elements with `data-kind` (e.g. `data-kind="cell"`).
2. Add position data (e.g. `data-row`, `data-col` for a grid).
3. Create a `DragDropManager` with callbacks that read position/data and handle drag/drop.

```typescript
import { DragDropManager, type DragDropCallbacks } from 'dnd-manager'

type Item = { id: string; name: string }
type Position = { row: number; col: number }

const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => {
    const row = el.dataset.row,
      col = el.dataset.col
    return row != null && col != null ? { row: +row, col: +col } : null
  },
  getItemData: (el, pos) => ({ id: el.dataset.itemId ?? '', name: el.dataset.name ?? '' }),
  onDrop: (from, to, item) => {
    /* swap/update DOM or state */
  },
  onDragEnd: (result) => {
    /* result or null; cleanup preview etc. */
  },
}

const manager = new DragDropManager<Item, Position>(
  document.querySelector('#container'),
  { draggableKind: 'cell', droppableKind: 'cell' },
  callbacks,
)

// On teardown:
manager.destroy()
```

Elements with `data-empty` are not draggable. Use `onDragStart` / `onDragMove` to show a preview;
use `onDragEnd(result)` for cleanup and optional reordering (see below).

---

## Clone preview helper

`DragPreviewController` gives a clone of the dragged element that follows the cursor
(`position: fixed`, `pointer-events: none`). Reduces drift in scrolled containers.

```typescript
import { DragPreviewController, DragDropManager, type DragDropCallbacks } from 'dnd-manager'

const preview = new DragPreviewController({ zIndex: 9999, opacity: 0.95 })

const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => ({ index: Number(el.dataset.index) }),
  getItemData: (el, pos) => ({ index: pos.index }),
  onDragStart: (element) => preview.startFromElement(element),
  onDragMove: (pos) => preview.moveToPointer(pos),
  onDragEnd: () => preview.stop(),
}

const manager = new DragDropManager(
  container,
  { draggableKind: 'ITEM', droppableKind: 'ITEM' },
  callbacks,
)

// Cleanup:
preview.destroy()
manager.destroy()
```

---

## Vanilla JS

Use a container of elements with `data-kind`, `data-row`, `data-col`, and item fields
(`data-item-id`, `data-name`, etc.). In callbacks:

- **getItemPosition** — parse position from data attributes.
- **getItemData** — return item payload (e.g. id, name, color).
- **onDragStart** — show preview (e.g. copy size/style to a fixed preview element).
- **onDragMove** — update preview position (`left`/`top` or transform).
- **onDrop** — swap/update DOM (or state) using source/target positions and `sourceItem`.
- **onDragEnd(result)** — `result` is `{ sourcePosition, targetPosition, sourceItem }` on valid
  drop, or `null` when cancelled. Use for cleanup (hide preview) and optionally do reordering here
  instead of in `onDrop`.
- **onClick** — handle click (e.g. log or select).

Full grid markup and CSS are in the [demo app](demo/) (see `GridDemo` and styles). Minimal markup
pattern:

```html
<div id="grid-container">
  <div class="cell" data-kind="cell" data-row="0" data-col="0" data-item-id="1" data-name="Item 1">
    Item 1
  </div>
  <!-- ... more cells; use data-empty on empty slots -->
</div>
<div id="drag-preview"></div>
```

### Reordering in `onDragEnd`

You can do all post-drag work in `onDragEnd` so cleanup and DOM/state updates stay in one place:

```typescript
onDragEnd: (result) => {
  if (result === null) return
  const { sourcePosition, targetPosition, sourceItem } = result
  // Update DOM or state (e.g. swap elements), then cleanup
  swapElements(container, sourcePosition, targetPosition, sourceItem)
  preview.style.opacity = '0'
}
```

---

## React

Create the manager inside `useEffect` and clean up on unmount. Use state for grid data and preview;
update state in `onDrop` (or `onDragEnd`). Keep `getItemData` reading from current state so the
manager always has up-to-date item data.

```typescript
useEffect(() => {
  if (!containerRef.current) return
  const callbacks: DragDropCallbacks<GridItem, GridPosition> = {
    getItemPosition: (el) => ({ row: +el.dataset.row!, col: +el.dataset.col! }),
    getItemData: (_, pos) => gridData[pos.row][pos.col],
    onDragStart: (el, _, item) => setDragPreview({ item, rect: el.getBoundingClientRect() }),
    onDragMove: (pos) => setDragPreview((p) => (p ? { ...p, position: pos } : p)),
    onDrop: (from, to, item) => setGridData((prev) => swap(prev, from, to, item)),
    onDragEnd: () => setDragPreview(null),
  }
  const manager = new DragDropManager(
    containerRef,
    { draggableKind: 'cell', droppableKind: 'cell' },
    callbacks,
  )
  return () => manager.destroy()
}, [gridData])
```

Render cells with `data-kind`, `data-row`, `data-col`, and item attributes; render a fixed-position
preview from `dragPreview`. Full component and CSS: [demo app](demo/).

---

## Multiple managers

Use two (or more) `DragDropManager` instances with **compatible `data-kind`** and a **shared
callbacks** object. Ensure positions identify items globally (e.g. `{ containerId, itemId }`) so
`onDrop` / `onDragEnd` can update both containers or shared state.

`onDrop` runs on the manager where the drag **started**. `onDragEnd(result)` runs for every drag;
`result` is the drop payload or `null`.

```typescript
const callbacks: DragDropCallbacks<Item, Position> = {
  getItemPosition: (el) => ({
    containerId: el.closest('[data-container]')?.dataset.container as 'left' | 'right',
    itemId: el.dataset.id!,
  }),
  getItemData: (el) => ({ id: el.dataset.id!, label: el.dataset.label! }),
  onDrop: (sourcePos, targetPos, sourceItem) => {
    // Update DOM or state for both source and target containers
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
// Cleanup: destroy both
```

Drops land on any matching droppable in the page by default (`dropScope: 'document'`). For
independent widgets that share kinds but must not exchange items, set `dropScope: 'container'`.
Managers may also nest: a press inside an inner manager's container belongs to the inner manager
only.

---

## Dynamic drag ability

Control whether an item can be dragged (e.g. by permissions or locked state) **without
reinitializing** the manager.

- **`canDrag(element, position)`** — optional callback; called on every pointer down. Return `true`
  to allow drag, `false` to block.
- Keep the **callbacks object stable** and either:
  - **Mutate** `callbacks.canDrag` when permissions/state change (vanilla), or
  - Have **`canDrag` read from a ref or store** you update (e.g. in React) so the same manager
    instance always sees current state.

**Vanilla:** update `canDrag` when state changes:

```typescript
const callbacks = { getItemPosition, getItemData, canDrag: () => true }
function setCanDrag(fn: (el: HTMLElement, pos: Position) => boolean) {
  callbacks.canDrag = fn
}
setCanDrag((el, pos) => !getItemData(el, pos)?.locked && userCanEdit)
const manager = new DragDropManager(container, config, callbacks)
```

**React:** use a ref that always holds latest state; `canDrag` reads from it so the manager doesn’t
need to be recreated when state changes.

---

## API overview

### Callbacks

| Callback                                             | Purpose                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `getItemPosition(element, kind)`                     | Return position object from DOM (e.g. `{ row, col }`) or `null`.                                                                              |
| `getItemData(element, position)`                     | Return item data for the element at `position`.                                                                                               |
| `canDrag(element, position)`                         | Optional. Return `false` to block drag on this pointer down.                                                                                  |
| `onDragStart(element, position, item)`               | Show preview, update source appearance.                                                                                                       |
| `onDragMove(pointerPosition, hoveredElement)`        | Update preview position.                                                                                                                      |
| `onDrop(sourcePosition, targetPosition, sourceItem)` | Called when dropped on valid target; update DOM/state.                                                                                        |
| `onDragEnd(result)`                                  | Always called when drag ends. `result` = `{ sourcePosition, targetPosition, sourceItem }` or `null`. Use for cleanup and optional reordering. |
| `onClick(element, position)`                         | Click/tap on draggable element.                                                                                                               |

### Manager config

| Option                            | Description                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `draggableKind` / `droppableKind` | String or string[] to match `data-kind`.                                                                 |
| `dragThreshold`                   | Pixels before drag starts (default 10).                                                                  |
| `clickThreshold`                  | Max movement to still count as click (default 10).                                                       |
| `scrollThreshold`                 | Distance from a scroll container's or the viewport's edge to start auto-scroll (default 100).            |
| `scrollSpeed`                     | Auto-scroll speed in px per frame (default 10, `0` disables it).                                         |
| `cancelOnEscape`                  | Cancel drag on Escape (default true).                                                                    |
| `cancelOnPointerLeave`            | Cancel when pointer leaves window (default true).                                                        |
| `dropScope`                       | `'document'` (default): drop on matching droppables anywhere; `'container'`: only inside this container. |

### Conventions

- **`data-kind`** — identifies draggable/droppable type; must match config.
- **`data-empty`** — elements with this attribute are not draggable.
- **Buttons** — only the main button of the primary pointer starts a drag; right-click (context
  menus), middle-click and extra touches are left to the browser.
- **`data-dragging`** — set to `"true"` on the source element during drag; removed on end/cancel.
- **`data-hovered`** — set to `"true"` on the hovered droppable; removed when pointer leaves or drag
  ends.
- **Preview** — implement in `onDragStart` / `onDragMove` / `onDragEnd`, or use
  `DragPreviewController`.

### Notes

- Uses `requestAnimationFrame` for 60fps updates; pointer events work with touch, mouse, and pen.
- Auto-scroll scrolls the closest scroll container under the pointer (`overflow: auto | scroll`)
  that can still scroll toward the edge the pointer is near, nested ones first, and otherwise the
  window. It keeps scrolling while the pointer rests in the edge zone, and re-checks the hovered
  droppable after each step. A container's zone is at most a quarter of its size.
- The native `click` the browser fires after the release that ends a drag (on the source element,
  which holds pointer capture) is swallowed, so a draggable `<button>` or link is not activated by a
  drop. A press that never became a drag clicks as usual.
- While a press is held the manager follows `pointermove` on the whole window, so dragging out of
  the container works even if the source element leaves the DOM mid-drag (a virtualized list
  unmounting its row), which ends pointer capture. Re-render the source's state from your own data
  (`onDragStart` / `onDragEnd`) if the row can come back as a new element.
- React: create manager in `useEffect`, depend on grid state if `getItemData` uses it, and destroy
  on cleanup.
