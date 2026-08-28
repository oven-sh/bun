import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Lowering of TC39 standard decorators. Once any member of a class is
// decorated, every field of that class leaves the class body (instance fields
// move into the constructor, static fields and static blocks move after the
// class), in source order and with [[Define]] semantics, and every private
// member is lowered so the moved code can still reach it. This mirrors
// esbuild's `lowerClass`.
//
// One fixture holds the whole matrix and prints one JSON object. It runs as
// .js / .ts / .cjs / .cts, with `useDefineForClassFields` on and off, and both
// directly and through `bun build`.

function filterStderr(stderr: string) {
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

async function run(cwd: string, args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
  });
  const [stdout, rawStderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr: filterStderr(rawStderr), exitCode };
}

const kinds = ["field", "method", "getter", "setter", "accessor"] as const;
const placements = ["instance", "static"] as const;
const visibilities = ["public", "private"] as const;
type Kind = (typeof kinds)[number];
type Placement = (typeof placements)[number];
type Visibility = (typeof visibilities)[number];

function matrixName(kind: Kind, placement: Placement, visibility: Visibility) {
  return `${kind}/${placement}/${visibility}`;
}

// One class per cell: the decorated member `x` sits between undecorated
// instance fields, private fields, static fields and a static block.
function matrixClass(kind: Kind, placement: Placement, visibility: Visibility) {
  const s = placement === "static" ? "static " : "";
  const name = visibility === "private" ? "#x" : "x";
  const self = placement === "static" ? "C" : "this";
  let member: string;
  let reader: string;
  switch (kind) {
    case "field":
      member = `@dec ${s}${name} = L("x");`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "accessor":
      member = `@dec ${s}accessor ${name} = L("x");`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "method":
      member = `@dec ${s}${name}() { return "x"; }`;
      reader = `${s}read() { return ${self}.${name}(); }`;
      break;
    case "getter":
      member = `@dec ${s}get ${name}() { return "x"; }`;
      reader = `${s}read() { return ${self}.${name}; }`;
      break;
    case "setter":
      member = `@dec ${s}set ${name}(v) { side = v; }`;
      reader = `${s}read() { ${self}.${name} = "x"; return side; }`;
      break;
  }
  const id = JSON.stringify(matrixName(kind, placement, visibility));
  return `
{
  let side;
  log.length = 0;
  class C {
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
  const ctorLog = log.slice();
  out[${id}] = {
    defLog,
    ctorLog,
    value: ${placement === "static" ? "C.read()" : "inst.read()"},
    iPriv: inst.iPriv,
    sPriv: C.sPriv,
    callM: inst.callM(),
    has: inst.has(),
    ctx: decCtx,
  };
}`;
}

function matrixExpected(kind: Kind, placement: Placement, visibility: Visibility) {
  const name = visibility === "private" ? "#x" : "x";
  const isFieldLike = kind === "field" || kind === "accessor";
  const defLog = [`dec:${name}`, "sBefore", "sBlock"];
  if (isFieldLike && placement === "static") defLog.push("x");
  defLog.push("sAfter", "#sp", "sPriv");
  const ctorLog = ["iBefore", "#p", "iPriv"];
  if (isFieldLike && placement === "instance") ctorLog.push("x");
  ctorLog.push("iAfter");
  return {
    defLog,
    ctorLog,
    value: "x",
    iPriv: "#p",
    sPriv: "#sp",
    callM: "m",
    has: true,
    ctx: { kind, name, static: placement === "static", private: visibility === "private" },
  };
}

