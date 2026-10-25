import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DragPreviewController } from '../../src/drag-preview-controller'

function createSourceElement(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'source-item'
  element.textContent = 'Drag me'
  element.style.background = 'rgb(20, 184, 166)'
  element.style.color = 'white'
  document.body.appendChild(element)
  return element
}

describe('DragPreviewController', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  test('creates a clone in document.body with required base styles', () => {
    const source = createSourceElement()
    const controller = new DragPreviewController()

    controller.startFromElement(source)

    const clone = document.body.lastElementChild as HTMLElement
    expect(clone).not.toBe(source)
    expect(clone.getAttribute('aria-hidden')).toBe('true')
    expect(clone.style.position).toBe('fixed')
    expect(clone.style.left).toBe('0px')
    expect(clone.style.top).toBe('0px')
    expect(clone.style.pointerEvents).toBe('none')
    expect(clone.style.zIndex).toBe('9999')
    expect(clone.style.transition).toBe('none')
    expect(clone.style.transform).toBe('translate(-9999px, -9999px)')
    expect(clone.textContent).toBe('Drag me')
  })

  test("drops the source's identity and drag state from the clone, and makes it inert", () => {
    const source = createSourceElement()
    source.id = 'slot-1'
    source.tabIndex = 0
    source.dataset.kind = 'slot'
    source.dataset.dragging = 'true'
    source.dataset.hovered = 'true'
    source.dataset.testid = 'slot'
    source.innerHTML = `<span id="name-1" data-kind="badge">Pikachu</span><input type="radio" name="pick" checked>`
    const controller = new DragPreviewController()

    controller.startFromElement(source)

    const clone = document.body.lastElementChild as HTMLElement
    for (const name of ['id', 'data-kind', 'data-dragging', 'data-hovered']) {
      expect(clone.hasAttribute(name)).toBe(false)
    }
    expect(clone.querySelector('[id], [data-kind], [name]')).toBeNull()
    expect(document.querySelectorAll('#slot-1, #name-1')).toHaveLength(2)
    // The source's radio stays checked: the clone's is in no group.
    expect(source.querySelector('input')!.checked).toBe(true)
    expect(clone.hasAttribute('inert')).toBe(true)
    expect(clone.hasAttribute('data-drag-preview')).toBe(true)
    // What styles it stays: classes and the other attributes.
    expect(clone.className).toBe('source-item')
    expect(clone.dataset.testid).toBe('slot')
    expect(clone.textContent).toBe('Pikachu')
  })

  test('moves clone using centered cursor transform by default', () => {
    const source = createSourceElement()
    const controller = new DragPreviewController()

    controller.startFromElement(source)
    controller.moveToPointer({ x: 120, y: 240 })

    const clone = document.body.lastElementChild as HTMLElement
    expect(clone.style.transform).toBe('translate(120px, 240px) translate(-50%, -50%)')
  })

  test('supports non-centered cursor transform when centerOnCursor is false', () => {
    const source = createSourceElement()
    const controller = new DragPreviewController({ centerOnCursor: false })

    controller.startFromElement(source)
    controller.moveToPointer({ x: 80, y: 40 })

    const clone = document.body.lastElementChild as HTMLElement
    expect(clone.style.transform).toBe('translate(80px, 40px)')
  })

  test('applies options for className, appendTo, and copyComputedStyles', () => {
    const source = createSourceElement()
    const container = document.createElement('section')
    document.body.appendChild(container)

    const controller = new DragPreviewController({
      className: ['drop-shadow-xl', 'preview-clone'],
      appendTo: container,
      copyComputedStyles: ['color'],
      opacity: 0.9,
      zIndex: 1234,
    })

    controller.startFromElement(source)
    const clone = container.lastElementChild as HTMLElement

    expect(clone.classList.contains('drop-shadow-xl')).toBe(true)
    expect(clone.classList.contains('preview-clone')).toBe(true)
    expect(clone.style.opacity).toBe('0.9')
    expect(clone.style.zIndex).toBe('1234')
    expect(clone.style.color).not.toBe('')
  })

  test('stop and destroy are idempotent and remove existing clone', () => {
    const source = createSourceElement()
    const controller = new DragPreviewController()

    controller.startFromElement(source)
    controller.stop()
    controller.stop()
    controller.destroy()
    controller.destroy()

    const preview = document.querySelector('[aria-hidden="true"]')
    expect(preview).toBeNull()
  })
})
