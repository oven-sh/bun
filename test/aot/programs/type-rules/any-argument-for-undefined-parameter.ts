// A parameter declared `undefined`, called through `any` with a value of type `any`: what is handed may be undefined, so the call does not always throw.
declare const console: { log(...values: unknown[]): void };
function takesUndefined(x: undefined): unknown { return x; }
function takesNothing(x: undefined | null): unknown { return x; }
const untyped: any = takesUndefined, untypedToo: any = takesNothing;
async function row(name: string, make: () => unknown): Promise<void> { console.log(name, await make()); }
const values: [string, () => any][] = [["first", () => undefined], ["second", () => undefined]];
for (const [name, make] of values) {
  { const value: any = make(); await row(name, () => untyped(value)); }
  { const value: any = make(); await row(name, () => untypedToo(value)); }
}
export {};
