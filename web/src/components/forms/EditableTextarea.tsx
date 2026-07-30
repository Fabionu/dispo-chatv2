import EditableField, { type EditableFieldProps } from './EditableField'

// The multi-line row. A thin alias so a caller says what it means
// (`<EditableTextarea …/>`) instead of passing a control flag — the styles,
// states and save flow are EditableField's, never a second copy.
export default function EditableTextarea(props: Omit<EditableFieldProps, 'control' | 'options'>) {
  return <EditableField {...props} control="textarea" />
}
