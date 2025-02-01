import Root from "./input.svelte";

export type FormInputEvent<T extends Event = Event> = T & {
  currentTarget: EventTarget & HTMLInputElement;
};
export type InputEvents = {
  blur: FormInputEvent<FocusEvent>;
  change: FormInputEvent<Event>;
  click: FormInputEvent<MouseEvent>;
  focus: FormInputEvent<FocusEvent>;
  focusin: FormInputEvent<FocusEvent>;
  focusout: FormInputEvent<FocusEvent>;
  keydown: FormInputEvent<KeyboardEvent>;
  keypress: FormInputEvent<KeyboardEvent>;
  keyup: FormInputEvent<KeyboardEvent>;
  mouseover: FormInputEvent<MouseEvent>;
  mouseenter: FormInputEvent<MouseEvent>;
  mouseleave: FormInputEvent<MouseEvent>;
  mousemove: FormInputEvent<MouseEvent>;
  paste: FormInputEvent<ClipboardEvent>;
  input: FormInputEvent<InputEvent>;
  wheel: FormInputEvent<WheelEvent>;
  selectionchange: FormInputEvent<Event>;
};

export {
  //
  Root as Input,
  Root,
};
