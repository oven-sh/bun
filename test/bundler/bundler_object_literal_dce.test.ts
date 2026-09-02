import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Property reads on a module-local plain object literal are side-effect free.
//
//   const A = { x: "x" };
//   const B = { y: A.x }; // unreferenced: both A and B tree-shake
//
// `A` has to be a top-level `const`/`let` whose initializer has only plain
// data properties (no getter, setter, spread, computed key or `__proto__`), the
// key has to be one of its own keys, and `A` must never be reassigned or used
// anywhere in the file other than as the object of a property read. Anything
// else keeps the read, since it may run user code.
//
// esbuild does not implement this. The "keep" cases are the ones esbuild keeps
// for a reason. The rollup cases are ported from rollup's `test/form/samples`
// and the rolldown cases from `crates/rolldown/tests/rolldown/tree_shaking`.

const plainObjectPropertyReadFiles = {
  "/entry.js": /* js */ `
    const removeSource = {
      x: "xxxxxxxx",
      y: 1,
      "quoted": 2,
      1: "one",
      nested: { deep: 3 },
      method() {},
      fn: () => {},
    };
    let removeLetSource = { x: "let" };

    const removeRead1 = { v: removeSource.x };
    const removeRead2 = removeSource.y;
    const removeRead3 = removeSource["quoted"];
    const removeRead4 = removeSource[1];
    const removeRead5 = removeSource?.x;
    const removeRead6 = removeSource.method;
    const removeRead7 = [removeSource.x, removeSource.y, removeSource.nested];
    const removeRead8 = removeLetSource.x;
    const removeRead9 = /* @__PURE__ */ removeMerge([removeSource.x, removeSource.nested]);
    const removeRead10 = removeSource.fn;
    const removeRead11 = removeSource.x === removeSource.y;
    class RemoveClass {
      static v = removeSource.x;
    }
    function removeMerge(list) {
      return list;
    }

    export function used() {
      return 1;
    }
    console.log(used());
  `,
};

