// The Street View entry on the Google map, in the app's own chrome.
//
// Google's way in is Pegman — a figure you drag onto the map, which paints the
// roads with coverage while you hold him. That widget is Google's, white and
// Material, and it went with the rest of Google's controls (see GoogleMap).
// This is the same job as a two-step gesture the app already speaks: press the
// button (it turns solid, the cursor becomes a crosshair, a hint says what to
// do), then click a road. GoogleMap owns the mode itself — the panorama, the
// coverage lookup, the click — this is only the button and the hint, built the
// way HereMapStyleControl and HereMapZoomControl are so the three stack as one
// column.

type Options = {
  container: HTMLElement
  /** The button was pressed: enter (true) or leave (false) pick mode. */
  onToggle: (picking: boolean) => void
  /** "Back to map" was pressed while the panorama was up. */
  onExit: () => void
}

export type MapStreetViewControlHandle = {
  /** Reflect the mode (GoogleMap decides when it ends — a click, Escape, a
   *  miss, the panorama opening). */
  setActive: (active: boolean) => void
  /** Show a line of guidance over the map; empty hides it. `transient` hides
   *  it again by itself after a moment (a miss: "No Street View here"). */
  setHint: (text: string, transient?: boolean) => void
  dispose: () => void
}

// lucide `PersonStanding` — the nearest thing to Pegman in the app's own
// icon set, and what the planner would use for "a person on the ground".
const personIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="5" r="1" />
    <path d="m9 20 3-6 3 6" />
    <path d="m6 8 6 2 6-2" />
    <path d="M12 10v4" />
  </svg>`

// lucide `ArrowLeft` — the planner header's own "back" glyph.
const backIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m12 19-7-7 7-7" />
    <path d="M19 12H5" />
  </svg>`

export function createMapStreetViewControl({ container, onToggle, onExit }: Options): MapStreetViewControlHandle {
  const root = document.createElement('div')
  root.className = 'here-map-streetview-control'
  root.innerHTML = `
    <button type="button" class="here-map-streetview-trigger" aria-label="Street View" title="Street View — click a road to open it" aria-pressed="false">
      ${personIcon}
    </button>`
  const hint = document.createElement('div')
  hint.className = 'here-map-hint'
  hint.hidden = true
  // The way OUT of the panorama. Google's own close button sits top-left of
  // the panorama — under the planner card, where it could neither be seen nor
  // reached (user, 2026-09-11). This one sits top-centre, clear of the card on
  // the left and the planner's Places / HGV toggles on the right, and is only
  // shown while the host carries `is-streetview` (GoogleMap sets it from the
  // panorama's `visible_changed`). Google's own is switched off.
  const exit = document.createElement('button')
  exit.type = 'button'
  exit.className = 'here-map-streetview-exit'
  exit.setAttribute('aria-label', 'Back to map')
  exit.innerHTML = `${backIcon}<span>Back to map</span>`

  const trigger = root.querySelector<HTMLButtonElement>('.here-map-streetview-trigger')!
  let active = false
  let hintTimer = 0

  const setActive = (next: boolean) => {
    active = next
    trigger.classList.toggle('is-active', next)
    trigger.setAttribute('aria-pressed', String(next))
  }
  const setHint = (text: string, transient = false) => {
    window.clearTimeout(hintTimer)
    hint.textContent = text
    hint.hidden = !text
    if (text && transient) hintTimer = window.setTimeout(() => (hint.hidden = true), 1800)
  }

  const onTriggerClick = () => onToggle(!active)
  const onExitClick = () => onExit()
  const stopMapPointer = (event: Event) => event.stopPropagation()

  trigger.addEventListener('click', onTriggerClick)
  exit.addEventListener('click', onExitClick)
  root.addEventListener('pointerdown', stopMapPointer)
  root.addEventListener('dblclick', stopMapPointer)
  root.addEventListener('wheel', stopMapPointer)
  exit.addEventListener('pointerdown', stopMapPointer)
  exit.addEventListener('dblclick', stopMapPointer)
  container.appendChild(root)
  container.appendChild(hint)
  container.appendChild(exit)

  return {
    setActive,
    setHint,
    dispose: () => {
      window.clearTimeout(hintTimer)
      trigger.removeEventListener('click', onTriggerClick)
      exit.removeEventListener('click', onExitClick)
      root.removeEventListener('pointerdown', stopMapPointer)
      root.removeEventListener('dblclick', stopMapPointer)
      root.removeEventListener('wheel', stopMapPointer)
      exit.removeEventListener('pointerdown', stopMapPointer)
      exit.removeEventListener('dblclick', stopMapPointer)
      root.remove()
      hint.remove()
      exit.remove()
    },
  }
}
