for (const version of [18, 19]) {
  let Component = function () {},
    Named = function () {};
  const element = Symbol.for(version === 18 ? "react.element" : "react.transitional.element");
  const h = (type, props, ...children) => {
    const { key = null, ref = null, ...rest } = props ?? {};
    if (children.length > 0) rest.children = children.length === 1 ? children[0] : children;
    return { $$typeof: element, type, key, ref, props: rest };
  };
  const of = (name, members = {}) => ({ $$typeof: Symbol.for("react." + name), ...members });
  Named.displayName = "Display.Name";
  const Arrow = () => null;

  class Klass {}
  const context = of("context");
  context.Provider = version === 18 ? of("provider", { _context: context }) : context;
  context.Consumer = version === 18 ? context : of("consumer", { _context: context });
  const cases = {
    empty: () => h("div"),
    "text child": () => h("p", null, "hello"),
    "one prop": () => h("a", { href: "/x" }),
    "props are sorted": () => h("a", { z: 1, href: "/x", className: "c", "data-a": "d", id: "i" }, "t"),
    "prop types": () =>
      h("x", {
        s: "str",
        n: 1,
        b: true,
        f: false,
        nul: null,
        u: undefined,
        fn() {},
        o: { a: 1 },
        arr: [1, 2],
        e: {},
        ea: [],
        d: new Date(0),
        re: /r+/,
        sym: Symbol("s"),
        big: 1n,
      }),
    "string props with odd characters": () =>
      h("x", {
        q: 'a "b"',
        lt: "<>&",
        nl: `a
b`,
        bt: "`${x}`\\",
      }),
    "element as prop": () => h("x", { icon: h("i", { className: "k" }), one: h("b") }),
    "mock as prop": () => h("button", { onClick: jest.fn(), onNamed: jest.fn().mockName("nm") }),
    "key and ref": () => h("li", { key: "k1", ref: () => {} }, "x"),
    nested: () =>
      h(
        "ul",
        { className: "l" },
        h("li", null, "one"),
        h("li", null, h("b", null, "two"), " and ", h("i", null, "three")),
      ),
    "children of several types": () =>
      h("div", null, "s", 1, 0, true, false, null, undefined, "", ["a", ["b", h("i")]], 2n),
    "text is escaped": () => h("p", null, 'a < b > c & d "q"'),
    "multi-line text": () =>
      h(
        "p",
        null,
        `line one
line two`,
      ),
    "object child": () => h("p", null, { a: 1 }),
    "function child": () => h(Component, null, () => {}),
    "children prop": () => h("p", { children: "from props" }),
    "children prop array": () => h("p", { children: ["a", "b"], id: "i" }),
    "function component": () => h(Component, { a: 1 }, "c"),
    displayName: () => h(Named),
    "arrow component": () => h(Arrow),
    "anonymous component": () => h(() => null),
    "class component": () => h(Klass, { p: "v" }),
    fragment: () => h(Symbol.for("react.fragment"), null, h("a"), h("b")),
    suspense: () => h(Symbol.for("react.suspense"), { fallback: h("i") }, "c"),
    "strict mode": () => h(Symbol.for("react.strict_mode"), null, "c"),
    forwardRef: () => h(of("forward_ref", { render: function Inner() {} })),
    "forwardRef anonymous": () => h(of("forward_ref", { render: (() => () => {})() })),
    "forwardRef displayName": () => h(of("forward_ref", { render() {}, displayName: "Forwarded" })),
    memo: () => h(of("memo", { type: function Memoized() {} })),
    "memo anonymous": () => h(of("memo", { type: (() => () => {})() })),
    "memo displayName": () => h(of("memo", { type() {}, displayName: "Remembered" })),
    "context provider": () => h(context.Provider, { value: 2 }, "c"),
    "context consumer": () => h(context.Consumer, null, () => null),
    lazy: () => h(of("lazy")),
    "in an object": () => ({ el: h("p", { id: "x" }, "t"), list: [h("a"), h("b", null, "c")] }),
    "in a Map": () => new Map([["k", h("p", null, "t")]]),
    deep: () => h("a", null, h("b", null, h("c", null, h("d", { x: { y: [h("e")] } })))),
    "undefined type": () => h(undefined),
    "number type": () => h(5),
  };
  describe(`elements of React ${version}`, () => {
    for (const [name, make] of Object.entries(cases)) {
      test(name, () => {
        expect(make()).toMatchSnapshot();
      });
    }
  });
}
test("what react-test-renderer gives", () => {
  const json = members => ({ $$typeof: Symbol.for("react.test.json"), ...members });
  expect([
    json({ type: "a", props: {}, children: null }),
    json({
      type: "b",
      props: { x: 1, u: undefined, children: "kept", s: "str" },
      children: ["t", json({ type: "c" })],
    }),
    json({ type: "d" }),
    json({ type: "e", children: [] }),
    json({ type: "f", props: null, children: ["<>", 5, null] }),
  ]).toMatchSnapshot();
});
