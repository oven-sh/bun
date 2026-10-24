// What a built-in function or a catch clause yields is checked where it enters a declared place: JSON.parse, Reflect.get, Map.get, Object.values, Array.prototype.find and pop on untyped data, inside loops and try blocks.
class Failure extends Error { constructor(public code: number) { super("failure " + code); } }

function parsedText(text: string): string { const value: string = JSON.parse(text); return "text " + value.length; }
function parsedOptionalText(text: string): string { const value: string | undefined | null = JSON.parse(text); return value == null ? "nothing" : "text " + value.length; }
function parsedList(text: string): string { const value: string[] = JSON.parse(text); return "list " + value.length; }
function parsedCount(text: string): string { const value: number = JSON.parse(text); return "count " + (value + 1); }
function reflected(holder: object, key: string): string { const value: string = Reflect.get(holder, key); return "reflected " + value.length; }
function mapped(map: Map<string, any>, key: string): string { const value: string = map.get(key); return "mapped " + value.length; }
function firstValue(holder: Record<string, any>): string { const value: string = Object.values(holder)[0]; return "first " + value.length; }
function found(list: any[]): string { const value: string = list.find(x => x !== null); return "found " + value.length; }
function popped(list: any[]): string { const value: string[] = list.pop(); return "popped " + value.length; }
function caughtFailure(thrown: unknown): string {
  try {
    throw thrown;
  } catch (error: any) {
    const failure: Failure = error;
    return "caught " + failure.code;
  }
}
function caughtText(thrown: unknown): string {
  try {
    throw thrown;
  } catch (error: any) {
    const text: string = error;
    return "caught " + text.length;
  }
}
function inALoop(texts: string[]): string {
  let sum = 0;
  for (const text of texts) {
    const value: string = JSON.parse(text);
    sum += value.length;
  }
  return "sum " + sum;
}
function inATry(text: string): string {
  try {
    const value: string[] = JSON.parse(text);
    return "fine " + value.length;
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
function row(name: string, run: () => string): void {
  try {
    console.log(name, run());
  } catch (error) {
    console.log(name, "threw", (error as Error).name);
  }
}
const texts = ['"four"', "4", '["a","b"]', '{"length":2}', "null", "true"];
for (const text of texts) {
  for (const run of [parsedText, parsedOptionalText, parsedList, parsedCount, inATry]) row(run.name + " " + text, () => run(text));
}
const values: any[] = ["four", 4, ["a", "b"], { length: 2 }, undefined, false, () => 1, new Failure(7)];
for (const value of values) {
  const shown = typeof value === "function" ? "function" : value instanceof Failure ? "Failure" : JSON.stringify(value);
  row("reflected " + shown, () => reflected({ key: value }, "key"));
  row("mapped " + shown, () => mapped(new Map([["key", value]]), "key"));
  row("firstValue " + shown, () => firstValue({ key: value }));
  row("found " + shown, () => found([null, value]));
  row("popped " + shown, () => popped([value]));
  row("caughtFailure " + shown, () => caughtFailure(value));
  row("caughtText " + shown, () => caughtText(value));
}
row("in a loop", () => inALoop(['"a"', '"bc"']));
row("in a loop, the second is wrong", () => inALoop(['"a"', "2", '"bc"']));
