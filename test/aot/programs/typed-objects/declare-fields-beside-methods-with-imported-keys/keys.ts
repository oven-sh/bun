export const equalKey = "~kernel/Equal";
export const hashKey = "~kernel/Hash";
export const inspectKey = Symbol.for("nodejs.util.inspect.custom");
export let changing = "first";
export function change(to: string): void {
  changing = to;
}
