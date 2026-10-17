export interface Lazy { readonly value: number; n: number }
export function take(lazy: Lazy): number { return lazy.value + lazy.n; }
let kept: Lazy | undefined;
export function keep(lazy: Lazy): void { kept = lazy; }
export function keptValue(): number { return kept ? kept.value + kept.n : -1; }
