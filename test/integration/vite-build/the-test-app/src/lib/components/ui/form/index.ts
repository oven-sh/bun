import * as FormPrimitive from "formsnap";
import Button from "./form-button.svelte";
import Description from "./form-description.svelte";
import ElementField from "./form-element-field.svelte";
import FieldErrors from "./form-field-errors.svelte";
import Field from "./form-field.svelte";
import Fieldset from "./form-fieldset.svelte";
import Label from "./form-label.svelte";
import Legend from "./form-legend.svelte";

const Control = FormPrimitive.Control;

export {
  Button,
  Control,
  Description,
  ElementField,
  Field,
  FieldErrors,
  Fieldset,
  Button as FormButton,
  Control as FormControl,
  Description as FormDescription,
  ElementField as FormElementField,
  //
  Field as FormField,
  FieldErrors as FormFieldErrors,
  Fieldset as FormFieldset,
  Label as FormLabel,
  Legend as FormLegend,
  Label,
  Legend,
};