const fixturePrelude = `
const log = [];
const L = (name) => (log.push(name), name);
let decCtx;
const dec = (value, ctx) => {
  log.push("dec:" + String(ctx.name));
  decCtx = { kind: ctx.kind, name: ctx.name, static: ctx.static, private: ctx.private };
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
  for (const kind of kinds) {
    for (const placement of placements) {
      for (const visibility of visibilities) {
        src += matrixClass(kind, placement, visibility);
      }
    }
  }
  src += installSection;
  src += extraSections;
  src += `\nPromise.all(pending).then(() => console.log(JSON.stringify(out)));\n`;
  if (cjs) src += `module.exports = out;\n`;
  return src;
}

function buildExpected(assign: boolean) {
  const expected: Record<string, unknown> = {};
  for (const kind of kinds) {
    for (const placement of placements) {
      for (const visibility of visibilities) {
        expected[matrixName(kind, placement, visibility)] = matrixExpected(kind, placement, visibility);
      }
    }
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

describe("ES decorators lowering matrix", () => {
  for (const mode of modes) {
    test.concurrent(mode.name, async () => {
      using dir = tempDir("es-dec-matrix", {
        [mode.file]: buildFixture(mode.cjs),
        "tsconfig.json": JSON.stringify({ compilerOptions: mode.useDefine ? {} : { useDefineForClassFields: false } }),
      });
      const cwd = String(dir);
      let entry = mode.file;
      if (mode.bundle) {
        const build = await run(cwd, ["build", mode.file, "--target=bun", "--outfile=bundled.js"]);
        expect(build.stderr).toBe("");
        expect(build.exitCode).toBe(0);
        entry = "bundled.js";
      }
      const { stdout, stderr, exitCode } = await run(cwd, [entry]);
      expect(stderr).toBe("");
      // JSON turns `undefined` into `null` inside arrays.
      expect(JSON.parse(stdout)).toEqual(buildExpected(!mode.useDefine));
      expect(exitCode).toBe(0);
    });
  }
});

describe("ES decorators lowering", () => {
  test.concurrent("undecorated fields initialize in source order next to decorated fields", async () => {
    using dir = tempDir("es-dec-order", {
      "test.js": `
        const dec = (v, ctx) => {}; const log = (s) => (console.log("init", s), s);
        class Foo { @dec a = log("a"); b = log(this.a === "a" ? "b (a set)" : "b (a NOT set)"); @dec c = log("c"); }
        new Foo();
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("init a\ninit b (a set)\ninit c\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("decorated fields are defined, not assigned", async () => {
    using dir = tempDir("es-dec-define", {
      "test.js": `
        const dec = (v, ctx) => {};
        class Base { set a(v) { console.log("BASE SETTER", v) } }
        class Bar extends Base { @dec a = 1 }
        console.log(JSON.stringify(Object.getOwnPropertyDescriptor(new Bar(), "a")));
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe('{"value":1,"writable":true,"enumerable":true,"configurable":true}\n');
    expect(exitCode).toBe(0);
  });

  test.concurrent("static fields and static blocks keep their order next to decorated members", async () => {
    using dir = tempDir("es-dec-static-order", {
      "test.js": `
        const dec = (v, ctx) => {};
        class S { @dec static x = console.log(1); static { console.log(2) } static y = console.log(3) }
        class T { static { console.log(1) } static x = console.log(2); @dec m() {} }
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.js"]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1\n2\n3\n1\n2\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("private names in undecorated field initializers are lowered with the rest", async () => {
    using dir = tempDir("es-dec-private-siblings", {
      "test.js": `
        function d(t, k) {}
        class D { static #p = 5; static a = D.#p; static b = this.#p; #q = 6; d = this.#q; e() { return D.#p + this.#q } @d m() {} }
        console.log(D.a, D.b, new D().d, new D().e());
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.js"]);
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

describe("ES decorators in invalid positions", () => {
  test.concurrent("a decorated static block is a syntax error", async () => {
    using dir = tempDir("es-dec-static-block", {
      "test.js": `
        const x = () => {};
        class X { @x static {} }
        console.log("loaded");
      `,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["test.js"]);
    expect(stdout).toBe("");
    expect(stderr).toContain('Expected ";" but found "{"');
    expect(exitCode).toBe(1);
  });

  test.concurrent("a parameter decorator in JavaScript is a syntax error", async () => {
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
