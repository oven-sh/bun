// Variables that another module reads while this one goes on writing them.
export let live: any = 1;
export function setLive(v: any) { live = v; }
export let neverWrittenAgain: any = "constant";
export var hoisted: any;
export function initHoisted() { hoisted = [1, 2, 3]; }
export let counter = 0;
export const bump = () => ++counter;
export function declared() { return "declared"; }
export function replaceDeclared(v: any) { (declared as any) = v; }
export class Klass { static tag: any = "klass"; }
export const table = new Map<string, any>([["a", 1]]);
export const list: any[] = [];
export const pattern = /a+/g;
