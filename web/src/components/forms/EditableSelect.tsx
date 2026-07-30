import EditableField, { type EditableFieldProps } from './EditableField'

// The option-list row. Same alias trick as EditableTextarea, plus a typed
// `onSave` that hands the caller back its own union instead of a bare string —
// the shape the vehicle/trip tabs already save with (undefined = cleared).
export default function EditableSelect<T extends string>({
  options,
  onSave,
  ...rest
}: Omit<EditableFieldProps, 'control' | 'options' | 'onSave' | 'type'> & {
  options: ReadonlyArray<{ value: T; label: string }>
  onSave?: (value: T | undefined) => Promise<void>
}) {
  return (
    <EditableField
      {...rest}
      control="select"
      options={options}
      onSave={onSave ? (v) => onSave((v || undefined) as T | undefined) : undefined}
    />
  )
}
