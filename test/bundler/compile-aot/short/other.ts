export function inOther(a: any, b: any) { return [a, b]; }
export const arrowInOther = (x: any) => x;
export default function () { return "default"; }
export function whoImports() { return import.meta.url.split("/").pop(); }
export async function importsLater() { const m = await import("./third"); return m.third(); }
export function stackHere() { return new Error("here").stack!; }
