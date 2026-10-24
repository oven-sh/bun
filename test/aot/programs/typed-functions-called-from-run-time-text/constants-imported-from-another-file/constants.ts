import { open, pointAt } from "./open";
export const origin = open(pointAt)(0);
export const registry = new Map([["a", open(pointAt)(1)]]);
export let limit = open((n: number) => n * 2)(4);
