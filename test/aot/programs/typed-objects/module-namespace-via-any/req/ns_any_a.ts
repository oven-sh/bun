export enum Kind { A = 1, B = 2 }
export const enum Hidden { X = 7 }
export interface OnlyAType { n: number }
export let counter = 0
export function bump(by: number): number { counter += by; return counter }
export function replaceable(): string { return "original" }
export const table = { a: 1, b: 2 }
export * from "./ns_any_b"
export { deep as renamed } from "./ns_any_b"
export default function theDefault(): string { return "default" }
