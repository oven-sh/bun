// `bun test --rerun-each=<n> ./file-end-orders-fixture.ts` loads this file n times in one global. Each load plays the next order of
// up to DEPTH calls on the property TARGET, then each order of the JSON list ORDERS. The load after it looks at what the end of the
// test file left on the property: what was there before all loads, or a value that the order assigned by hand.
// The last load prints { orders, bad }.
import { jest, test, vi as viOfBun } from "bun:test";

// "setTimeout", "Date.now", "performance.now" or "process.nextTick".
const [name, ownerName = "globalThis"] = process.env.TARGET!.split(".").reverse();
const owner = (globalThis as any)[ownerName] as Record<string, unknown>;
const depth = Number(process.env.DEPTH);
const calls = process.env.CALLS!.split(",");
// API is "jest", "bun:test" for its `vi`, or "vitest" for the `vi` that `--globals=vitest` defines.
// This file does not import "vitest": that import gives a test file the globals of Vitest.
const api =
  process.env.API === "jest"
    ? jest
    : process.env.API === "vitest"
      ? ((globalThis as any).vi as typeof viOfBun)
      : viOfBun;
// Fake timers leave `process.nextTick` alone unless they are told to replace it.
const options = name === "nextTick" ? { toFake: ["nextTick" as const] } : undefined;

type State = {
  orders: string[][];
  next: number;
  first: PropertyDescriptor | undefined;
  // Each spy and each assigned function of every load, with the order that made it.
  made: WeakMap<object, string>;
  assignedByHand: unknown[];
  bad: string[];
};
const state: State = ((globalThis as any).stateOfFileEndOrders ??= (() => {
  const orders: string[][] = [];
  const extend = (order: string[]) => {
    if (order.length) orders.push(order);
    if (order.length < depth) for (const call of calls) extend([...order, call]);
  };
  extend([]);
  orders.push(...JSON.parse(process.env.ORDERS ?? "[]"));
  return {
    orders,
    next: 0,
    first: Object.getOwnPropertyDescriptor(owner, name),
    made: new WeakMap(),
    assignedByHand: [],
    bad: [],
  };
})());

function whatIsLeft(): string | undefined {
  const { first } = state;
  const left = Object.getOwnPropertyDescriptor(owner, name);
  if (!left) return first ? "no property" : undefined;
  if (!("value" in left)) return "an accessor";
  if (left.value !== first?.value && !state.assignedByHand.includes(left.value)) {
    // Nothing but a spy, an assignment and fake timers puts a value there.
    return state.made.get(left.value) ?? "a fake timer function";
  }
  const attributes = (it: PropertyDescriptor) => [it.writable, it.enumerable, it.configurable].join();
  return !first || attributes(left) === attributes(first) ? undefined : `attributes ${attributes(left)}`;
}

if (state.next > 0) {
  const left = whatIsLeft();
  if (left) state.bad.push(`after ${state.orders[state.next - 1].join(", ")}: ${left}`);
  if (state.first) Object.defineProperty(owner, name, state.first);
  else delete owner[name];
  state.assignedByHand = [];
}
const order = state.orders[state.next++];

test("order", () => {
  if (!order) {
    console.log(JSON.stringify({ orders: state.orders.length, bad: state.bad.slice(0, 20) }));
    return;
  }
  const live: ReturnType<typeof jest.spyOn>[] = [];
  const restored: typeof live = [];
  const restore = (spy: (typeof live)[number] | undefined) => {
    if (!spy) return;
    spy.mockRestore();
    live.splice(live.indexOf(spy), 1);
    restored.push(spy);
  };
  const assign = (value: unknown) => {
    owner[name] = value;
    state.assignedByHand.push(value);
  };
  for (const call of order) {
    if (call === "spyOn") {
      const spy = api.spyOn(owner, name);
      // spyOn() of a property that has a mock function returns that function.
      if (!state.made.has(spy)) {
        live.push(spy);
        state.made.set(spy, `a spy of ${order.join(", ")}`);
      }
    } else if (call === "restoreFirst") restore(live[0]);
    else if (call === "restoreLast") restore(live.at(-1));
    else if (call === "assign") {
      const assigned = function assigned() {};
      state.made.set(assigned, `an assigned function of ${order.join(", ")}`);
      assign(assigned);
    } else if (call === "assignRestoredSpy") {
      if (restored.length) assign(restored.at(-1));
    } else if (call === "fake") api.useFakeTimers(options);
    else if (call === "real") api.useRealTimers();
    else throw new Error(`unknown call ${call}`);
  }
});
