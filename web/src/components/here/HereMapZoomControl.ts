type Options = {
  container: HTMLElement
  onZoomIn: () => void
  onZoomOut: () => void
}

export type HereMapZoomControlHandle = {
  dispose: () => void
}

const plusIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>`

const minusIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14" />
  </svg>`

export function createHereMapZoomControl({
  container,
  onZoomIn,
  onZoomOut,
}: Options): HereMapZoomControlHandle {
  const root = document.createElement('div')
  root.className = 'here-map-zoom-control'
  root.innerHTML = `
    <button type="button" class="here-map-zoom-button" aria-label="Zoom in" title="Zoom in">
      ${plusIcon}
    </button>
    <span class="here-map-zoom-divider" aria-hidden="true"></span>
    <button type="button" class="here-map-zoom-button" aria-label="Zoom out" title="Zoom out">
      ${minusIcon}
    </button>`

  const [zoomInButton, zoomOutButton] = Array.from(
    root.querySelectorAll<HTMLButtonElement>('.here-map-zoom-button'),
  )
  const stopMapPointer = (event: Event) => event.stopPropagation()

  zoomInButton.addEventListener('click', onZoomIn)
  zoomOutButton.addEventListener('click', onZoomOut)
  root.addEventListener('pointerdown', stopMapPointer)
  root.addEventListener('dblclick', stopMapPointer)
  root.addEventListener('wheel', stopMapPointer)
  container.appendChild(root)

  return {
    dispose: () => {
      zoomInButton.removeEventListener('click', onZoomIn)
      zoomOutButton.removeEventListener('click', onZoomOut)
      root.removeEventListener('pointerdown', stopMapPointer)
      root.removeEventListener('dblclick', stopMapPointer)
      root.removeEventListener('wheel', stopMapPointer)
      root.remove()
    },
  }
}