describe("bundler", () => {
  itBundled("object_literal_dce/PlainObjectPropertyRead", {
    files: plainObjectPropertyReadFiles,
    dce: true,
    run: { stdout: "1" },
  });

  itBundled("object_literal_dce/PlainObjectPropertyReadMinifySyntax", {
    files: plainObjectPropertyReadFiles,
    minifySyntax: true,
    dce: true,
    run: { stdout: "1" },
  });

  // Every source here is something other than an untouched plain literal, so
  // each read may run user code and has to stay. The runtime output proves the
  // reads still happen, in order.
  itBundled("object_literal_dce/KeepReadsThatMayRunCode", {
    files: {
      "/entry.js": /* js */ `
        const KEEP_getter = { get x() { console.log("getter"); return 1; } };
        const KEEP_readGetter = KEEP_getter.x;

        const KEEP_setterOnly = { set x(v) {}, y: 1 };
        const KEEP_readSetterObject = KEEP_setterOnly.y;

        const KEEP_spreadFrom = { get x() { console.log("spread getter"); return 1; } };
        const KEEP_spread = { ...KEEP_spreadFrom, y: 2 };
        const KEEP_readSpread = KEEP_spread.y;

        let KEEP_key = "x";
        const KEEP_computed = { [KEEP_key]: 1, y: 2 };
        const KEEP_readComputed = KEEP_computed.y;

        const KEEP_proto = { get a() { console.log("proto getter"); return 1; } };
        const KEEP_withProto = { __proto__: KEEP_proto, x: 1 };
        const KEEP_readProtoGetter = KEEP_withProto.a;
        const POSSIBLE_REMOVAL_protoOwn = KEEP_withProto.x;

        const KEEP_proxy = new Proxy({ x: 1 }, { get(t, k) { console.log("proxy " + k); return t[k]; } });
        const KEEP_readProxy = KEEP_proxy.x;

        let KEEP_reassigned = { x: 1 };
        KEEP_reassigned = new Proxy({ x: 2 }, { get(t, k) { console.log("reassigned " + k); return t[k]; } });
        const KEEP_readReassigned = KEEP_reassigned.x;

        const KEEP_defined = { x: 1 };
        Object.defineProperty(KEEP_defined, "x", { get() { console.log("defineProperty"); return 1; } });
        const KEEP_readDefined = KEEP_defined.x;

        const KEEP_withMethod = { x: 1, install() { Object.defineProperty(this, "x", { get() { console.log("method"); return 1; } }); } };
        KEEP_withMethod.install();
        const KEEP_readAfterMethodCall = KEEP_withMethod.x;

        const KEEP_hoisted = { x: 1 };
        KEEP_mutate();
        const KEEP_readHoisted = KEEP_hoisted.x;
        function KEEP_mutate() {
          Object.defineProperty(KEEP_hoisted, "x", { get() { console.log("hoisted"); return 1; } });
        }

        const KEEP_deleted = { x: 1 };
        delete KEEP_deleted.x;
        KEEP_deleted.__proto__ = { get x() { console.log("deleted"); return 1; } };
        const KEEP_readDeleted = KEEP_deleted.x;

        const KEEP_escaped = { x: 1 };
        export function leak() { return KEEP_escaped; }
        const KEEP_readEscaped = KEEP_escaped.x;

        const KEEP_tag = { x() { console.log("tag"); } };
        KEEP_tag.x\`\`;
        const KEEP_readTag = KEEP_tag.x;

        const KEEP_nested = { x: { y: 1 } };
        const POSSIBLE_REMOVAL_deep = KEEP_nested.x.y;
        const KEEP_missing = { x: 1 };
        const POSSIBLE_REMOVAL_notOwn = KEEP_missing.y;
      `,
    },
    dce: true,
    run: {
      stdout: `
        getter
        spread getter
        proto getter
        proxy x
        reassigned x
        defineProperty
        method
        hoisted
        deleted
        tag
      `,
    },
  });

  // The declaration is visited after the read, so the read is never matched.
  // The bundle keeps the TDZ error.
  itBundled("object_literal_dce/ReadBeforeDeclarationIsKept", {
    files: {
      "/entry.js": /* js */ `
        const KEEP_tdz = KEEP_late.x;
        const KEEP_late = { x: 1 };
        export {};
      `,
    },
    dce: true,
    run: { error: "ReferenceError" },
  });

  // A write to a property (`x.key = v`) cannot install a getter, and an object
  // destructuring pattern only reads. Neither stops a later read from being
  // pure.
  itBundled("object_literal_dce/WritesAndDestructuringDoNotDeopt", {
    files: {
      "/entry.js": /* js */ `
        const written = { x: 1, y: 2 };
        written.x = 3;
        written.y++;
        const removeReadWritten = written.x;

        const removeDestructured = { x: 1, y: 2 };
        const { x: removeX } = removeDestructured;
        const removeReadDestructured = removeDestructured.y;

        export function used() {
          return written.x;
        }
        console.log(used());
      `,
    },
    dce: true,
    run: { stdout: "3" },
  });

  // `var` is left out: a second declaration is a plain redeclaration, not an
  // assignment, and a `var` in a single-statement `if` body may never run.
  itBundled("object_literal_dce/VarIsNotTracked", {
    files: {
      "/entry.js": /* js */ `
        var KEEP_redeclared = { x: 1 };
        var KEEP_redeclared = { get x() { console.log("redeclared getter"); return 2; } };
        const KEEP_readRedeclared = KEEP_redeclared.x;

        if (globalThis.never) var conditional = { x: 1 };
        const KEEP_readConditional = conditional?.x;
        export {};
      `,
    },
    dce: true,
    run: { stdout: "redeclared getter" },
  });

  // Reassigning the binding in a function that runs before the read.
  // Derived from rolldown `tree_shaking/reassigned_let_binding_not_pure`.
  itBundled("object_literal_dce/RolldownReassignedLetBindingNotPure", {
    files: {
      "/entry.js": /* js */ `
        let KEEP_send = { handler: () => {} };
        export function setup() {
          KEEP_send = { get handler() { console.log("getter"); return () => {}; } };
        }
        setup();
        const KEEP_unusedRead = KEEP_send.handler;
      `,
    },
    dce: true,
    run: { stdout: "getter" },
  });

  // The shape of three.js's ShaderLib: exported literals whose initializers
  // read each other. Nothing imports them, so all of them tree-shake. The
  // statements with side effects after the reads do not change that: only
  // code that runs between the declaration and the read could reach an
  // exported object from another module.
  itBundled("object_literal_dce/ExportedLiteralsReadingEachOther", {
    files: {
      "/entry.js": /* js */ `
        import { Vector3 } from "./three.js";
        console.log(new Vector3().length());
      `,
      "/three.js": /* js */ `
        export class Vector3 {
          length() { return 0; }
        }
        export const REMOVE_UniformsLib = {
          common: { diffuse: { value: 1 } },
          fog: { fogColor: { value: 2 } },
        };
        export const REMOVE_ShaderChunk = {
          meshbasic_vert: "REMOVE_VERTEX_SHADER_SOURCE",
          meshbasic_frag: "REMOVE_FRAGMENT_SHADER_SOURCE",
        };
        export const REMOVE_ShaderLib = {
          basic: {
            uniforms: /* @__PURE__ */ removeMergeUniforms([REMOVE_UniformsLib.common, REMOVE_UniformsLib.fog]),
            vertexShader: REMOVE_ShaderChunk.meshbasic_vert,
            fragmentShader: REMOVE_ShaderChunk.meshbasic_frag,
          },
        };
        function removeMergeUniforms(uniforms) {
          return Object.assign({}, ...uniforms);
        }
        console.log("three loaded");
        globalThis.__three = true;
      `,
    },
    dce: true,
    run: { stdout: "three loaded\n0" },
  });

  // Another module in an import cycle can reach an exported object through
  // its import binding, but only while this module hands control to it. A
  // read of an exported literal after a statement with unknown side effects
  // stays. A module-private literal cannot be reached that way.
  itBundled("object_literal_dce/ExportedLiteralReadAfterCallOut", {
    files: {
      "/entry.js": /* js */ `
        import { install, noop } from "./b.js";

        export const exported = { x: 1 };
        const removePrivate = { x: 1 };
        const removeReadBefore = exported.x;
        install();
        const KEEP_readAfter = exported.x;
        const removeReadPrivate = removePrivate.x;

        export const exportedLater = { x: 1 };
        noop();
        const KEEP_readLater = exportedLater.x;
      `,
      "/b.js": /* js */ `
        import { exported } from "./entry.js";
        export function install() {
          Object.defineProperty(exported, "x", { get() { console.log("cycle getter"); return 1; } });
        }
        export function noop() {}
      `,
    },
    dce: true,
    run: { stdout: "cycle getter" },
  });

  // A read that stays because its object escaped may itself run a getter,
  // which can reach another exported literal. It counts like any other
  // statement with side effects for the reads after it.
  itBundled("object_literal_dce/KeptReadCountsAsCallOut", {
    files: {
      "/entry.js": /* js */ `
        import { setup } from "./b.js";
        export const a = { x: 1 };
        setup(a);
        export const b = { y: 1 };
        const KEEP_readA = a.x;
        const KEEP_readB = b.y;
      `,
      "/b.js": /* js */ `
        import { b } from "./entry.js";
        export function setup(a) {
          Object.defineProperty(a, "x", {
            get() {
              console.log("a getter");
              Object.defineProperty(b, "y", { get() { console.log("b getter"); return 1; } });
              return 1;
            },
          });
        }
      `,
    },
    dce: true,
    run: { stdout: "a getter\nb getter" },
  });

  // A TypeScript enum is visited ahead of the other statements, but its
  // initializers run at the enum's own position.
  itBundled("object_literal_dce/EnumInitializerIsACallOut", {
    files: {
      "/entry.ts": /* ts */ `
        import { install } from "./b.js";
        export const obj = { x: 1 };
        enum E {
          A = install(),
        }
        const KEEP_read = obj.x;
        console.log(E.A);
      `,
      "/b.js": /* js */ `
        import { obj } from "./entry.ts";
        export function install() {
          Object.defineProperty(obj, "x", { get() { console.log("enum getter"); return 1; } });
          return 7;
        }
      `,
    },
    dce: true,
    run: { stdout: "enum getter\n7" },
  });

  // A direct eval can reach any binding by name without a visible reference.
  itBundled("object_literal_dce/DirectEvalKeepsReads", {
    files: {
      "/entry.js": /* js */ `
        const obj = { x: 1 };
        eval("Object.defineProperty(obj, 'x', { get() { console.log('eval getter'); return 1; } })");
        obj.x;
        const KEEP_read = obj.x;
        export {};
      `,
    },
    dce: true,
    run: { stdout: "eval getter\neval getter" },
  });

  // Ported from rollup `test/form/samples/keep-property-access-side-effects`
  // (the default `treeshake.propertyReadSideEffects: true`). None of the
  // objects is a plain literal binding read at an own key, so every read stays.
  itBundled("object_literal_dce/RollupKeepPropertyAccessSideEffects", {
    files: {
      "/entry.js": /* js */ `
        const KEEP_getter = {
          get foo() {
            console.log("effect");
          },
        };
        const KEEP_foo1 = KEEP_getter.foo;

        const KEEP_empty = {};
        try {
          const KEEP_foo2 = KEEP_empty.foo.tooDeep;
        } catch {
          console.log("tooDeep throws");
        }

        function KEEP_accessArg(arg) {
          try {
            const KEEP_foo3 = arg.tooDeep;
          } catch {
            console.log("arg throws");
          }
        }
        KEEP_accessArg(null);

        const KEEP_foo5 = {
          ...{
            get prop() {
              console.log("spread effect");
            },
          },
        };

        const KEEP_foo6 = (async function () {
          return {
            get then() {
              console.log("then effect");
              return () => {};
            },
          };
        })();
      `,
    },
    dce: true,
    run: {
      stdout: `
        effect
        tooDeep throws
        arg throws
        spread effect
        then effect
      `,
    },
  });

  // Ported from rollup `test/form/samples/side-effects-getters-and-setters`:
  // a getter or setter is a function call. rollup also drops the read of a
  // getter whose body has no effects; that is not attempted here.
  itBundled("object_literal_dce/RollupSideEffectsGettersAndSetters", {
    files: {
      "/entry.js": /* js */ `
        const KEEP_retained1 = {
          get effect() {
            console.log("effect");
          },
          get noEffect() {
            const x = 1;
            return x;
          },
        };
        KEEP_retained1.effect;
        KEEP_retained1["eff" + "ect"];
        const POSSIBLE_REMOVAL_noEffectRead = KEEP_retained1.noEffect;

        const KEEP_retained3 = {
          set effect(value) {
            console.log(value);
          },
        };
        KEEP_retained3.effect = "retained";

        const KEEP_retained7 = {
          foo: () => {},
          get foo() {
            return () => console.log("getter wins");
          },
        };
        KEEP_retained7.foo();
      `,
    },
    dce: true,
    run: {
      stdout: `
        effect
        effect
        retained
        getter wins
      `,
    },
  });

  // Ported from rollup `test/form/samples/object-expression/proto-property`:
  // `__proto__: value` and `"__proto__": value` set the prototype, so a read
  // of a key the literal does not own can hit a getter.
  itBundled("object_literal_dce/RollupObjectExpressionProtoProperty", {
    files: {
      "/entry.js": /* js */ `
        let removeBasic = { a: false };
        const removeBasicRead = removeBasic.a;

        let KEEP_proto = {
          get a() { console.log("proto a"); return true; },
        };

        let KEEP_plainProto = { __proto__: KEEP_proto };
        const KEEP_plainProtoRead = KEEP_plainProto.a;

        let KEEP_quotedProto = { "__proto__": KEEP_proto };
        const KEEP_quotedProtoRead = KEEP_quotedProto.a;
        export {};
      `,
    },
    dce: true,
    run: { stdout: "proto a\nproto a" },
  });

  // Ported from rollup `test/form/samples/object-expression/computed-properties`:
  // a number key and a string index name the same property. The computed key
  // `[2]` keeps that object out of the analysis, so its reads stay.
  itBundled("object_literal_dce/RollupObjectExpressionComputedProperties", {
    files: {
      "/entry.js": /* js */ `
        const removeNumberKeys = {
          "1": 1,
          2: 2,
        };
        const removeRead1 = removeNumberKeys["1"];
        const removeRead2 = removeNumberKeys[2];

        const KEEP_computed = {
          "1": 1,
          [2]: 2,
        };
        const POSSIBLE_REMOVAL_read1 = KEEP_computed[1];
        const POSSIBLE_REMOVAL_read2 = KEEP_computed["2"];
        export {};
      `,
    },
    dce: true,
  });

  // Ported from rollup `test/form/samples/object-define-property`: passing the
  // object to a call lets the callee redefine its properties.
  itBundled("object_literal_dce/RollupObjectDefineProperty", {
    files: {
      "/entry.js": /* js */ `
        const KEEP_defined = { foo: 1 };
        Object.defineProperty(KEEP_defined, "foo", { get() { console.log("defined"); return true; } });
        const KEEP_read = KEEP_defined.foo;

        const KEEP_defineds = { bar: 1 };
        Object.defineProperties(KEEP_defineds, { bar: { get() { console.log("defineds"); return true; } } });
        const KEEP_readBar = KEEP_defineds.bar;
        export {};
      `,
    },
    dce: true,
    run: { stdout: "defined\ndefineds" },
  });

  // Ported from rollup `test/form/samples/side-effects-object-literal-calls`:
  // calling a method passes the object as `this`.
  itBundled("object_literal_dce/RollupSideEffectsObjectLiteralCalls", {
    files: {
      "/entry.js": /* js */ `
        const KEEP_retained1 = {
          x: () => {},
          y() {
            Object.defineProperty(this, "x", { get() { console.log("x getter"); return () => {}; } });
          },
        };
        KEEP_retained1.y();
        const KEEP_readX = KEEP_retained1.x;

        const KEEP_retained2 = { x: () => {} };
        KEEP_retained2.x = () => console.log("replaced");
        KEEP_retained2.x();
        export {};
      `,
    },
    dce: true,
    run: { stdout: "x getter\nreplaced" },
  });

  // Ported from rolldown `tree_shaking/property_read_side_effects`, under the
  // default `propertyReadSideEffects`. `API_ENDPOINTS` is imported, so its
  // reads are not resolved in the importing file; the reads off a call result
  // stay in any case.
  itBundled("object_literal_dce/RolldownPropertyReadSideEffects", {
    files: {
      "/entry.js": /* js */ `
        import { API_ENDPOINTS } from "./constants.js";

        const POSSIBLE_REMOVAL_users = API_ENDPOINTS.USERS;
        const POSSIBLE_REMOVAL_posts = API_ENDPOINTS["POSTS"];

        function KEEP_test() {
          console.log("test function called");
          return { a: { b: { c: 1 } } };
        }
        try {
          API_ENDPOINTS[globalThis.unknown];
        } catch {}
        const KEEP_deep = KEEP_test().a.b.c;
        const KEEP_optional = KEEP_test()?.a?.b.c;
        export default {};
      `,
      "/constants.js": /* js */ `
        export const API_ENDPOINTS = {
          USERS: "/api/users",
          POSTS: "/api/posts",
        };
      `,
    },
    dce: true,
    run: { stdout: "test function called\ntest function called" },
  });
});
