// Small presentational controls for the Route planner panel: a labelled numeric
// input (truck-profile fields) and a labelled read-only stat (route summary).
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-card border border-white/[0.06] bg-white/[0.04] px-2.5 text-[0.8125rem] outline-none transition-colors focus:border-white/[0.16] focus:bg-white/[0.05] placeholder:text-faint"
      />
    </label>
  )
}

// Compact metric tile (route summary): a quiet fill so the three stats read as
// one scannable row without adding border weight to the panel.
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex flex-col gap-0.5 rounded-card bg-white/[0.03] px-2 py-1.5">
      <span className="text-[0.625rem] uppercase tracking-badge text-faint">{label}</span>
      <span className="text-[0.8125rem] font-semibold tracking-[-0.2px] tabular-nums truncate">{value}</span>
    </div>
  )
}
