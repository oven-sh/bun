// `if (result && typeof result.then === "function") result.then(ok, bad)` in a program where many records have a field `then`.
const schemas = [
  { if: { type: "a" }, then: { type: "b" }, else: 1 },
  { kind: 1, then: true },
  { kind: 2, name: "n", then: "text" },
  { then: 5, other: 1 },
  { then: null, more: 2, other: 1 },
  { a: 1, b: 2, then: undefined },
  JSON.parse('{ "then": [1, 2] }'),
];
const log = [];
// The compiler does not see through text that is compiled while the program runs.
const hide = new Function("value", "return value");
function settle(result, label) {
  if (result && typeof result.then === "function") {
    result.then(
      value => log.push(label + " ok " + value),
      error => log.push(label + " bad " + error),
    );
  } else log.push(label + " plain " + (result && typeof result.then));
}
class Late extends Promise {
  then(ok, bad) {
    log.push("Late.then");
    return super.then(ok, bad);
  }
}
const own = Promise.resolve("own");
own.then = function (ok) {
  ok("replaced");
};
const queue = { items: [], push(item) { this.items.push("q" + item); return this.items.length; } };
const stacks = [{ push: 1, a: 1 }, { push: 2, b: 1 }, { push: 3, c: 1 }, { push: 4, d: 1 }];
function add(list, item) {
  return list.push(item);
}
const results = [
  Promise.resolve(1),
  Promise.reject("no"),
  { then(ok) { ok("thenable"); } },
  { then(ok, bad) { bad("refused"); } },
  new Late(resolve => resolve("late")),
  own,
  new Proxy(Promise.resolve(2), { get(target, key) { return key === "then" ? ok => ok("proxy") : target[key]; } }),
  Object.create(Promise.resolve(3)),
  undefined,
  null,
  0,
  "text",
  () => {},
  ...schemas,
];
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < results.length; i++) {
    try {
      settle(hide(results[i]), round + ":" + i);
    } catch (error) {
      log.push(round + ":" + i + " threw " + error.constructor.name);
    }
  }
}
console.log(add(hide([1]), 2), add(hide(queue), 3), queue.items.join(), stacks.map(stack => stack.push).join());
try {
  add(hide(stacks[0]), 1);
} catch (error) {
  console.log(error.constructor.name);
}
await new Promise(resolve => setTimeout(resolve, 1));
console.log(log.join("\n"));
