enum Action {
  Start,
  Stop,
}

const handlers: Record<Action, (n: number) => number> = {
  [Action.Start]: n => n + 1,
  [Action.Stop]: n => n - 1,
};
const inOrder: ((n: number) => number)[] = [n => n * 2, n => n * 3];

function run(action: Action, n: number): number {
  return handlers[action](n);
}
function runInOrder(action: Action, n: number): number {
  return inOrder[action](n);
}
function tried(call: () => number): string {
  try {
    return String(call());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += run(i % 2, i) + runInOrder(i % 2, i);
console.log(warm);
const numbers: number[] = [2, -1, 0.5, NaN, 2 ** 31];
for (const n of numbers) {
  const action: Action = n;
  console.log(n, tried(() => run(action, 1)), tried(() => runInOrder(action, 1)), typeof handlers[action], typeof inOrder[action]);
}
const zero: number = -0;
console.log(tried(() => run(zero, 1)), tried(() => runInOrder(zero, 1)));
console.log(run(Action.Stop, 1), runInOrder(Action.Stop, 1));
