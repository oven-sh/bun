export const TypeId = "~fixture/Cache";
export const Version = 3;
export const Prefixed = `${TypeId}/entry` as const;
export const Checked = "~fixture/checked" satisfies string;
export const Annotated: Annotated = "~fixture/annotated";
export type Annotated = "~fixture/annotated";
export const missing = Symbol();
export const marker: unique symbol = Symbol.for("marker");
export function canonical(value: string): string;
export function canonical(value: number): number;
export function canonical(value: string | number): string | number {
  return value;
}
export function measure(value: string, from?: number): number {
  return value.length - (from ?? 0);
}
export class Unused {
  size = 0;
}
