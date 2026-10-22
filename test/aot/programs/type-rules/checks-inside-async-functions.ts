// Inside an async function every declared place checks what enters it: parameters of calls through a variable, annotated variables, results of untyped calls and property reads, ahead of and behind an await, inside try blocks and loops.
interface Entry { name: string; tags: string[] }
class Holder { constructor(public held: number) {} }

const untyped: any = {
  text: "text", count: 3, list: ["a", "b"], entry: { name: "n", tags: ["t"] }, holder: new Holder(5), nothing: undefined, call: () => 2,
  give(key: string) { return this[key]; },
};

async function takesText(value: string): Promise<string> { return "text " + value.length; }
async function takesOptionalText(value?: string): Promise<string> { return value === undefined ? "nothing" : "text " + value.length; }
async function takesList(value: string[]): Promise<string> { return "list " + value.length; }
async function takesHolder(value: Holder): Promise<string> { return "holder " + value.held; }
async function takesFunction(value: (x: number) => number): Promise<string> { return "function " + value(1); }
async function takesTwo(first: string, second: string[]): Promise<string> { await null; return first + second.length; }

async function aheadOfTheAwait(key: string): Promise<string> {
  const value: string = untyped[key];
  await null;
  return "ahead " + value.length;
}
async function behindTheAwait(key: string): Promise<string> {
  await null;
  const value: string = untyped[key];
  return "behind " + value.length;
}
async function listBehindTheAwait(key: string): Promise<string> {
  await null;
  const value: string[] = untyped.give(key);
  return "list behind " + value.length;
}
async function optionalBehindTheAwait(key: string): Promise<string> {
  await null;
  const value: string | undefined = untyped.give(key);
  return "optional behind " + (value === undefined ? "nothing" : value.length);
}
async function holderBehindTheAwait(key: string): Promise<string> {
  await null;
  const value: Holder = untyped.give(key);
  return "holder behind " + value.held;
}
async function inATry(key: string): Promise<string> {
  await null;
  try {
    const value: string = untyped.give(key);
    return "fine " + value.length;
  } catch (error) {
    return "caught " + (error as Error).name;
  }
}
async function inALoop(keys: string[]): Promise<string> {
  await null;
  let sum = 0;
  for (const key of keys) {
    const value: string = untyped.give(key);
    sum += value.length;
  }
  return "sum " + sum;
}
async function result(key: string): Promise<string> {
  await null;
  return untyped.give(key);
}

async function row(name: string, run: () => Promise<unknown>): Promise<void> {
  try {
    const value = await run();
    console.log(name, typeof value === "function" ? "a function" : String(value));
  } catch (error) {
    console.log(name, "threw", (error as Error).name);
  }
}
async function main(): Promise<void> {
  const byValue: Record<string, (...given: any[]) => Promise<string>> = { takesText, takesOptionalText, takesList, takesHolder, takesFunction, takesTwo };
  for (const key of ["text", "count", "list", "entry", "holder", "nothing", "call"]) {
    for (const name of ["takesText", "takesOptionalText", "takesList", "takesHolder", "takesFunction"]) await row(name + " " + key, () => byValue[name](untyped[key]));
    await row("takesTwo text " + key, () => byValue.takesTwo("t", untyped[key]));
    await row("takesTwo " + key + " list", () => byValue.takesTwo(untyped[key], ["l"]));
    for (const run of [aheadOfTheAwait, behindTheAwait, listBehindTheAwait, optionalBehindTheAwait, holderBehindTheAwait, inATry, result]) await row(run.name + " " + key, () => run(key));
  }
  await row("takesText, no argument", () => byValue.takesText());
  await row("takesOptionalText, no argument", () => byValue.takesOptionalText());
  await row("in a loop", () => inALoop(["text", "text"]));
  await row("in a loop, the second is wrong", () => inALoop(["text", "count", "text"]));
}
main();
