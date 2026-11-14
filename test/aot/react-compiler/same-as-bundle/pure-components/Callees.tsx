// How the source writes a callee says what the call passes for `this`: `api.who()` passes `api`, and `(0, api.who)()` passes nothing.
// The same holds for the tag of a template.
import { useMemo } from "react";

type Props = { a: number; list: number[] };

const api = {
  who(this: unknown): string {
    return this === undefined ? "none" : this === api ? "api" : "other";
  },
  tag(this: unknown, strings: TemplateStringsArray): string {
    return strings[0] + (this === undefined ? " none" : this === api ? " api" : " other");
  },
};
const box = { api };

export function ValueCallees({ a, list }: Props) {
  "use memo";
  return [a, (0, api.who)(), (0, api["who"])(), (0, box.api.who)(), (0, api.who)?.(), list.map(() => (0, api.who)())];
}

// The compiler puts the body of each function in the place of its call, so the callee of the second call is `api.who` itself.
export function ValueCalleesOfPasses({ a }: Props) {
  "use memo";
  return [a, (() => api.who)()(), useMemo(() => api.who, [])()];
}

export function MemberCallees({ a }: Props) {
  "use memo";
  return [a, api.who(), api["who"](), box.api.who(), api.who?.()];
}

export function ValueTags({ a, list }: Props) {
  "use memo";
  return [a, (list.length, api.tag)`x`, (() => api.tag)()`y`];
}

export function MemberTags({ a }: Props) {
  "use memo";
  return [a, api.tag`x`, box.api.tag`y`];
}
