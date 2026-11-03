import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const vector = `
class V:
    def __init__(self, x): self.x = x
    def __repr__(self): return f"V({self.x})"
    def _v(o): return o.x if isinstance(o, V) else o
    def __add__(self, o): return V(self.x + V._v(o))
    def __radd__(self, o): return V(("r", o, self.x))
    def __sub__(self, o): return V(self.x - V._v(o))
    def __rsub__(self, o): return V(o - self.x)
    def __mul__(self, o): return V(self.x * V._v(o))
    def __rmul__(self, o): return V(o * self.x)
    def __truediv__(self, o): return V(self.x / V._v(o))
    def __mod__(self, o): return V(self.x % V._v(o))
    def __pow__(self, o): return V(self.x ** V._v(o))
    def __and__(self, o): return V(self.x & V._v(o))
    def __or__(self, o): return V(self.x | V._v(o))
    def __xor__(self, o): return V(self.x ^ V._v(o))
    def __lshift__(self, o): return V(self.x << V._v(o))
    def __rshift__(self, o): return V(self.x >> V._v(o))
    def __neg__(self): return V(-self.x)
    def __invert__(self): return V(~self.x)
    def __eq__(self, o): return isinstance(o, V) and self.x == o.x
    def __hash__(self): return hash(self.x)
    def __lt__(self, o): return self.x < V._v(o)
    def __le__(self, o): return self.x <= V._v(o)
    def __gt__(self, o): return self.x > V._v(o)
    def __ge__(self, o): return self.x >= V._v(o)

class Plain:
    def __str__(self): return "plain"

class Raises:
    def __add__(self, o): raise ValueError("no sum")

def half(x): return x / 2
`;

async function run(files: Record<string, string>) {
  using dir = tempDir("python-operators", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("the operators of JS ask the classes of Python objects", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": vector,
    "main.js": `
      import { V, Plain, Raises, half } from "./v.py";
      const a = new V(6), b = V(4);
      const show = (...values) => console.log(values.map(String).join(" "));
      show(a + b, a - b, a * b, a / b, a % b, a ** b);
      show(a & b, a | b, a ^ b, a << b, a >> b);
      show(a + 1, 1 + a, a - 1, 10 - a, a * 2, 2 * a);
      show(-a, ~a);
      show(a == new V(6), a == b, a != b, a != new V(6), a === a, a === new V(6), a == 6, a == null, a == undefined);
      show(a < b, a <= b, a > b, a >= b, a < 7, 7 > a, 7 < a, a >= 6);
      let c = new V(1); c++; ++c; c--; c += 10; c *= 2;
      show(c);
      // Not overloaded: what JS does with any object.
      const p = new Plain();
      show("<" + p + ">", p + "!", \`\${p}\`, p - 1, p * 2, p < 1, p == "plain", p == p);
      try { new Raises() + 1; } catch (e) { show(e.name ?? e.constructor?.name, String(e)); }
      // A float that is a whole number is a number in JS.
      show(typeof half(4), half(4) === 2, half(4) + 1, typeof half(3), half(3));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "V(10) V(2) V(24) V(1.5) V(2) V(1296)
    V(4) V(6) V(2) V(96) V(0)
    V(7) V(('r', 1, 6)) V(5) V(4) V(12) V(12)
    V(-6) V(-7)
    true false true false true false false false false
    false false true true true true false true
    V(24)
    <plain> plain! plain NaN NaN false true true
    ValueError ValueError: no sum
    number true 3 number 1.5
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("code that was optimized before Python started is not trusted afterwards", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": vector,
    "main.js": `
      import { numberOfDFGCompiles, optimizeNextInvocation } from "bun:jsc";
      function kindOfProduct(a) { const r = a * 2; return typeof r; }
      function kindOfSum(a, b) { const r = a + b; return typeof r; }
      function kindOfNegation(a) { const r = -a; return typeof r; }
      function equal(a, b) { return a == b; }
      function branch(a, b) { if (a == b) return "same"; return "different"; }
      function less(a, b) { return a < b; }
      const three = { valueOf() { return 3; } }, four = { valueOf() { return 4; } };
      const functions = [kindOfProduct, kindOfSum, kindOfNegation, equal, branch, less];
      let seen = new Set();
      function heat(run) {
        for (let i = 0; i < 1200; i++) run();
        for (const f of functions) optimizeNextInvocation(f);
        run();
      }
      heat(() => {
        seen.add(kindOfProduct(three)); seen.add(kindOfSum(three, four)); seen.add(kindOfNegation(three));
        seen.add(equal(three, four)); seen.add(equal(three, three)); seen.add(branch(three, four)); seen.add(less(three, four));
      });
      console.log([...seen].join(" "), functions.every(f => numberOfDFGCompiles(f) > 0));
      const { V } = await import("./v.py");
      const a = new V(6), b = new V(6);
      console.log(kindOfProduct(a), kindOfSum(a, b), kindOfSum(1, a), kindOfNegation(a), equal(a, b), branch(a, b), less(a, new V(7)));
      seen = new Set();
      heat(() => {
        seen.add(kindOfProduct(a)); seen.add(kindOfSum(a, b)); seen.add(kindOfNegation(a));
        seen.add(equal(a, b)); seen.add(branch(a, b)); seen.add(less(a, b));
        seen.add(kindOfProduct(three)); seen.add(equal(three, four));
      });
      console.log([...seen].join(" "));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "number false true different true
    object object object object true same true
    object true same false number
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("hot loops over Python objects", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": vector,
    "main.js": `
      import { V } from "./v.py";
      function sum(n) { let s = new V(0); for (let i = 0; i < n; i++) s = s + i; return s; }
      function mixed(values) { let s = 0; for (const v of values) s = v + s; return s; }
      function count(values, needle) { let n = 0; for (const v of values) if (v == needle) n++; return n; }
      console.log(String(sum(1500)));
      const numbers = Array.from({ length: 1500 }, (_, i) => i);
      console.log(mixed(numbers));
      console.log(String(mixed([...numbers.slice(0, 3), new V(10), 1])));
      const vs = Array.from({ length: 1500 }, (_, i) => new V(i % 10));
      console.log(count(vs, new V(3)), count(numbers, 3), count(vs, 3));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "V(1124250)
    1124250
    V(('r', 1, 13))
    150 1 0
    "
  `);
  expect(exitCode).toBe(0);
});
