import type { PointerPosition } from './drag-drop-manager'

export type DragPreviewControllerOptions = {
  zIndex?: number
  opacity?: number
  centerOnCursor?: boolean
  className?: string | string[]
  copyComputedStyles?: string[]
  appendTo?: HTMLElement
}

const OFFSCREEN_TRANSFORM = 'translate(-9999px, -9999px)'

/**
 * Attributes of the source (and its descendants) that belong to its place in the page or to the
 * drag, not to its look: a clone keeping them would duplicate ids, join radio groups, count as a
 * draggable or droppable, and match `[data-dragging]` placeholder styles.
 */
const SOURCE_ONLY_ATTRIBUTES = [
  'id',
  'name',
  'data-kind',
  'data-dragging',
  'data-hovered',
  'data-drop-invalid',
]

function stripSourceAttributes(clone: HTMLElement): void {
  for (const element of [clone, ...clone.querySelectorAll('*')]) {
    for (const name of SOURCE_ONLY_ATTRIBUTES) element.removeAttribute(name)
  }
}

function normalizeClassNames(className: string | string[] | undefined): string[] {
  if (!className) return []
  return Array.isArray(className) ? className : [className]
}

export class DragPreviewController {
  private options: Required<
    Pick<DragPreviewControllerOptions, 'zIndex' | 'opacity' | 'centerOnCursor'>
  > &
    Omit<DragPreviewControllerOptions, 'zIndex' | 'opacity' | 'centerOnCursor'>
  private previewElement: HTMLElement | null = null

  constructor(options: DragPreviewControllerOptions = {}) {
    this.options = {
      zIndex: options.zIndex ?? 9999,
      opacity: options.opacity ?? 0.95,
      centerOnCursor: options.centerOnCursor ?? true,
      className: options.className,
      copyComputedStyles: options.copyComputedStyles,
      appendTo: options.appendTo,
    }
  }

  public startFromElement(element: HTMLElement): void {
    this.stop()
    const rect = element.getBoundingClientRect()
    const clone = element.cloneNode(true) as HTMLElement
    const computed = window.getComputedStyle(element)
    const appendTo = this.options.appendTo ?? document.body

    stripSourceAttributes(clone)
    // A picture of the source: not focusable (a tabindex is copied), not announced.
    clone.setAttribute('inert', '')
    clone.setAttribute('aria-hidden', 'true')
    clone.setAttribute('data-drag-preview', '')
    clone.style.position = 'fixed'
    clone.style.left = '0'
    clone.style.top = '0'
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    clone.style.pointerEvents = 'none'
    clone.style.zIndex = String(this.options.zIndex)
    clone.style.opacity = String(this.options.opacity)
    clone.style.transform = OFFSCREEN_TRANSFORM
    clone.style.transition = 'none'
    clone.style.cursor = 'grabbing'
    clone.style.margin = '0'
    clone.style.boxSizing = 'border-box'
    clone.style.background = computed.backgroundColor

    for (const classToken of normalizeClassNames(this.options.className)) {
      clone.classList.add(classToken)
    }

    if (this.options.copyComputedStyles && this.options.copyComputedStyles.length > 0) {
      for (const propertyName of this.options.copyComputedStyles) {
        clone.style.setProperty(propertyName, computed.getPropertyValue(propertyName))
      }
    }

    appendTo.appendChild(clone)
    this.previewElement = clone
  }

  public moveToPointer(pos: PointerPosition): void {
    if (!this.previewElement) return
    if (this.options.centerOnCursor) {
      this.previewElement.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`
      return
    }
    this.previewElement.style.transform = `translate(${pos.x}px, ${pos.y}px)`
  }

  public stop(): void {
    this.previewElement?.remove()
    this.previewElement = null
  }

  public destroy(): void {
    this.stop()
  }
}
