import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import CountryFlag from './CountryFlag'
import type { TripPlace } from '../lib/vehicleOps'

// A compact loading/unloading place in the room header. A small role marker
// (coloured directional icon + short "Load"/"Unload" label, fixed-width so the
// two lines align) distinguishes loading from unloading at a glance, followed by
// the inline-SVG country flag (when a code is detected) + the "ES 11201
// Algeciras" text, with a "+N" when more stops of that role exist. The flag
// renders nothing for unknown codes.
export default function HeaderPlace({
  kind,
  place,
  extra,
}: {
  kind: 'loading' | 'unloading'
  place: TripPlace
  extra: number
}) {
  const loading = kind === 'loading'
  const RoleIcon = loading ? ArrowUpFromLine : ArrowDownToLine
  return (
    <span className="inline-flex items-center gap-2 min-w-0 text-[0.78125rem]">
      <span
        className={`shrink-0 w-[3.625rem] inline-flex items-center gap-1 text-[0.65625rem] font-semibold uppercase tracking-wide ${
          loading ? 'text-[#5fae72]' : 'text-[#d68a52]'
        }`}
      >
        <RoleIcon size="0.75rem" strokeWidth={2.2} className="shrink-0" />
        {loading ? 'Load' : 'Unload'}
      </span>
      <CountryFlag code={place.code} />
      <span className="truncate text-muted">{place.text || place.code || '—'}</span>
      {extra > 0 && <span className="shrink-0 text-faint">+{extra}</span>}
    </span>
  )
}
