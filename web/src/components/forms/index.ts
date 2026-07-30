// The app's form kit. Everything editable in a panel comes from here so a
// field looks and behaves the same in Account, My profile, Company profile,
// Group info, the trip/stop editors and any future settings screen.
//
//   EditableField     label + value, edits in place (input / textarea / select)
//   EditableTextarea  multi-line variant of the same row
//   EditableSelect    option-list variant of the same row
//   FormActions       the Save/Cancel pair used inside a row
//   FormFooter        the same pair as labelled buttons for a whole form
//   FieldError/Hint   the message line under a control
//   fieldStyles       the class recipes, if a bespoke control ever needs them
//
// Section wrappers live with the panel chrome (settings/profileChrome →
// ProfileSection), since a section is panel layout rather than a control.

export { default as EditableField, type EditableFieldProps } from './EditableField'
export { default as EditableTextarea } from './EditableTextarea'
export { default as EditableSelect } from './EditableSelect'
export { FormActions, FormFooter, type SaveState } from './FormActions'
export { FieldError, FieldHint, OptionalMark } from './FieldError'
export {
  FIELD_LABEL,
  FIELD_ROW,
  FIELD_VALUE,
  FIELD_SINGLE,
  FIELD_MULTI,
  fieldClass,
} from './fieldStyles'
