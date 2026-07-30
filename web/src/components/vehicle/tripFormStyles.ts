// Field styling for the Add-trip panel and its stop form. These used to be a
// SECOND field recipe (pill-shaped, with its own fill / edge / focus values)
// living alongside the inline editable rows, so the same kind of form looked
// different depending on which panel opened it. They now delegate to the app's
// single field recipe (components/forms/fieldStyles) — the names are kept
// because the trip form imports them in a dozen places, but there is no styling
// left here, only aliases.
import { fieldClass, FIELD_SINGLE } from '../forms/fieldStyles'

// The control box. Inline fields (the country/postal/city row) add their own
// flex/min-width on top.
export const FIELD_BASE = fieldClass()

export const INPUT_CLASS = fieldClass()

// <select> variant — same box, pointer cursor for the native chevron.
export const SELECT_CLASS = `${fieldClass()} cursor-pointer`

export const AREA_CLASS = fieldClass({ multiline: true })

// The single-line height, for controls that must match a field's box without
// being one (e.g. the map-pick button beside an address input).
export const FIELD_HEIGHT = FIELD_SINGLE
