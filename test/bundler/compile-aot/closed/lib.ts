const show = (x: unknown) => typeof x + ":" + String(x);
export function onlyImported(x: number) { return "onlyImported " + show(x); }
export function importedAndPassedAString(x: number) { return "importedAndPassedAString " + show(x); }
export function byNamespace(x: number) { return "byNamespace " + show(x); }
export function byNamespaceComputed(x: number) { return "byNamespaceComputed " + show(x); }
export function usedHereAsAValue(x: number) { return "usedHereAsAValue " + show(x); }
export const table: Record<string, any> = { usedHereAsAValue };
export const arrow = (x: number) => "arrow " + show(x);
export default function theDefault(x: number) { return "theDefault " + show(x); }
