export class Klass { value(): string { return "real class"; } static make(): Klass { return new Klass(); } }
export const settings = { mode: "real", get(): string { return this.mode; } };
export let counter = 0;
export function bump(): number { return ++counter; }
export async function fetchIt(): Promise<string> { return "real async"; }
export function* walk(): Generator<number> { yield 1; }
export default function theDefault(): string { return "real default"; }
export const usesAll = async (): Promise<unknown[]> => [new Klass().value(), Klass.make().value(), settings.get(), bump() > 0, await fetchIt(), [...walk()], theDefault()];
export enum Color { Red = "red" }
export namespace Tools { export const name = "tools"; export function run(): string { return "ran"; } }
