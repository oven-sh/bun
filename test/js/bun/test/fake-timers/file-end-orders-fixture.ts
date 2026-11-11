// `bun test --rerun-each=<n> ./file-end-orders-fixture.ts` loads this file n times in one global. Each load plays the next order of
// up to DEPTH calls that put something on the global TARGET or take it off, then each order of the JSON list ORDERS. The load after
// it looks at what the end of the test file left there: the value from before all of them, or a function that the order assigned.
// The last load prints { orders, bad }.
import { jest as bunJest, vi as bunVi, test } from "bun:test";
import { vi as vitestVi } from "vitest";

const target = process.env.TARGET!;
const depth = Number(process.env.DEPTH);
const calls = process.env.CALLS!.split(",");
// API is "jest" for jest.spyOn() and the fake timers of `jest`, or the module of the `vi` that does everything.
const vi = process.env.API === "vitest" ? vitestVi : bunVi;
const api = process.env.API === "jest" ? bunJest : vi;

type Made = { kind: "spy" | "stub" | "assigned"; isOn: boolean };
type State = {
  orders: string[][];
  next: number;
  first: PropertyDescriptor;
  made: Map<unknown, Made>;
  sharedStub: () => void;
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
    first: Object.getOwnPropertyDescriptor(globalThis, target)!,
    made: new Map(),
    sharedStub: function sharedStub() {},
    bad: [],
  };
})());

function whatIsLeft(): string | undefined {
  const left = Object.getOwnPropertyDescriptor(globalThis, target);
  if (!left || !("value" in left)) return left ? "an accessor" : "nothing";
  const made = state.made.get(left.value);
  const is =
    left.value === state.first.value || made?.kind === "assigned"
      ? undefined
      : made?.kind === "spy"
        ? "a spy"
        : made?.kind === "stub"
          ? "a stub"
          : "a fake timer function";
  if (is) return is;
  const attributes = (it: PropertyDescriptor) => [it.writable, it.enumerable, it.configurable].join();
  return attributes(left) === attributes(state.first) ? undefined : `attributes ${attributes(left)}`;
}

if (state.next > 0) {
  const left = whatIsLeft();
  if (left) state.bad.push(`${state.orders[state.next - 1].join(", ")}: ${left}`);
  Object.defineProperty(globalThis, target, state.first);
  state.made.clear();
}
const order = state.orders[state.next++];

test("order", () => {
  if (!order) {
    console.log(JSON.stringify({ orders: state.orders.length, bad: state.bad.slice(0, 20) }));
    return;
  }
  const spies: ReturnType<typeof bunJest.spyOn>[] = [];
  const restore = (spy: (typeof spies)[number] | undefined) => {
    if (!spy) return;
    spy.mockRestore();
    state.made.get(spy)!.isOn = false;
  };
  const stub = (value: () => void) => {
    vi.stubGlobal(target, value);
    state.made.set(value, { kind: "stub", isOn: true });
  };
  for (const call of order) {
    if (call === "spyOn") {
      const spy = api.spyOn(globalThis, target as "setTimeout");
      // spyOn() of a property that has a mock function returns that function.
      if (!state.made.has(spy)) {
        spies.push(spy);
        state.made.set(spy, { kind: "spy", isOn: true });
      }
    } else if (call === "restoreFirst") restore(spies.find(spy => state.made.get(spy)!.isOn));
    else if (call === "restoreLast") restore(spies.findLast(spy => state.made.get(spy)!.isOn));
    else if (call === "stub") stub(function stub() {});
    else if (call === "stubMock") stub(vi.fn());
    else if (call === "stubShared") stub(state.sharedStub);
    else if (call === "unstub") vi.unstubAllGlobals();
    else if (call === "assign") {
      const assigned = function assigned() {};
      (globalThis as any)[target] = assigned;
      state.made.set(assigned, { kind: "assigned", isOn: true });
    } else if (call === "fake") api.useFakeTimers();
    else if (call === "real") api.useRealTimers();
    else throw new Error(`unknown call ${call}`);
  }
});
