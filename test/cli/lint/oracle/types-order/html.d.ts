// Attributes of elements as a library of components declares them: unions of string literals, `undefined | null`, and an
// interface with two bases.
type EventHandler<E extends Event = Event, T extends EventTarget = Element> = (
  event: E & { currentTarget: EventTarget & T },
) => any;

export interface DOMAttributes<T extends EventTarget> {
  children?: unknown;
  onclick?: EventHandler<MouseEvent, T> | undefined | null;
  onkeydown?: EventHandler<KeyboardEvent, T> | undefined | null;
  "on:click"?: EventHandler<MouseEvent, T> | undefined | null;
}

export interface AriaAttributes {
  "aria-hidden"?: boolean | "false" | "true" | undefined | null;
  "aria-live"?: "assertive" | "off" | "polite" | undefined | null;
  "aria-label"?: string | undefined | null;
  "aria-pressed"?: boolean | "false" | "mixed" | "true" | undefined | null;
}

export interface HTMLAttributes<T extends EventTarget> extends AriaAttributes, DOMAttributes<T> {
  accesskey?: string | undefined | null;
  autocapitalize?: "characters" | "off" | "on" | "none" | "sentences" | "words" | undefined | null;
  class?: ClassValue | undefined | null;
  contenteditable?: boolean | "true" | "false" | "plaintext-only" | "inherit" | undefined | null;
  dir?: "ltr" | "rtl" | "auto" | undefined | null;
  hidden?: boolean | "until-found" | undefined | null;
  id?: string | undefined | null;
  inputmode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search" | undefined | null;
  role?: string | undefined | null;
  style?: string | undefined | null;
  tabindex?: number | undefined | null;
  title?: string | undefined | null;
  translate?: "yes" | "no" | "" | undefined | null;
}

export type ClassValue = string | ClassArray | ClassDictionary;
type ClassArray = ClassValue[];
type ClassDictionary = Record<string, any>;
