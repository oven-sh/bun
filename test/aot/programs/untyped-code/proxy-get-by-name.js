// `proxy.value` at one untyped call site: the `get` trap is called with the right operands, and every proxy without a usable trap or with a trap that breaks an invariant behaves as in plain Bun.
function read(object) {
  return object.value;
}

function outcome(object) {
  try {
    return String(read(object));
  } catch (error) {
    return `${error.constructor.name}: ${error.message}`;
  }
}

function outcomes(object) {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(outcome(object));
  return [...seen].join(" | ");
}

class Point {
  constructor(value) {
    this.value = value;
  }
}

const target = { value: "target value" };
const operandsAreRight = [];
const handler = {
  get(trapTarget, key, receiver) {
    operandsAreRight.push(this === handler && trapTarget === target && key === "value" && receiver === proxy && arguments.length === 3);
    return operandsAreRight.length;
  },
};
const proxy = new Proxy(target, handler);
let sum = 0;
for (let i = 0; i < 100; i++) sum += read(proxy);
console.log("get trap:", sum, operandsAreRight.length, operandsAreRight.every(Boolean));

console.log("no trap:", outcomes(new Proxy({ value: "target value" }, {})));
console.log("undefined trap:", outcomes(new Proxy({ value: "target value" }, { get: undefined })));
console.log("trap is not callable:", outcomes(new Proxy({ value: "target value" }, { get: 1 })));

const revocable = Proxy.revocable({ value: "target value" }, { get: () => "trap value" });
console.log("before revoke:", outcomes(revocable.proxy));
revocable.revoke();
console.log("after revoke:", outcomes(revocable.proxy));

const readOnly = Object.defineProperty({}, "value", { value: 1 });
console.log("read-only property, wrong answer:", outcomes(new Proxy(readOnly, { get: () => 2 })));
console.log("read-only property, right answer:", outcomes(new Proxy(readOnly, { get: () => 1 })));
console.log("read-only property, other name:", outcomes(new Proxy(Object.defineProperty({}, "other", { value: 1 }), { get: () => 2 })));

const setterOnly = Object.defineProperty({}, "value", { set() {} });
console.log("accessor without getter, wrong answer:", outcomes(new Proxy(setterOnly, { get: () => 2 })));
console.log("accessor without getter, right answer:", outcomes(new Proxy(setterOnly, { get: () => undefined })));

console.log("frozen instance, wrong answer:", outcomes(new Proxy(Object.freeze(new Point(1)), { get: () => 2 })));
console.log("frozen instance, right answer:", outcomes(new Proxy(Object.freeze(new Point(1)), { get: () => 1 })));
console.log("sealed instance:", outcomes(new Proxy(Object.seal(new Point(1)), { get: () => 2 })));
console.log("instance:", outcomes(new Proxy(new Point(1), { get: () => 2 })));

const frozenByTrap = new Point(1);
console.log("trap freezes the target:", outcomes(new Proxy(frozenByTrap, { get: trapTarget => (Object.freeze(trapTarget), 2) })));

console.log(
  "trap throws:",
  outcomes(
    new Proxy({}, {
      get(trapTarget, key) {
        throw new RangeError(`no ${key}`);
      },
    }),
  ),
);

let count = 0;
console.log(
  "trap throws every other time:",
  outcomes(
    new Proxy({}, {
      get() {
        if (++count % 2) throw new RangeError("odd");
        return "even";
      },
    }),
  ),
  count,
);

console.log("plain object:", outcomes({ value: "own value" }));
console.log("get trap again:", read(proxy), operandsAreRight.every(Boolean));
