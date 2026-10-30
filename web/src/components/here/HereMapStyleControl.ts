import standardMapPreview from '../../assets/map-view-standard.svg'
import satelliteMapPreview from '../../assets/map-view-satellite.svg'
import trafficMapPreview from '../../assets/map-view-traffic.svg'

export type BaseMapMode = 'map' | 'satellite'

type Options = {
  container: HTMLElement
  satelliteAvailable: boolean
  trafficAvailable: boolean
  onBaseModeChange: (mode: BaseMapMode) => void
  onTrafficChange: (enabled: boolean) => void
  /** Given, the panel carries an HGV switch below Traffic; absent, there is none. */
  onHgvChange?: (enabled: boolean) => void
}

export type HereMapStyleControlHandle = {
  close: () => void
  dispose: () => void
  setTruckMode: (active: boolean) => void
  /** Mirror the HGV state held by the owner of the layer (no callback fires). */
  setHgv: (active: boolean) => void
}

const layersIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 16 9 5 9-5" />
  </svg>`

const checkIcon = `
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="m5 10 3 3 7-7" />
  </svg>`

const truckIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M10 17h4V5H2v12h3M14 9h4l4 4v4h-3" />
    <circle cx="7.5" cy="17.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </svg>`

export function createHereMapStyleControl({
  container,
  satelliteAvailable,
  trafficAvailable,
  onBaseModeChange,
  onTrafficChange,
  onHgvChange,
}: Options): HereMapStyleControlHandle {
  const root = document.createElement('div')
  root.className = 'here-map-style-control'
  root.innerHTML = `
    <section class="here-map-style-panel" aria-label="Map display settings" hidden>
      <div class="here-map-style-title">Map view</div>
      <div class="here-map-style-grid" role="radiogroup" aria-label="Base map">
        <button type="button" class="here-map-style-option is-active" data-map-mode="map" role="radio" aria-checked="true">
          <span class="here-map-style-thumb">
            <img src="${standardMapPreview}" alt="" draggable="false" />
            <span class="here-map-style-check">${checkIcon}</span>
          </span>
          <span>Map</span>
        </button>
        <button type="button" class="here-map-style-option" data-map-mode="satellite" role="radio" aria-checked="false" ${satelliteAvailable ? '' : 'disabled'}>
          <span class="here-map-style-thumb">
            <img src="${satelliteMapPreview}" alt="" draggable="false" />
            <span class="here-map-style-check">${checkIcon}</span>
          </span>
          <span>Satellite</span>
        </button>
      </div>
      <div class="here-map-style-hgv-note" hidden>Turn off HGV view to change the base map.</div>
      <div class="here-map-style-divider"></div>
      <button type="button" class="here-map-traffic-option" aria-pressed="false" ${trafficAvailable ? '' : 'disabled'}>
        <img src="${trafficMapPreview}" alt="" draggable="false" />
        <span class="here-map-traffic-copy">
          <strong>Traffic</strong>
          <small>Live road conditions</small>
        </span>
        <span class="here-map-style-switch" aria-hidden="true"><span></span></span>
      </button>
      ${
        onHgvChange
          ? `<div class="here-map-style-divider"></div>
      <button type="button" class="here-map-traffic-option here-map-hgv-option" aria-pressed="false">
        <span class="here-map-hgv-thumb" aria-hidden="true">${truckIcon}</span>
        <span class="here-map-traffic-copy">
          <strong>HGV</strong>
          <small>Truck restriction signs</small>
        </span>
        <span class="here-map-style-switch" aria-hidden="true"><span></span></span>
      </button>`
          : ''
      }
    </section>
    <button type="button" class="here-map-style-trigger" aria-label="Map view" title="Map view" aria-expanded="false">
      ${layersIcon}
    </button>`

  const panel = root.querySelector<HTMLElement>('.here-map-style-panel')!
  const trigger = root.querySelector<HTMLButtonElement>('.here-map-style-trigger')!
  const modeButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-map-mode]'))
  const trafficButton = root.querySelector<HTMLButtonElement>('.here-map-traffic-option')!
  const hgvNote = root.querySelector<HTMLElement>('.here-map-style-hgv-note')!
  const hgvButton = root.querySelector<HTMLButtonElement>('.here-map-hgv-option')
  let hgvEnabled = false
  let open = false
  let selectedMode: BaseMapMode = 'map'
  let trafficEnabled = false

  const setOpen = (next: boolean) => {
    open = next
    panel.hidden = !next
    trigger.setAttribute('aria-expanded', String(next))
    root.classList.toggle('is-open', next)
  }

  const syncMode = () => {
    for (const button of modeButtons) {
      const active = button.dataset.mapMode === selectedMode
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-checked', String(active))
    }
  }

  const onTriggerClick = () => setOpen(!open)
  const onModeClick = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement
    if (button.disabled) return
    selectedMode = button.dataset.mapMode as BaseMapMode
    syncMode()
    onBaseModeChange(selectedMode)
  }
  const onTrafficClick = () => {
    if (trafficButton.disabled) return
    trafficEnabled = !trafficEnabled
    trafficButton.classList.toggle('is-active', trafficEnabled)
    trafficButton.setAttribute('aria-pressed', String(trafficEnabled))
    onTrafficChange(trafficEnabled)
  }
  const showHgv = (enabled: boolean) => {
    hgvEnabled = enabled
    hgvButton?.classList.toggle('is-active', enabled)
    hgvButton?.setAttribute('aria-pressed', String(enabled))
  }
  const onHgvClick = () => {
    showHgv(!hgvEnabled)
    onHgvChange?.(hgvEnabled)
  }
  const stopMapPointer = (event: Event) => event.stopPropagation()
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (open && !root.contains(event.target as Node)) setOpen(false)
  }

  trigger.addEventListener('click', onTriggerClick)
  for (const button of modeButtons) button.addEventListener('click', onModeClick)
  trafficButton.addEventListener('click', onTrafficClick)
  hgvButton?.addEventListener('click', onHgvClick)
  root.addEventListener('pointerdown', stopMapPointer)
  root.addEventListener('dblclick', stopMapPointer)
  root.addEventListener('wheel', stopMapPointer)
  document.addEventListener('pointerdown', onDocumentPointerDown)
  container.appendChild(root)

  return {
    close: () => setOpen(false),
    setTruckMode: (active) => {
      for (const button of modeButtons) {
        const unavailable = button.dataset.mapMode === 'satellite' && !satelliteAvailable
        button.disabled = active || unavailable
      }
      hgvNote.hidden = !active
    },
    setHgv: showHgv,
    dispose: () => {
      trigger.removeEventListener('click', onTriggerClick)
      for (const button of modeButtons) button.removeEventListener('click', onModeClick)
      trafficButton.removeEventListener('click', onTrafficClick)
      hgvButton?.removeEventListener('click', onHgvClick)
      root.removeEventListener('pointerdown', stopMapPointer)
      root.removeEventListener('dblclick', stopMapPointer)
      root.removeEventListener('wheel', stopMapPointer)
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      root.remove()
    },
  }
}
