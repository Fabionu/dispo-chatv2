import type { ReactNode } from 'react'

// Tiny inline-SVG country flags for the common European/logistics countries.
// Inline SVG (a handful of coloured rects each) is reliable on every platform —
// unlike emoji regional indicators, which don't render as flags on Windows. No
// images, no library, no network. Unknown codes render nothing (graceful).
//
// viewBox is 18×12 (3:2). Most flags are simple tri-/bi-colours; a few
// (ES, PT, CZ, GB) carry a special shape. Emblems are intentionally omitted —
// the colours alone read clearly at this size.

const W = 18
const H = 12

function bandsH(colors: string[]): ReactNode[] {
  const h = H / colors.length
  return colors.map((c, i) => (
    // +0.3 overlap avoids hairline seams between bands.
    <rect key={i} x={0} y={i * h} width={W} height={h + 0.3} fill={c} />
  ))
}
function bandsV(colors: string[]): ReactNode[] {
  const w = W / colors.length
  return colors.map((c, i) => <rect key={i} x={i * w} y={0} width={w + 0.3} height={H} fill={c} />)
}

const FLAGS: Record<string, () => ReactNode[]> = {
  DE: () => bandsH(['#000000', '#DD0000', '#FFCE00']),
  FR: () => bandsV(['#002395', '#FFFFFF', '#ED2939']),
  IT: () => bandsV(['#009246', '#FFFFFF', '#CE2B37']),
  NL: () => bandsH(['#AE1C28', '#FFFFFF', '#21468B']),
  BE: () => bandsV(['#000000', '#FAE042', '#ED2939']),
  AT: () => bandsH(['#ED2939', '#FFFFFF', '#ED2939']),
  PL: () => bandsH(['#FFFFFF', '#DC143C']),
  HU: () => bandsH(['#CD2A3E', '#FFFFFF', '#436F4D']),
  RO: () => bandsV(['#002B7F', '#FCD116', '#CE1126']),
  BG: () => bandsH(['#FFFFFF', '#00966E', '#D62612']),
  SK: () => bandsH(['#FFFFFF', '#0B4EA2', '#EE1620']),
  SI: () => bandsH(['#FFFFFF', '#005DA4', '#ED1C24']),
  HR: () => bandsH(['#FF0000', '#FFFFFF', '#171796']),
  ES: () => [
    <rect key="t" x={0} y={0} width={W} height={3} fill="#AA151B" />,
    <rect key="m" x={0} y={3} width={W} height={6} fill="#F1BF00" />,
    <rect key="b" x={0} y={9} width={W} height={3} fill="#AA151B" />,
  ],
  PT: () => [
    <rect key="g" x={0} y={0} width={7.2} height={H} fill="#006600" />,
    <rect key="r" x={7.2} y={0} width={W - 7.2} height={H} fill="#FF0000" />,
  ],
  CZ: () => [
    <rect key="w" x={0} y={0} width={W} height={6} fill="#FFFFFF" />,
    <rect key="r" x={0} y={6} width={W} height={6} fill="#D7141A" />,
    <polygon key="t" points="0,0 9,6 0,12" fill="#11457E" />,
  ],
  GB: () => [
    <rect key="bg" x={0} y={0} width={W} height={H} fill="#012169" />,
    <path key="wd" d="M0,0 L18,12 M18,0 L0,12" stroke="#FFFFFF" strokeWidth={2.6} />,
    <path key="rd" d="M0,0 L18,12 M18,0 L0,12" stroke="#C8102E" strokeWidth={1.1} />,
    <rect key="wv" x={7} y={0} width={4} height={H} fill="#FFFFFF" />,
    <rect key="wh" x={0} y={4} width={W} height={4} fill="#FFFFFF" />,
    <rect key="rv" x={7.6} y={0} width={2.8} height={H} fill="#C8102E" />,
    <rect key="rh" x={0} y={4.6} width={W} height={2.8} fill="#C8102E" />,
  ],
}

export default function CountryFlag({
  code,
  className = '',
}: {
  code: string | null | undefined
  className?: string
}) {
  const cc = code?.toUpperCase()
  const build = cc ? FLAGS[cc] : undefined
  if (!build || !cc) return null
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="17"
      height="12"
      role="img"
      aria-label={cc}
      className={`shrink-0 rounded-[2px] ${className}`}
    >
      {build()}
      {/* Hairline border so white-topped flags stay defined on the dark header. */}
      <rect x={0.3} y={0.3} width={W - 0.6} height={H - 0.6} rx={1.5} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={0.6} />
    </svg>
  )
}
