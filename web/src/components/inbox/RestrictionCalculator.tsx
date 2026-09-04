import { useMemo, useState } from 'react'
import { ArrowLeft, Ban, Plus, Route as RouteIcon, X } from 'lucide-react'

import { DateField, TimeField } from '../DateTimeField'
import { fieldClass } from '../forms/fieldStyles'
import type { RouteCountryLeg } from '../../lib/here/types'
import {
  calculateArrival,
  countryName,
  countryZone,
  expandBanRules,
  legDurationSec,
  partsIn,
  type BanRule,
  type CalcResult,
  type Segment,
} from '../../lib/restrictions'

type Props = {
  /** Country legs handed over from the Route planner. `null` = no route yet. */
  legs: RouteCountryLeg[] | null
  onBack: () => void
  onPlanRoute: () => void
}

const DEFAULT_BREAK_HOURS = '9'

// Read once. `navigator.language` inside a row component is cheap on its own,
// but it was one more thing every row redid on every render.
const LOCALE = typeof navigator === 'undefined' ? 'en' : navigator.language || 'en'

// The date fields speak DD/MM/YYYY (the app's format, and what DateField
// parses); the engine speaks ISO. The UI keeps DD/MM/YYYY as the source of
// truth so a half-typed date is never round-tripped through a stricter format
// and rewritten under the cursor.
function dmyToIso(value: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!m) return ''
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function toDmy(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

// A restriction as the form holds it, with dates still in DD/MM/YYYY.
type RuleDraft = Omit<BanRule, 'dateFrom' | 'dateTo'> & { dateFrom: string; dateTo: string }

type BreakBlock = { id: string; hours: number }

let seq = 0
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`

export default function RestrictionCalculator({ legs, onBack, onPlanRoute }: Props) {
  const now = useMemo(() => new Date(), [])
  const [departDate, setDepartDate] = useState(() => toDmy(now))
  const [departTime, setDepartTime] = useState(
    () => `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  )
  // The program runs out at an absolute moment, not at a clock time that
  // repeats: a driver starting a run with four hours left on his card has a
  // program that ends this afternoon and never comes back, and a two-driver
  // crew runs straight past midnight.
  const [programDate, setProgramDate] = useState(() => toDmy(now))
  const [programTime, setProgramTime] = useState('20:00')
  const [driverCount, setDriverCount] = useState<1 | 2>(1)
  const [averageSpeed, setAverageSpeed] = useState('')
  const [breakDraft, setBreakDraft] = useState(DEFAULT_BREAK_HOURS)
  const [breaks, setBreaks] = useState<BreakBlock[]>([])
  const [rules, setRules] = useState<RuleDraft[]>([])

  // The operation's clock is the DEPARTURE country's, not the browser's: a
  // dispatcher in Bucharest planning a truck that leaves Spain is describing the
  // driver's day, not their own.
  const shiftZone = useMemo(() => {
    const first = legs?.[0]?.code
    return (first && countryZone(first)) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  }, [legs])

  const speedKmh = useMemo(() => {
    const value = Number(averageSpeed.replace(',', '.'))
    return Number.isFinite(value) && value > 0 ? value : null
  }, [averageSpeed])

  const departAt = useMemo(
    () => parseLocalInput(dmyToIso(departDate), departTime, shiftZone),
    [departDate, departTime, shiftZone],
  )

  const programUntil = useMemo(
    () => parseLocalInput(dmyToIso(programDate), programTime, shiftZone),
    [programDate, programTime, shiftZone],
  )

  // Rules → flat windows. A rule with no usable start date contributes nothing,
  // so a half-typed date can't blank the whole calculation.
  const bans = useMemo(
    () =>
      expandBanRules(
        rules
          .map((rule) => ({
            ...rule,
            dateFrom: dmyToIso(rule.dateFrom),
            dateTo: dmyToIso(rule.dateTo) || dmyToIso(rule.dateFrom),
          }))
          .filter((rule) => rule.dateFrom !== ''),
      ),
    [rules],
  )

  const result = useMemo<CalcResult | null>(() => {
    if (!legs || legs.length === 0 || departAt === null) return null
    return calculateArrival({
      departAt,
      programUntil,
      driverCount,
      breakHours: breaks.map((b) => b.hours),
      shiftZone,
      averageSpeedKmh: speedKmh,
      legs,
      bans,
    })
  }, [legs, departAt, programUntil, driverCount, breaks, shiftZone, speedKmh, bans])

  const addBreak = () => {
    const hours = Number(breakDraft.replace(',', '.'))
    if (!Number.isFinite(hours) || hours <= 0) return
    setBreaks((current) => [...current, { id: nextId('brk'), hours }])
  }

  const removeBreak = (id: string) =>
    setBreaks((current) => current.filter((block) => block.id !== id))

  const addRule = (countryCode: string) => {
    setRules((current) => [
      ...current,
      {
        id: nextId('rule'),
        countryCode,
        dateFrom: departDate,
        dateTo: departDate,
        intervals: [{ id: nextId('int'), from: '22:00', to: '06:00' }],
      },
    ])
  }

  const patchRule = (id: string, patch: Partial<RuleDraft>) =>
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)))

  const removeRule = (id: string) => setRules((current) => current.filter((rule) => rule.id !== id))

  const addInterval = (id: string) =>
    setRules((current) =>
      current.map((rule) =>
        rule.id === id
          ? {
              ...rule,
              intervals: [...rule.intervals, { id: nextId('int'), from: '07:00', to: '16:00' }],
            }
          : rule,
      ),
    )

  const patchInterval = (
    ruleId: string,
    intervalId: string,
    patch: Partial<{ from: string; to: string }>,
  ) =>
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              intervals: rule.intervals.map((interval) =>
                interval.id === intervalId ? { ...interval, ...patch } : interval,
              ),
            }
          : rule,
      ),
    )

  // The last window is never removable: a restriction with no hours in it is
  // not a restriction, and leaving an empty rule on screen would read as one
  // that simply isn't working.
  const removeInterval = (ruleId: string, intervalId: string) =>
    setRules((current) =>
      current.map((rule) =>
        rule.id === ruleId && rule.intervals.length > 1
          ? { ...rule, intervals: rule.intervals.filter((interval) => interval.id !== intervalId) }
          : rule,
      ),
    )

  return (
    <>
      <header className="h-[var(--header-height)] flex shrink-0 items-center gap-3 px-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to workspace"
          className={`${ICON_BTN} h-8 w-8`}
        >
          <ArrowLeft size="1rem" strokeWidth={1.8} />
        </button>
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-[-0.2px] leading-tight">
            Restriction calculator
          </div>
          <div className="mt-0.5 truncate text-sm leading-tight text-muted">
            Driving bans, rests and the arrival they add up to
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto flex max-w-[57.5rem] flex-col gap-6">
          {!legs || legs.length === 0 ? (
            <EmptyState onPlanRoute={onPlanRoute} />
          ) : (
            <>
              {result && (
                <Arrival result={result} zone={shiftZone} breakCount={breaks.length} />
              )}

              <section>
                <div className="eyebrow mb-2">Working plan</div>
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
                  <Field label="Departure date">
                    <DateField
                      value={departDate}
                      onChange={setDepartDate}
                      ariaLabel="Departure date"
                    />
                  </Field>
                  <Field label="Departure time">
                    <TimeField
                      value={departTime}
                      onChange={setDepartTime}
                      ariaLabel="Departure time"
                    />
                  </Field>
                  <Field label="Program until" hint="Date">
                    <DateField
                      value={programDate}
                      onChange={setProgramDate}
                      ariaLabel="Program until, date"
                    />
                  </Field>
                  <Field label="Program until" hint="Time">
                    <TimeField
                      value={programTime}
                      onChange={setProgramTime}
                      ariaLabel="Program until, time"
                    />
                  </Field>
                  <Field label="Crew">
                    <select
                      value={driverCount}
                      onChange={(e) => setDriverCount(Number(e.target.value) === 2 ? 2 : 1)}
                      aria-label="Number of drivers"
                      className={fieldClass()}
                    >
                      <option value={1}>1 driver · 9h shifts</option>
                      <option value={2}>2 drivers · 18h shifts</option>
                    </select>
                  </Field>
                  <Field label="Average speed" hint="km/h — blank uses HERE">
                    <input
                      type="number"
                      inputMode="decimal"
                      min={1}
                      max={130}
                      placeholder="HERE estimate"
                      value={averageSpeed}
                      onChange={(e) => setAverageSpeed(e.target.value)}
                      className={fieldClass()}
                    />
                  </Field>
                </div>

                {/* Rests are entered as HOURS and never as moments. Where a truck
                    can actually stop for nine — never mind forty-five — depends
                    on parking, the shipper's window and where the driver happens
                    to be when his hours run out. The hours are real and the
                    dispatcher knows them; only their position is unknowable, so
                    only their position is left out. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted">Rests</span>
                  {breaks.map((block) => (
                    <span
                      key={block.id}
                      className="rounded-chip flex h-7 items-center gap-1 border border-line pl-2.5 pr-1 text-sm"
                    >
                      {formatHours(block.hours)}
                      <button
                        type="button"
                        onClick={() => removeBreak(block.id)}
                        aria-label={`Remove the ${formatHours(block.hours)} rest`}
                        className={`${ICON_BTN} h-5 w-5`}
                      >
                        <X size="0.625rem" strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.5}
                    max={99}
                    step={0.5}
                    value={breakDraft}
                    onChange={(e) => setBreakDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addBreak()
                      }
                    }}
                    aria-label="Rest length in hours"
                    className={`${COMPACT_FIELD} w-16`}
                  />
                  <span className="text-sm text-faint">h</span>
                  <button type="button" onClick={addBreak} className={SMALL_BTN}>
                    <Plus size="0.75rem" strokeWidth={1.8} />
                    Add rest
                  </button>
                </div>

                <p className="mt-2.5 text-xs leading-relaxed text-faint">
                  The program runs on {zoneLabel(shiftZone)} time. Ban windows below are read in each
                  country&rsquo;s own local time, which is not always the same hour. Rest hours are
                  added to the arrival, not placed on the timeline &mdash; so a ban falling after the
                  first rest is timed approximately.
                </p>
              </section>

              <section>
                <div className="eyebrow mb-2">Countries on the route</div>
                <div className="flex flex-col divide-y divide-line border-y border-line">
                  {legs.map((leg, index) => (
                    <CountryRow
                      key={`${leg.code}-${index}`}
                      leg={leg}
                      speedKmh={speedKmh}
                      rules={rules.filter((rule) => rule.countryCode === leg.code)}
                      onAddRule={() => addRule(leg.code)}
                      onPatchRule={patchRule}
                      onRemoveRule={removeRule}
                      onAddInterval={addInterval}
                      onPatchInterval={patchInterval}
                      onRemoveInterval={removeInterval}
                    />
                  ))}
                </div>
              </section>

              {result && (
                <section>
                  <div className="eyebrow mb-2">Timeline</div>
                  <div className="flex flex-col divide-y divide-line border-y border-line">
                    {result.segments.map((segment, index) => (
                      <TimelineRow key={index} segment={segment} zone={shiftZone} />
                    ))}
                  </div>
                </section>
              )}

              {result && result.unknownZones.length > 0 && (
                <p className="text-xs leading-relaxed text-alert">
                  No time zone known for {result.unknownZones.join(', ')} — bans in{' '}
                  {result.unknownZones.length === 1 ? 'that country' : 'those countries'} were read
                  in {zoneLabel(shiftZone)} time instead.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

const COMPACT_FIELD = fieldClass({ fullWidth: false })

const ICON_BTN =
  'rounded-btn flex shrink-0 items-center justify-center text-muted transition-colors hover:bg-white/6 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20'

const SMALL_BTN =
  'rounded-btn flex h-7 shrink-0 items-center gap-1.5 border border-line px-2.5 text-xs text-muted transition-colors hover:bg-white/6 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted">
        {label}
        {hint && <span className="text-faint"> · {hint}</span>}
      </span>
      {children}
    </label>
  )
}

// A route is the calculator's only real input, so with none in hand the screen
// points at the tool that produces one rather than showing an inert form.
function EmptyState({ onPlanRoute }: { onPlanRoute: () => void }) {
  return (
    <div className="rounded-soft flex flex-col items-center border border-line bg-white/2 px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-tile border border-active/20 bg-active/10 text-active">
        <RouteIcon size="1.25rem" strokeWidth={1.6} />
      </span>
      <div className="mt-3 text-lg font-semibold tracking-[-0.2px]">No route yet</div>
      <p className="mt-1 max-w-[26rem] text-base leading-[1.5] text-muted">
        The calculator works from the countries a route passes through. Plan one, then send it here
        from the route summary.
      </p>
      <button
        type="button"
        onClick={onPlanRoute}
        className="rounded-btn mt-4 h-9 border border-line bg-white/6 px-4 text-base text-text transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        Open route planner
      </button>
    </div>
  )
}

function Arrival({
  result,
  zone,
  breakCount,
}: {
  result: CalcResult
  zone: string
  breakCount: number
}) {
  // The shift count is the one thing the calculator can honestly say about
  // rests: it knows how much driving is left over once the current program runs
  // out, and how long a shift is for this crew. Whether the dispatcher has
  // entered enough rest blocks to cover them is a comparison worth surfacing —
  // it is the difference between an arrival and a wish.
  const short = result.shiftsNeeded > breakCount
  return (
    <section className="rounded-soft border border-line bg-white/2 p-4">
      <div className="eyebrow">Arrival</div>
      <div className="mt-1 text-2xl font-semibold tracking-[-0.4px]">
        {formatInstant(result.arrival, zone)}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2.5 text-sm text-muted">
        <span>Driving {formatSpan(result.drivingMs)}</span>
        <span>Rest {formatSpan(result.breakMs)}</span>
        <span className={result.banMs > 0 ? 'text-alert' : undefined}>
          Held by bans {formatSpan(result.banMs)}
        </span>
      </div>
      {result.shiftsNeeded > 0 && (
        <div className={`mt-2 text-sm ${short ? 'text-alert' : 'text-muted'}`}>
          {formatSpan(result.overrunMs)} of driving falls past the program —{' '}
          {result.shiftsNeeded === 1
            ? `1 more shift of ${result.shiftHours} h`
            : `${result.shiftsNeeded} more shifts of ${result.shiftHours} h`}
          {short &&
            ` · ${breakCount === 0 ? 'no rest entered' : `only ${breakCount} rest${breakCount === 1 ? '' : 's'} entered`}`}
        </div>
      )}
    </section>
  )
}

function CountryRow({
  leg,
  speedKmh,
  rules,
  onAddRule,
  onPatchRule,
  onRemoveRule,
  onAddInterval,
  onPatchInterval,
  onRemoveInterval,
}: {
  leg: RouteCountryLeg
  speedKmh: number | null
  rules: RuleDraft[]
  onAddRule: () => void
  onPatchRule: (id: string, patch: Partial<RuleDraft>) => void
  onRemoveRule: (id: string) => void
  onAddInterval: (id: string) => void
  onPatchInterval: (
    ruleId: string,
    intervalId: string,
    patch: Partial<{ from: string; to: string }>,
  ) => void
  onRemoveInterval: (ruleId: string, intervalId: string) => void
}) {
  const seconds = legDurationSec(leg, speedKmh)
  return (
    <div className="py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">
            {countryName(leg.code, LOCALE)}
          </span>
          <span className="mt-0.5 block text-xs text-faint">
            {Math.round(leg.length / 1000)} km · {formatSpan(seconds * 1000)} driving
          </span>
        </span>
        <button type="button" onClick={onAddRule} className={SMALL_BTN}>
          <Plus size="0.75rem" strokeWidth={1.8} />
          Restriction
        </button>
      </div>

      {rules.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-card border border-line p-2.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <Ban size="0.75rem" strokeWidth={1.8} className="shrink-0 text-alert" />
                <span className="text-xs text-faint">From</span>
                <DateField
                  value={rule.dateFrom}
                  onChange={(value) => onPatchRule(rule.id, { dateFrom: value })}
                  className="w-[9.5rem]"
                  ariaLabel="Restriction first day"
                />
                <span className="text-xs text-faint">to</span>
                <DateField
                  value={rule.dateTo}
                  onChange={(value) => onPatchRule(rule.id, { dateTo: value })}
                  className="w-[9.5rem]"
                  ariaLabel="Restriction last day"
                />
                <button
                  type="button"
                  onClick={() => onRemoveRule(rule.id)}
                  aria-label="Remove restriction"
                  className={`${ICON_BTN} ml-auto h-7 w-7`}
                >
                  <X size="0.75rem" strokeWidth={1.8} />
                </button>
              </div>

              {/* One row per window. Countries that close the middle of the day
                  and the evening separately (07:00–16:00, then 19:00–00:00)
                  need both, and they apply to every day in the range above. */}
              <div className="mt-2 flex flex-col gap-1.5">
                {rule.intervals.map((interval) => (
                  <div key={interval.id} className="flex flex-wrap items-center gap-2">
                    <TimeField
                      value={interval.from}
                      onChange={(value) => onPatchInterval(rule.id, interval.id, { from: value })}
                      className="w-[7.5rem]"
                      ariaLabel="Window start"
                    />
                    <span className="text-xs text-faint">to</span>
                    <TimeField
                      value={interval.to}
                      onChange={(value) => onPatchInterval(rule.id, interval.id, { to: value })}
                      className="w-[7.5rem]"
                      ariaLabel="Window end"
                    />
                    {rule.intervals.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRemoveInterval(rule.id, interval.id)}
                        aria-label="Remove window"
                        className={`${ICON_BTN} h-7 w-7`}
                      >
                        <X size="0.6875rem" strokeWidth={1.8} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => onAddInterval(rule.id)}
                  className={`${SMALL_BTN} self-start`}
                >
                  <Plus size="0.75rem" strokeWidth={1.8} />
                  Window
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelineRow({ segment, zone }: { segment: Segment; zone: string }) {
  const label =
    segment.kind === 'drive'
      ? `Driving · ${countryName(segment.countryCode, LOCALE)}`
      : segment.kind === 'break'
        ? `Rest ${formatSpan(segment.end - segment.start)} · position not fixed`
        : `Restriction · ${countryName(segment.countryCode, LOCALE)}`
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        aria-hidden
        className={`h-6 w-0.5 shrink-0 ${
          segment.kind === 'drive'
            ? 'bg-active'
            : segment.kind === 'ban'
              ? 'bg-alert'
              : 'bg-line-2'
        }`}
      />
      <span className="min-w-0 flex-1 truncate text-base">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-faint">
        {formatInstant(segment.start, zone)} → {formatInstant(segment.end, zone)}
      </span>
    </div>
  )
}

// ── Formatting ───────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, '0')
}

// The date/time inputs read as wall clock in the OPERATION's zone, not the
// browser's — the same rule the rest of the calculator follows, so a dispatcher
// abroad still enters the driver's departure time and not their own.
function parseLocalInput(isoDate: string, time: string, zone: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  const t = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  return zonedToUtcSafe(zone, Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]))
}

function zonedToUtcSafe(
  zone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  // Re-derived through partsIn so this file has one dependency on the engine's
  // zone handling rather than a second implementation of it.
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const offset = (at: number) => {
    const p = partsIn(zone, at)
    return (
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Math.floor(at / 1000) * 1000
    )
  }
  let utc = naive - offset(naive)
  utc = naive - offset(utc)
  return utc
}

function formatInstant(ms: number, zone: string): string {
  const p = partsIn(zone, ms)
  return `${pad(p.day)}.${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`
}

function formatSpan(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

// "9h", and "4,5h" for a half — a decimal comma, which is what this app's users
// write and what the number field beside it accepts.
function formatHours(hours: number): string {
  return `${String(hours).replace('.', ',')}h`
}

// "Europe/Bucharest" reads as machinery in a sentence; the city does not.
function zoneLabel(zone: string): string {
  const city = zone.split('/').pop() ?? zone
  return city.replace(/_/g, ' ')
}
