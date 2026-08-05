import assert from "assert";
import util from "util";

describe("util.inspect large arrays with maxArrayLength", () => {
  // util.inspect used to enumerate every own property descriptor to find
  // non-index keys, so inspecting a 1e6-element array took seconds even when
  // maxArrayLength bounded the output to a few items.

  for (const [label, make] of [
    ["Array", n => new Array(n).fill(7)],
    ["Uint8Array", n => new Uint8Array(n)],
    ["Float64Array", n => new Float64Array(n)],
  ]) {
    test(`${label}: bounded by maxArrayLength, not length`, () => {
      // Warm up inspect and allocate outside the timed region so the assertion
      // measures only the inspect call itself.
      util.inspect(make(8), { maxArrayLength: 4 });
      const big = make(1_000_000);
      const start = performance.now();
      const out = util.inspect(big, { maxArrayLength: 4 });
      const elapsed = performance.now() - start;
      assert.ok(out.includes("... 999996 more items"), out);
      // With the native non-index property scan this is sub-millisecond work.
      // Leave wide headroom for debug+ASAN builds; the regressed path takes
      // multiple seconds.
      assert.ok(elapsed < 500, `inspect(${label}(1e6), {maxArrayLength: 4}) took ${elapsed}ms`);
    });
  }

  test("Array: non-index own keys are still shown", () => {
    const big = new Array(1_000_000).fill(7);
    big.foo = "bar";
    big[Symbol.for("s")] = "sym";
    const out = util.inspect(big, { maxArrayLength: 2, breakLength: Infinity });
    assert.strictEqual(out, "[ 7, 7, ... 999998 more items, foo: 'bar', Symbol(s): 'sym' ]");
  });

  test("Array: numeric-string keys at the array-index boundary are non-index", () => {
    const a = [1, 2, 3];
    a["4294967295"] = "not-an-index"; // 2**32 - 1 is not a valid array index
    a["4294967296"] = "also-not-an-index";
    a.foo = "bar";
    assert.strictEqual(
      util.inspect(a, { breakLength: Infinity }),
      "[ 1, 2, 3, '4294967295': 'not-an-index', '4294967296': 'also-not-an-index', foo: 'bar' ]",
    );
  });

  test("Array: showHidden includes non-enumerable own keys", () => {
    const a = new Array(5).fill(7);
    a.foo = 1;
    a[Symbol.for("s")] = 2;
    a.bar = 3;
    Object.defineProperty(a, "hidden", { value: 4, enumerable: false });
    assert.strictEqual(
      util.inspect(a, { breakLength: Infinity, compact: true }),
      "[ 7, 7, 7, 7, 7, foo: 1, bar: 3, Symbol(s): 2 ]",
    );
    assert.strictEqual(
      util.inspect(a, { showHidden: true, breakLength: Infinity, compact: true }),
      "[ 7, 7, 7, 7, 7, [length]: 5, foo: 1, bar: 3, [hidden]: 4, Symbol(s): 2 ]",
    );
  });

  test("TypedArray: non-index own keys are still shown", () => {
    const big = new Uint8Array(1_000_000);
    big.foo = "bar";
    const out = util.inspect(big, { maxArrayLength: 2, breakLength: Infinity });
    assert.strictEqual(out, "Uint8Array(1000000) [ 0, 0, ... 999998 more items, foo: 'bar' ]");
  });

  test("util.format %o on large array is bounded", () => {
    util.format("%o", [1, 2, 3]);
    const big = new Array(1_000_000).fill(7);
    const start = performance.now();
    const out = util.format("%o", big);
    const elapsed = performance.now() - start;
    assert.ok(out.includes("more items"), out);
    assert.ok(elapsed < 500, `format("%o", Array(1e6)) took ${elapsed}ms`);
  });
});

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
  assert.strictEqual(util.format(obj), "{ x: 5 }");

  assert.strictEqual(util.formatWithOptions({ numericSeparator: true }, "%d", 4000), "4_000");

  const a = {};
  a.b = a;
  assert.strictEqual(util.inspect(a, { compact: false }), "<ref *1> {\n  b: [Circular *1]\n}");
  assert.strictEqual(util.inspect(a, { compact: true }), "<ref *1> { b: [Circular *1] }");

  const cause = new Error("cause");
  const e2 = new Error("wrapper", { cause });
  assert.match(util.inspect(e2), /\[cause\]: Error: cause\n/);
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
