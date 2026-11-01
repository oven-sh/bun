export function holdAndCall(f: (seed: number) => unknown, seed: number): unknown[];
export function holdAcrossYields(seed: number): Generator<unknown, unknown[], unknown>;
export function holdAcrossAwaits(f: (n: number) => unknown, seed: number): Promise<unknown[]>;
export function deep(n: number, f: () => number): number;
export function plain(a: any, b: any): any;
export const arrow: (a: any) => any;
export const holder: any;
export class WithStatics { static a: number; static readonly hidden: number; static method(): number; static fromBlock: string; instanceMethod(): void; }
export const word: RegExp;
export const sticky: RegExp;
export function makeRegExp(): RegExp;
export function matchWith(re: RegExp, text: string): RegExpExecArray | null;
export function replaceWith(text: string, re: RegExp | string, f: ((...args: any[]) => string) | string): string;
export const texts: { empty: string; one: string; ascii: string; wide: string; key: string; num: string; long: string };
export class Base { who(): string; hello(): string; get prop(): string; static make<T>(this: new () => T): T; }
export function callWho(o: any): any;
export function callHello(o: any): any;
export function readProp(o: any): any;
export function loopWho(o: any, n: number): string;
export function getAt(o: any, k: any): any;
export function putAt(o: any, k: any, v: any): any;
export function inAt(o: any, k: any): boolean;
export function delAt(o: any, k: any): boolean;
export function forIn(o: any): string[];
export function ownNames(o: any): string[];
export function iterate(o: any): unknown[];
export function destructure(o: any): unknown[];
