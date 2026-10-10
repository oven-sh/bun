// What a value that only looks like something pretty-format has a plugin for may hold, member by member.
class Captured {
  constructor(value) {
    this.value = value;
  }
}
let printed;
expect.addSnapshotSerializer({
  test: value => value instanceof Captured,
  serialize(captured, config, indentation, depth, refs, printer) {
    printed = printer(captured.value, config, indentation, depth, refs);
    return "captured";
  },
});
function print(value) {
  printed = undefined;
  try {
    expect(new Captured(value)).toMatchInlineSnapshot(`captured`);
  } catch {
    return "throws";
  }
  return printed;
}

const revoked = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};
const hostile = {
  undefined: () => undefined,
  null: () => null,
  false: () => false,
  true: () => true,
  zero: () => 0,
  number: () => 5,
  "empty string": () => "",
  string: () => "abc",
  symbol: () => Symbol("s"),
  bigint: () => 10n,
  function: () => function f(a, b) {},
  "empty array": () => [],
  array: () => [1, "two"],
  object: () => ({ a: 1 }),
  proxy: () => new Proxy({ a: 1 }, {}),
  "proxy of an array": () => new Proxy([1], {}),
  "revoked proxy": revoked,
  "throwing getters": () => ({
    get length() {
      throw new Error("length");
    },
    get a() {
      throw new Error("a");
    },
  }),
  "throwing proxy": () =>
    new Proxy(
      {},
      {
        get() {
          throw new Error("get");
        },
        ownKeys() {
          throw new Error("ownKeys");
        },
        has() {
          throw new Error("has");
        },
      },
    ),
};

const matcher = members => ({ $$typeof: Symbol.for("jest.asymmetricMatcher"), ...members });
const named = name => ({ toString: () => name });
const element = (type, props) => ({ $$typeof: Symbol.for("react.element"), type, props });
const element19 = (type, props) => ({ $$typeof: Symbol.for("react.transitional.element"), type, props });
const json = members => ({ $$typeof: Symbol.for("react.test.json"), ...members });
const immutable = (kind, members) => ({
  "@@__IMMUTABLE_ITERABLE__@@": true,
  [`@@__IMMUTABLE_${kind}__@@`]: true,
  ...members,
});
const mock = members =>
  Object.assign(function () {}, {
    _isMockFunction: true,
    getMockName: () => "name",
    mock: { calls: [[1]], results: [] },
    ...members,
  });
const tagged = (tag, members) => ({ [Symbol.toStringTag]: tag, ...members });
class Serialized {
  constructor(members) {
    Object.assign(this, members);
  }
}
expect.addSnapshotSerializer({
  test: value => (value instanceof Serialized ? value.tested : false),
  serialize: value => value.result,
});
class SerializedTheOlderWay {
  constructor(result) {
    this.result = result;
  }
}
expect.addSnapshotSerializer({
  test: value => value instanceof SerializedTheOlderWay,
  print: value => value.result,
});
class GivenToPrinter {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
}
expect.addSnapshotSerializer({
  test: value => value instanceof GivenToPrinter,
  serialize(given, config, indentation, depth, refs, printer) {
    const inner = { a: [1, { b: 2 }] };
    const all = { value: inner, config, indentation, depth, refs, [given.name]: given.value };
    return printer(all.value, all.config, all.indentation, all.depth, all.refs);
  },
});
class GivenToPrint {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
}
expect.addSnapshotSerializer({
  test: value => value instanceof GivenToPrint,
  print: (given, print, indent) => (given.name === "print" ? print(given.value) : indent(given.value)),
});
const once = first => {
  let calls = 0;
  return { next: () => (calls++ === 0 ? first : { done: true }) };
};

