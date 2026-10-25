# Changelog

The releases of dnd-manager, newest first. Versions follow semver.

## 1.3.0 (2026-10-25)

### Features

- add focusOnPress, so a press can focus the draggable (f3d641b)
- add keyboard pick-and-place (keyboard: true) (2588899)
- add dragDelay for long-press activation, and keep touch drags alive (58a090f)
- add canDrop to reject drop targets while dragging (94f8c1d)
- improve onDragEnd by passing the dropped item info (c38280e)

### Fixes

- keep touch drags alive on iOS Safari and when the source leaves the DOM (662437f)
- keep the source's identity and drag state out of the preview clone (2034b43)
- let one manager take a press in nested containers, and add dropScope (8f1f3de)
- follow pointermove on the window while a press is held (c7a1ee7)
- auto-scroll scroll containers, and keep scrolling at a resting edge (41569f8)
- reject non-primary pointers only for touch (d550b3f)
- ignore presses from secondary buttons and non-primary pointers (7a638ec)
- swallow the native click that follows a drag (5f4cd2c)
- ts config (5a3de4e)
