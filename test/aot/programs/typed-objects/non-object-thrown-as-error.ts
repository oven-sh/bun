// What a program throws need be no object. `Error` is tested like any object type: undefined, null and every object, an Error or not, pass `e as Error` and every place written `Error` (a variable, a parameter, a field, a field of a class, a result, an element) and stay what they are. A thrown string, number, boolean or bigint is no object: `e as Error` throws a TypeError.
class Report { cause: Error; constructor(cause: Error) { this.cause = cause } }
function thrown(v: unknown): unknown { try { throw v } catch (e) { return e } }
function kindOf(e: Error): string { return typeof e }
function messageOf(e: Error): unknown { return e instanceof Error ? e.message : String(e) }
function asError(v: unknown): Error { return thrown(v) as Error }
function say(name: string, f: () => unknown): void {
  let said: string;
  try { said = String(f()) } catch (e) { said = "throws " + (e as Error).name }
  console.log(name + ": " + said);
}
const values: [string, unknown][] = [["a string", "boom"], ["a number", 7], ["a boolean", false], ["a bigint", 5n], ["undefined", undefined], ["null", null], ["a plain object", { message: "plain" }], ["an error", new Error("real")], ["a range error", new RangeError("far")]];
for (const [name, v] of values) {
  say("a variable, " + name, () => { const err: Error = thrown(v) as Error; return typeof err });
  say("a parameter, " + name, () => kindOf(thrown(v) as Error));
  say("a parameter that is looked at, " + name, () => messageOf(thrown(v) as Error));
  say("a field, " + name, () => { const held: { cause: Error } = { cause: thrown(v) as Error }; return typeof held.cause });
  say("a field of a class, " + name, () => typeof new Report(thrown(v) as Error).cause);
  say("a result, " + name, () => typeof asError(v));
  say("an element, " + name, () => { const all: Error[] = [thrown(v) as Error]; return typeof all[0] });
  say("its message, " + name, () => { const err: Error = thrown(v) as Error; return err.message });
  say("the same value, " + name, () => { const err: Error = thrown(v) as Error; return (err as unknown) === v });
}