const members = {
  "asymmetric matcher: toString": value => matcher({ toString: value }),
  "asymmetric matcher: what toString() returns": value => matcher({ toString: () => value }),
  "asymmetric matcher: sample of ObjectContaining": value => matcher({ ...named("ObjectContaining"), sample: value }),
  "asymmetric matcher: sample of ObjectNotContaining": value =>
    matcher({ ...named("ObjectNotContaining"), sample: value }),
  "asymmetric matcher: sample of ArrayContaining": value => matcher({ ...named("ArrayContaining"), sample: value }),
  "asymmetric matcher: sample of ArrayNotContaining": value =>
    matcher({ ...named("ArrayNotContaining"), sample: value }),
  "asymmetric matcher: sample of StringMatching": value => matcher({ ...named("StringMatching"), sample: value }),
  "asymmetric matcher: sample of StringContaining": value => matcher({ ...named("StringContaining"), sample: value }),
  "asymmetric matcher: toAsymmetricMatcher": value => matcher({ ...named("Other"), toAsymmetricMatcher: value }),
  "asymmetric matcher: what toAsymmetricMatcher() returns": value =>
    matcher({ ...named("Other"), toAsymmetricMatcher: () => value }),
  "$$typeof": value => ({ $$typeof: value, type: "a", props: {} }),
  "element: type": value => element(value, {}),
  "element: props": value => element("a", value),
  "element: a prop": value => element("a", { b: value }),
  "element: children": value => element("a", { children: value }),
  "element: a child": value => element("a", { children: ["text", value] }),
  "element: displayName of its type": value =>
    element(
      Object.assign(function Named() {}, { displayName: value }),
      {},
    ),
  "element: $$typeof of its type": value => element({ $$typeof: value }, {}),
  "element: render of a forwardRef": value => element({ $$typeof: Symbol.for("react.forward_ref"), render: value }, {}),
  "element: displayName of a forwardRef": value =>
    element({ $$typeof: Symbol.for("react.forward_ref"), displayName: value, render() {} }, {}),
  "element: type of a memo": value => element({ $$typeof: Symbol.for("react.memo"), type: value }, {}),
  "element of React 19: type": value => element19(value, {}),
  "element of React 19: props": value => element19("a", value),
  "test renderer: type": value => json({ type: value, props: {}, children: null }),
  "test renderer: props": value => json({ type: "a", props: value, children: null }),
  "test renderer: a prop": value => json({ type: "a", props: { b: value }, children: null }),
  "test renderer: children": value => json({ type: "a", props: {}, children: value }),
  "test renderer: a child": value => json({ type: "a", props: {}, children: ["text", value] }),
  "Immutable: the mark": value => ({
    "@@__IMMUTABLE_ITERABLE__@@": value,
    "@@__IMMUTABLE_LIST__@@": true,
    values: () => [1].values(),
  }),
  "Immutable: the mark of a kind": value => ({
    "@@__IMMUTABLE_ITERABLE__@@": true,
    "@@__IMMUTABLE_LIST__@@": value,
    values: () => [1].values(),
    _keys: [],
  }),
  "Immutable.Map: entries": value => immutable("MAP", { entries: value }),
  "Immutable.Map: what entries() returns": value => immutable("MAP", { entries: () => value }),
  "Immutable.Map: an entry": value => immutable("MAP", { entries: () => [value].values() }),
  "Immutable.List: values": value => immutable("LIST", { values: value }),
  "Immutable.List: what values() returns": value => immutable("LIST", { values: () => value }),
  "Immutable.List: an item": value => immutable("LIST", { values: () => [value].values() }),
  "Immutable.Seq: _array": value => immutable("SEQ", { _array: value, values: () => [1].values() }),
  "Immutable.Record: _name": value => ({ "@@__IMMUTABLE_RECORD__@@": true, _name: value, _keys: ["a"], get: () => 1 }),
  "Immutable.Record: _keys": value => ({ "@@__IMMUTABLE_RECORD__@@": true, _keys: value, get: () => 1 }),
  "Immutable.Record: a key": value => ({ "@@__IMMUTABLE_RECORD__@@": true, _keys: [value], get: () => 1 }),
  "Immutable.Record: get": value => ({ "@@__IMMUTABLE_RECORD__@@": true, _keys: ["a"], get: value }),
  "Immutable.Record: what get() returns": value => ({
    "@@__IMMUTABLE_RECORD__@@": true,
    _keys: ["a"],
    get: () => value,
  }),
  "mock function: _isMockFunction": value => Object.assign(function () {}, { _isMockFunction: value }),
  "mock function: _isMockFunction of an object": value => ({
    _isMockFunction: value,
    getMockName: () => "name",
    mock: { calls: [], results: [] },
  }),
  "mock function: getMockName": value => mock({ getMockName: value }),
  "mock function: what getMockName() returns": value => mock({ getMockName: () => value }),
  "mock function: mock": value => mock({ mock: value }),
  "mock function: calls": value => mock({ mock: { calls: value, results: [] } }),
  "mock function: length of calls": value => mock({ mock: { calls: { length: value }, results: [] } }),
  "mock function: results": value => mock({ mock: { calls: [[1]], results: value } }),
  toJSON: value => ({ a: 1, toJSON: value }),
  "what toJSON() returns": value => ({ a: 1, toJSON: () => value }),
  constructor: value => Object.assign(Object.create({ constructor: value }), { a: 1 }),
  "own constructor": value => ({ constructor: value }),
  "name of the constructor": value => {
    function F() {}
    Object.defineProperty(F, "name", { value });
    return new F();
  },
  "constructor of an array": value => Object.assign([1], { constructor: value }),
  "Symbol.toStringTag": value => ({ [Symbol.toStringTag]: value, a: 1 }),
  "name of an error": value => Object.assign(new Error("message"), { name: value }),
  "message of an error": value => Object.assign(new Error("message"), { message: value }),
  "length of what says it is Arguments": value => tagged("Arguments", { length: value }),
  "length of what says it is an Array": value => tagged("Array", { length: value }),
  "length of what says it is a Uint8Array": value => tagged("Uint8Array", { length: value }),
  "byteLength of what says it is a DataView": value => tagged("DataView", { byteLength: value }),
  "entries of what says it is a Map": value => tagged("Map", { entries: value }),
  "values of what says it is a Set": value => tagged("Set", { values: value }),
  "entries of a Map": value => Object.assign(new Map([[1, 2]]), { entries: value }),
  "values of a Set": value => Object.assign(new Set([1]), { values: value }),
  "what says it is a Date": value => tagged("Date", { toISOString: value }),
  "what says it is a RegExp": value => tagged("RegExp", { toString: value, source: "a", flags: "g" }),
  "a function: $$typeof": value => Object.assign(function () {}, { $$typeof: value }),
  "an iterator: next": value => tagged("Map", { entries: () => ({ next: value }) }),
  "an iterator: what next() returns": value => tagged("Map", { entries: () => ({ next: () => value }) }),
  "an iterator: done": value => tagged("Set", { values: () => once({ done: value, value: 1 }) }),
  "an iterator: the value of an entry": value => tagged("Map", { entries: () => once({ done: false, value }) }),
  "an iterator: the value of an item": value => tagged("Set", { values: () => once({ done: false, value }) }),
  "a serializer: what test() returns": value => new Serialized({ tested: value, result: "printed" }),
  "a serializer: what serialize() returns": value => new Serialized({ tested: true, result: value }),
  "a serializer: what print() returns": value => new SerializedTheOlderWay(value),
  "printer(): value": value => new GivenToPrinter("value", value),
  "print(): value": value => new GivenToPrint("print", value),
};

