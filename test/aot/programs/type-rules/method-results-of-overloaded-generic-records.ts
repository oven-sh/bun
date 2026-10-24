// A generic overload over an implementation that is typed with `unknown`, one step on: a method of the record that the implementation makes
// returns a record of its own, laid out as { value: unknown }, and the call through the promised type expects { value: number }. The value fits, so the record is taken as it is.
interface Fold<In extends unknown[], Out> {
  readonly run: (box: { value: In }) => { value: Out };
  readonly initial: Out;
}
function fold<In extends unknown[], Out>(initial: Out): Fold<In, Out>;
function fold(initial: unknown): Fold<unknown[], unknown> {
  return { initial, run(box) { return { value: box.value.length }; } };
}
const step = fold<number[], number>(0);
console.log(step.run({ value: [9, -12, 345] }).value + 1);
