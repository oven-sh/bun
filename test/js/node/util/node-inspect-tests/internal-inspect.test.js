import assert from "assert";
import { Console } from "console";
import { Writable } from "stream";
import util from "util";

test("no assertion failures", () => {
  // Errors in accessors are not triggered
  const obj = new Proxy(
    { x: 5 },
    {
      get() {
        throw new Error("Error message");
      },
    },
  );
  assert.strictEqual(util.format(obj), "Proxy({ x: 5 })");

  assert.strictEqual(util.formatWithOptions({ numericSeparator: true }, "%d", 4000), "4_000");

  const a = {};
  a.b = a;
  assert.strictEqual(util.inspect(a, { compact: false }), "<ref *1> {\n  b: [Circular *1]\n}");
  assert.strictEqual(util.inspect(a, { compact: true }), "<ref *1> { b: [Circular *1] }");

  const cause = new Error("cause");
  const e2 = new Error("wrapper", { cause });
  assert.match(util.inspect(e2), /\[cause\]: Error: cause\n/);
});

// Proxies are formatted as their (innermost) target wrapped in `Proxy(...)`,
// one layer per proxy, without invoking any handler trap
// (nodejs/node#61029 and nodejs/node#61077, in node v26.3.0).
test("proxies are marked as such unless showProxy is set", () => {
  const proxy = new Proxy({ a: 1 }, {});
  assert.strictEqual(util.inspect(proxy), "Proxy({ a: 1 })");
  assert.strictEqual(util.inspect(proxy, { depth: -1 }), "Proxy([Object])");
  assert.strictEqual(util.inspect({ p: proxy }), "{ p: Proxy({ a: 1 }) }");
  assert.strictEqual(util.inspect([proxy, proxy]), "[ Proxy({ a: 1 }), Proxy({ a: 1 }) ]");
  assert.strictEqual(util.inspect(new Map([[proxy, 1]])), "Map(1) { Proxy({ a: 1 }) => 1 }");
  assert.strictEqual(util.inspect(new Proxy(function f() {}, {})), "Proxy([Function: f])");
  assert.strictEqual(util.inspect(new Proxy(new Map([[1, 2]]), {})), "Proxy(Map(1) { 1 => 2 })");
  class Foo {
    x = 1;
  }
  assert.strictEqual(util.inspect(new Proxy(new Foo(), {})), "Proxy(Foo { x: 1 })");
  const xs = Buffer.alloc(30, "x").toString();
  const ys = Buffer.alloc(30, "y").toString();
  assert.strictEqual(
    util.inspect({ k: new Proxy({ first: xs, second: ys }, {}) }),
    `{\n  k: Proxy({\n    first: '${xs}',\n    second: '${ys}'\n  })\n}`,
  );
  assert.strictEqual(
    util.inspect(proxy, { colors: true }),
    "\x1B[36mProxy(\x1B[39m{ a: \x1B[33m1\x1B[39m }\x1B[36m)\x1B[39m",
  );

  // Only `showProxy` (and `%o`, which implies it) shows the target/handler pair.
  assert.strictEqual(util.inspect(proxy, { showProxy: true }), "Proxy [ { a: 1 }, {} ]");
  assert.strictEqual(util.format("%o", proxy), "Proxy [ { a: 1 }, {} ]");
  assert.strictEqual(util.format("%O", proxy), "Proxy({ a: 1 })");
  assert.strictEqual(util.format("%s", proxy), "Proxy({ a: 1 })");
  assert.strictEqual(util.format("%j", proxy), '{"a":1}');
  assert.strictEqual(util.format(proxy), "Proxy({ a: 1 })");

  // A target revoked after being wrapped.
  const revocable = Proxy.revocable({ a: 1 }, {});
  const wrapped = new Proxy(revocable.proxy, {});
  assert.strictEqual(util.inspect(wrapped), "Proxy(Proxy({ a: 1 }))");
  revocable.revoke();
  assert.strictEqual(util.inspect(revocable.proxy), "<Revoked Proxy>");
  assert.strictEqual(util.inspect(wrapped), "Proxy(<Revoked Proxy>)");
  assert.strictEqual(util.inspect(new Proxy(wrapped, {})), "Proxy(Proxy(<Revoked Proxy>))");
  assert.strictEqual(util.inspect(wrapped, { showProxy: true }), "Proxy [ <Revoked Proxy>, {} ]");

  // The custom inspect function is looked up on the innermost target without
  // going through any handler, invoked with the proxy as `this`, and its
  // result is used as-is.
  const throwingHandler = new Proxy(
    {},
    {
      get(_, trap) {
        throw new Error(`trap ${String(trap)} was invoked`);
      },
    },
  );
  let receiver;
  const target = {
    [util.inspect.custom](depth, options) {
      receiver = this;
      return `custom(${depth}, showProxy=${options.showProxy})`;
    },
  };
  const nested = new Proxy(new Proxy(target, throwingHandler), {});
  assert.strictEqual(util.inspect(nested), "custom(2, showProxy=false)");
  assert.strictEqual(receiver, nested);
  assert.strictEqual(util.inspect({ nested }), "{ nested: custom(1, showProxy=false) }");
  assert.strictEqual(util.inspect(new Proxy({ z: 1 }, throwingHandler)), "Proxy({ z: 1 })");

  // A custom inspect function returning `this` falls through to the regular formatting.
  const returnsThis = {
    [util.inspect.custom]() {
      return this;
    },
  };
  assert.strictEqual(
    util.inspect(new Proxy(returnsThis, {})),
    "Proxy({\n  Symbol(nodejs.util.inspect.custom): [Function: [nodejs.util.inspect.custom]]\n})",
  );

  // A proxy around an object already being formatted is a circular reference to its target.
  const self = { name: "self" };
  self.proxy = new Proxy(self, {});
  assert.strictEqual(util.inspect(self), "<ref *1> { name: 'self', proxy: [Circular *1] }");

  // node:console and node:assert format values through the same code.
  let written = "";
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      written += chunk;
      callback();
    },
  });
  new Console(stream).log(proxy, wrapped);
  assert.strictEqual(written, "Proxy({ a: 1 }) Proxy(<Revoked Proxy>)\n");

  assert.throws(() => assert.deepStrictEqual(new Proxy([1, 2], {}), [1, 2, 3]), {
    message:
      "Expected values to be strictly deep-equal:\n" +
      "+ actual - expected\n" +
      "\n" +
      "+ Proxy([\n" +
      "- [\n" +
      "    1,\n" +
      "    2,\n" +
      "+ ])\n" +
      "-   3\n" +
      "- ]\n",
  });
});