test("what an object says it is", () => {
  for (const tag of [
    "Function",
    "GeneratorFunction",
    "AsyncFunction",
    "Symbol",
    "WeakMap",
    "WeakSet",
    "Error",
    "Date",
    "RegExp",
    "Map",
    "Set",
    "Array",
    "Arguments",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "Uint8Array",
    "BigInt64Array",
    "Object",
    "Null",
    "Undefined",
    "Number",
    "String",
    "Boolean",
    "BigInt",
    "Promise",
    "Window",
    "global",
  ]) {
    expect(print(tagged(tag, { a: 1 }))).toMatchSnapshot(tag);
  }
});

test("a function with the mark of a plugin", () => {
  const marked = members => Object.assign(function () {}, members);
  expect(print(marked(json({ type: "a" })))).toMatchSnapshot("react.test.json");
  expect(print(marked(element("a", {})))).toMatchSnapshot("react.element");
  expect(print(marked(matcher({ ...named("StringContaining"), sample: "a" })))).toMatchSnapshot(
    "jest.asymmetricMatcher",
  );
  expect(print(marked(immutable("LIST", { values: () => [1].values() })))).toMatchSnapshot("Immutable");
});

for (const [member, make] of Object.entries(members)) {
  test(member, () => {
    for (const [kind, value] of Object.entries(hostile)) {
      expect(print(make(value()))).toMatchSnapshot(kind);
    }
  });
}
