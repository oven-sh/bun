import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";

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

async function run(files: Record<string, string>, env: Record<string, string> = {}) {
  using dir = tempDir("python-operators", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: { ...bunEnv, ...env },
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
      // With a string, + concatenates, as it does with any object.
      const p = new Plain();
      show("<" + p + ">", p + "!", \`\${p}\`, p == "plain", p == p);
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
    <plain> plain! plain true true
    ValueError ValueError: no sum
    number true 3 number 1.5
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("an operator that neither operand has an answer to is a TypeError", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": vector,
    "n.py": "class Number:\n    def __float__(self): return 1.5\n",
    "main.js": `
      import { Plain, V } from "./v.py";
      import { Number as PyNumber } from "./n.py";
      import { TypeError as PyTypeError } from "python:builtins";
      const p = new Plain(), v = new V(1), n = new PyNumber();
      let counter = new Plain();
      for (const f of [
        () => p - 1, () => 1 - p, () => p * 2, () => p + 1, () => 1 + p, () => p + p, () => p / p, () => p % 2, () => p ** 2, () => p & 1, () => p | 1,
        () => p ^ 1, () => p << 1, () => p >> 1, () => -p, () => ~p, () => p < 1, () => 1 <= p, () => p > p, () => p >= null,
        () => p + null, () => p + undefined, () => p + {}, () => p + [], () => p + 1n, () => p + true, () => { counter++; }, () => { --counter; }, () => (counter -= 1),
        () => v / "a", () => n * 2,
      ]) {
        try {
          console.log("no exception:", String(f), String(f()));
        } catch (e) {
          console.log(e instanceof PyTypeError, e.message ?? String(e));
        }
      }
      // To make a number of it is up to the program, as in Python.
      console.log(+n * 2, Number(n) * 2, Math.round(n));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "true unsupported operand type(s) for -: 'Plain' and 'int'
    true unsupported operand type(s) for -: 'int' and 'Plain'
    true unsupported operand type(s) for *: 'Plain' and 'int'
    true unsupported operand type(s) for +: 'Plain' and 'int'
    true unsupported operand type(s) for +: 'int' and 'Plain'
    true unsupported operand type(s) for +: 'Plain' and 'Plain'
    true unsupported operand type(s) for /: 'Plain' and 'Plain'
    true unsupported operand type(s) for %: 'Plain' and 'int'
    true unsupported operand type(s) for ** or pow(): 'Plain' and 'int'
    true unsupported operand type(s) for &: 'Plain' and 'int'
    true unsupported operand type(s) for |: 'Plain' and 'int'
    true unsupported operand type(s) for ^: 'Plain' and 'int'
    true unsupported operand type(s) for <<: 'Plain' and 'int'
    true unsupported operand type(s) for >>: 'Plain' and 'int'
    true bad operand type for unary -: 'Plain'
    true bad operand type for unary ~: 'Plain'
    true '<' not supported between instances of 'Plain' and 'int'
    true '<=' not supported between instances of 'int' and 'Plain'
    true '>' not supported between instances of 'Plain' and 'Plain'
    true '>=' not supported between instances of 'Plain' and 'NoneType'
    true unsupported operand type(s) for +: 'Plain' and 'NoneType'
    true unsupported operand type(s) for +: 'Plain' and 'NoneType'
    true unsupported operand type(s) for +: 'Plain' and 'JSPlainObject'
    true unsupported operand type(s) for +: 'Plain' and 'list'
    true unsupported operand type(s) for +: 'Plain' and 'int'
    true unsupported operand type(s) for +: 'Plain' and 'bool'
    true unsupported operand type(s) for +: 'Plain' and 'int'
    true unsupported operand type(s) for -: 'Plain' and 'int'
    true unsupported operand type(s) for -: 'Plain' and 'int'
    true unsupported operand type(s) for /: 'int' and 'str'
    true unsupported operand type(s) for *: 'Number' and 'int'
    3 3 2
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("the type of an operand that is a value of JS is asked as well", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": `
import fractions
class Index:
    def __index__(self): return 2
class Pair(tuple): pass
class Text(str): pass
index, pair, one, half, text = Index(), Pair((1, 2)), (1,), fractions.Fraction(1, 2), Text("%d!")
class Reflected:
    def __radd__(self, other): return ("radd", other)
    def __rmod__(self, other): return ("rmod", other)
reflected = Reflected()
`,
    "main.js": `
      import { index, pair, one, half, text, reflected } from "./v.py";
      import { repr } from "python:builtins";
      const show = (...values) => console.log(values.map(repr).join(" "));
      show("%s and %s" % pair, "%s" % one, "%.2f" % half, text % 3);
      show("ab" * index, index * "ab", [1, 2] * index, index * [0]);
      show(one * 2, 2 * one, one + one, true + half, 10n + half, 1.5 + half, 2 ** half);
      show("a" + reflected, 1 + reflected, [] + reflected, 2 % reflected);
      for (const f of [() => [1] + one, () => one + [1], () => "ab" * half, () => "a" < one, () => [1] < one, () => "%d" % text])
        try { show(f()); } catch (e) { console.log(String(e)); }
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "'1 and 2' '1' '0.50' '3!'
    'abab' 'abab' [1, 2, 1, 2] [0, 0]
    (1, 1) (1, 1) (1, 1) Fraction(3, 2) Fraction(21, 2) 2 1.4142135623730951
    ('radd', 'a') ('radd', 1) ('radd', []) ('rmod', 2)
    TypeError: can only concatenate list (not "tuple") to list
    TypeError: can only concatenate tuple (not "list") to tuple
    TypeError: can't multiply sequence by non-int of type 'Fraction'
    TypeError: '<' not supported between instances of 'str' and 'tuple'
    TypeError: '<' not supported between instances of 'list' and 'tuple'
    TypeError: format argument: %d requires a real number, not v.Text
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("to multiply by the literal 1 is to multiply", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": vector,
    "main.js": `
      import { V } from "./v.py";
      const a = new V(6);
      const show = (...values) => console.log(values.map(String).join(" "));
      show(a * 1, 1 * a, a * 1.0, a * 1 * 1);
      show("3" * 1, 1 * "3", [5] * 1, { valueOf: () => 4 } * 1, null * 1, undefined * 1, typeof ("3" * 1), Object.is(-0 * 1, -0));
      try { 5n * 1; } catch (e) { show(e.name); }
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toBe("V(6) V(6) V(6) V(6)\n3 3 5 4 0 NaN number true\nTypeError\n");
  expect(exitCode).toBe(0);
});

test.concurrent("code that was optimized before Python started gives the answers of Python objects", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
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
    },
    // So that a function is compiled by the time it is said to be.
    { BUN_JSC_useConcurrentJIT: "0" },
  );
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

// Every tier is to give the same answers, whatever a site has seen before.
const tiers: [string, Record<string, string>][] = [
  ["as shipped", {}],
  ["the interpreter", { BUN_JSC_useJIT: "0" }],
  ["no DFG", { BUN_JSC_useDFGJIT: "0" }],
  ["no FTL", { BUN_JSC_useFTLJIT: "0", BUN_JSC_useConcurrentJIT: "0", BUN_JSC_thresholdForOptimizeAfterWarmUp: "100" }],
  [
    "an eager FTL",
    {
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "50",
      BUN_JSC_thresholdForOptimizeSoon: "50",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "200",
      BUN_JSC_thresholdForFTLOptimizeSoon: "200",
    },
  ],
];
const answersOfEveryTier = `if (a == b) ++s;         376,113,376 (300); 113,376,113 (600); 376,38,0,0 (825)
const r = a == b; s += r 376,113,376 (300); 113,376,113 (600); 376,38,0,0 (825)
if (a != b) ++s;         2624,187,2624 (300); 187,2624,187 (600); 2624,262,300,300 (825)
a == b; ++s;             3000,300,3000 (300); 300,3000,300 (600); 3000,300,300,300 (825)
if (a === b) ++s;        376,0,376 (0); 0,376,0 (0); 376,0,0,0 (0)
if (a == a) ++s;         3000,300,3000 (300); 300,3000,300 (600); 3000,300,300,300 (450)
if (a < b) ++s;          1500,112,1500 (0); 112,1500,112 (0); 1500,149,112,149 (0)
const r = a >= b; s += r 1500,188,1500 (0); 188,1500,188 (0); 1500,151,188,151 (0)
const r = a + b; s += ty 4500,300375,4500 (0); 300375,4500,300375 (0); 4500,262950,450375,300450 (0)
const r = a * 2; s += ty 3000,300300,3000 (0); 300300,3000,300300 (0); 3000,150300,300,300300 (0)
const r = 1 - a; s += ty 1500,300150,1500 (0); 300150,1500,300150 (0); 1500,150150,150,300150 (0)
const r = -a; s += typeo -1500,299850,-1500 (0); 299850,-1500,299850 (0); -1500,149850,-150,299850 (0)
const r = a | 0; s += ty 1500,300150,1500 (0); 300150,1500,300150 (0); 1500,150150,150,300150 (0)
let c = a; ++c; s += typ 4500,300450,4500 (0); 300450,4500,300450 (0); 4500,150450,450,300450 (0)
if (a == b) ++s;         376,76,376,38,0 (450); 376,152,76,0,0 (300)
const r = a == b; s += r 376,76,376,38,0 (450); 376,152,76,0,0 (300)
if (a != b) ++s;         2624,224,2624,262,300 (450); 2624,148,224,300,300 (300)
a == b; ++s;             3000,300,3000,300,300 (450); 3000,300,300,300,300 (300)
if (a == a) ++s;         3000,150,3000 (0); 3000,150 (0); 3000,150 (0)
const r = a != a; s += r 0,150,0 (0); 0,150 (0); 0,150 (0)
`;
test.concurrent.each(tiers)("a site sees objects of JS, of Python, or both: %s", async (_, env) => {
  const { stdout, stderr, exitCode } = await run(
    {
      "v.py":
        vector +
        `
V._v = lambda o: o if isinstance(o, (int, float)) else o.x
calls = 0
class Counted(V):
    def __eq__(self, o):
        global calls
        calls += 1
        return V.__eq__(self, o)
    __hash__ = V.__hash__
    def __radd__(self, o): return V(V._v(o) + self.x + 500)
def take_calls():
    global calls
    n, calls = calls, 0
    return n
pairs = [(i % 2, "t") for i in range(4)]
nans = [float("nan"), 1.0, float("nan"), 3.0]
`,
      "main.js": `
      import { Counted, Plain, nans, pairs, take_calls } from "./v.py";
      const HOT = 3000, WARM = 300;
      class J { constructor(x) { this.x = x; } valueOf() { return this.x; } }
      const four = [0, 1, 2, 3];
      const js = four.map(i => new J(i % 2)), js2 = four.map(i => (i & 1 ? js[i] : new J(i)));
      const py = four.map(i => new Counted(i % 2)), py2 = four.map(i => new Counted(i % 3));
      const both = [js[0], py[1], js[2], py[3]], both2 = [py2[0], py2[1], js2[2], js2[3]];
      const jsOrNull = [null, js[1], undefined, js[3]], pyOrNull = [null, py[1], undefined, py[3]];
      const kinds = [{}, [], () => 0, new Error("e")], kinds2 = [kinds[0], [], kinds[2], {}];
      const plains = four.map(() => new Plain());
      // A function for each site, so that it has seen nothing but what it is given here.
      const site = body => (0, eval)("(function (xs, ys, n) { let s = 0; for (let i = 0; i < n; ++i) { const a = xs[i & 3], b = ys[(i + (i >> 2)) & 3]; " + body + " } return s; })");
      const bodies = [
        "if (a == b) ++s;", "const r = a == b; s += r;", "if (a != b) ++s;", "a == b; ++s;", "if (a === b) ++s;", "if (a == a) ++s;",
        "if (a < b) ++s;", "const r = a >= b; s += r;",
        "const r = a + b; s += typeof r === 'number' ? r : 1000 + r.x;", "const r = a * 2; s += typeof r === 'number' ? r : 1000 + r.x;",
        "const r = 1 - a; s += typeof r === 'number' ? r : 1000 + r.x;", "const r = -a; s += typeof r === 'number' ? r : 1000 + r.x;",
        "const r = a | 0; s += typeof r === 'number' ? r : 1000 + r.x;", "let c = a; ++c; s += typeof c === 'number' ? c : 1000 + c.x;",
      ];
      const orders = [
        [[js, js2, HOT], [py, py2, WARM], [js, js2, HOT]],
        [[py, py2, WARM], [js, js2, HOT], [py, py2, WARM]],
        [[js, js2, HOT], [both, both2, WARM], [js, py2, WARM], [py, js2, WARM]],
      ];
      const equalityOnly = [
        [[js, jsOrNull, HOT], [py, pyOrNull, WARM], [jsOrNull, js, HOT], [pyOrNull, py2, WARM], [js, pyOrNull, WARM]],
        [[kinds, kinds2, HOT], [pairs, pairs, WARM], [plains, plains, WARM], [kinds, pairs, WARM], [py, [0, 1, "a", 2n], WARM]],
      ];
      const go = (body, phases) => {
        const f = site(body);
        take_calls();
        return phases.map(([xs, ys, n]) => f(xs, ys, n)).join(",") + " (" + take_calls() + ")";
      };
      for (const body of bodies) console.log(body.slice(0, 24).padEnd(24), orders.map(phases => go(body, phases)).join("; "));
      for (const body of bodies.slice(0, 4)) console.log(body.slice(0, 24).padEnd(24), equalityOnly.map(phases => go(body, phases)).join("; "));
      // A value and itself: a NaN of Python's, which is an object in a list, says no.
      const itself = [[[js, js, HOT], [nans, nans, WARM], [js, js, HOT]], [[kinds, kinds, HOT], [nans, nans, WARM]], [[four, four, HOT], [nans, nans, WARM]]];
      for (const body of ["if (a == a) ++s;", "const r = a != a; s += r;"]) console.log(body.slice(0, 24).padEnd(24), itself.map(phases => go(body, phases)).join("; "));
    `,
    },
    env,
  );
  expect(stderr).toBe("");
  expect(stdout).toBe(answersOfEveryTier);
  expect(exitCode).toBe(0);
});

// differential/interop/018_operator_operands has every operator with every kind of operand, once. Minutes in the slow builds.
test.skipIf(isDebug || isASAN).concurrent.each(tiers.slice(2))(
  "Python is asked before an operand is converted: %s",
  async (_, env) => {
    const script = join(import.meta.dir, "differential", "interop", "018_operator_operands");
    const { stdout, stderr, exitCode } = await run(
      {
        "main.js": await Bun.file(script + ".js").text(),
        "018_operator_operands.py": await Bun.file(script + ".py").text(),
      },
      { ...env, TURNS: "300" },
    );
    const expected = await Bun.file(script + ".expected").text();
    expect(stderr).toBe("");
    expect(stdout).toBe(expected.slice(expected.indexOf("\n---\n") + 5));
    expect(exitCode).toBe(0);
  },
);

test.concurrent("code of a realm that has no Python", async () => {
  const { stdout, stderr, exitCode } = await run({
    "v.py": vector,
    "main.js": `
      import { runInNewContext } from "node:vm";
      import { V, Plain } from "./v.py";
      const results = runInNewContext(\`
        const outcome = f => { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
        [() => a - 1, () => 10 - a, () => a * b, () => a & 1, () => 1 << a, () => ~a, () => -a, () => { let c = a; ++c; return c; }, () => a + 1, () => "s" + a,
         () => a == b, () => a == a, () => a != 3, () => a < b, () => 4 >= a, () => plain - 1, () => plain < 1, () => plain == plain, () => plain + "!"].map(outcome)
      \`, { a: new V(3), b: new V(4), plain: new Plain() });
      console.log(results.join("\\n"));
    `,
  });
  expect(stderr).toBe("");
  expect(stdout).toMatchInlineSnapshot(`
    "V(2)
    V(7)
    V(12)
    V(1)
    TypeError: unsupported operand type(s) for <<: 'int' and 'V'
    V(-4)
    V(-3)
    V(4)
    V(4)
    V(('r', 's', 3))
    false
    true
    true
    true
    true
    TypeError: unsupported operand type(s) for -: 'Plain' and 'int'
    TypeError: '<' not supported between instances of 'Plain' and 'int'
    true
    plain!
    "
  `);
  expect(exitCode).toBe(0);
});

test.concurrent("a site that meets Python objects is not compiled over and over", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "v.py": vector,
      "main.js": `
      import { numberOfDFGCompiles } from "bun:jsc";
      import { V } from "./v.py";
      function count(xs, ys, n) { let s = 0; for (let i = 0; i < n; ++i) if (xs[i & 3] == ys[i & 3]) ++s; return s; }
      const js = [{}, {}, {}, {}], py = [0, 1, 2, 3].map(i => new V(i));
      const results = [count(js, js, 20000)];
      const compiledForJS = numberOfDFGCompiles(count);
      for (let i = 0; i < 40; ++i) results.push(count(py, py, 500), count(js, js, 500));
      console.log(new Set(results).size, compiledForJS > 0, numberOfDFGCompiles(count) - compiledForJS <= 3);
    `,
    },
    { BUN_JSC_useConcurrentJIT: "0" },
  );
  expect(stderr).toBe("");
  expect(stdout).toBe("2 true true\n");
  expect(exitCode).toBe(0);
});