test("boxed BigInt/Symbol with no prototype are still formatted as boxed primitives", () => {
  assert.strictEqual(util.inspect(Object.setPrototypeOf(Object(55n), null)), "[BigInt (null prototype): 55n]");
  assert.strictEqual(
    util.inspect(Object.setPrototypeOf(Object(Symbol("x")), null)),
    "[Symbol (null prototype): Symbol(x)]",
  );
});

//! non-standard property, should this be kept?
test.skip("util.stylizeWithHTML", () => {
  assert.strictEqual(
    util.inspect(
      {
        a: 1,
        b: "<p>\xA0\u{1F4A9}</p>",
        "&lt;": NaN,
        [Symbol("<br>")]: false,
        buf: new Uint8Array([1, 2, 3, 4]),
      },
      {
        compact: false,
        stylize: util.stylizeWithHTML,
      },
    ),
    "{\n" +
      '  a: <span style="color:yellow;">1</span>,\n' +
      '  b: <span style="color:green;">&apos;&lt;p&gt;&nbsp;\u{1F4A9}&lt;&#47;p&gt;&apos;</span>,\n' +
      '  <span style="color:green;">&apos;&amp;lt&#59;&apos;</span>: <span style="color:yellow;">NaN</span>,\n' +
      "  buf: Uint8Array(4) [\n" +
      '    <span style="color:yellow;">1</span>,\n' +
      '    <span style="color:yellow;">2</span>,\n' +
      '    <span style="color:yellow;">3</span>,\n' +
      '    <span style="color:yellow;">4</span>\n' +
      "  ],\n" +
      '  [<span style="color:green;">Symbol&#40;&lt;br&gt;&#41;</span>]: <span style="color:yellow;">false</span>\n' +
      "}",
  );
});
