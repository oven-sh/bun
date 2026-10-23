// A field of a function type that is declared and never stored is applied inside a callback, by two calls that each stand under a handler of their own. The build aborted: behind an edge that it had split, allocation sinking took up again an object that its second look had left out, and removed the object under a call that still named it.
function describe(value: unknown): string {
  const text = String(value);
  return typeof value + " " + (text.includes("=>") ? "a function" : text);
}
type Step = (step: number) => number;
class Planet {
  declare run: Step;
}
function probe(v: Planet): string {
  let out = "";
  const bag = { held: v };
  [0].forEach(() => {
    out += describe(bag.held.run.apply(undefined, [4]));
  });
  return out;
}
function both(): void {
  try {
    console.log(probe(new Planet()));
  } catch (error) {
    console.log("first threw");
  }
  try {
    console.log(probe(new Planet()));
  } catch (error) {
    console.log("second threw");
  }
}
both();
