import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Lowering of TC39 standard decorators. Once any member of a class is
// decorated, every field of that class leaves the class body (instance fields
// move into the constructor, static fields and static blocks move after the
// class), in source order and with [[Define]] semantics, and every private
// member is lowered so the moved code can still reach it. This mirrors
// esbuild's `lowerClass`.
//
// One fixture per mode holds the whole matrix and prints one JSON object; each
// matrix cell is then its own test. The fixture runs as .js / .ts / .cjs /
// .cts, with `useDefineForClassFields` on and off, directly and through
// `bun build`.

async function run(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A single-file case: the source goes straight to `bun -e`. The cwd is an empty
// directory because `-e` reads the cwd's tsconfig.json, and the repository's
// root tsconfig enables experimentalDecorators.
async function runInline(code: string) {
  using dir = tempDir("es-dec-inline", {});
  return await run(String(dir), ["-e", code]);
}

const kinds = ["field", "method", "getter", "setter", "accessor"] as const;
const placements = ["instance", "static"] as const;
const visibilities = ["public", "private"] as const;
type Kind = (typeof kinds)[number];
type Placement = (typeof placements)[number];
type Visibility = (typeof visibilities)[number];

type Cell = {
  kind: Kind;
  placement: Placement;
  visibility: Visibility;
  classDecorated: boolean;
  derived: boolean;
};

const cells: Cell[] = [];
for (const kind of kinds) {
  for (const placement of placements) {
    for (const visibility of visibilities) {
      for (const classDecorated of [false, true]) {
        for (const derived of [false, true]) {
          cells.push({ kind, placement, visibility, classDecorated, derived });
        }
      }
    }
  }
}

function cellName(cell: Cell) {
  const flags = [cell.classDecorated ? "class decorator" : "", cell.derived ? "derived" : ""].filter(Boolean);
  return `${cell.kind}/${cell.placement}/${cell.visibility}${flags.length ? ` (${flags.join(", ")})` : ""}`;
}

// One class per cell: the decorated member `x` sits between undecorated
// instance fields, private fields, static fields and a static block. `dec`
// replaces every kind of member with one that appends "!" to its value, so
// the result also shows the decorator's return value was applied to the right
// member and nothing else.
function matrixClass(cell: Cell) {
  const { kind, placement, visibility, classDecorated, derived } = cell;
  const s = placement === "static" ? "static " : "";
  const name = visibility === "private" ? "#x" : "x";
  const self = placement === "static" ? "C" : "this";
  let member: string;
  let reader: string;
  switch (kind) {
    case "field":
      member = `@decApply ${s}${name} = L("x");`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "accessor":
      member = `@decApply ${s}accessor ${name} = L("x");`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "method":
      member = `@decApply ${s}${name}() { return "x"; }`;
      reader = `${s}read() { return ${self}.${name}(); }`;
      break;
    case "getter":
      member = `@decApply ${s}get ${name}() { return "x"; }`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "setter":
      member = `@decApply ${s}set ${name}(v) { side = v; }`;
      reader = `${s}read() { ${self}.${name} = "x"; return side; }`;
      break;
  }
  const id = JSON.stringify(cellName(cell));
  return `
{
  let side;
  class B { constructor() { L("base"); } }
  log.length = 0;
  ctxs = {};
  ${classDecorated ? "@decApply " : ""}class C ${derived ? "extends B " : ""}{
    static sBefore = L("sBefore");
    static { L("sBlock"); }
    iBefore = L("iBefore");
    #p = L("#p");
    iPriv = (L("iPriv"), this.#p);
    ${member}
    iAfter = L("iAfter");
    static sAfter = L("sAfter");
    static #sp = L("#sp");
    static sPriv = (L("sPriv"), C.#sp);
    #m() { return "m"; }
    callM() { return this.#m(); }
    has() { return #p in this; }
    ${reader}
  }
  const defLog = log.slice();
  log.length = 0;
  const inst = new C();
  out[${id}] = {
    defLog,
    ctorLog: log.slice(),
    value: ${placement === "static" ? "C.read()" : "inst.read()"},
    iPriv: inst.iPriv,
    sPriv: C.sPriv,
    callM: inst.callM(),
    has: inst.has(),
    ctx: ctxs[${JSON.stringify(name)}],
    classCtx: ctxs["C"] ?? null,
    isInstance: inst instanceof C${derived ? " && inst instanceof B" : ""},
  };
}`;
}

function matrixExpected(cell: Cell) {
  const { kind, placement, visibility, classDecorated, derived } = cell;
  const name = visibility === "private" ? "#x" : "x";
  const isFieldLike = kind === "field" || kind === "accessor";
  // Decorators are called before any static member is initialized; the class
  // decorator last. Static fields and blocks then run in source order.
  const defLog = [`dec:${name}`];
  if (classDecorated) defLog.push("dec:C");
  defLog.push("sBefore", "sBlock");
  if (isFieldLike && placement === "static") defLog.push("x");
  defLog.push("sAfter", "#sp", "sPriv");
  // Instance fields run after super() returns, in source order.
  const ctorLog = derived ? ["base"] : [];
  ctorLog.push("iBefore", "#p", "iPriv");
  if (isFieldLike && placement === "instance") ctorLog.push("x");
  ctorLog.push("iAfter");
  return {
    defLog,
    ctorLog,
    value: "x!",
    iPriv: "#p",
    sPriv: "#sp",
    callM: "m",
    has: true,
    ctx: { kind, name, static: placement === "static", private: visibility === "private" },
    classCtx: classDecorated ? { kind: "class", name: "C", static: null, private: null } : null,
    isInstance: true,
  };
}

const fixturePrelude = `
const log = [];
const L = (name) => (log.push(name), name);
let ctxs = {};
const dec = (value, ctx) => {
  log.push("dec:" + String(ctx.name));
  ctxs[String(ctx.name)] = { kind: ctx.kind, name: ctx.name, static: ctx.static ?? null, private: ctx.private ?? null };
};
const decApply = (value, ctx) => {
  dec(value, ctx);
  switch (ctx.kind) {
    case "field": return (v) => v + "!";
    case "accessor": return { init: (v) => v + "!" };
    case "method": return function (...args) { return value.call(this, ...args) + "!"; };
    case "getter": return function () { return value.call(this) + "!"; };
    case "setter": return function (v) { value.call(this, v + "!"); };
  }
};
const out = {};
const pending = [];
`;

// Fields keep [[Define]] semantics after lowering: a setter on the base class
// is not invoked, and the instance gets an own data property. TypeScript's
// \`useDefineForClassFields: false\` switches to [[Set]] for every field and
// emits nothing for a field without an initializer, as tsc does.
const installSection = `
{
  const calls = [];
  class Base {
    set f(v) { calls.push("f:" + v); }
    set g(v) { calls.push("g:" + v); }
    static set sf(v) { calls.push("sf:" + v); }
    static set sg(v) { calls.push("sg:" + v); }
  }
  class D extends Base {
    @dec f = 1;
    g = 2;
    @dec static sf = 3;
    static sg = 4;
    bar;
  }
  const d = new D();
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  out.install = {
    calls,
    own: [own(d, "f"), own(d, "g"), own(d, "bar")],
    staticOwn: [own(D, "sf"), own(D, "sg")],
    values: [d.f, d.g, d.bar, D.sf, D.sg],
  };
}`;

const installExpectedDefine = {
  calls: [],
  own: [true, true, true],
  staticOwn: [true, true],
  values: [1, 2, null, 3, 4],
};
const installExpectedAssign = {
  calls: ["sf:3", "sg:4", "f:1", "g:2"],
  own: [false, false, false],
  staticOwn: [false, false],
  values: [null, null, null, null, null],
};

const extraSections = `
// \`this\` in a static initializer that leaves the class body is the class.
{
  class S {
    @dec static x = this;
    static y = () => this;
    static z = this.x;
  }
  out.staticThis = [S.x === S, S.y() === S, S.z === S];
}

// Two decorated classes in one scope keep separate decorator contexts.
{
  const seen = [];
  const decInit = (value, ctx) => {
    ctx.addInitializer(function () { seen.push(ctx.name + ":" + this.constructor.name); });
  };
  class A1 { @decInit m() {} }
  class B1 { @decInit n() {} }
  new A1();
  new B1();
  out.twoClasses = seen;
}

// Generated names do not clash with user bindings.
{
  let _init = "user";
  let _x = "user_x";
  let _dec = "user_dec";
  class V { @dec m() {} #x = 1; getX() { return this.#x; } }
  out.collision = [_init, _x, _dec, new V().getX()];
}

// Undecorated \`accessor\` fields: initialization order is kept, and a class
// without decorators gets no Symbol.metadata.
{
  log.length = 0;
  class T {
    accessor a = L("a");
    b = L("b");
    static accessor c = L("c");
    static d = L("d");
  }
  const defLog = log.slice();
  log.length = 0;
  const t = new T();
  out.accessorOnly = { defLog, ctorLog: log.slice(), values: [t.a, t.b, T.c, T.d], symbols: Object.getOwnPropertySymbols(T).length };
}

// Decorator expressions and computed keys evaluate in source order, once.
{
  log.length = 0;
  const K = (n) => (log.push("k:" + n), n);
  const D = (n) => (log.push("d:" + n), dec);
  class Q {
    [K("m")]() { return "mv"; }
    @D("f") [K("f")] = L("fv");
    static [K("s")] = L("sv");
    [K("g")] = L("gv");
  }
  const defLog = log.slice();
  log.length = 0;
  const q = new Q();
  out.computed = { defLog, ctorLog: log.slice(), values: [q.m(), q.f, Q.s, q.g] };
  new Q();
  out.computedTwice = log.slice();
}

// A named class expression: moved static code still sees the class.
{
  log.length = 0;
  const E = class Named {
    @dec m() {}
    static self = Named;
    static { L("eblk"); }
    y = Named;
  };
  out.namedExpr = { defLog: log.slice(), self: E.self === E, y: new E().y === E };
}

// Derived class with an explicit constructor: fields initialize after super().
{
  log.length = 0;
  class Base2 { constructor() { L("base"); } }
  class Der extends Base2 {
    a = L("a");
    @dec b = L("b");
    constructor() { L("pre"); super(); L("post"); }
  }
  new Der();
  out.derived = log.slice();
}

// Private accessors and private methods next to a decorated member.
{
  class PA {
    @dec m() {}
    accessor #acc = L("acc");
    static accessor #sacc = 5;
    get acc() { return this.#acc; }
    set acc(v) { this.#acc = v; }
    static bump() { return ++PA.#sacc; }
    static { PA.#sacc += 10; }
  }
  const pa = new PA();
  const before = pa.acc;
  pa.acc = 7;
  out.privateAccessor = [before, pa.acc, PA.bump()];
}

// Update and compound assignments on lowered private members evaluate the
// receiver once and apply ToNumeric like the native operators.
{
  let n = 0;
  class U {
    @dec m() {}
    #x = "5";
    #b = 1n;
    static #s = 1;
    static run(o) {
      const mk = () => (n++, o);
      const r1 = ++o.#x;
      const r2 = o.#x++;
      o.#x -= 1;
      o.#x ??= 100;
      o.#b++;
      U.#s += 2;
      mk().#x *= 2;
      mk().#x ||= 0;
      return [r1, r2, o.#x, o.#b.toString() + "n", U.#s, n];
    }
  }
  out.privateUpdates = U.run(new U());
}

// \`super\`, \`this\` and nested scopes in static code that leaves the class
// body. The expected values are what node prints for the same class without
// the decorator.
{
  let n = 0;
  class SBase {
    static count = 10;
    static get y() { return "by"; }
    static m(a) { return "bm:" + a + ":" + this.name; }
    static set z(v) { SBase.z_ = v; }
  }
  class SDer extends SBase {
    @dec static q = 1;
    static a = super.y;
    static b = super.m("arg");
    static c = (super.z = 5);
    static d = () => super["y"];
    static { SDer.e = super.m("blk"); }
    static f = (super.count += 5);
    static g = ++super.count;
    static h = super.count++;
    static i = (super.z ??= 7);
    static j = super[(n++, "y")];
    static k = (super[(n++, "count")] -= 1);
    static l = (super[(n++, "count")]--, SDer.count);
    static obj = { [this.q]: this.q, m() { return super.toString === Object.prototype.toString; } };
    static fn = (a = this.q, { b = this.q } = {}) => [a, b];
    static nested = class Inner extends (this.q, SBase) { static [this.q] = 2; static w = SDer.q; };
    static asyncFn = async () => { await null; return this.q; };
    static { const { x = this.q } = {}; const [y = this.q] = []; SDer.destructured = [x, y]; }
  }
  out.superStatic = [SDer.a, SDer.b, SDer.c, SDer.d(), SDer.e, SDer.f, SDer.g, SDer.h, SDer.i, SDer.j, SDer.k, SDer.l, SDer.count, SBase.count, SBase.z_, n];
  out.relocated = [SDer.obj[1], SDer.obj.m(), SDer.fn(), SDer.nested[1], SDer.nested.w, SDer.destructured];
  pending.push(SDer.asyncFn().then((v) => { out.relocatedAsync = v; }));
}

// The inner name of a class expression, in nested scopes of relocated code.
{
  const E = class Named {
    @dec m() {}
    static #p = 3;
    static inner = class { static w = Named.#p; static [Named.#p] = "k"; m() { return Named; } };
    static obj = { [Named.#p]: Named.#p, get g() { return Named.#p; } };
    static fn = (a = Named.#p, { b = Named.#p } = {}) => [a, b, Named];
    static { const { x = Named.#p } = {}; for (const y of [Named.#p]) Named.z = x + y; }
  };
  out.namedExprNested = [E.inner.w, E.inner[3], new E.inner().m() === E, E.obj[3], E.obj.g, E.fn().slice(0, 2), E.fn()[2] === E, E.z];
}

// Every form of \`super\` and of a lowered private member, in code that left
// the class body, with \`Reflect\` and \`Object\` shadowed. The expected values
// are what node prints for the same class without the decorator.
{
  const Reflect = null;
  const Object = null;
  class SB {
    static v = 1;
    static get g() { return "g"; }
    static tag(s, ...vals) { return this.name + ":" + s.raw.join("|") + vals.join(","); }
    static sm() { return "sm:" + this.name; }
    greet() { return "hi:" + this.n; }
  }
  class SC extends SB {
    @dec static m() {}
    n = 7;
    static y = super.v;
    static opt1 = super.missing?.();
    static opt2 = super.sm?.();
    static tagged = super.tag\`a\${1}b\${2}\`;
    static destructured = ([super.d1, { k: super.d2 = 9 }, ...super.rest] = [5, {}, 6, 7], [SC.d1, SC.d2, SC.rest]);
    static loop = (() => {
      const seen = [];
      for (super.it of [1, 2]) seen.push(SC.it);
      for (super.key in { a: 1 }) seen.push(SC.key);
      return seen;
    })();
    static {
      try {
        SC.fail = (super.g = 1);
      } catch (e) {
        SC.readonlyError = e.constructor.name + ": " + e.message;
      }
    }
    #pm() { return super.greet() + "/" + super.sm?.() + "/" + super.missing?.(); }
    static #spm() { return super.sm() + "/" + super.g; }
    #tag(s, ...vals) { return this.n + ":" + s.raw.join("|") + vals.join(","); }
    #a = 1;
    #b = 2;
    swap() {
      [this.#a, this.#b] = [this.#b, this.#a];
      ({ x: this.#a = 10 } = {});
      for (this.#b of [30]) {}
      return [this.#a, this.#b];
    }
    call() { return [this.#pm(), SC.#spm(), this.#tag\`q\${1}\`]; }
  }
  out.superForms = [SC.y, SC.opt1, SC.opt2, SC.tagged, SC.destructured, SC.loop, SC.readonlyError];
  out.privateForms = [new SC().call(), new SC().swap()];
}

// https://github.com/oven-sh/bun/issues/28118
{
  const id = (value, context) => value;
  class Broken {
    @id accessor label = "";
    #name = "hello";
    #callback = () => this.#name;
    run() { return this.#callback(); }
  }
  out.issue28118 = new Broken().run();
}

// https://github.com/oven-sh/bun/issues/31917
{
  const pick = (x) => x;
  const C = class Foo {
    static #m = function (tag) { return { tag }; };
    @dec static s = Foo.#m("s").tag;
    @dec static t = pick(this).#m("t").tag;
  };
  out.issue31917 = [C.s, C.t];
}

// https://github.com/oven-sh/bun/issues/31929
{
  const C = class Foo {
    @dec static s = (class { @dec static x = Foo; }).x;
  };
  out.issue31929 = [typeof C.s, C.s === C];
}

// https://github.com/oven-sh/bun/issues/28010 and /28316: each class keeps
// its own decorator context, so subclasses and siblings do not mix up
// field initializer slots.
{
  const seen = [];
  const decorate = (name) => (_value, context) => (initialValue) => {
    seen.push(name + ":" + String(context.name) + "=" + initialValue);
    return initialValue;
  };
  class Parent {
    @decorate("Parent.foo") foo = "parent_foo";
    @decorate("Parent.shared") shared = "parent_shared";
  }
  class Child extends Parent {
    @decorate("Child.foo") foo = "child_foo";
    @decorate("Child.childOnly") childOnly = "child_childOnly";
  }
  new Child();
  out.issue28010 = seen;
}

// https://github.com/oven-sh/bun/issues/29837
{
  class A { accessor name = "A"; }
  class B extends A {
    accessor name = "B";
    names() { return [this.name, super.name]; }
  }
  out.issue29837 = new B().names();
}
`;

const extraExpected = {
  staticThis: [true, true, true],
  twoClasses: ["m:A1", "n:B1"],
  collision: ["user", "user_x", "user_dec", 1],
  accessorOnly: { defLog: ["c", "d"], ctorLog: ["a", "b"], values: ["a", "b", "c", "d"], symbols: 0 },
  computed: {
    defLog: ["k:m", "d:f", "k:f", "k:s", "k:g", "dec:f", "sv"],
    ctorLog: ["fv", "gv"],
    values: ["mv", "fv", "sv", "gv"],
  },
  computedTwice: ["fv", "gv", "fv", "gv"],
  namedExpr: { defLog: ["dec:m", "eblk"], self: true, y: true },
  derived: ["dec:b", "pre", "base", "a", "b", "post"],
  privateAccessor: ["acc", 7, 16],
  privateUpdates: [6, 6, 12, "2n", 3, 2],
  superStatic: ["by", "bm:arg:SDer", 5, "by", "bm:blk:SDer", 15, 11, 10, 7, "by", 9, 9, 9, 10, 7, 3],
  relocated: [1, true, [1, 1], 2, 1, [1, 1]],
  relocatedAsync: 1,
  namedExprNested: [3, "k", true, 3, 3, [3, 3], true, 6],
  superForms: [
    1,
    null,
    "sm:SC",
    "SC:a|b|1,2",
    [5, 9, [6, 7]],
    [1, 2, "a"],
    "TypeError: Attempted to assign to readonly property.",
  ],
  privateForms: [
    ["hi:7/undefined/undefined", "sm:SC/g", "7:q|1"],
    [10, 30],
  ],
  issue28118: "hello",
  issue31917: ["s", "t"],
  issue31929: ["function", true],
  issue28010: [
    "Parent.foo:foo=parent_foo",
    "Parent.shared:shared=parent_shared",
    "Child.foo:foo=child_foo",
    "Child.childOnly:childOnly=child_childOnly",
  ],
  issue29837: ["B", "A"],
};

function buildFixture(cjs: boolean) {
  let src = fixturePrelude;
  for (const cell of cells) {
    src += matrixClass(cell);
  }
  src += installSection;
  src += extraSections;
  src += `\nPromise.all(pending).then(() => console.log(JSON.stringify(out)));\n`;
  if (cjs) src += `module.exports = out;\n`;
  return src;
}

function buildExpected(assign: boolean) {
  const expected: Record<string, unknown> = {};
  for (const cell of cells) {
    expected[cellName(cell)] = matrixExpected(cell);
  }
  expected.install = assign ? installExpectedAssign : installExpectedDefine;
  Object.assign(expected, extraExpected);
  return expected;
}

type Mode = {
  name: string;
  file: string;
  cjs: boolean;
  useDefine: boolean;
  bundle: boolean;
};

const modes: Mode[] = [
  { name: ".js", file: "main.js", cjs: false, useDefine: true, bundle: false },
  { name: ".ts", file: "main.ts", cjs: false, useDefine: true, bundle: false },
  { name: ".cjs", file: "main.cjs", cjs: true, useDefine: true, bundle: false },
  { name: ".cts", file: "main.cts", cjs: true, useDefine: true, bundle: false },
  { name: ".js with module.exports", file: "main.js", cjs: true, useDefine: true, bundle: false },
  { name: ".ts useDefineForClassFields: false", file: "main.ts", cjs: false, useDefine: false, bundle: false },
  { name: ".cts useDefineForClassFields: false", file: "main.cts", cjs: true, useDefine: false, bundle: false },
  { name: ".js bundled", file: "main.js", cjs: false, useDefine: true, bundle: true },
  { name: ".ts bundled", file: "main.ts", cjs: false, useDefine: true, bundle: true },
  { name: ".cjs bundled", file: "main.cjs", cjs: true, useDefine: true, bundle: true },
  { name: ".ts useDefineForClassFields: false bundled", file: "main.ts", cjs: false, useDefine: false, bundle: true },
];

// Runs the fixture once per mode and returns its JSON output.
async function runMode(mode: Mode): Promise<Record<string, unknown>> {
  using dir = tempDir("es-dec-matrix", {
    [mode.file]: buildFixture(mode.cjs),
    "tsconfig.json": JSON.stringify({ compilerOptions: mode.useDefine ? {} : { useDefineForClassFields: false } }),
  });
  const cwd = String(dir);
  let entry = mode.file;
  if (mode.bundle) {
    const build = await run(cwd, ["build", mode.file, "--target=bun", "--outfile=bundled.js"]);
    if (build.stderr !== "" || build.exitCode !== 0) {
      throw new Error(`bun build failed (${build.exitCode}): ${build.stderr}`);
    }
    entry = "bundled.js";
  }
  const { stdout, stderr, exitCode } = await run(cwd, [entry]);
  if (stderr !== "" || exitCode !== 0) {
    throw new Error(`fixture failed (${exitCode}): ${stderr}\n${stdout}`);
  }
  return JSON.parse(stdout);
}

describe("ES decorators lowering matrix", () => {
  // Every mode's fixture is started up front so the spawns overlap. A failure
  // is reported by the mode's own `beforeAll`, not as an unhandled rejection.
  const runs = new Map<string, Promise<Record<string, unknown>>>();
  beforeAll(() => {
    for (const mode of modes) {
      const result = runMode(mode);
      result.catch(() => {});
      runs.set(mode.name, result);
    }
  });

  for (const mode of modes) {
    describe(mode.name, () => {
      let results: Record<string, unknown>;
      // The eleven fixtures (and four bundles) run at once; on a loaded debug
      // or ASAN machine the first hook waits well past the default 5 s.
      beforeAll(async () => {
        results = await runs.get(mode.name)!;
      }, 120_000);

      const expected = buildExpected(!mode.useDefine);
      for (const key of Object.keys(expected)) {
        test(key, () => {
          // JSON turns `undefined` into `null`.
          expect(results[key]).toEqual(expected[key]);
        });
      }

      test("no other output", () => {
        expect(Object.keys(results).sort()).toEqual(Object.keys(expected).sort());
      });
    });
  }
});

describe("ES decorators lowering", () => {
  test.concurrent("undecorated fields initialize in source order next to decorated fields", async () => {
    const { stdout, stderr, exitCode } = await runInline(`
      const dec = (v, ctx) => {}; const log = (s) => (console.log("init", s), s);
      class Foo { @dec a = log("a"); b = log(this.a === "a" ? "b (a set)" : "b (a NOT set)"); @dec c = log("c"); }
      new Foo();
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("init a\ninit b (a set)\ninit c\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("decorated fields are defined, not assigned", async () => {
    const { stdout, stderr, exitCode } = await runInline(`
      const dec = (v, ctx) => {};
      class Base { set a(v) { console.log("BASE SETTER", v) } }
      class Bar extends Base { @dec a = 1 }
      console.log(JSON.stringify(Object.getOwnPropertyDescriptor(new Bar(), "a")));
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe('{"value":1,"writable":true,"enumerable":true,"configurable":true}\n');
    expect(exitCode).toBe(0);
  });

  test.concurrent("static fields and static blocks keep their order next to decorated members", async () => {
    const { stdout, stderr, exitCode } = await runInline(`
      const dec = (v, ctx) => {};
      class S { @dec static x = console.log(1); static { console.log(2) } static y = console.log(3) }
      class T { static { console.log(1) } static x = console.log(2); @dec m() {} }
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("1\n2\n3\n1\n2\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("private names in undecorated field initializers are lowered with the rest", async () => {
    const { stdout, stderr, exitCode } = await runInline(`
      function d(t, k) {}
      class D { static #p = 5; static a = D.#p; static b = this.#p; #q = 6; d = this.#q; e() { return D.#p + this.#q } @d m() {} }
      console.log(D.a, D.b, new D().d, new D().e());
    `);
    expect(stderr).toBe("");
    expect(stdout).toBe("5 5 6 11\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("TypeScript useDefineForClassFields: false assigns every lowered field", async () => {
    using dir = tempDir("es-dec-udfcf", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { useDefineForClassFields: false } }),
      "test.ts": `
        const dec = (v: any, ctx: any) => {};
        class Base { set p(v: any) { console.log("SET", v) } }
        class C extends Base {
          @dec a = 1;
          bar: number;
          p: any = "field";
          constructor(public x: number) { super(); console.log("ctor", this.a, this.x); }
        }
        const c = new C(5);
        console.log(Object.keys(c), Object.prototype.hasOwnProperty.call(c, "bar"), Object.prototype.hasOwnProperty.call(c, "p"));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.ts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe('SET field\nctor 1 5\n[ "x", "a" ] false false\n');
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.Transpiler moves every field once one is decorated", () => {
    const transpiler = new Bun.Transpiler({ loader: "js", target: "bun" });
    const out = transpiler.transformSync(`
      const dec = () => {};
      class A { @dec a = 1; b = 2; static { c() } static d = 3; #e = 4; }
    `);
    // Instance fields: `a` before `b`, both defined in the constructor.
    expect(out).toMatch(
      /constructor\(\) \{\s*__publicField\w*\(this, "a", __runInitializers\w*\([^)]*\)\);\s*__runInitializers\w*\([^)]*\);\s*__publicField\w*\(this, "b", 2\);\s*__privateAdd\w*\(this, _e\$?\d*, 4\);/,
    );
    // Static block before the static field, both after the class body.
    expect(out).toMatch(/\}\n[\s\S]*c\(\);\n__publicField\w*\(A, "d", 3\);/);
    expect(out).not.toContain("static d");
    expect(out).not.toContain("this.a =");
    const legacy = new Bun.Transpiler({
      loader: "ts",
      target: "bun",
      tsconfig: { compilerOptions: { useDefineForClassFields: false } },
    });
    const assign = legacy.transformSync(`
      const dec = () => {};
      class A { @dec a = 1; b = 2; bar; static d = 3; }
    `);
    expect(assign).toContain("this.a = __runInitializers");
    expect(assign).toContain("this.b = 2");
    expect(assign).not.toContain("bar");
    expect(assign).toContain("A.d = 3");
    expect(assign).not.toContain("__publicField");
  });
});

// The shape of the transpiled output. Helper names carry a hash suffix and
// generated bindings a `$N` counter, so the checks match on prefixes.
describe("ES decorators lowering output", () => {
  const js = new Bun.Transpiler({ loader: "js", target: "bun" });
  const ts = (compilerOptions: Record<string, unknown> = {}) =>
    new Bun.Transpiler({ loader: "ts", target: "bun", tsconfig: { compilerOptions } });
  // The statements of the first constructor, trimmed, one per entry.
  const ctorBody = (out: string) =>
    /constructor\([^)]*\) \{\n([\s\S]*?)\n  \}/
      .exec(out)![1]
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);
  // Everything after the class body, trimmed, one statement per entry.
  const suffix = (out: string) =>
    out
      .slice(out.lastIndexOf("\n}\n") + 3)
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean);

  test("a class without decorators or accessors is untouched", () => {
    const code = `class A {\n  x = 1;\n  static y = 2;\n  #p = 3;\n  static {\n    z();\n  }\n}\n`;
    expect(js.transformSync(code)).toBe(code);
  });

  test("every field moves once one is decorated, with [[Define]] semantics", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec a = 1; b = 2; static c = 3; @dec static d = 4; }`,
    );
    expect(ctorBody(out)).toEqual([
      expect.stringMatching(/^__publicField\w*\(this, "a", __runInitializers\w*\(_init\$\d+, 12, this, 1\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 15, this\);$/),
      expect.stringMatching(/^__publicField\w*\(this, "b", 2\);$/),
    ]);
    // Decorate calls: static fields before instance fields. Then the static
    // fields in source order, then the metadata.
    expect(suffix(out)).toEqual([
      expect.stringMatching(/^__decorateElement\w*\(_init\$\d+, 13, "d", _dec2\$\d+, A\);$/),
      expect.stringMatching(/^__decorateElement\w*\(_init\$\d+, 5, "a", _dec\$\d+, A\);$/),
      expect.stringMatching(/^__publicField\w*\(A, "c", 3\);$/),
      expect.stringMatching(/^__publicField\w*\(A, "d", __runInitializers\w*\(_init\$\d+, 8, A, 4\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, A\);$/),
      expect.stringMatching(/^__decoratorMetadata\w*\(_init\$\d+, A\);$/),
    ]);
    expect(out).not.toContain("static c");
  });

  test("useDefineForClassFields: false assigns and drops fields without an initializer", () => {
    const out = ts({ useDefineForClassFields: false }).transformSync(
      `const dec = () => {}; class A { @dec a = 1; b = 2; bar; static c = 3; static t; }`,
    );
    expect(ctorBody(out)).toEqual([
      expect.stringMatching(/^this\.a = __runInitializers\w*\(_init\$\d+, 8, this, 1\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, this\);$/),
      "this.b = 2;",
    ]);
    expect(suffix(out)).toEqual([
      expect.stringMatching(/^__decorateElement\w*/),
      "A.c = 3;",
      expect.stringMatching(/^__decoratorMetadata\w*/),
    ]);
    expect(out).not.toContain("bar");
    expect(out).not.toMatch(/\bt\b/);
  });

  test("computed keys are hoisted once, in source order, literals are copied", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { [k1()]() {} @dec [k2()] = 1; static [k3()] = 2; [k4()] = 3; ["lit"] = 4; [0] = 5; }`,
    );
    expect(out).toMatch(
      /var _computedKey\$\d+ = k1\(\), _dec\$\d+ = \[\n  dec\n\], _computedKey2\$\d+ = k2\(\), _computedKey3\$\d+ = k3\(\), _computedKey4\$\d+ = k4\(\), _init\$\d+ = /,
    );
    expect(ctorBody(out)).toEqual([
      expect.stringMatching(
        /^__publicField\w*\(this, _computedKey2\$\d+, __runInitializers\w*\(_init\$\d+, 8, this, 1\)\);$/,
      ),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, this\);$/),
      expect.stringMatching(/^__publicField\w*\(this, _computedKey4\$\d+, 3\);$/),
      expect.stringMatching(/^__publicField\w*\(this, "lit", 4\);$/),
      expect.stringMatching(/^__publicField\w*\(this, 0, 5\);$/),
    ]);
    expect(out).toMatch(/\[_computedKey\$\d+\]\(\) \{\}/);
    expect(out).toMatch(/__publicField\w*\(A, _computedKey3\$\d+, 2\);/);
    expect(out.match(/k[1-4]\(\)/g)).toEqual(["k1()", "k2()", "k3()", "k4()"]);
  });

  test("a class with only a class decorator keeps its members in the body", () => {
    const out = js.transformSync(`const dec = () => {}; @dec class A { a = 1; static b = 2; static { c() } #p = 3; }`);
    expect(out).toContain("  a = 1;\n  static b = 2;\n  static {\n    c();\n  }\n  #p = 3;\n}");
    expect(suffix(out)).toEqual([
      expect.stringMatching(/^A = __decorateElement\w*\(_init\$\d+, 0, "A", _dec\$\d+, A\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 1, A\);$/),
    ]);
    expect(out).not.toContain("__decoratorMetadata");
    expect(out).not.toContain("__publicField");
    expect(out).not.toContain("WeakMap");
  });

  test("a class with only accessors gets storage but no decorator context", () => {
    const out = js.transformSync(`class A { accessor a = 1; b = 2; static accessor c = 3; }`);
    expect(out).not.toContain("__decoratorStart");
    expect(out).not.toContain("__decoratorMetadata");
    expect(ctorBody(out)).toEqual([
      expect.stringMatching(/^__privateAdd\w*\(this, _a\$\d+, 1\);$/),
      expect.stringMatching(/^__publicField\w*\(this, "b", 2\);$/),
    ]);
    expect(suffix(out)).toEqual([expect.stringMatching(/^__privateAdd\w*\(A, _c\$\d+, 3\);$/)]);
    expect(out).toMatch(/get a\(\) \{\n    return __privateGet\w*\(this, _a\$\d+\);/);
    expect(out).toMatch(/static set c\(v\) \{\n    __privateSet\w*\(this, _c\$\d+, v\);/);
  });

  test("two decorated classes get distinct temporaries", () => {
    const out = js.transformSync(`const dec = () => {}; class A { @dec m() {} } class B { @dec m() {} }`);
    const inits = [...new Set(out.match(/_init\$\d+/g))];
    const decs = [...new Set(out.match(/_dec\$\d+/g))];
    expect(inits).toHaveLength(2);
    expect(decs).toHaveLength(2);
    expect(out).toMatch(
      new RegExp(
        `class A \\{\\n  constructor\\(\\) \\{\\n    __runInitializers\\w*\\(${inits[0].replace("$", "\\$")}, 5, this\\);`,
      ),
    );
    expect(out).toMatch(
      new RegExp(
        `class B \\{\\n  constructor\\(\\) \\{\\n    __runInitializers\\w*\\(${inits[1].replace("$", "\\$")}, 5, this\\);`,
      ),
    );
  });

  test("`this` in relocated static code is the class", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec static a = this; static b = () => this; static { this.c = 1 } }`,
    );
    expect(suffix(out)).toEqual([
      expect.stringMatching(/^__decorateElement\w*\(_init\$\d+, 13, "a", _dec\$\d+, A\);$/),
      expect.stringMatching(/^__publicField\w*\(A, "a", __runInitializers\w*\(_init\$\d+, 8, A, A\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, A\);$/),
      expect.stringMatching(/^__publicField\w*\(A, "b", \(\) => A\);$/),
      "A.c = 1;",
      expect.stringMatching(/^__decoratorMetadata\w*\(_init\$\d+, A\);$/),
    ]);
    expect(out).not.toContain("this");
  });

  test("`super` in relocated static code goes through the runtime helpers", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A extends B { @dec m() {} static s = super.x; static t = super.y(1); static u = (super.z = 2); static o = super.q?.(); static g = super.tag\`x\`; static { [super.a, ...super.r] = v; for (super.i of v) {} } }`,
    );
    expect(out).toMatch(/__publicField\w*\(A, "s", __superGet\w*\(A, A, "x"\)\);/);
    expect(out).toMatch(/__publicField\w*\(A, "t", __superGet\w*\(A, A, "y"\)\.call\(A, 1\)\);/);
    expect(out).toMatch(/__publicField\w*\(A, "u", __superSet\w*\(A, A, "z", 2\)\);/);
    // An optional call checks the looked-up method, not `.call`.
    expect(out).toMatch(
      /__publicField\w*\(A, "o", \((__bun_temp_ref_\w+\$) = __superGet\w*\(A, A, "q"\)\) == null \? void 0 : \1\.call\(A\)\);/,
    );
    // A tagged template keeps the class as the receiver.
    expect(out).toMatch(/__publicField\w*\(A, "g", __superGet\w*\(A, A, "tag"\)\.bind\(A\)`x`\);/);
    // Destructuring and loop targets go through a wrapper.
    expect(out).toMatch(/\[__superWrapper\w*\(A, A, "a"\)\._, \.\.\.__superWrapper\w*\(A, A, "r"\)\._\] = v;/);
    expect(out).toMatch(/for \(__superWrapper\w*\(A, A, "i"\)\._ of v\)/);
    expect(out).not.toContain("super.");
    expect(out).not.toContain("Reflect");
    // The base class is captured once and the class extends the capture.
    expect(out).toMatch(/var _base\$\d+ = B,/);
    expect(out).toMatch(/class A extends _base\$\d+ \{/);
    expect(out).toMatch(/__decoratorStart\w*\(_base\$\d+\)/);
  });

  test("updates and compound assignments on lowered private members", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec m() {} #x = 1; inc() { return this.#x++ } pre() { return ++this.#x } add(v) { this.#x += v } nul(v) { this.#x ??= v } }`,
    );
    expect(out).toMatch(
      /return __privateSet\w*\(this, _x\$\d+, \((__bun_temp_ref_\w+\$) = __privateGet\w*\(this, _x\$\d+\), (__bun_temp_ref_\w+\$) = \1\+\+, \1\)\), \2;/,
    );
    expect(out).toMatch(
      /return __privateSet\w*\(this, _x\$\d+, \((__bun_temp_ref_\w+\$) = __privateGet\w*\(this, _x\$\d+\), \+\+\1\)\);/,
    );
    expect(out).toMatch(/__privateSet\w*\(this, _x\$\d+, __privateGet\w*\(this, _x\$\d+\) \+ v\);/);
    expect(out).toMatch(/__privateGet\w*\(this, _x\$\d+\) \?\? __privateSet\w*\(this, _x\$\d+, v\);/);
    // Temporaries are declared in the method that uses them.
    expect(out).toMatch(/inc\(\) \{\n    var __bun_temp_ref_\w+\$, __bun_temp_ref_\w+\$;/);
  });

  test("`super` in extracted private methods uses the class or its prototype as home", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A extends B { @dec m() {} #pm() { return super.greet(); } static #spm() { return super.sm(); } }`,
    );
    expect(out).toMatch(
      /_pm_fn\$\d+ = function\(\) \{\n  return __superGet\w*\(A\.prototype, this, "greet"\)\.call\(this\);\n\};/,
    );
    expect(out).toMatch(/_spm_fn\$\d+ = function\(\) \{\n  return __superGet\w*\(A, A, "sm"\)\.call\(A\);\n\};/);
    expect(out).not.toContain("super.");
  });

  test("lowered private members as template tags and destructuring targets", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec m() {} #x = 1; #pm() {} get #g() { return 1 } set #g(v) {} sw() { [this.#x, { k: this.#g = 2 }] = v; for (this.#x of v) {} } tg() { return this.#pm\`t\` } }`,
    );
    expect(out).toMatch(
      /\[__privateWrapper\w*\(this, _x\$\d+\)\._, \{ k: __privateWrapper\w*\(this, _g\$\d+, _g_set\$\d+, _g_get\$\d+\)\._ = 2 \}\] = v;/,
    );
    expect(out).toMatch(/for \(__privateWrapper\w*\(this, _x\$\d+\)\._ of v\)/);
    expect(out).toMatch(/return __privateMethod\w*\(this, _pm\$\d+, _pm_fn\$\d+\)\.bind\(this\)`t`;/);
  });

  test("private methods: brands are added before the method extra initializers", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec m() {} #a() {} get #b() { return 1 } static #c() {} call() { return [this.#a(), this.#b, A.#c()] } }`,
    );
    expect(ctorBody(out)).toEqual([
      expect.stringMatching(/^__privateAdd\w*\(this, _a\$\d+\);$/),
      expect.stringMatching(/^__privateAdd\w*\(this, _b\$\d+\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 5, this\);$/),
    ]);
    expect(out).toMatch(/_a\$\d+ = new WeakSet, _a_fn\$\d+;\n_a_fn\$\d+ = function\(\) \{\};/);
    expect(out).toMatch(/__privateMethod\w*\(this, _a\$\d+, _a_fn\$\d+\)\.call\(this\)/);
    expect(out).toMatch(/__privateGet\w*\(this, _b\$\d+, _b_get\$\d+\)/);
    expect(out).toMatch(/__privateMethod\w*\(A, _c\$\d+, _c_fn\$\d+\)\.call\(A\)/);
    // The static brand is added after the decorate calls, before the metadata.
    expect(suffix(out)).toEqual([
      expect.stringMatching(/^__decorateElement\w*/),
      expect.stringMatching(/^__privateAdd\w*\(A, _c\$\d+\);$/),
      expect.stringMatching(/^__decoratorMetadata\w*/),
    ]);
  });

  test("decorated private members use their storage as the decorate target", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec #a = 1; @dec #m() {} @dec accessor #acc = 2; @dec static #s = 3; get() { return [this.#a, this.#m(), this.#acc, A.#s] } }`,
    );
    expect(suffix(out)).toEqual([
      expect.stringMatching(
        /^_m_fn\$\d+ = __decorateElement\w*\(_init\$\d+, 17, "#m", _dec2\$\d+, _m\$\d+, function\(\) \{\}\);$/,
      ),
      expect.stringMatching(
        /^_acc_acc\$\d+ = __decorateElement\w*\(_init\$\d+, 20, "#acc", _dec3\$\d+, _acc\$\d+, _acc\$\d+\);$/,
      ),
      expect.stringMatching(/^__decorateElement\w*\(_init\$\d+, 29, "#s", _dec4\$\d+, _s\$\d+\);$/),
      expect.stringMatching(/^__decorateElement\w*\(_init\$\d+, 21, "#a", _dec\$\d+, _a\$\d+\);$/),
      expect.stringMatching(/^__privateAdd\w*\(A, _s\$\d+, __runInitializers\w*\(_init\$\d+, 12, A, 3\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 15, A\);$/),
      expect.stringMatching(/^__decoratorMetadata\w*\(_init\$\d+, A\);$/),
    ]);
    expect(out).toMatch(/__privateGet\w*\(this, _acc\$\d+, _acc_acc\$\d+\.get\)/);
    expect(ctorBody(out)).toEqual([
      expect.stringMatching(/^__privateAdd\w*\(this, _m\$\d+\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 5, this\);$/),
      expect.stringMatching(/^__privateAdd\w*\(this, _a\$\d+, __runInitializers\w*\(_init\$\d+, 16, this, 1\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 19, this\);$/),
      expect.stringMatching(/^__privateAdd\w*\(this, _acc\$\d+, __runInitializers\w*\(_init\$\d+, 8, this, 2\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, this\);$/),
    ]);
  });

  test("TypeScript parameter properties keep their declaration and run before lowered fields assign", () => {
    const define = ts().transformSync(
      `const dec = () => {}; class A { constructor(public x: number) {} @dec y = 1; z = 2; }`,
    );
    expect(define).toContain("class A {\n  x;\n  constructor(x) {");
    expect(ctorBody(define)).toEqual([
      expect.stringMatching(/^__publicField\w*\(this, "y", __runInitializers\w*\(_init\$\d+, 8, this, 1\)\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, this\);$/),
      expect.stringMatching(/^__publicField\w*\(this, "z", 2\);$/),
      "this.x = x;",
    ]);

    const assign = ts({ useDefineForClassFields: false }).transformSync(
      `const dec = () => {}; class A { constructor(public x: number) { log() } @dec y = this.x; z = 2; }`,
    );
    expect(assign).not.toContain("  x;\n");
    expect(ctorBody(assign)).toEqual([
      "this.x = x;",
      expect.stringMatching(/^this\.y = __runInitializers\w*\(_init\$\d+, 8, this, this\.x\);$/),
      expect.stringMatching(/^__runInitializers\w*\(_init\$\d+, 11, this\);$/),
      "this.z = 2;",
      "log();",
    ]);
  });

  test("a named class expression references its temporary from relocated code", () => {
    const out = js.transformSync(
      `const dec = () => {}; const E = class Named { @dec m() {} static s = Named; y = Named; static { Named.t = this } };`,
    );
    expect(out).toMatch(/^var _class\$\d+, _init\$\d+, _dec\$\d+;\n/m);
    expect(out).toMatch(
      /_class\$\d+ = class Named \{\n  constructor\(\) \{\n    __runInitializers\w*\(_init\$\d+, 5, this\);\n    __publicField\w*\(this, "y", Named\);\n  \}/,
    );
    expect(out).toMatch(
      /__publicField\w*\(_class\$\d+, "s", _class\$\d+\), _class\$\d+\.t = _class\$\d+, __decoratorMetadata\w*\(_init\$\d+, _class\$\d+\), _class\$\d+\);/,
    );
  });

  test("static blocks with declarations become an arrow IIFE", () => {
    const out = js.transformSync(
      `const dec = () => {}; class A { @dec m() {} static { const v = 1; A.v = v; } static { f(); g(); } }`,
    );
    expect(suffix(out)).toEqual([
      expect.stringMatching(/^__decorateElement\w*/),
      "(() => {",
      "const v = 1;",
      "A.v = v;",
      "})();",
      "f();",
      "g();",
      expect.stringMatching(/^__decoratorMetadata\w*/),
    ]);
  });
});

