export class HotA { n: number; kind: string; constructor(n: number); value(): number; get twice(): number; }
export function sumN(list: any[]): number;
export function sumValue(list: any[]): number;
export function sumTwice(list: any[]): number;
export function bumpN(list: any[]): number;
export function kindsOf(list: any[]): string;
export function countA(list: any[]): number;
export function countHas(list: any[], key: PropertyKey): number;
export function callEach(fs: Array<(x: any) => number>, x: any): number;
export function callEachWith(fs: Array<(...args: any[]) => number>, self: any, ...args: any[]): number;
export function newEach(cs: Array<new (x: number) => { value(): number }>, x: number): number;
export function makeClosures(f: (x: number) => number): Array<(x: number) => number>;
export function pingPong(n: number, other: (n: number, back: any) => number): number;
export function throwAt(n: number, other: (n: number, back: any) => number): number;
export namespace throwAt { let unwound: number | undefined; }
export function catchEvery(n: number, f: (i: number) => unknown): number;
export const toJSONer: { n: number; toJSON(): unknown };
export const primitive: any;
export function compareByN(a: { n: number }, b: { n: number }): number;
