// The TypeError messages for reads and stores on null and undefined name the property. `x!` tests nothing. A store of another type to a typed field through `any` succeeds, and the next typed read of the field reports the value.
export {};
const box: any[] = JSON.parse("[0]");
function hidden(value: unknown): any { box[0] = value; return box[0]; }
function shown(value: unknown): string { return typeof value === "string" ? JSON.stringify(value) : String(value); }
function outcome(run: () => unknown): string {
  try { return "no error, " + shown(run()); } catch (error) { return (error as Error).name + ": " + (error as Error).message.replace(/ \(bun compile [^)]*\)/, ""); }
}

const key = Symbol("key");
for (const nothing of [null, undefined]) {
  console.log(nothing + ".p: " + outcome(() => hidden(nothing).p));
  console.log(nothing + "[0]: " + outcome(() => hidden(nothing)[0]));
  console.log(nothing + '["k"]: ' + outcome(() => hidden(nothing)["k"]));
  console.log(nothing + "[key]: " + outcome(() => hidden(nothing)[key]));
  console.log(nothing + ".p = 1: " + outcome(() => { hidden(nothing).p = 1; }));
  console.log(nothing + "?.p: " + outcome(() => hidden(nothing)?.p));
  console.log(nothing + "?.[0]: " + outcome(() => hidden(nothing)?.[0]));
}

function pick(index: number): number | string | null | undefined { return hidden([null, undefined, 0, ""])[index]; }
function assertedVariable(value: number | string | null | undefined): unknown { return value!; }
function assertedCall(index: number): unknown { return pick(index)!; }
for (const value of [null, undefined, 0, ""]) console.log(shown(value) + "!: " + outcome(() => assertedVariable(value)));
for (let index = 0; index < 4; index++) console.log("pick(" + index + ")!: " + outcome(() => assertedCall(index)));

class Counter { count: number = 0; label: string = "none"; }
function readCount(counter: Counter): number { return counter.count; }
function readLabel(counter: Counter): string { return counter.label; }

const byName = new Counter();
console.log("count = 5 by name: " + outcome(() => { hidden(byName).count = 5; }));
console.log("typed read of count: " + outcome(() => readCount(byName)));
console.log('count = "many" by name: ' + outcome(() => { hidden(byName).count = "many"; }));
console.log("typed read of count: " + outcome(() => readCount(byName)));
console.log("untyped read of count: " + outcome(() => hidden(byName).count));

const byKey = new Counter();
const labelKey: string = hidden("label");
console.log('label = "some" by key: ' + outcome(() => { hidden(byKey)[labelKey] = "some"; }));
console.log("typed read of label: " + outcome(() => readLabel(byKey)));
console.log("label = 7 by key: " + outcome(() => { hidden(byKey)[labelKey] = 7; }));
console.log("typed read of label: " + outcome(() => readLabel(byKey)));
console.log("untyped read of label: " + outcome(() => hidden(byKey)[labelKey]));