describe("ES decorators in invalid positions", () => {
  test.concurrent("a decorated static block is a syntax error", async () => {
    const { stdout, stderr, exitCode } = await runInline(`
      const x = () => {};
      class X { @x static {} }
      console.log("loaded");
    `);
    expect(stdout).toBe("");
    expect(stderr).toContain('Expected ";" but found "{"');
    expect(exitCode).toBe(1);
  });

  test.concurrent("a parameter decorator in JavaScript is a syntax error", async () => {
    // `-e` parses as TypeScript and reports the TypeScript message; this is the JavaScript one.
    using dir = tempDir("es-dec-param-js", {
      "test.js": `
        const y = () => {};
        class Y { m(@y z) {} }
        console.log("loaded");
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.js"]);
    expect(stdout).toBe("");
    expect(stderr).toContain("Parameter decorators are not allowed in JavaScript");
    expect(exitCode).toBe(1);
  });

  test("Bun.Transpiler rejects misplaced decorators", () => {
    // `transformSync` throws the single BuildMessage, or an AggregateError of them.
    const parseErrors = (transpiler: Bun.Transpiler, code: string) => {
      try {
        transpiler.transformSync(code);
      } catch (e: any) {
        return e.errors ? (e.errors as { message: string }[]).map(m => m.message) : [e.message];
      }
      return [];
    };

    const js = new Bun.Transpiler({ loader: "js" });
    expect(parseErrors(js, `class X { @x static {} }`)).toContain('Expected ";" but found "{"');
    expect(parseErrors(js, `class Y { m(@y z) {} }`)).toEqual(["Parameter decorators are not allowed in JavaScript"]);

    const ts = new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions: {} } });
    expect(parseErrors(ts, `class Y { m(@y z: number) {} }`)).toEqual([
      "Parameter decorators only work when experimental decorators are enabled",
    ]);

    // Still accepted: parameter decorators with experimental decorators.
    const legacy = new Bun.Transpiler({
      loader: "ts",
      tsconfig: { compilerOptions: { experimentalDecorators: true } },
    });
    expect(legacy.transformSync(`class Y { m(@y z: number) {} }`)).toContain("__legacyDecorateParamTS");
  });
});

describe("ES decorators in CommonJS modules", () => {
  test.concurrent(".cjs", async () => {
    using dir = tempDir("es-dec-cjs", {
      "dcjs.cjs": `
        class A { @((v, c) => {}) x = 1 }
        new A; console.log(typeof module.exports, new A().x);
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["dcjs.cjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("object 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent(".cts", async () => {
    using dir = tempDir("es-dec-cts", {
      "d.cts": `
        const dec = (v: any, ctx: any) => { ctx.addInitializer(function (this: any) { console.log("init", ctx.name) }) };
        class A { @dec x = 1; @dec m() {} }
        new A();
        module.exports = { A };
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["d.cts"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("init m\ninit x\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent(".js that uses module.exports", async () => {
    using dir = tempDir("es-dec-sloppy", {
      "sloppy.js": `
        const dec = (v, ctx) => {};
        class A { @dec x = 1 }
        module.exports = { A, x: new A().x };
        console.log(typeof module.exports.A, module.exports.x);
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["sloppy.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("function 1\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("require() of a decorated .cjs from an ES module", async () => {
    using dir = tempDir("es-dec-require", {
      "lib.cjs": `
        const dec = (v, ctx) => { ctx.addInitializer(function () { this.tag = "init:" + ctx.name; }); };
        class A { @dec m() {} }
        module.exports = { A };
      `,
      "entry.mjs": `
        import { createRequire } from "node:module";
        const { A } = createRequire(import.meta.url)("./lib.cjs");
        console.log(new A().tag);
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["entry.mjs"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("init:m\n");
    expect(exitCode).toBe(0);
  });
});
