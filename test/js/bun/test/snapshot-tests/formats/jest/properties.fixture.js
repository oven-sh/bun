// toMatchSnapshot(properties): what is printed is `deepMerge(received, properties)`, with its oddities.
class Foo {
  constructor(members) {
    Object.assign(this, members);
  }
}
class List extends Array {}
class WithToJSON {
  a = 1;
  toJSON() {
    return "json";
  }
}
class WithPrivateField {
  #secret = 1;
  a = 1;
  toJSON() {
    return this.#secret;
  }
}
const symbol = Symbol("s");
const number = () => expect.any(Number);

const printed = {
  "an instance of a class": () => [new Foo({ a: 1, b: 2 }), { a: number() }],
  "an instance inside": () => [{ x: new Foo({ a: 1 }) }, { x: { a: number() } }],
  "instances in an array": () => [
    { items: [new Foo({ a: 1 }), new Foo({ a: 2 })] },
    { items: [{ a: number() }, { a: number() }] },
  ],
  "an instance in the array that is received": () => [[new Foo({ a: 1 })], [{ a: number() }]],
  "an instance under a numeric key": () => [{ 1: new Foo({ a: 1 }) }, { 1: { a: number() } }],
  "an instance that the properties do not name": () => [
    { x: new Foo({ a: 1 }), y: new Foo({ b: 1 }) },
    { x: { a: number() } },
  ],
  "an instance in one that they name": () => [{ x: new Foo({ a: 1, k: new Foo({ z: 1 }) }) }, { x: { a: number() } }],
  "instances three levels down": () => [
    { a: new Foo({ b: new Foo({ c: new Foo({ d: 1 }) }) }) },
    { a: { b: { c: { d: number() } } } },
  ],
  "instances in arrays in arrays": () => [{ d: [[new Foo({ a: 1 })]] }, { d: [[{ a: number() }]] }],
  "a Date among the properties": () => [{ d: new Date(0), n: 1 }, { d: new Date(0) }],
  "a RegExp among the properties": () => [{ d: /x/g }, { d: /x/g }],
  "a Map among the properties": () => [{ d: new Map([[1, 2]]) }, { d: new Map([[1, 2]]) }],
  "a Set among the properties": () => [{ d: new Set([1]) }, { d: new Set([1]) }],
  "an Error among the properties": () => [{ d: new Error("e") }, { d: new Error("e") }],
  "a typed array among the properties": () => [{ d: new Uint8Array([1]) }, { d: new Uint8Array([1]) }],
  "an array among the properties": () => [{ d: [1, 2, 3], n: 1 }, { d: [1, 2, 3] }],
  "an array of objects among the properties": () => [{ d: [{ a: 1, b: 2 }] }, { d: [{ a: 1, b: 2 }] }],
  "arrays of arrays": () => [{ d: [[1, 2], [3]] }, { d: [[1, 2], [3]] }],
  "an array of all sorts": () => [
    { d: [1, "a", null, undefined, { a: 1 }] },
    { d: [1, "a", null, undefined, { a: number() }] },
  ],
  "an instance of a class of arrays": () => [{ d: List.from([1]) }, { d: [1] }],
  "an array with holes": () => [{ d: [1, , 3] }, { d: [1, , 3] }],
  "part of the objects of an array": () => [{ d: [{ a: 1, b: 2 }] }, { d: [{ a: number() }] }],
  "an array, and properties that are no array": () => [[1, 2], { 0: number() }],
  "an object without a prototype": () => [Object.assign(Object.create(null), { a: 1 }), { a: number() }],
  "an accessor": () => [
    {
      get a() {
        return 1;
      },
      b: 2,
    },
    { b: number() },
  ],
  "a property that is not enumerable": () => [Object.defineProperty({ a: 1 }, "hidden", { value: 1 }), { a: number() }],
  "a symbol as a key": () => [{ a: 1, [symbol]: 2 }, { a: number() }],
  "a symbol as a key of the properties": () => [{ [symbol]: 1, a: 1 }, { [symbol]: number() }],
  "a symbol as a key of the properties, inside": () => [
    { x: { [symbol]: new Foo({ a: 1 }) } },
    { x: { [symbol]: { a: number() } } },
  ],
  "its own toJSON()": () => [{ a: 1, toJSON: () => "json" }, { a: number() }],
  "the toJSON() of its class": () => [new WithToJSON(), { a: number() }],
  "the toJSON() of its class, inside": () => [{ x: new WithToJSON() }, { x: { a: number() } }],
  "a toJSON() that needs a private field": () => [new WithPrivateField(), { a: number() }],
  "a toJSON() that needs a private field, inside": () => [{ x: new WithPrivateField() }, { x: { a: number() } }],
  "no properties": () => [new Foo({ a: 1 }), {}],
  "no properties, inside": () => [{ x: new Foo({ a: 1 }) }, { x: {} }],
  null: () => [{ a: null, b: 1 }, { a: null }],
  "objectContaining()": () => [{ x: new Foo({ a: 1, b: 2 }) }, { x: expect.objectContaining({ a: 1 }) }],
  "arrayContaining()": () => [{ x: [1, 2] }, { x: expect.arrayContaining([1]) }],
  "stringMatching() of a string": () => [{ s: "abc" }, { s: expect.stringMatching("b") }],
  "stringMatching() of a string that a RegExp has to escape": () => [
    { s: "a.b/c" },
    { s: expect.stringMatching("a.b/") },
  ],
  "stringMatching() of a RegExp": () => [{ s: "abc" }, { s: expect.stringMatching(/B/i) }],
  "closeTo()": () => [
    { d: 1.001, e: -0 },
    { d: expect.closeTo(1), e: expect.closeTo(-0, 1) },
  ],
  "matchers for what is no object in an array": () => [
    { d: [1, "abc", "abc", 1.001, 5] },
    {
      d: [number(), expect.stringMatching("b"), expect.stringContaining("b"), expect.closeTo(1, 2), expect.anything()],
    },
  ],
  "one object twice": () => {
    const foo = new Foo({ a: 1 });
    return [{ x: foo, y: foo }, { x: { a: number() } }];
  },
  "an object that holds itself": () => {
    const object = { a: 1 };
    object.self = object;
    return [object, { a: number() }];
  },
  "a part of the object as its own properties": () => {
    const part = new Foo({ a: 1 });
    return [{ part, n: 1 }, { part }];
  },
  "any(Date), beside an Error": () => [{ d: new Date(0), e: new Error("x") }, { d: expect.any(Date) }],
  "a React element": () => [
    { el: { $$typeof: Symbol.for("react.element"), type: "div", props: { id: 1 } } },
    { el: { type: "div" } },
  ],
  "a Map that is received": () => [Object.assign(new Map([[1, 2]]), { a: 1 }), { a: number() }],
  "an Error that is received": () => [Object.assign(new Error("m"), { code: 1 }), { code: number() }],
  "a Date that is received": () => [Object.assign(new Date(0), { a: 1 }), { a: number() }],
  "a class that says what it is": () => [
    new (class {
      get [Symbol.toStringTag]() {
        return "Tagged";
      }
      a = 1;
    })(),
    { a: number() },
  ],
};
for (const [name, make] of Object.entries(printed)) {
  test(name, () => {
    const [received, properties] = make();
    expect(received).toMatchSnapshot(properties);
  });
}

// The copy of the object gets the members of the matcher, `$$typeof` among them, and is taken for a matcher.
test("a matcher for an object in an array cannot be printed", () => {
  expect(() =>
    expect({ items: [{ a: 1, b: 2 }] }).toMatchSnapshot({ items: [expect.objectContaining({ a: 1 })] }),
  ).toThrow("does not implement toAsymmetricMatcher()");
  expect(() =>
    expect({ items: [{ a: 1 }] }).toMatchSnapshot({ items: [expect.not.objectContaining({ z: 1 })] }),
  ).toThrow("does not implement toAsymmetricMatcher()");
});
