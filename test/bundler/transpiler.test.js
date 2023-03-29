import { expect, it, describe } from "bun:test";

describe("Bun.Transpiler", () => {
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      user_undefined: "undefined",
    },
    macro: {
      react: {
        bacon: `${import.meta.dir}/macro-check.js`,
      },
    },
    platform: "browser",
  });

  const ts = {
    parsed: (code, trim = true, autoExport = false) => {
      if (autoExport) {
        code = "export default (" + code + ")";
      }

      var out = transpiler.transformSync(code, "ts");
      if (autoExport && out.startsWith("export default ")) {
        out = out.substring("export default ".length);
      }

      if (trim) {
        out = out.trim();

        if (out.endsWith(";")) {
          out = out.substring(0, out.length - 1);
        }

        return out.trim();
      }

      return out;
    },

    expectPrinted: (code, out) => {
      expect(ts.parsed(code, true, true)).toBe(out);
    },

    expectPrinted_: (code, out) => {
      expect(ts.parsed(code, !out.endsWith(";\n"), false)).toBe(out);
    },

    expectParseError: (code, message) => {
      try {
        ts.parsed(code, false, false);
      } catch (er) {
        var err = er;
        if (er instanceof AggregateError) {
          err = err.errors[0];
        }

        expect(er.message).toBe(message);

        return;
      }

      throw new Error("Expected parse error for code\n\t" + code);
    },
  };

  it("normalizes \\r\\n", () => {
    ts.expectPrinted_("console.log(`\r\n\r\n\r\n`)", "console.log(`\n\n\n`);\n");
  });

  describe("TypeScript", () => {
    it("import Foo = Baz.Bar", () => {
      ts.expectPrinted_("import Foo = Baz.Bar;\nexport default Foo;", "const Foo = Baz.Bar;\nexport default Foo");
    });

    it("modifiers", () => {
      const exp = ts.expectPrinted_;

      exp("class Foo { public foo: number }", "class Foo {\n  foo;\n}");
      exp("class Foo { private foo: number }", "class Foo {\n  foo;\n}");
      exp("class Foo { protected foo: number }", "class Foo {\n  foo;\n}");
      exp("class Foo { declare foo: number }", "class Foo {\n}");
      exp("class Foo { declare public foo: number }", "class Foo {\n}");
      exp("class Foo { public declare foo: number }", "class Foo {\n}");
      exp("class Foo { override foo: number }", "class Foo {\n  foo;\n}");
      exp("class Foo { override public foo: number }", "class Foo {\n  foo;\n}");
      exp("class Foo { public override foo: number }", "class Foo {\n  foo;\n}");
      exp("class Foo { declare override public foo: number }", "class Foo {\n}");
      exp("class Foo { declare foo = 123 }", "class Foo {\n}");

      exp("class Foo { public static foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { private static foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { protected static foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { declare static foo: number }", "class Foo {\n}");
      exp("class Foo { declare public static foo: number }", "class Foo {\n}");
      exp("class Foo { public declare static foo: number }", "class Foo {\n}");
      exp("class Foo { public static declare foo: number }", "class Foo {\n}");
      exp("class Foo { override static foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { override public static foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { public override static foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { public static override foo: number }", "class Foo {\n  static foo;\n}");
      exp("class Foo { declare override public static foo: number }", "class Foo {\n}");
      exp("class Foo { declare static foo = 123 }", "class Foo {\n}");
      exp("class Foo { static declare foo = 123 }", "class Foo {\n}");

      exp("let x: abstract new () => void = Foo", "let x = Foo");
      exp("let x: abstract new <T>() => Foo<T>", "let x");
    });

    it("types", () => {
      const exp = ts.expectPrinted_;
      exp("x as 1 < 1", "x < 1");
      exp("x as 1n < 1", "x < 1");
      exp("x as -1 < 1", "x < 1");
      exp("x as -1n < 1", "x < 1");
      exp("x as '' < 1", "x < 1");
      exp("x as `` < 1", "x < 1");
      exp("x as any < 1", "x < 1");
      exp("x as bigint < 1", "x < 1");
      exp("x as false < 1", "x < 1");
      exp("x as never < 1", "x < 1");
      exp("x as null < 1", "x < 1");
      exp("x as number < 1", "x < 1");
      exp("x as object < 1", "x < 1");
      exp("x as string < 1", "x < 1");
      exp("x as symbol < 1", "x < 1");
      exp("x as this < 1", "x < 1");
      exp("x as true < 1", "x < 1");
      exp("x as undefined < 1", "x < 1");
      exp("x as unique symbol < 1", "x < 1");
      exp("x as unknown < 1", "x < 1");
      exp("x as void < 1", "x < 1");
    });

    it("class constructor", () => {
      const fixtures = [
        [
          `class Test {
            b: string;
          
            constructor(private a: string) {
              this.b = a;
            }
          }`,

          `
class Test {
  a;
  b;
  constructor(a) {
    this.a = a;
    this.b = a;
  }
}
                  `.trim(),
        ],
        [
          `class Test extends Bar {
            b: string;
          
            constructor(private a: string) {
              super();
              this.b = a;
            }
          }`,

          `
class Test extends Bar {
  a;
  b;
  constructor(a) {
    super();
    this.a = a;
    this.b = a;
  }
}
                  `.trim(),
        ],
      ];

      for (const [code, out] of fixtures) {
        expect(ts.parsed(code, false, false).trim()).toBe(out);
        expect(
          ts
            .parsed("var Test = " + code.trim(), false, false)
            .trim()
            .replaceAll("\n", "")
            .replaceAll("  ", ""),
        ).toBe(("var Test = " + out.trim() + ";\n").replaceAll("\n", "").replaceAll("  ", ""));
      }
    });

    it("import Foo = require('bar')", () => {
      ts.expectPrinted_("import React = require('react')", 'const React = require("react")');
    });

    it("import type Foo = require('bar')", () => {
      ts.expectPrinted_("import type Foo = require('bar')", "");
    });

    it("unused import = gets removed", () => {
      ts.expectPrinted_("import Foo = Baz.Bar;", "");
    });

    it("export import Foo = Baz.Bar", () => {
      ts.expectPrinted_("export import Foo = Baz.Bar;", "export const Foo = Baz.Bar");
    });

    it("export = {foo: 123}", () => {
      ts.expectPrinted_("export = {foo: 123}", "module.exports = { foo: 123 }");
    });

    it("export default class implements TypeScript regression", () => {
      expect(
        transpiler
          .transformSync(
            `
      export default class implements ITest {
        async* runTest(path: string): AsyncGenerator<number> {
          yield Math.random();
        }
      }
      `,
            "ts",
          )
          .trim(),
      ).toBe(
        `
export default class {
  async* runTest(path) {
    yield Math.random();
  }
}
      `.trim(),
      );
    });

    it("satisfies", () => {
      ts.expectPrinted_("const t1 = { a: 1 } satisfies I1;", "const t1 = { a: 1 };\n");
      ts.expectPrinted_("const t2 = { a: 1, b: 1 } satisfies I1;", "const t2 = { a: 1, b: 1 };\n");
      ts.expectPrinted_("const t3 = { } satisfies I1;", "const t3 = {};\n");
      ts.expectPrinted_("const t4: T1 = { a: 'a' } satisfies T1;", 'const t4 = { a: "a" };\n');
      ts.expectPrinted_("const t5 = (m => m.substring(0)) satisfies T2;", "const t5 = (m) => m.substring(0);\n");
      ts.expectPrinted_("const t6 = [1, 2] satisfies [number, number];", "const t6 = [1, 2];\n");
      ts.expectPrinted_("let t7 = { a: 'test' } satisfies A;", 'let t7 = { a: "test" };\n');
      ts.expectPrinted_("let t8 = { a: 'test', b: 'test' } satisfies A;", 'let t8 = { a: "test", b: "test" };\n');
      ts.expectPrinted_("export default {} satisfies Foo;", "export default {};\n");
      ts.expectPrinted_("export default { a: 1 } satisfies Foo;", "export default { a: 1 };\n");
      ts.expectPrinted_(
        "const p = { isEven: n => n % 2 === 0, isOdd: n => n % 2 === 1 } satisfies Predicates;",
        "const p = { isEven: (n) => n % 2 === 0, isOdd: (n) => n % 2 === 1 };\n",
      );
      ts.expectPrinted_(
        "let obj: { f(s: string): void } & Record<string, unknown> = { f(s) { }, g(s) { } } satisfies { g(s: string): void } & Record<string, unknown>;",
        "let obj = { f(s) {\n}, g(s) {\n} };\n",
      );
      ts.expectPrinted_(
        "const car = { start() { }, move(d) { }, stop() { } } satisfies Movable & Record<string, unknown>;",
        "const car = { start() {\n}, move(d) {\n}, stop() {\n} };\n",
      );
      ts.expectPrinted_("var v = undefined satisfies 1;", "var v = undefined;\n");
      ts.expectPrinted_("const a = { x: 10 } satisfies Partial<Point2d>;", "const a = { x: 10 };\n");
      ts.expectPrinted_(
        'const p = { a: 0, b: "hello", x: 8 } satisfies Partial<Record<Keys, unknown>>;',
        'const p = { a: 0, b: "hello", x: 8 };\n',
      );
      ts.expectPrinted_(
        'const p = { a: 0, b: "hello", x: 8 } satisfies Record<Keys, unknown>;',
        'const p = { a: 0, b: "hello", x: 8 };\n',
      );
      ts.expectPrinted_('const x2 = { m: true, s: "false" } satisfies Facts;', 'const x2 = { m: true, s: "false" };\n');
      ts.expectPrinted_(
        "export const Palette = { white: { r: 255, g: 255, b: 255 }, black: { r: 0, g: 0, d: 0 }, blue: { r: 0, g: 0, b: 255 }, } satisfies Record<string, Color>;",
        "export const Palette = { white: { r: 255, g: 255, b: 255 }, black: { r: 0, g: 0, d: 0 }, blue: { r: 0, g: 0, b: 255 } };\n",
      );
      ts.expectPrinted_('const a: "baz" = "foo" satisfies "foo" | "bar";', 'const a = "foo";\n');
      ts.expectPrinted_(
        'const b: { xyz: "baz" } = { xyz: "foo" } satisfies { xyz: "foo" | "bar" };',
        'const b = { xyz: "foo" };\n',
      );
    });
  });

  describe("generated closures", () => {
    const input1 = `namespace test {
  export enum x { y }
}`;
    const output1 = `var test;
(function(test) {
  let x;
  (function(x) {
    x[x["y"] = 0] = "y";
  })(x = test.x || (test.x = {}));
})(test || (test = {}))`;

    it("namespace with exported enum", () => {
      ts.expectPrinted_(input1, output1);
    });

    const input2 = `export namespace test {
  export enum x { y }
}`;
    const output2 = `export var test;
(function(test) {
  let x;
  (function(x) {
    x[x["y"] = 0] = "y";
  })(x = test.x || (test.x = {}));
})(test || (test = {}))`;

    it("exported namespace with exported enum", () => {
      ts.expectPrinted_(input2, output2);
    });

    const input3 = `namespace first {
  export namespace second {
    enum x { y }
  }
}`;
    const output3 = `var first;
(function(first) {
  let second;
  (function(second) {
    let x;
    (function(x) {
      x[x["y"] = 0] = "y";
    })(x || (x = {}));
  })(second = first.second || (first.second = {}));
})(first || (first = {}))`;

    it("exported inner namespace", () => {
      ts.expectPrinted_(input3, output3);
    });

    const input4 = `export enum x { y }`;
    const output4 = `export var x;
(function(x) {
  x[x["y"] = 0] = "y";
})(x || (x = {}))`;

    it("exported enum", () => {
      ts.expectPrinted_(input4, output4);
    });
  });

  describe("exports.replace", () => {
    const transpiler = new Bun.Transpiler({
      exports: {
        replace: {
          // export var foo = function() { }
          // =>
          // export var foo = "bar";
          foo: "bar",

          // export const getStaticProps = /* code */
          // =>
          // export var __N_SSG = true;
          getStaticProps: ["__N_SSG", true],
          getStaticPaths: ["__N_SSG", true],
          // export function getStaticProps(ctx) { /* code */ }
          // =>
          // export var __N_SSP = true;
          getServerSideProps: ["__N_SSP", true],
        },

        // Explicitly remove the top-level export, even if it is in use by
        // another part of the file
        eliminate: ["loader", "localVarToRemove"],
      },
      /* only per-file for now, so this isn't good yet */
      treeShaking: true,

      // remove non-bare unused exports, even if they may have side effects
      // Consistent with tsc & esbuild, this is enabled by default for TypeScript files
      // this flag lets you enable it for JavaScript files
      // this already existed, just wasn't exposed in the API
      trimUnusedImports: true,
    });

    it("a deletes dead exports and any imports only referenced in dead regions", () => {
      const out = transpiler.transformSync(`
    import {getUserById} from './my-database';

    export async function getStaticProps(ctx){
      return { props: { user: await getUserById(ctx.params.id)  } };
    }

    export default function MyComponent({user}) {
      getStaticProps();
      return <div id='user'>{user.name}</div>;
    }
  `);
    });

    it("deletes dead exports and any imports only referenced in dead regions", () => {
      const output = transpiler.transformSync(`
        import deadFS from 'fs';
        import liveFS from 'fs';

        export var deleteMe = 100;

        export function loader() {
          deadFS.readFileSync("/etc/passwd");
          liveFS.readFileSync("/etc/passwd");
        }

        export function action() {
          require("foo");
          liveFS.readFileSync("/etc/passwd")
          deleteMe = 101;
        }

        export function baz() {
          require("bar");
        }
      `);
      expect(output.includes("loader")).toBe(false);
      expect(output.includes("react")).toBe(false);
      expect(output.includes("action")).toBe(true);
      expect(output.includes("deadFS")).toBe(false);
      expect(output.includes("liveFS")).toBe(true);
    });

    it("supports replacing exports", () => {
      const output = transpiler.transformSync(`
        import deadFS from 'fs';
        import anotherDeadFS from 'fs';
        import liveFS from 'fs';

        export var localVarToRemove = deadFS.readFileSync("/etc/passwd");
        export var localVarToReplace = 1;

        var getStaticProps = function () {
          deadFS.readFileSync("/etc/passwd")
        };

        export {getStaticProps}

        export function baz() {
          liveFS.readFileSync("/etc/passwd");
          require("bar");
        }
      `);
      expect(output.includes("loader")).toBe(false);
      expect(output.includes("react")).toBe(false);
      expect(output.includes("deadFS")).toBe(false);
      expect(output.includes("default")).toBe(false);
      expect(output.includes("anotherDeadFS")).toBe(false);
      expect(output.includes("liveFS")).toBe(true);
      expect(output.includes("__N_SSG")).toBe(true);
      expect(output.includes("localVarToReplace")).toBe(true);
      expect(output.includes("localVarToRemove")).toBe(false);
    });
  });

  const bunTranspiler = new Bun.Transpiler({
    loader: "tsx",
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      user_undefined: "undefined",
    },
    platform: "bun",
    macro: {
      inline: {
        whatDidIPass: `${import.meta.dir}/inline.macro.js`,
        promiseReturningFunction: `${import.meta.dir}/inline.macro.js`,
        promiseReturningCtx: `${import.meta.dir}/inline.macro.js`,
      },
      react: {
        bacon: `${import.meta.dir}/macro-check.js`,
      },
    },
  });

  const code = `import { useParams } from "remix";
  import type { LoaderFunction, ActionFunction } from "remix";
  import { type xx } from 'mod';
  import { type xx as yy } from 'mod';
  import { type 'xx' as yy } from 'mod';
  import { type if as yy } from 'mod';
  import React, { type ReactNode, Component as Romponent, Component } from 'react';

  
  export const loader: LoaderFunction = async ({
    params
  }) => {
    console.log(params.postId);
  };
  
  export const action: ActionFunction = async ({
    params
  }) => {
    console.log(params.postId);
  };
  
  export default function PostRoute() {
    const params = useParams();
    console.log(params.postId);
  }





  `;

  it("jsxFactory (two level)", () => {
    var bun = new Bun.Transpiler({
      loader: "jsx",
      allowBunRuntime: false,
      tsconfig: JSON.stringify({
        compilerOptions: {
          jsxFragmentFactory: "foo.frag",
          jsx: "react",
          jsxFactory: "foo.factory",
        },
      }),
    });

    const element = bun.transformSync(`
export default <div>hi</div>
    `);

    expect(element.includes("var jsxEl = foo.factory;")).toBe(true);

    const fragment = bun.transformSync(`
export default <>hi</>
    `);
    expect(fragment.includes("var JSXFrag = foo.frag,")).toBe(true);
  });

  it("jsxFactory (one level)", () => {
    var bun = new Bun.Transpiler({
      loader: "jsx",
      allowBunRuntime: false,
      tsconfig: JSON.stringify({
        compilerOptions: {
          jsxFragmentFactory: "foo.frag",
          jsx: "react",
          jsxFactory: "h",
        },
      }),
    });

    const element = bun.transformSync(`
export default <div>hi</div>
    `);
    expect(element.includes("var jsxEl = h;")).toBe(true);

    const fragment = bun.transformSync(`
export default <>hi</>
    `);
    expect(fragment.includes("var JSXFrag = foo.frag,")).toBe(true);
  });

  it("JSX", () => {
    var bun = new Bun.Transpiler({
      loader: "jsx",
      define: {
        "process.env.NODE_ENV": JSON.stringify("development"),
      },
    });
    expect(bun.transformSync("export var foo = <div foo />")).toBe(
      `export var foo = $jsx("div", {
  foo: true
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var foo = <div foo={foo} />")).toBe(
      `export var foo = $jsx("div", {
  foo
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var foo = <div {...foo} />")).toBe(
      `export var foo = $jsx("div", {
  ...foo
}, undefined, false, undefined, this);
`,
    );

    expect(bun.transformSync("export var hi = <div {foo} />")).toBe(
      `export var hi = $jsx("div", {
  foo
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var hi = <div {foo.bar.baz} />")).toBe(
      `export var hi = $jsx("div", {
  baz: foo.bar.baz
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var hi = <div {foo?.bar?.baz} />")).toBe(
      `export var hi = $jsx("div", {
  baz: foo?.bar?.baz
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var hi = <div {foo['baz'].bar?.baz} />")).toBe(
      `export var hi = $jsx("div", {
  baz: foo["baz"].bar?.baz
}, undefined, false, undefined, this);
`,
    );

    // cursed
    expect(bun.transformSync("export var hi = <div {foo[{name: () => true}.name].hi} />")).toBe(
      `export var hi = $jsx("div", {
  hi: foo[{ name: () => true }.name].hi
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var hi = <Foo {process.env.NODE_ENV} />")).toBe(
      `export var hi = $jsx(Foo, {
  NODE_ENV: "development"
}, undefined, false, undefined, this);
`,
    );

    expect(bun.transformSync("export var hi = <div {foo['baz'].bar?.baz} />")).toBe(
      `export var hi = $jsx("div", {
  baz: foo["baz"].bar?.baz
}, undefined, false, undefined, this);
`,
    );
    try {
      bun.transformSync("export var hi = <div {foo}={foo}= />");
      throw new Error("Expected error");
    } catch (e) {
      expect(e.errors[0].message.includes('Expected ">"')).toBe(true);
    }

    expect(bun.transformSync("export var hi = <div {Foo}><Foo></Foo></div>")).toBe(
      `export var hi = $jsx("div", {
  Foo,
  children: $jsx(Foo, {}, undefined, false, undefined, this)
}, undefined, false, undefined, this);
`,
    );
    expect(bun.transformSync("export var hi = <div {Foo}><Foo></Foo></div>")).toBe(
      `export var hi = $jsx("div", {
  Foo,
  children: $jsx(Foo, {}, undefined, false, undefined, this)
}, undefined, false, undefined, this);
`,
    );

    expect(bun.transformSync("export var hi = <div>{123}}</div>").trim()).toBe(
      `export var hi = $jsx("div", {
  children: [
    123,
    "}"
  ]
}, undefined, true, undefined, this);
      `.trim(),
    );
  });

  describe("inline JSX", () => {
    const inliner = new Bun.Transpiler({
      loader: "tsx",
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        user_undefined: "undefined",
      },
      platform: "bun",
      jsxOptimizationInline: true,
      treeShaking: false,
    });

    it("inlines static JSX into object literals", () => {
      expect(
        inliner
          .transformSync(
            `
export var hi = <div>{123}</div>
export var hiWithKey = <div key="hey">{123}</div>
export var hiWithRef = <div ref={foo}>{123}</div>

export var ComponentThatChecksDefaultProps = <Hello></Hello>
export var ComponentThatChecksDefaultPropsAndHasChildren = <Hello>my child</Hello>
export var ComponentThatHasSpreadCausesDeopt = <Hello {...spread} />

`.trim(),
          )
          .trim(),
      ).toBe(
        `var $$typeof = Symbol.for("react.element");
export var hi = {
  $$typeof,
  type: "div",
  key: null,
  ref: null,
  props: {
    children: 123
  },
  _owner: null
};
export var hiWithKey = {
  $$typeof,
  type: "div",
  key: "hey",
  ref: null,
  props: {
    children: 123
  },
  _owner: null
};
export var hiWithRef = $jsx("div", {
  ref: foo,
  children: 123
});
export var ComponentThatChecksDefaultProps = {
  $$typeof,
  type: Hello,
  key: null,
  ref: null,
  props: Hello.defaultProps || {},
  _owner: null
};
export var ComponentThatChecksDefaultPropsAndHasChildren = {
  $$typeof,
  type: Hello,
  key: null,
  ref: null,
  props: __merge({
    children: "my child"
  }, Hello.defaultProps),
  _owner: null
};
export var ComponentThatHasSpreadCausesDeopt = $jsx(Hello, {
  ...spread
});
`.trim(),
      );
    });
  });

  it("require with a dynamic non-string expression", () => {
    var nodeTranspiler = new Bun.Transpiler({ platform: "node" });
    expect(nodeTranspiler.transformSync("require('hi' + bar)")).toBe('require("hi" + bar);\n');
  });

  it("CommonJS", () => {
    var nodeTranspiler = new Bun.Transpiler({ platform: "node" });
    expect(nodeTranspiler.transformSync("module.require('hi' + 123)")).toBe('require("hi" + 123);\n');

    expect(nodeTranspiler.transformSync("module.require(1 ? 'foo' : 'bar')")).toBe('require("foo");\n');
    expect(nodeTranspiler.transformSync("require(1 ? 'foo' : 'bar')")).toBe('require("foo");\n');

    expect(nodeTranspiler.transformSync("module.require(unknown ? 'foo' : 'bar')")).toBe(
      'unknown ? require("foo") : require("bar");\n',
    );
  });

  describe("regressions", () => {
    it("unexpected super", () => {
      const input = `
      'use strict';

      const ErrorReportingMixinBase = require('./mixin-base');
      const PositionTrackingPreprocessorMixin = require('../position-tracking/preprocessor-mixin');
      const Mixin = require('../../utils/mixin');
      
      class ErrorReportingPreprocessorMixin extends ErrorReportingMixinBase {
          constructor(preprocessor, opts) {
              super(preprocessor, opts);
      
              this.posTracker = Mixin.install(preprocessor, PositionTrackingPreprocessorMixin);
              this.lastErrOffset = -1;
          }
      
          _reportError(code) {
              //NOTE: avoid reporting error twice on advance/retreat
              if (this.lastErrOffset !== this.posTracker.offset) {
                  this.lastErrOffset = this.posTracker.offset;
                  super._reportError(code);
              }
          }
      }
      
      module.exports = ErrorReportingPreprocessorMixin;
      

`;
      expect(transpiler.transformSync(input, "js").length > 0).toBe(true);
    });
  });

  describe("scanImports", () => {
    it("reports import paths, excluding types", () => {
      const imports = transpiler.scanImports(code, "tsx");
      expect(imports.filter(({ path }) => path === "remix")).toHaveLength(1);
      expect(imports.filter(({ path }) => path === "mod")).toHaveLength(0);
      expect(imports.filter(({ path }) => path === "react")).toHaveLength(1);
      expect(imports).toHaveLength(2);
    });
  });

  const parsed = (code, trim = true, autoExport = false, transpiler_ = transpiler) => {
    if (autoExport) {
      code = "export default (" + code + ")";
    }

    var out = transpiler_.transformSync(code, "js");
    if (autoExport && out.startsWith("export default ")) {
      out = out.substring("export default ".length);
    }

    if (trim) {
      out = out.trim();

      if (out.endsWith(";")) {
        out = out.substring(0, out.length - 1);
      }

      return out.trim();
    }

    return out;
  };

  const expectPrinted = (code, out) => {
    expect(parsed(code, true, true)).toBe(out);
  };

  const expectPrinted_ = (code, out) => {
    expect(parsed(code, !out.endsWith(";\n"), false)).toBe(out);
  };

  const expectPrintedNoTrim = (code, out) => {
    expect(parsed(code, false, false)).toBe(out);
  };

  const expectBunPrinted_ = (code, out) => {
    expect(parsed(code, !out.endsWith(";\n"), false, bunTranspiler)).toBe(out);
  };

  const expectParseError = (code, message) => {
    try {
      parsed(code, false, false);
    } catch (er) {
      var err = er;
      if (er instanceof AggregateError) {
        err = err.errors[0];
      }

      expect(er.message).toBe(message);

      return;
    }

    throw new Error("Expected parse error for code\n\t" + code);
  };

  describe("parser", () => {
    it("arrays", () => {
      expectPrinted("[]", "[]");
      expectPrinted("[,]", "[,]");
      expectPrinted("[1]", "[1]");
      expectPrinted("[1,]", "[1]");
      expectPrinted("[,1]", "[, 1]");
      expectPrinted("[1,2]", "[1, 2]");
      expectPrinted("[,1,2]", "[, 1, 2]");
      expectPrinted("[1,,2]", "[1, , 2]");
      expectPrinted("[1,2,]", "[1, 2]");
      expectPrinted("[1,2,,]", "[1, 2, ,]");
    });

    it("exponentiation", () => {
      expectPrinted("(delete x) ** 0", "(delete x) ** 0");
      expectPrinted("(delete x.prop) ** 0", "(delete x.prop) ** 0");
      expectPrinted("(delete x[0]) ** 0", "(delete x[0]) ** 0");

      expectPrinted("(delete x?.prop) ** 0", "(delete x?.prop) ** 0");

      expectPrinted("(void x) ** 0", "(void x) ** 0");
      expectPrinted("(typeof x) ** 0", "(typeof x) ** 0");
      expectPrinted("(+x) ** 0", "(+x) ** 0");
      expectPrinted("(-x) ** 0", "(-x) ** 0");
      expectPrinted("(~x) ** 0", "(~x) ** 0");
      expectPrinted("(!x) ** 0", "(!x) ** 0");
      expectPrinted("(await x) ** 0", "(await x) ** 0");
      expectPrinted("(await -x) ** 0", "(await -x) ** 0");

      expectPrinted("--x ** 2", "--x ** 2");
      expectPrinted("++x ** 2", "++x ** 2");
      expectPrinted("x-- ** 2", "x-- ** 2");
      expectPrinted("x++ ** 2", "x++ ** 2");

      expectPrinted("(-x) ** 2", "(-x) ** 2");
      expectPrinted("(+x) ** 2", "(+x) ** 2");
      expectPrinted("(~x) ** 2", "(~x) ** 2");
      expectPrinted("(!x) ** 2", "(!x) ** 2");
      expectPrinted("(-1) ** 2", "(-1) ** 2");
      expectPrinted("(+1) ** 2", "1 ** 2");
      expectPrinted("(~1) ** 2", "(~1) ** 2");
      expectPrinted("(!1) ** 2", "false ** 2");
      expectPrinted("(void x) ** 2", "(void x) ** 2");
      expectPrinted("(delete x) ** 2", "(delete x) ** 2");
      expectPrinted("(typeof x) ** 2", "(typeof x) ** 2");
      expectPrinted("undefined ** 2", "undefined ** 2");

      expectParseError("-x ** 2", "Unexpected **");
      expectParseError("+x ** 2", "Unexpected **");
      expectParseError("~x ** 2", "Unexpected **");
      expectParseError("!x ** 2", "Unexpected **");
      expectParseError("void x ** 2", "Unexpected **");
      expectParseError("delete x ** 2", "Unexpected **");
      expectParseError("typeof x ** 2", "Unexpected **");

      expectParseError("-x.y() ** 2", "Unexpected **");
      expectParseError("+x.y() ** 2", "Unexpected **");
      expectParseError("~x.y() ** 2", "Unexpected **");
      expectParseError("!x.y() ** 2", "Unexpected **");
      expectParseError("void x.y() ** 2", "Unexpected **");
      expectParseError("delete x.y() ** 2", "Unexpected **");
      expectParseError("typeof x.y() ** 2", "Unexpected **");

      expectParseError("delete x ** 0", "Unexpected **");
      expectParseError("delete x.prop ** 0", "Unexpected **");
      expectParseError("delete x[0] ** 0", "Unexpected **");
      expectParseError("delete x?.prop ** 0", "Unexpected **");
      expectParseError("void x ** 0", "Unexpected **");
      expectParseError("typeof x ** 0", "Unexpected **");
      expectParseError("+x ** 0", "Unexpected **");
      expectParseError("-x ** 0", "Unexpected **");
      expectParseError("~x ** 0", "Unexpected **");
      expectParseError("!x ** 0", "Unexpected **");
      expectParseError("await x ** 0", "Unexpected **");
      expectParseError("await -x ** 0", "Unexpected **");
    });

    it("await", () => {
      expectPrinted("await x", "await x");
      expectPrinted("await +x", "await +x");
      expectPrinted("await -x", "await -x");
      expectPrinted("await ~x", "await ~x");
      expectPrinted("await !x", "await !x");
      expectPrinted("await --x", "await --x");
      expectPrinted("await ++x", "await ++x");
      expectPrinted("await x--", "await x--");
      expectPrinted("await x++", "await x++");
      expectPrinted("await void x", "await void x");
      expectPrinted("await typeof x", "await typeof x");
      expectPrinted("await (x * y)", "await (x * y)");
      expectPrinted("await (x ** y)", "await (x ** y)");

      expectPrinted_("async function f() { await delete x }", "async function f() {\n  await delete x;\n}");

      // expectParseError(
      //   "await delete x",
      //   "Delete of a bare identifier cannot be used in an ECMAScript module"
      // );
    });

    it("import assert", () => {
      expectPrinted_(`import json from "./foo.json" assert { type: "json" };`, `import json from "./foo.json"`);
      expectPrinted_(`import json from "./foo.json";`, `import json from "./foo.json"`);
      expectPrinted_(`import("./foo.json", { type: "json" });`, `import("./foo.json")`);
    });

    it("import with unicode escape", () => {
      expectPrinted_(`import { name } from 'mod\\u1011';`, `import {name} from "mod\\u1011"`);
    });

    it("fold string addition", () => {
      expectPrinted_(
        `
const a = "[^aeiou]";
const b = a + "[^aeiouy]*";
console.log(a);
        `,
        `
const a = "[^aeiou]";
const b = a + "[^aeiouy]*";
console.log(a)
        `.trim(),
      );

      expectPrinted_(`export const foo = "a" + "b";`, `export const foo = "ab"`);
      expectPrinted_(
        `export const foo = "F" + "0" + "F" + "0123456789" + "ABCDEF" + "0123456789ABCDEFF0123456789ABCDEF00" + "b";`,
        `export const foo = "F0F0123456789ABCDEF0123456789ABCDEFF0123456789ABCDEF00b"`,
      );
      expectPrinted_(`export const foo = "a" + 1 + "b";`, `export const foo = "a" + 1 + "b"`);
      expectPrinted_(`export const foo = "a" + "b" + 1 + "b";`, `export const foo = "ab" + 1 + "b"`);
      expectPrinted_(`export const foo = "a" + "b" + 1 + "b" + "c";`, `export const foo = "ab" + 1 + "bc"`);
    });

    it("numeric constants", () => {
      expectBunPrinted_("export const foo = 1 + 2", "export const foo = 3");
      expectBunPrinted_("export const foo = 1 - 2", "export const foo = -1");
      expectBunPrinted_("export const foo = 1 * 2", "export const foo = 2");
    });

    it("pass objects to macros", () => {
      var object = {
        helloooooooo: {
          message: [12345],
        },
      };

      const output = bunTranspiler.transformSync(
        `
        import {whatDidIPass} from 'inline';

        export function foo() {
         return whatDidIPass();
        }
      `,
        object,
      );
      expect(output).toBe(`export function foo() {
  return {
    helloooooooo: {
      message: [
        12345
      ]
    }
  };
}
`);
    });

    it("macros can return a promise", () => {
      var object = {
        helloooooooo: {
          message: [12345],
        },
      };

      const output = bunTranspiler.transformSync(
        `
        import {promiseReturningFunction} from 'inline';

        export function foo() {
         return promiseReturningFunction();
        }
      `,
        object,
      );
      expect(output).toBe(`export function foo() {
  return 1;
}
`);
    });

    it("macros can return a Response body", () => {
      // "promiseReturningCtx" is this:
      // export function promiseReturningCtx(expr, ctx) {
      //   return new Promise((resolve, reject) => {
      //     setTimeout(() => {
      //       resolve(ctx);
      //     }, 1);
      //   });
      // }
      var object = Response.json({ hello: "world" });

      const input = `
import {promiseReturningCtx} from 'inline';

export function foo() {
  return promiseReturningCtx();
}
`.trim();

      const output = `
export function foo() {
  return { hello: "world" };
}
`.trim();

      expect(bunTranspiler.transformSync(input, object).trim()).toBe(output);
    });

    it("macros get dead code eliminated", () => {
      var object = Response.json({
        big: {
          object: {
            beep: "boop",
            huge: 123,
          },
          blobby: {
            beep: "boop",
            huge: 123,
          },
        },
        dead: "hello world!",
      });

      const input = `
import {promiseReturningCtx} from 'inline';

export const {dead} = promiseReturningCtx();
`.trim();

      const output = `
export const { dead } = { dead: "hello world!" };
`.trim();

      expect(bunTranspiler.transformSync(input, object).trim()).toBe(output);
    });

    it("rewrite string to length", () => {
      expectPrinted_(`export const foo = "a".length + "b".length;`, `export const foo = 1 + 1`);
      expectBunPrinted_(`export const foo = "a".length + "b".length;`, `export const foo = 2`);
    });

    describe("Bun.js", () => {
      it("require -> import.meta.require", () => {
        expectBunPrinted_(
          `export const foo = require('bar.node')`,
          `export const foo = import.meta.require("bar.node")`,
        );
        expectBunPrinted_(
          `export const foo = require('bar.node')`,
          `export const foo = import.meta.require("bar.node")`,
        );
      });

      it("require.resolve -> import.meta.require.resolve", () => {
        expectBunPrinted_(
          `export const foo = require.resolve('bar.node')`,
          `export const foo = import.meta.require.resolve("bar.node")`,
        );
      });

      it('require.resolve(path, {paths: ["blah"]}) -> import.meta.require.resolve', () => {
        expectBunPrinted_(
          `export const foo = require.resolve('bar.node', {paths: ["blah"]})`,
          `export const foo = import.meta.require.resolve("bar.node", { paths: ["blah"] })`,
        );
      });

      it("require is defined", () => {
        expectBunPrinted_(
          `
const {resolve} = require;
console.log(resolve.length)
          `.trim(),
          `
const { resolve } = import.meta.require;
console.log(resolve.length)
          `.trim(),
        );
      });
    });

    describe("Browsers", () => {
      it('require.resolve("my-module") -> "/resolved/my-module"', () => {
        // the module resolver & linker doesn't run with Bun.Transpiler
        // so in this test, it becomes the same path string
        expectPrinted_(`export const foo = require.resolve('my-module')`, `export const foo = "my-module"`);
      });
    });

    it("define", () => {
      expectPrinted_(`export default typeof user_undefined === 'undefined';`, `export default true`);
      expectPrinted_(`export default typeof user_undefined !== 'undefined';`, `export default false`);

      expectPrinted_(`export default typeof user_undefined !== 'undefined';`, `export default false`);
      expectPrinted_(`export default !user_undefined;`, `export default true`);
    });

    it("jsx symbol should work", () => {
      expectBunPrinted_(`var x = jsx; export default x;`, "var x = jsx;\nexport default x");
    });

    it("decls", () => {
      // expectParseError("var x = 0", "");
      // expectParseError("let x = 0", "");
      // expectParseError("const x = 0", "");
      // expectParseError("for (var x = 0;;) ;", "");
      // expectParseError("for (let x = 0;;) ;", "");
      // expectParseError("for (const x = 0;;) ;", "");

      // expectParseError("for (var x in y) ;", "");
      // expectParseError("for (let x in y) ;", "");
      // expectParseError("for (const x in y) ;", "");
      // expectParseError("for (var x of y) ;", "");
      // expectParseError("for (let x of y) ;", "");
      // expectParseError("for (const x of y) ;", "");

      // expectParseError("var x", "");
      // expectParseError("let x", "");
      expectParseError("const x", 'The constant "x" must be initialized');
      expectParseError("const {}", "This constant must be initialized");
      expectParseError("const []", "This constant must be initialized");
      // expectParseError("for (var x;;) ;", "");
      // expectParseError("for (let x;;) ;", "");
      expectParseError("for (const x;;) ;", 'The constant "x" must be initialized');
      expectParseError("for (const {};;) ;", "This constant must be initialized");
      expectParseError("for (const [];;) ;", "This constant must be initialized");

      // Make sure bindings are visited during parsing
      expectPrinted_("var {[x]: y} = {}", "var { [x]: y } = {}");
      expectPrinted_("var {...x} = {}", "var { ...x } = {}");

      // Test destructuring patterns
      expectPrinted_("var [...x] = []", "var [...x] = []");
      expectPrinted_("var {...x} = {}", "var { ...x } = {}");

      expectPrinted_("export var foo = ([...x] = []) => {}", "export var foo = ([...x] = []) => {\n}");

      expectPrinted_("export var foo = ({...x} = {}) => {}", "export var foo = ({ ...x } = {}) => {\n}");

      expectParseError("var [...x,] = []", 'Unexpected "," after rest pattern');
      expectParseError("var {...x,} = {}", 'Unexpected "," after rest pattern');
      expectParseError(
        "export default function() { return ([...x,] = []) => {} }",
        "Unexpected trailing comma after rest element",
      );
      expectParseError("({...x,} = {}) => {}", "Unexpected trailing comma after rest element");

      expectPrinted_("[b, ...c] = d", "[b, ...c] = d");
      expectPrinted_("([b, ...c] = d)", "[b, ...c] = d");
      expectPrinted_("({b, ...c} = d)", "({ b, ...c } = d)");
      expectPrinted_("({a = b} = c)", "({ a = b } = c)");
      expectPrinted_("({a: b = c} = d)", "({ a: b = c } = d)");
      expectPrinted_("({a: b.c} = d)", "({ a: b.c } = d)");
      expectPrinted_("[a = {}] = b", "[a = {}] = b");
      expectPrinted_("[[...a, b].x] = c", "[[...a, b].x] = c");
      expectPrinted_("[{...a, b}.x] = c", "[{ ...a, b }.x] = c");
      expectPrinted_("({x: [...a, b].x} = c)", "({ x: [...a, b].x } = c)");
      expectPrinted_("({x: {...a, b}.x} = c)", "({ x: { ...a, b }.x } = c)");
      expectPrinted_("[x = [...a, b]] = c", "[x = [...a, b]] = c");
      expectPrinted_("[x = {...a, b}] = c", "[x = { ...a, b }] = c");
      expectPrinted_("({x = [...a, b]} = c)", "({ x = [...a, b] } = c)");
      expectPrinted_("({x = {...a, b}} = c)", "({ x = { ...a, b } } = c)");

      expectPrinted_("(x = y)", "x = y");
      expectPrinted_("([] = [])", "[] = []");
      expectPrinted_("({} = {})", "({} = {})");
      expectPrinted_("([[]] = [[]])", "[[]] = [[]]");
      expectPrinted_("({x: {}} = {x: {}})", "({ x: {} } = { x: {} })");
      expectPrinted_("(x) = y", "x = y");
      expectParseError("([]) = []", "Invalid assignment target");
      expectParseError("({}) = {}", "Invalid assignment target");
      expectParseError("[([])] = [[]]", "Invalid assignment target");
      expectParseError("({x: ({})} = {x: {}})", "Invalid assignment target");
      expectParseError("(([]) = []) => {}", "Unexpected parentheses in binding pattern");
      expectParseError("(({}) = {}) => {}", "Unexpected parentheses in binding pattern");
      expectParseError("function f(([]) = []) {}", "Parse error");
      expectParseError(
        "function f(({}) = {}) {}",
        "Parse error",
        // 'Expected identifier but found "("\n'
      );

      expectPrintedNoTrim("for (x in y) ;", "for (x in y)\n  ;\n");
      expectPrintedNoTrim("for ([] in y) ;", "for ([] in y)\n  ;\n");
      expectPrintedNoTrim("for ({} in y) ;", "for ({} in y)\n  ;\n");
      expectPrintedNoTrim("for ((x) in y) ;", "for (x in y)\n  ;\n");
      expectParseError("for (x in y)", "Unexpected end of file");
      expectParseError("for ([] in y)", "Unexpected end of file");
      expectParseError("for ({} in y)", "Unexpected end of file");
      expectParseError("for ((x) in y)", "Unexpected end of file");
      expectParseError("for (([]) in y) ;", "Invalid assignment target");
      expectParseError("for (({}) in y) ;", "Invalid assignment target");

      expectPrintedNoTrim("for (x of y) ;", "for (x of y)\n  ;\n");
      expectPrintedNoTrim("for ([] of y) ;", "for ([] of y)\n  ;\n");
      expectPrintedNoTrim("for ({} of y) ;", "for ({} of y)\n  ;\n");
      expectPrintedNoTrim("for ((x) of y) ;", "for (x of y)\n  ;\n");
      expectPrintedNoTrim("for (x of y) {}", "for (x of y)\n  ;\n");
      expectPrintedNoTrim("for ([] of y) {}", "for ([] of y)\n  ;\n");
      expectPrintedNoTrim("for ({} of y) {}", "for ({} of y)\n  ;\n");
      expectPrintedNoTrim("for ((x) of y) {}", "for (x of y)\n  ;\n");
      expectParseError("for (x of y)", "Unexpected end of file");
      expectParseError("for ([] of y)", "Unexpected end of file");
      expectParseError("for ({} of y)", "Unexpected end of file");
      expectParseError("for ((x) of y)", "Unexpected end of file");
      expectParseError("for (([]) of y) ;", "Invalid assignment target");
      expectParseError("for (({}) of y) ;", "Invalid assignment target");

      expectParseError("[[...a, b]] = c", 'Unexpected "," after rest pattern');
      expectParseError("[{...a, b}] = c", 'Unexpected "," after rest pattern');
      expectParseError("({x: [...a, b]} = c)", 'Unexpected "," after rest pattern');
      expectParseError("({x: {...a, b}} = c)", 'Unexpected "," after rest pattern');
      expectParseError("[b, ...c,] = d", 'Unexpected "," after rest pattern');
      expectParseError("([b, ...c,] = d)", 'Unexpected "," after rest pattern');
      expectParseError("({b, ...c,} = d)", 'Unexpected "," after rest pattern');
      expectParseError("({a = b})", 'Unexpected "="');
      expectParseError("({x = {a = b}} = c)", 'Unexpected "="');
      expectParseError("[a = {b = c}] = d", 'Unexpected "="');

      expectPrintedNoTrim("for ([{a = {}}] in b) ;", "for ([{ a = {} }] in b)\n  ;\n");
      expectPrintedNoTrim("for ([{a = {}}] of b) ;", "for ([{ a = {} }] of b)\n  ;\n");
      expectPrintedNoTrim("for ({a = {}} in b) ;", "for ({ a = {} } in b)\n  ;\n");
      expectPrintedNoTrim("for ({a = {}} of b) ;", "for ({ a = {} } of b)\n  ;\n");
      expectParseError("for ([{a = {}}] in b)", "Unexpected end of file");
      expectParseError("for ([{a = {}}] of b)", "Unexpected end of file");
      expectParseError("for ({a = {}} in b)", "Unexpected end of file");
      expectParseError("for ({a = {}} of b)", "Unexpected end of file");

      // this is different from esbuild
      expectPrintedNoTrim("for ([{a = {}}] in b) {}", "for ([{ a = {} }] in b)\n  ;\n");
      expectPrintedNoTrim("for ([{a = {}}] of b) {}", "for ([{ a = {} }] of b)\n  ;\n");
      expectPrintedNoTrim("for ({a = {}} in b) {}", "for ({ a = {} } in b)\n  ;\n");
      expectPrintedNoTrim("for ({a = {}} of b) {}", "for ({ a = {} } of b)\n  ;\n");
      expectPrintedNoTrim("for (x in y) {}", "for (x in y)\n  ;\n");
      expectPrintedNoTrim("for ([] in y) {}", "for ([] in y)\n  ;\n");
      expectPrintedNoTrim("for ({} in y) {}", "for ({} in y)\n  ;\n");
      expectPrintedNoTrim("for ((x) in y) {}", "for (x in y)\n  ;\n");
      expectPrintedNoTrim("while (true) {}", "while (true)\n  ;\n");

      expectPrintedNoTrim("while (true) ;", "while (true)\n  ;\n");
      expectParseError("while (1)", "Unexpected end of file");

      expectParseError("({a = {}} in b)", 'Unexpected "="');
      expectParseError("[{a = {}}]\nof()", 'Unexpected "="');
      expectParseError("for ([...a, b] in c) {}", 'Unexpected "," after rest pattern');
      expectParseError("for ([...a, b] of c) {}", 'Unexpected "," after rest pattern');
    });

    it("regexp", () => {
      expectPrinted("/x/g", "/x/g");
      expectPrinted("/x/i", "/x/i");
      expectPrinted("/x/m", "/x/m");
      expectPrinted("/x/s", "/x/s");
      expectPrinted("/x/u", "/x/u");
      expectPrinted("/x/y", "/x/y");
      expectPrinted("/gimme/g", "/gimme/g");
      expectPrinted("/gimgim/g", "/gimgim/g");

      expectParseError("/x/msuygig", 'Duplicate flag "g" in regular expression');
    });

    it("identifier escapes", () => {
      expectPrinted_("var _\u0076\u0061\u0072", "var _var");
      expectParseError("var \u0076\u0061\u0072", 'Expected identifier but found "\u0076\u0061\u0072"');
      expectParseError("\\u0076\\u0061\\u0072 foo", "Unexpected \\u0076\\u0061\\u0072");

      expectPrinted_("foo._\u0076\u0061\u0072", "foo._var");
      expectPrinted_("foo.\u0076\u0061\u0072", "foo.var");

      // expectParseError("\u200Ca", 'Unexpected "\\u200c"');
      // expectParseError("\u200Da", 'Unexpected "\\u200d"');
    });
  });

  it("private identifiers", () => {
    expectParseError("#foo", "Unexpected #foo");
    expectParseError("#foo in this", "Unexpected #foo");
    expectParseError("this.#foo", 'Expected identifier but found "#foo"');
    expectParseError("this?.#foo", 'Expected identifier but found "#foo"');
    expectParseError("({ #foo: 1 })", 'Expected identifier but found "#foo"');
    expectParseError("class Foo { x = { #foo: 1 } }", 'Expected identifier but found "#foo"');
    expectParseError("class Foo { x = #foo }", 'Expected "in" but found "}"');
    expectParseError("class Foo { #foo; foo() { delete this.#foo } }", 'Deleting the private name "#foo" is forbidden');
    expectParseError(
      "class Foo { #foo; foo() { delete this?.#foo } }",
      'Deleting the private name "#foo" is forbidden',
    );
    expectParseError("class Foo extends Bar { #foo; foo() { super.#foo } }", 'Expected identifier but found "#foo"');
    expectParseError("class Foo { #foo = () => { for (#foo in this) ; } }", "Unexpected #foo");
    expectParseError("class Foo { #foo = () => { for (x = #foo in this) ; } }", "Unexpected #foo");
    expectPrinted_("class Foo { #foo }", "class Foo {\n  #foo;\n}");
    expectPrinted_("class Foo { #foo = 1 }", "class Foo {\n  #foo = 1;\n}");
    expectPrinted_("class Foo { #foo = #foo in this }", "class Foo {\n  #foo = #foo in this;\n}");
    expectPrinted_(
      "class Foo { #foo = #foo in (#bar in this); #bar }",
      "class Foo {\n  #foo = #foo in (#bar in this);\n  #bar;\n}",
    );
    expectPrinted_("class Foo { #foo() {} }", "class Foo {\n  #foo() {\n  }\n}");
    expectPrinted_("class Foo { get #foo() {} }", "class Foo {\n  get #foo() {\n  }\n}");
    expectPrinted_("class Foo { set #foo(x) {} }", "class Foo {\n  set #foo(x) {\n  }\n}");
    expectPrinted_("class Foo { static #foo }", "class Foo {\n  static #foo;\n}");
    expectPrinted_("class Foo { static #foo = 1 }", "class Foo {\n  static #foo = 1;\n}");
    expectPrinted_("class Foo { static #foo() {} }", "class Foo {\n  static #foo() {\n  }\n}");
    expectPrinted_("class Foo { static get #foo() {} }", "class Foo {\n  static get #foo() {\n  }\n}");
    expectPrinted_("class Foo { static set #foo(x) {} }", "class Foo {\n  static set #foo(x) {\n  }\n}");

    expectParseError("class Foo { #foo = #foo in #bar in this; #bar }", "Unexpected #bar");

    expectParseError("class Foo { #constructor }", 'Invalid field name "#constructor"');
    expectParseError("class Foo { #constructor() {} }", 'Invalid method name "#constructor"');
    expectParseError("class Foo { static #constructor }", 'Invalid field name "#constructor"');
    expectParseError("class Foo { static #constructor() {} }", 'Invalid method name "#constructor"');
    expectParseError("class Foo { #\\u0063onstructor }", 'Invalid field name "#constructor"');
    expectParseError("class Foo { #\\u0063onstructor() {} }", 'Invalid method name "#constructor"');
    expectParseError("class Foo { static #\\u0063onstructor }", 'Invalid field name "#constructor"');
    expectParseError("class Foo { static #\\u0063onstructor() {} }", 'Invalid method name "#constructor"');
    const errorText = '"#foo" has already been declared';
    expectParseError("class Foo { #foo; #foo }", errorText);
    expectParseError("class Foo { #foo; static #foo }", errorText);
    expectParseError("class Foo { static #foo; #foo }", errorText);
    expectParseError("class Foo { #foo; #foo() {} }", errorText);
    expectParseError("class Foo { #foo; get #foo() {} }", errorText);
    expectParseError("class Foo { #foo; set #foo(x) {} }", errorText);
    expectParseError("class Foo { #foo() {} #foo }", errorText);
    expectParseError("class Foo { get #foo() {} #foo }", errorText);
    expectParseError("class Foo { set #foo(x) {} #foo }", errorText);
    expectParseError("class Foo { get #foo() {} get #foo() {} }", errorText);
    expectParseError("class Foo { set #foo(x) {} set #foo(x) {} }", errorText);
    expectParseError("class Foo { get #foo() {} set #foo(x) {} #foo }", errorText);
    expectParseError("class Foo { set #foo(x) {} get #foo() {} #foo }", errorText);

    expectPrinted_(
      "class Foo { get #foo() {} set #foo(x) { this.#foo } }",
      "class Foo {\n  get #foo() {\n  }\n  set #foo(x) {\n    this.#foo;\n  }\n}",
    );
    expectPrinted_(
      "class Foo { set #foo(x) { this.#foo } get #foo() {} }",
      "class Foo {\n  set #foo(x) {\n    this.#foo;\n  }\n  get #foo() {\n  }\n}",
    );
    expectPrinted_("class Foo { #foo } class Bar { #foo }", "class Foo {\n  #foo;\n}\n\nclass Bar {\n  #foo;\n}");
    expectPrinted_("class Foo { foo = this.#foo; #foo }", "class Foo {\n  foo = this.#foo;\n  #foo;\n}");
    expectPrinted_("class Foo { foo = this?.#foo; #foo }", "class Foo {\n  foo = this?.#foo;\n  #foo;\n}");
    expectParseError(
      "class Foo { #foo } class Bar { foo = this.#foo }",
      'Private name "#foo" must be declared in an enclosing class',
    );
    expectParseError(
      "class Foo { #foo } class Bar { foo = this?.#foo }",
      'Private name "#foo" must be declared in an enclosing class',
    );
    expectParseError(
      "class Foo { #foo } class Bar { foo = #foo in this }",
      'Private name "#foo" must be declared in an enclosing class',
    );

    expectPrinted_(
      `class Foo {
  #if
  #im() { return this.#im(this.#if) }
  static #sf
  static #sm() { return this.#sm(this.#sf) }
  foo() {
    return class {
      #inner() {
        return [this.#im, this?.#inner, this?.x.#if]
      }
    }
  }
}
`,
      `class Foo {
  #if;
  #im() {
    return this.#im(this.#if);
  }
  static #sf;
  static #sm() {
    return this.#sm(this.#sf);
  }
  foo() {
    return class {
      #inner() {
        return [this.#im, this?.#inner, this?.x.#if];
      }
    };
  }
}`,
    );
  });

  it("type only exports", () => {
    let { expectPrinted_, expectParseError } = ts;
    expectPrinted_("export type {foo, bar as baz} from 'bar'", "");
    expectPrinted_("export type {foo, bar as baz}", "");
    expectPrinted_("export type {foo} from 'bar'; x", "x");
    expectPrinted_("export type {foo} from 'bar'\nx", "x");
    expectPrinted_("export type {default} from 'bar'", "");
    expectPrinted_("export { type } from 'mod'; type", 'export { type } from "mod";\ntype');
    expectPrinted_("export { type, as } from 'mod'", 'export { type, as } from "mod"');
    expectPrinted_("export { x, type foo } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { x, type as } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { x, type foo as bar } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { x, type foo as as } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { type as as } from 'mod'; as", 'export { type as as } from "mod";\nas');
    expectPrinted_("export { type as foo } from 'mod'; foo", 'export { type as foo } from "mod";\nfoo');
    expectPrinted_("export { type as type } from 'mod'; type", 'export { type } from "mod";\ntype');
    expectPrinted_("export { x, type as as foo } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { x, type as as as } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { x, type type as as } from 'mod'; x", 'export { x } from "mod";\nx');
    expectPrinted_("export { x, \\u0074ype y }; let x, y", "export { x };\nlet x, y");
    expectPrinted_("export { x, \\u0074ype y } from 'mod'", 'export { x } from "mod"');
    expectPrinted_("export { x, type if } from 'mod'", 'export { x } from "mod"');
    expectPrinted_("export { x, type y as if }; let x", "export { x };\nlet x");
    expectPrinted_("export { type x };", "");
  });

  it("delete + optional chain", () => {
    expectPrinted_("delete foo.bar.baz", "delete foo.bar.baz");
    expectPrinted_("delete foo?.bar.baz", "delete foo?.bar.baz");
    expectPrinted_("delete foo?.bar?.baz", "delete foo?.bar?.baz");
  });

  it("useDefineForConst TypeScript class initialization", () => {
    var { expectPrinted_ } = ts;
    expectPrinted_(
      `
class Foo {
  constructor(public x: string = "hey") {}
  bar: number;
}
`.trim(),
      `
class Foo {
  x;
  constructor(x = "hey") {
    this.x = x;
  }
  bar;
}
`.trim(),
    );
  });

  it("class static blocks", () => {
    expectPrinted_("class Foo { static {} }", "class Foo {\n  static {\n  }\n}");
    expectPrinted_("class Foo { static {} x = 1 }", "class Foo {\n  static {\n  }\n  x = 1;\n}");
    expectPrinted_("class Foo { static { this.foo() } }", "class Foo {\n  static {\n    this.foo();\n  }\n}");

    expectParseError("class Foo { static { yield } }", '"yield" is a reserved word and cannot be used in strict mode');
    expectParseError("class Foo { static { await } }", 'The keyword "await" cannot be used here');
    expectParseError("class Foo { static { return } }", "A return statement cannot be used here");
    expectParseError("class Foo { static { break } }", 'Cannot use "break" here');
    expectParseError("class Foo { static { continue } }", 'Cannot use "continue" here');
    expectParseError("x: { class Foo { static { break x } } }", 'There is no containing label named "x"');
    expectParseError("x: { class Foo { static { continue x } } }", 'There is no containing label named "x"');

    expectParseError("class Foo { get #x() { this.#x = 1 } }", 'Writing to getter-only property "#x" will throw');
    expectParseError("class Foo { get #x() { this.#x += 1 } }", 'Writing to getter-only property "#x" will throw');
    expectParseError("class Foo { set #x(x) { this.#x } }", 'Reading from setter-only property "#x" will throw');
    expectParseError("class Foo { set #x(x) { this.#x += 1 } }", 'Reading from setter-only property "#x" will throw');

    // Writing to method warnings
    expectParseError("class Foo { #x() { this.#x = 1 } }", 'Writing to read-only method "#x" will throw');
    expectParseError("class Foo { #x() { this.#x += 1 } }", 'Writing to read-only method "#x" will throw');
  });

  describe("simplification", () => {
    it("unary operator", () => {
      expectPrinted("a = !(b, c)", "a = (b , !c)");
    });

    it("const inlining", () => {
      var transpiler = new Bun.Transpiler({
        inline: true,
        platform: "bun",
        allowBunRuntime: false,
      });

      function check(input, output) {
        expect(
          transpiler
            .transformSync("export function hello() {\n" + input + "\n}")
            .trim()
            .replaceAll(/^  /gm, ""),
        ).toBe("export function hello() {\n" + output + "\n}".replaceAll(/^  /gm, ""));
      }

      check("const x = 1; return x", "return 1;");
      check("const x = 1; return x + 1", "return 2;");
      check("const x = 1; return x + x", "return 2;");
      check("const x = 1; return x + x + 1", "return 3;");
      check("const x = 1; return x + x + x", "return 3;");
      check(`const foo = "foo"; const bar = "bar"; return foo + bar`, `return "foobar";`);

      check(
        `
const a = "a";
const c = "b" + a;
const b = c + a;
const d = b + a;
console.log(a, b, c, d);
        `,
        `
const c = "ba";
const b = c + "a";
const d = b + "a";
console.log("a", b, c, d);
        `.trim(),
      );

      // check that it doesn't inline after "var"
      check(
        `
      const x = 1;
      const y = 2;
      var hey = "yo";
      const z = 3;
      console.log(x + y + z);
      `,
        `
var hey = "yo";
const z = 3;
console.log(3 + z);
        `.trim(),
      );

      // check that nested scopes can inline from parent scopes
      check(
        `
      const x = 1;
      const y = 2;
      var hey = "yo";
      const z = 3;
      function hey() {
        const boom = 3;
        return x + y + boom + hey;
      }
      hey();
      `,
        `
var hey = "yo";
const z = 3;
function hey() {
  return 6 + hey;
}
hey();
        `.trim(),
      );

      // check that we don't inline objects or arrays that aren't from macros
      check(
        `
        const foo = { bar: true };
        const array = [1];
        console.log(foo, array);
        `,
        `
const foo = { bar: true };
const array = [1];
console.log(foo, array);
          `.trim(),
      );
    });

    it("constant folding scopes", () => {
      var transpiler = new Bun.Transpiler({
        inline: true,
        platform: "bun",
        allowBunRuntime: false,
      });

      // Check that pushing/popping scopes doesn't cause a crash
      // We panic at runtime if the scopes are unbalanced, so this test just checks we don't have any crashes
      function check(input) {
        transpiler.transformSync(input);
      }

      check("var x; 1 ? 0 : ()=>{}; (()=>{})()");
      check("var x; 0 ? ()=>{} : 1; (()=>{})()");
      check("var x; 0 && (()=>{}); (()=>{})()");
      check("var x; 1 || (()=>{}); (()=>{})()");
      check("if (1) 0; else ()=>{}; (()=>{})()");
      check("if (0) ()=>{}; else 1; (()=>{})()");
      check(`
      var func = () => {};
      var x;
      1 ? 0 : func;
      (() => {})();
      switch (1) {
        case 0: {
          class Foo {
            static {
              function hey() {
                return class {
                  static {
                    var foo = class {
                      hey(arg) {
                        return 1;
                      }
                    };
                    new foo();
                  }
                };
              }
            }
          }
          new Foo();
        }
      }      
      `);
    });

    it("substitution", () => {
      var transpiler = new Bun.Transpiler({
        inline: true,
        platform: "bun",
        allowBunRuntime: false,
      });
      function check(input, output) {
        expect(
          transpiler
            .transformSync("export function hello() {\n" + input + "\n}")
            .trim()
            .replaceAll(/^  /gm, ""),
        ).toBe("export function hello() {\n" + output + "\n}".replaceAll(/^  /gm, ""));
      }
      check("var x = 1; return x", "var x = 1;\nreturn x;");
      check("let x = 1; return x", "return 1;");
      check("const x = 1; return x", "return 1;");

      check("let x = 1; if (false) x++; return x", "return 1;");
      // TODO: comma operator
      // check("let x = 1; if (true) x++; return x", "let x = 1;\nreturn x++, x;");
      check("let x = 1; return x + x", "let x = 1;\nreturn x + x;");

      // Can substitute into normal unary operators
      check("let x = 1; return +x", "return 1;");
      check("let x = 1; return -x", "return -1;");
      check("let x = 1; return !x", "return false;");
      check("let x = 1; return ~x", "return ~1;");
      // TODO: remove needless return undefined;
      // check("let x = 1; return void x", "let x = 1;");

      // esbuild does this:
      // check("let x = 1; return typeof x", "return typeof 1;");
      // we do:
      check("let x = 1; return typeof x", 'return "number";');

      // Check substituting a side-effect free value into normal binary operators
      // esbuild does this:
      // check("let x = 1; return x + 2", "return 1 + 2;");
      // we do:
      check("let x = 1; return x + 2", "return 3;");
      check("let x = 1; return 2 + x", "return 3;");
      check("let x = 1; return x + arg0", "return 1 + arg0;");
      // check("let x = 1; return arg0 + x", "return arg0 + 1;");
      check("let x = 1; return x + fn()", "return 1 + fn();");
      check("let x = 1; return fn() + x", "let x = 1;\nreturn fn() + x;");
      check("let x = 1; return x + undef", "return 1 + undef;");
      check("let x = 1; return undef + x", "let x = 1;\nreturn undef + x;");

      // Check substituting a value with side-effects into normal binary operators
      check("let x = fn(); return x + 2", "return fn() + 2;");
      check("let x = fn(); return 2 + x", "return 2 + fn();");
      check("let x = fn(); return x + arg0", "return fn() + arg0;");
      check("let x = fn(); return arg0 + x", "let x = fn();\nreturn arg0 + x;");
      check("let x = fn(); return x + fn2()", "return fn() + fn2();");
      check("let x = fn(); return fn2() + x", "let x = fn();\nreturn fn2() + x;");
      check("let x = fn(); return x + undef", "return fn() + undef;");
      check("let x = fn(); return undef + x", "let x = fn();\nreturn undef + x;");

      // Cannot substitute into mutating unary operators
      check("let x = 1; ++x", "let x = 1;\n++x;");
      check("let x = 1; --x", "let x = 1;\n--x;");
      check("let x = 1; x++", "let x = 1;\nx++;");
      check("let x = 1; x--", "let x = 1;\nx--;");
      check("let x = 1; delete x", "let x = 1;\ndelete x;");

      // Cannot substitute into mutating binary operators
      check("let x = 1; x = 2", "let x = 1;\nx = 2;");
      check("let x = 1; x += 2", "let x = 1;\nx += 2;");
      check("let x = 1; x ||= 2", "let x = 1;\nx ||= 2;");

      // Can substitute past mutating binary operators when the left operand has no side effects
      // check("let x = 1; arg0 = x", "arg0 = 1;");
      // check("let x = 1; arg0 += x", "arg0 += 1;");
      // check("let x = 1; arg0 ||= x", "arg0 ||= 1;");
      // check("let x = fn(); arg0 = x", "arg0 = fn();");
      // check("let x = fn(); arg0 += x", "let x = fn();\narg0 += x;");
      // check("let x = fn(); arg0 ||= x", "let x = fn();\narg0 ||= x;");

      // Cannot substitute past mutating binary operators when the left operand has side effects
      check("let x = 1; y.z = x", "let x = 1;\ny.z = x;");
      check("let x = 1; y.z += x", "let x = 1;\ny.z += x;");
      check("let x = 1; y.z ||= x", "let x = 1;\ny.z ||= x;");
      check("let x = fn(); y.z = x", "let x = fn();\ny.z = x;");
      check("let x = fn(); y.z += x", "let x = fn();\ny.z += x;");
      check("let x = fn(); y.z ||= x", "let x = fn();\ny.z ||= x;");

      // TODO:
      // Can substitute code without side effects into branches
      // check("let x = arg0; return x ? y : z;", "return arg0 ? y : z;");
      // check("let x = arg0; return arg1 ? x : y;", "return arg1 ? arg0 : y;");
      // check("let x = arg0; return arg1 ? y : x;", "return arg1 ? y : arg0;");
      // check("let x = arg0; return x || y;", "return arg0 || y;");
      // check("let x = arg0; return x && y;", "return arg0 && y;");
      // check("let x = arg0; return x ?? y;", "return arg0 ?? y;");
      // check("let x = arg0; return arg1 || x;", "return arg1 || arg0;");
      // check("let x = arg0; return arg1 && x;", "return arg1 && arg0;");
      // check("let x = arg0; return arg1 ?? x;", "return arg1 ?? arg0;");

      // Can substitute code without side effects into branches past an expression with side effects
      // check(
      //   "let x = arg0; return y ? x : z;",
      //   "let x = arg0;\nreturn y ? x : z;",
      // );
      // check(
      //   "let x = arg0; return y ? z : x;",
      //   "let x = arg0;\nreturn y ? z : x;",
      // );
      // check("let x = arg0; return (arg1 ? 1 : 2) ? x : 3;", "return arg0;");
      // check(
      //   "let x = arg0; return (arg1 ? 1 : 2) ? 3 : x;",
      //   "let x = arg0;\nreturn 3;",
      // );
      // check(
      //   "let x = arg0; return (arg1 ? y : 1) ? x : 2;",
      //   "let x = arg0;\nreturn !arg1 || y ? x : 2;",
      // );
      // check(
      //   "let x = arg0; return (arg1 ? 1 : y) ? x : 2;",
      //   "let x = arg0;\nreturn arg1 || y ? x : 2;",
      // );
      // check(
      //   "let x = arg0; return (arg1 ? y : 1) ? 2 : x;",
      //   "let x = arg0;\nreturn !arg1 || y ? 2 : x;",
      // );
      // check(
      //   "let x = arg0; return (arg1 ? 1 : y) ? 2 : x;",
      //   "let x = arg0;\nreturn arg1 || y ? 2 : x;",
      // );
      // check("let x = arg0; return y || x;", "let x = arg0;\nreturn y || x;");
      // check("let x = arg0; return y && x;", "let x = arg0;\nreturn y && x;");
      // check("let x = arg0; return y ?? x;", "let x = arg0;\nreturn y ?? x;");

      // Cannot substitute code with side effects into branches
      check("let x = fn(); return x ? arg0 : y;", "return fn() ? arg0 : y;");
      check("let x = fn(); return arg0 ? x : y;", "let x = fn();\nreturn arg0 ? x : y;");
      check("let x = fn(); return arg0 ? y : x;", "let x = fn();\nreturn arg0 ? y : x;");
      check("let x = fn(); return x || arg0;", "return fn() || arg0;");
      check("let x = fn(); return x && arg0;", "return fn() && arg0;");
      check("let x = fn(); return x ?? arg0;", "return fn() ?? arg0;");
      check("let x = fn(); return arg0 || x;", "let x = fn();\nreturn arg0 || x;");
      check("let x = fn(); return arg0 && x;", "let x = fn();\nreturn arg0 && x;");
      check("let x = fn(); return arg0 ?? x;", "let x = fn();\nreturn arg0 ?? x;");

      // Test chaining
      check("let x = fn(); let y = x[prop]; let z = y.val; throw z", "throw fn()[prop].val;");
      check("let x = fn(), y = x[prop], z = y.val; throw z", "throw fn()[prop].val;");

      // Can substitute an initializer with side effects
      check("let x = 0; let y = ++x; return y", "let x = 0;\nreturn ++x;");

      // Can substitute an initializer without side effects past an expression without side effects
      check("let x = 0; let y = x; return [x, y]", "let x = 0;\nreturn [x, x];");

      // TODO: merge s_local
      // Cannot substitute an initializer with side effects past an expression without side effects
      // check(
      //   "let x = 0; let y = ++x; return [x, y]",
      //   "let x = 0, y = ++x;\nreturn [x, y];",
      // );

      // Cannot substitute an initializer without side effects past an expression with side effects
      // TODO: merge s_local
      // check(
      //   "let x = 0; let y = {valueOf() { x = 1 }}; let z = x; return [y == 1, z]",
      //   "let x = 0, y = { valueOf() {\n  x = 1;\n} }, z = x;\nreturn [y == 1, z];",
      // );

      // Cannot inline past a spread operator, since that evaluates code
      check("let x = arg0; return [...x];", "return [...arg0];");
      check("let x = arg0; return [x, ...arg1];", "return [arg0, ...arg1];");
      check("let x = arg0; return [...arg1, x];", "let x = arg0;\nreturn [...arg1, x];");
      // TODO: preserve call here
      // check("let x = arg0; return arg1(...x);", "return arg1(...arg0);");
      // check(
      //   "let x = arg0; return arg1(x, ...arg1);",
      //   "return arg1(arg0, ...arg1);",
      // );
      check("let x = arg0; return arg1(...arg1, x);", "let x = arg0;\nreturn arg1(...arg1, x);");

      // Test various statement kinds
      // TODO:
      // check("let x = arg0; arg1(x);", "arg1(arg0);");

      check("let x = arg0; throw x;", "throw arg0;");
      check("let x = arg0; return x;", "return arg0;");
      check("let x = arg0; if (x) return 1;", "if (arg0)\n  return 1;");
      check("let x = arg0; switch (x) { case 0: return 1; }", "switch (arg0) {\n  case 0:\n    return 1;\n}");
      check("let x = arg0; let y = x; return y + y;", "let y = arg0;\nreturn y + y;");

      // Loops must not be substituted into because they evaluate multiple times
      check("let x = arg0; do {} while (x);", "let x = arg0;\ndo\n  ;\nwhile (x);");

      // TODO: convert while(x) to for (;x;)
      check(
        "let x = arg0; while (x) return 1;",
        "let x = arg0;\nwhile (x)\n  return 1;",
        // "let x = arg0;\nfor (; x; )\n  return 1;",
      );
      check("let x = arg0; for (; x; ) return 1;", "let x = arg0;\nfor (;x; )\n  return 1;");

      // Can substitute an expression without side effects into a branch due to optional chaining
      // TODO:
      // check("let x = arg0; return arg1?.[x];", "return arg1?.[arg0];");
      // check("let x = arg0; return arg1?.(x);", "return arg1?.(arg0);");

      // Cannot substitute an expression with side effects into a branch due to optional chaining,
      // since that would change the expression with side effects from being unconditionally
      // evaluated to being conditionally evaluated, which is a behavior change
      check("let x = fn(); return arg1?.[x];", "let x = fn();\nreturn arg1?.[x];");
      check("let x = fn(); return arg1?.(x);", "let x = fn();\nreturn arg1?.(x);");

      // Can substitute an expression past an optional chaining operation, since it has side effects
      check("let x = arg0; return arg1?.a === x;", "let x = arg0;\nreturn arg1?.a === x;");
      check("let x = arg0; return arg1?.[0] === x;", "let x = arg0;\nreturn arg1?.[0] === x;");
      check("let x = arg0; return arg1?.(0) === x;", "let x = arg0;\nreturn arg1?.(0) === x;");
      check("let x = arg0; return arg1?.a[x];", "let x = arg0;\nreturn arg1?.a[x];");
      check("let x = arg0; return arg1?.a(x);", "let x = arg0;\nreturn arg1?.a(x);");
      // TODO:
      // check(
      //   "let x = arg0; return arg1?.[a][x];",
      //   "let x = arg0;\nreturn arg1?.[a][x];",
      // );
      check("let x = arg0; return arg1?.[a](x);", "let x = arg0;\nreturn (arg1?.[a])(x);");
      check("let x = arg0; return arg1?.(a)[x];", "let x = arg0;\nreturn (arg1?.(a))[x];");
      check("let x = arg0; return arg1?.(a)(x);", "let x = arg0;\nreturn (arg1?.(a))(x);");

      // Can substitute into an object as long as there are no side effects
      // beforehand. Note that computed properties must call "toString()" which
      // can have side effects.
      check("let x = arg0; return {x};", "return { x: arg0 };");
      check("let x = arg0; return {x: y, y: x};", "let x = arg0;\nreturn { x: y, y: x };");
      // TODO:
      // check(
      //   "let x = arg0; return {x: arg1, y: x};",
      //   "return { x: arg1, y: arg0 };",
      // );
      check("let x = arg0; return {[x]: 0};", "return { [arg0]: 0 };");
      check("let x = arg0; return {[y]: x};", "let x = arg0;\nreturn { [y]: x };");
      check("let x = arg0; return {[arg1]: x};", "let x = arg0;\nreturn { [arg1]: x };");
      // TODO:
      // check(
      //   "let x = arg0; return {y() {}, x};",
      //   "return { y() {\n}, x: arg0 };",
      // );
      check("let x = arg0; return {[y]() {}, x};", "let x = arg0;\nreturn { [y]() {\n}, x };");
      check("let x = arg0; return {...x};", "return { ...arg0 };");
      check("let x = arg0; return {...x, y};", "return { ...arg0, y };");
      check("let x = arg0; return {x, ...y};", "return { x: arg0, ...y };");
      check("let x = arg0; return {...y, x};", "let x = arg0;\nreturn { ...y, x };");

      // TODO:
      // Check substitutions into template literals
      // check("let x = arg0; return `a${x}b${y}c`;", "return `a${arg0}b${y}c`;");
      // check(
      //   "let x = arg0; return `a${y}b${x}c`;",
      //   "let x = arg0;\nreturn `a${y}b${x}c`;",
      // );
      // check(
      //   "let x = arg0; return `a${arg1}b${x}c`;",
      //   "return `a${arg1}b${arg0}c`;",
      // );
      // check("let x = arg0; return x`y`;", "return arg0`y`;");
      // check(
      //   "let x = arg0; return y`a${x}b`;",
      //   "let x = arg0;\nreturn y`a${x}b`;",
      // );
      // check("let x = arg0; return arg1`a${x}b`;", "return arg1`a${arg0}b`;");
      // check("let x = 'x'; return `a${x}b`;", "return `axb`;");

      // Check substitutions into import expressions
      // TODO:
      // check("let x = arg0; return import(x);", "return import(arg0);");
      // check(
      //   "let x = arg0; return [import(y), x];",
      //   "let x = arg0;\nreturn [import(y), x];",
      // );
      // check(
      //   "let x = arg0; return [import(arg1), x];",
      //   "return [import(arg1), arg0];",
      // );

      // Check substitutions into await expressions
      check("return async () => { let x = arg0; await x; };", "return async () => {\n  await arg0;\n};");

      // TODO: combine with comma operator
      // check(
      //   "return async () => { let x = arg0; await y; return x; };",
      //   "return async () => {\n  let x = arg0;\n  return await y, x;\n};",
      // );
      // check(
      //   "return async () => { let x = arg0; await arg1; return x; };",
      //   "return async () => {\n  let x = arg0;\n  return await arg1, x;\n};",
      // );

      // Check substitutions into yield expressions
      check("return function* () { let x = arg0; yield x; };", "return function* () {\n  yield arg0;\n};");
      // TODO: combine with comma operator
      // check(
      //   "return function* () { let x = arg0; yield; return x; };",
      //   "return function* () {\n  let x = arg0;\n  yield ; \n  return x;\n};",
      // );
      // check(
      //   "return function* () { let x = arg0; yield y; return x; };",
      //   "return function* () {\n  let x = arg0;\n  return yield y, x;\n};",
      // );
      // check(
      //   "return function* () { let x = arg0; yield arg1; return x; };",
      //   "return function* () {\n  let x = arg0;\n  return yield arg1, x;\n};",
      // );

      // Cannot substitute into call targets when it would change "this"
      check("let x = arg0; x()", "arg0();");
      // check("let x = arg0; (0, x)()", "arg0();");
      check("let x = arg0.foo; x.bar()", "arg0.foo.bar();");
      check("let x = arg0.foo; x[bar]()", "arg0.foo[bar]();");
      check("let x = arg0.foo; x()", "let x = arg0.foo;\nx();");
      check("let x = arg0[foo]; x()", "let x = arg0[foo];\nx();");
      check("let x = arg0?.foo; x()", "let x = arg0?.foo;\nx();");
      check("let x = arg0?.[foo]; x()", "let x = arg0?.[foo];\nx();");
      // check("let x = arg0.foo; (0, x)()", "let x = arg0.foo;\nx();");
      // check("let x = arg0[foo]; (0, x)()", "let x = arg0[foo];\nx();");
      // check("let x = arg0?.foo; (0, x)()", "let x = arg0?.foo;\nx();");
      // check("let x = arg0?.[foo]; (0, x)()", "let x = arg0?.[foo];\nx();");
    });

    it("constant folding", () => {
      expectPrinted("1 && 2", "2");
      expectPrinted("1 || 2", "1");
      expectPrinted("0 && 1", "0");
      expectPrinted("0 || 1", "1");

      expectPrinted("null ?? 1", "1");
      expectPrinted("undefined ?? 1", "1");
      expectPrinted("0 ?? 1", "0");
      expectPrinted("false ?? 1", "false");
      expectPrinted('"" ?? 1', '""');

      expectPrinted("typeof undefined", '"undefined"');
      expectPrinted("typeof null", '"object"');
      expectPrinted("typeof false", '"boolean"');
      expectPrinted("typeof true", '"boolean"');
      expectPrinted("typeof 123", '"number"');
      expectPrinted("typeof 123n", '"bigint"');
      expectPrinted("typeof 'abc'", '"string"');
      expectPrinted("typeof function() {}", '"function"');
      expectPrinted("typeof (() => {})", '"function"');
      expectPrinted("typeof {}", '"object"');
      expectPrinted("typeof {foo: 123}", '"object"');
      expectPrinted("typeof []", '"object"');
      expectPrinted("typeof [0]", '"object"');
      expectPrinted("typeof [null]", '"object"');
      expectPrinted("typeof ['boolean']", '"object"');

      expectPrinted('typeof [] === "object"', "true");
      expectPrinted("typeof {foo: 123} === typeof {bar: 123}", "true");
      expectPrinted("typeof {foo: 123} !== typeof 123", "true");

      expectPrinted("undefined === undefined", "true");
      expectPrinted("undefined !== undefined", "false");
      expectPrinted("undefined == undefined", "true");
      expectPrinted("undefined != undefined", "false");

      expectPrinted("null === null", "true");
      expectPrinted("null !== null", "false");
      expectPrinted("null == null", "true");
      expectPrinted("null != null", "false");

      expectPrinted("undefined === null", "undefined === null");
      expectPrinted("undefined !== null", "undefined !== null");
      expectPrinted("undefined == null", "undefined == null");
      expectPrinted("undefined != null", "undefined != null");

      expectPrinted("true === true", "true");
      expectPrinted("true === false", "false");
      expectPrinted("true !== true", "false");
      expectPrinted("true !== false", "true");
      expectPrinted("true == true", "true");
      expectPrinted("true == false", "false");
      expectPrinted("true != true", "false");
      expectPrinted("true != false", "true");

      expectPrinted("1 === 1", "true");
      expectPrinted("1 === 2", "false");
      expectPrinted("1 === '1'", '1 === "1"');
      expectPrinted("1 == 1", "true");
      expectPrinted("1 == 2", "false");
      expectPrinted("1 == '1'", '1 == "1"');

      expectPrinted("1 !== 1", "false");
      expectPrinted("1 !== 2", "true");
      expectPrinted("1 !== '1'", '1 !== "1"');
      expectPrinted("1 != 1", "false");
      expectPrinted("1 != 2", "true");
      expectPrinted("1 != '1'", '1 != "1"');

      expectPrinted("'a' === '\\x61'", "true");
      expectPrinted("'a' === '\\x62'", "false");
      expectPrinted("'a' === 'abc'", "false");
      expectPrinted("'a' !== '\\x61'", "false");
      expectPrinted("'a' !== '\\x62'", "true");
      expectPrinted("'a' !== 'abc'", "true");
      expectPrinted("'a' == '\\x61'", "true");
      expectPrinted("'a' == '\\x62'", "false");
      expectPrinted("'a' == 'abc'", "false");
      expectPrinted("'a' != '\\x61'", "false");
      expectPrinted("'a' != '\\x62'", "true");
      expectPrinted("'a' != 'abc'", "true");

      expectPrinted("'a' + 'b'", '"ab"');
      expectPrinted("'a' + 'bc'", '"abc"');
      expectPrinted("'ab' + 'c'", '"abc"');
      expectPrinted("x + 'a' + 'b'", 'x + "ab"');
      expectPrinted("x + 'a' + 'bc'", 'x + "abc"');
      expectPrinted("x + 'ab' + 'c'", 'x + "abc"');
      expectPrinted("'a' + 1", '"a" + 1');
      expectPrinted("x * 'a' + 'b'", 'x * "a" + "b"');

      expectPrinted("'string' + `template`", `"stringtemplate"`);

      expectPrinted("`template` + 'string'", "`templatestring`");

      // TODO: string template simplification
      // expectPrinted("'string' + `a${foo}b`", "`stringa${foo}b`");
      // expectPrinted("'string' + tag`template`", '"string" + tag`template`;');
      // expectPrinted("`a${foo}b` + 'string'", "`a${foo}bstring`");
      // expectPrinted("tag`template` + 'string'", 'tag`template` + "string"');
      // expectPrinted("`template` + `a${foo}b`", "`templatea${foo}b`");
      // expectPrinted("`a${foo}b` + `template`", "`a${foo}btemplate`");
      // expectPrinted("`a${foo}b` + `x${bar}y`", "`a${foo}bx${bar}y`");
      // expectPrinted(
      //   "`a${i}${j}bb` + `xxx${bar}yyyy`",
      //   "`a${i}${j}bbxxx${bar}yyyy`"
      // );
      // expectPrinted(
      //   "`a${foo}bb` + `xxx${i}${j}yyyy`",
      //   "`a${foo}bbxxx${i}${j}yyyy`"
      // );
      // expectPrinted(
      //   "`template` + tag`template2`",
      //   "`template` + tag`template2`"
      // );
      // expectPrinted(
      //   "tag`template` + `template2`",
      //   "tag`template` + `template2`"
      // );

      expectPrinted("123", "123");
      expectPrinted("123 .toString()", "123 .toString()");
      expectPrinted("-123", "-123");
      expectPrinted("(-123).toString()", "(-123).toString()");
      expectPrinted("-0", "-0");
      expectPrinted("(-0).toString()", "(-0).toString()");
      expectPrinted("-0 === 0", "true");

      expectPrinted("NaN", "NaN");
      expectPrinted("NaN.toString()", "NaN.toString()");
      expectPrinted("NaN === NaN", "false");

      expectPrinted("Infinity", "Infinity");
      expectPrinted("Infinity.toString()", "Infinity.toString()");
      expectPrinted("(-Infinity).toString()", "(-Infinity).toString()");
      expectPrinted("Infinity === Infinity", "true");
      expectPrinted("Infinity === -Infinity", "false");

      expectPrinted("123n === 1_2_3n", "true");
    });
    describe("type coercions", () => {
      const dead = `
      if ("") {
        TEST_FAIL
      }

      if (false) {
        TEST_FAIL
      }

      if (0) {
        TEST_FAIL
      }

      if (void 0) {
        TEST_FAIL
      }

      if (null) {
        TEST_FAIL
      }

      var should_be_true = typeof "" === "string" || false
      var should_be_false = typeof "" !== "string" && TEST_FAIL;
      var should_be_false_2 = typeof true === "string" && TEST_FAIL;
      var should_be_false_3 = typeof false === "string" && TEST_FAIL;
      var should_be_false_4 = typeof 123n === "string" && TEST_FAIL;
      var should_be_false_5 = typeof function(){} === "string" && TEST_FAIL;
      var should_be_kept = typeof globalThis.BACON  === "string" && TEST_OK;
      var should_be_kept_1 = typeof TEST_OK  === "string";

      var should_be_kept_2 = TEST_OK ?? true;
      var should_be_kept_4 = { "TEST_OK": true } ?? TEST_FAIL;
      var should_be_false_6 = false ?? TEST_FAIL;
      var should_be_true_7 = true ?? TEST_FAIL;
    `;
      const out = transpiler.transformSync(dead);

      for (let line of out.split("\n")) {
        it(line, () => {
          if (line.includes("should_be_kept")) {
            expect(line.includes("TEST_OK")).toBe(true);
          }

          if (line.includes("should_be_false")) {
            if (!line.includes("= false")) throw new Error(`Expected false in "${line}"`);
            expect(line.includes("= false")).toBe(true);
          }

          if (line.includes("TEST_FAIL")) {
            throw new Error(`"${line}"\n\tshould not contain TEST_FAIL`);
          }
        });
      }
    });
  });

  describe("scan", () => {
    it("reports all export names", () => {
      const { imports, exports } = transpiler.scan(code);

      expect(exports[0]).toBe("action");
      expect(exports[2]).toBe("loader");
      expect(exports[1]).toBe("default");
      expect(exports).toHaveLength(3);

      expect(imports.filter(({ path }) => path === "remix")).toHaveLength(1);
      expect(imports.filter(({ path }) => path === "mod")).toHaveLength(0);
      expect(imports.filter(({ path }) => path === "react")).toHaveLength(1);
      expect(imports).toHaveLength(2);
    });
  });

  describe("transform", () => {
    // Async transform doesn't work in the test runner. Skipping for now.
    // This might be caused by incorrectly using shared memory between the two files.
    it.skip("supports macros", async () => {
      const out = await transpiler.transform(`
        import {keepSecondArgument} from 'macro:${require.resolve("./macro-check.js")}';

        export default keepSecondArgument("Test failed", "Test passed");
        export function otherNamesStillWork() {}
      `);
      expect(out.includes("Test failed")).toBe(false);
      expect(out.includes("Test passed")).toBe(true);

      // ensure both the import and the macro function call are removed
      expect(out.includes("keepSecondArgument")).toBe(false);
      expect(out.includes("otherNamesStillWork")).toBe(true);
    });

    it("sync supports macros", () => {
      const out = transpiler.transformSync(`
        import {keepSecondArgument} from 'macro:${import.meta.dir}/macro-check.js';

        export default keepSecondArgument("Test failed", "Test passed");
        export function otherNamesStillWork() {

        }
      `);
      expect(out.includes("Test failed")).toBe(false);
      expect(out.includes("Test passed")).toBe(true);

      expect(out.includes("keepSecondArgument")).toBe(false);
      expect(out.includes("otherNamesStillWork")).toBe(true);
    });

    it("special identifier in import statement", () => {
      const out = transpiler.transformSync(`
        import {ɵtest} from 'foo'
      `);

      expect(out).toBe('import {ɵtest} from "foo";\n');
    });

    const importLines = ["import {createElement, bacon} from 'react';", "import {bacon, createElement} from 'react';"];
    describe("sync supports macros remap", () => {
      for (let importLine of importLines) {
        it(importLine, () => {
          var thisCode = `
          ${importLine}
          
          export default bacon("Test failed", "Test passed");
          export function otherNamesStillWork() {
            return createElement("div");
          }
          
        `;
          var out = transpiler.transformSync(thisCode);
          try {
            expect(out.includes("Test failed")).toBe(false);
            expect(out.includes("Test passed")).toBe(true);

            expect(out.includes("bacon")).toBe(false);
            expect(out.includes("createElement")).toBe(true);
          } catch (e) {
            console.log("Failing code:\n\n" + out + "\n");
            throw e;
          }
        });
      }
    });

    it("macro remap removes import statement if its the only used one", () => {
      const out = transpiler.transformSync(`
        import {bacon} from 'react';

        export default bacon("Test failed", "Test passed");
      `);

      expect(out.includes("Test failed")).toBe(false);
      expect(out.includes("Test passed")).toBe(true);

      expect(out.includes("bacon")).toBe(false);
      expect(out.includes("import")).toBe(false);
    });

    it("removes types", () => {
      expect(code.includes("mod")).toBe(true);
      expect(code.includes("xx")).toBe(true);
      expect(code.includes("ActionFunction")).toBe(true);
      expect(code.includes("LoaderFunction")).toBe(true);
      expect(code.includes("ReactNode")).toBe(true);
      expect(code.includes("React")).toBe(true);
      expect(code.includes("Component")).toBe(true);
      const out = transpiler.transformSync(code);

      expect(out.includes("ActionFunction")).toBe(false);
      expect(out.includes("LoaderFunction")).toBe(false);
      expect(out.includes("mod")).toBe(false);
      expect(out.includes("xx")).toBe(false);
      expect(out.includes("ReactNode")).toBe(false);
      const { exports } = transpiler.scan(out);
      exports.sort();

      expect(exports[0]).toBe("action");
      expect(exports[2]).toBe("loader");
      expect(exports[1]).toBe("default");
      expect(exports).toHaveLength(3);
    });
  });
});
