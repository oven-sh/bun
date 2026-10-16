import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("drop/FunctionCall", {
    files: {
      "/a.js": `console.log("hello");`,
    },
    run: { stdout: "" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("drop/DebuggerStmt", {
    files: {
      "/a.js": `if(true){debugger;debugger;};debugger;function y(){ debugger; }y()`,
    },
    drop: ["debugger"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude("debugger");
    },
  });
  itBundled("drop/NoDisableDebugger", {
    files: {
      "/a.js": `if(true){debugger;debugger;};debugger;function y(){ debugger; }y();`,
    },
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").toIncludeRepeated("debugger", 4);
    },
  });
  itBundled("drop/RemovesSideEffects", {
    files: {
      "/a.js": `console.log(alert());`,
    },
    run: { stdout: "" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("drop/ReassignKeepsOutput", {
    files: {
      "/a.js": `var call = console.log; call("hello");`,
    },
    run: { stdout: "hello" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("drop/AssignKeepsOutput", {
    files: {
      "/a.js": `var call = console.log("a"); globalThis.console.log(call);`,
    },
    run: { stdout: "undefined" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("drop/UnaryExpression", {
    files: {
      "/a.js": `Bun.inspect(); console.log("hello");`,
    },
    run: { stdout: "" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("drop/0Args", {
    files: {
      "/a.js": `console.log();`,
    },
    run: { stdout: "" },
    drop: ["console"],
  });
  itBundled("drop/BecomesUndefined", {
    files: {
      "/a.js": `console.log(Bun.inspect.table());`,
    },
    run: { stdout: "undefined" },
    drop: ["Bun.inspect.table"],
  });
  itBundled("drop/BecomesUndefinedNested1", {
    files: {
      "/a.js": `console.log(Bun.inspect.table());`,
    },
    run: { stdout: "undefined" },
    drop: ["Bun.inspect"],
  });
  itBundled("drop/BecomesUndefinedNested2", {
    files: {
      "/a.js": `console.log(Bun.inspect.table());`,
    },
    run: { stdout: "undefined" },
    drop: ["Bun"],
  });
  itBundled("drop/AssignTarget", {
    files: {
      "/a.js": `console.log(
      (
      Bun.inspect.table = (() => 123) 
    )());`,
    },
    run: { stdout: "123" },
    drop: ["Bun"],
  });
  itBundled("drop/DeleteAssignTarget", {
    files: {
      "/a.js": `console.log((delete Bun.inspect()));`,
    },
    run: { stdout: "true" },
    drop: ["Bun"],
  });
  itBundled("drop/IdentifierCall", {
    files: {
      "/a.js": `ASSERT("hello");`,
    },
    run: { stdout: "" },
    drop: ["ASSERT"],
    backend: "api",
  });

  // `console.log.bind(console)` does not call console.log. It makes a function that the
  // program calls later, so it must stay a function.
  for (const [suffix, options] of [
    ["", { backend: "api" }],
    ["Cli", { backend: "cli" }],
    ["NoBundle", { bundling: false }],
    ["MinifySyntax", { minifySyntax: true }],
  ] as const) {
    itBundled(`drop/BindStaysCallable${suffix}`, {
      files: {
        "/a.js": `
          const out = text => process.stdout.write(text + "\\n");
          globalThis.my = { logger() { out("FAIL"); } };
          const log = console.log.bind(console);
          log("FAIL");
          const logger = { info: console.info.bind(console), warn: console.warn.bind(console) };
          logger.info("FAIL");
          logger.warn("FAIL");
          class Logger {
            log = console.log.bind(console);
          }
          new Logger().log("FAIL");
          function withDefault(log = console.log.bind(console)) {
            log("FAIL");
          }
          withDefault();
          console.log.bind(console)("FAIL");
          console.log.bind(console).bind(null)("FAIL");
          console.log?.bind(console)("FAIL");
          console?.log.bind(console)("FAIL");
          console.log.bind?.(console)("FAIL");
          ["FAIL"].forEach(console.log.bind(console));
          Promise.reject(new Error("FAIL")).catch(console.error.bind(console));
          my.logger.bind(null)("FAIL");
          Bun.inspect.table.bind(null)("FAIL");
          // With minifySyntax, and at run time, these single-use locals are inlined and visited again.
          function viaAlias() {
            const m = my;
            return typeof m.logger.bind(null) === "function" ? "callable" : "broken";
          }
          function viaLocal() {
            const log = console.log.bind(console);
            return log("FAIL") || "called";
          }
          out(viaAlias());
          out(viaLocal());
          out(console.log.bind(console) ? "truthy" : "falsy");
          out(typeof console.log.bind(console));
          out(typeof console["log"].bind(console));
          out(typeof console.log["bind"](console));
          out("ALIVE");
        `,
      },
      drop: ["console", "my.logger", "Bun.inspect"],
      run: { stdout: "callable\ncalled\ntruthy\nfunction\nfunction\nfunction\nALIVE" },
      ...options,
    });
  }
  itBundled("drop/BindBecomesEmptyFunction", {
    files: {
      "/a.js": `export const log = console.log.bind(console);`,
    },
    drop: ["console"],
    bundling: false,
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("log = () => {}");
    },
  });
  // A dropped call loses its arguments, and so does `.bind`: `ASSERT` does not exist at run
  // time, `label.cjs` must not be bundled, and the scopes in the arguments are still visited.
  itBundled("drop/BindArgumentsAreRemoved", {
    files: {
      "/a.js": `
        const out = value => process.stdout.write(value + "\\n");
        const fail = () => out("FAIL");
        const v = 2;
        const check = ASSERT.ok.bind(ASSERT, fail());
        check(false);
        console.log.bind(console, require("./label.cjs"))("FAIL");
        console.log.bind(console, v => v, function f(b) { return b; }, class K { m() {} });
        class After { value() { return v; } }
        const after = () => new After().value();
        out(after());
        out("ALIVE");
      `,
      "/label.cjs": `
        process.stdout.write("LABEL\\n");
        module.exports = "[app]";
      `,
    },
    drop: ["console", "ASSERT"],
    run: { stdout: "2\nALIVE" },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toContain("LABEL");
    },
  });
  // These call the dropped function, or a method of the dropped name, so they stay `undefined`.
  // `app.keys.bind` and `lib.hot.keys.bind` are on the drop list, and so are `app` and `lib.hot`.
  itBundled("drop/BindKeepsPlainCallsDropped", {
    files: {
      "/a.js": `
        const out = value => process.stdout.write(value + "\\n");
        const fail = () => out("FAIL");
        out(console.log.call(console, fail()));
        out(console.log.apply(console, [fail()]));
        out(console.log.bind.call(console.log, fail()));
        out(console.bind(fail()));
        out(Mousetrap.bind("ctrl+s", fail()));
        out(hotkeys.bind("ctrl+s", fail()));
        out(app.keys.bind("ctrl+s", fail()));
        out(app.keys.bind?.("ctrl+s", fail()));
        out(app.keys?.bind("ctrl+s", fail()));
        out(app?.keys.bind("ctrl+s", fail()));
        out(app?.keys?.bind?.("ctrl+s", fail()));
        out(lib.hot.keys.bind("ctrl+s", fail()));
      `,
    },
    drop: ["console", "Mousetrap", "hotkeys.bind", "app", "app.keys.bind", "lib.hot", "lib.hot.keys.bind"],
    run: { stdout: Array(12).fill("undefined").join("\n") },
  });
  // One row for each spelling of a callee: "kept" when `callee(arg())` is not dropped, else
  // `typeof callee.bind(null)`. The third column is the value with `minifySyntax`, where
  // `a["b"]` is `a.b`.
  const bindOfDroppedCallee: [callee: string, expected: string, minified?: string][] = [
    ["debug.log", "function"],
    ["debug?.log", "function"],
    ["(debug.log)", "function"],
    ["debug.a.b", "function"],
    ['debug["log"]', "kept", "function"],
    ["debug[key]", "kept"],
    ["(0, debug.log)", "kept"],
    ["globalThis.debug.log", "kept"],
    ["debug.log.call", "function"],
    ["debug.log.bind", "function"],
    ['debug.log["bind"]', "kept", "function"],
    ["ASSERT.ok", "function"],
    ["my.logger", "function"],
    ["my?.logger", "kept"],
    ['my["logger"]', "kept", "function"],
    ["my.logger.info", "function"],
    ['my["logger"].info', "kept", "function"],
    ['lib["log"].info', "function"],
    // `ASSERT.bind(null)` looks the same as `Mousetrap.bind(key, fn)`: a call of a dropped method.
    ["ASSERT", "undefined"],
    // `debug.a.bind` is on the drop list.
    ["debug.a", "undefined"],
    // Not a `drop` name: the HMR API without HMR.
    ["import.meta.hot.accept", "undefined"],
    // The define renames `renamed` after the drop key matched it.
    ["renamed.log", "undefined"],
  ];
  for (const minifySyntax of [false, true]) {
    itBundled(`drop/BindOfEachDroppedCallee${minifySyntax ? "MinifySyntax" : ""}`, {
      files: {
        "/a.js": `
          const fn = () => {};
          const namespace = { log: fn, info: fn, ok: fn, a: Object.assign(() => {}, { b: fn }) };
          Object.assign(globalThis, {
            key: "log",
            debug: namespace,
            other: namespace,
            ASSERT: Object.assign(() => {}, namespace),
            my: { logger: Object.assign(() => {}, namespace) },
            lib: { log: namespace },
          });
          let calls = 0;
          const arg = () => calls++;
          ${bindOfDroppedCallee
            .map(
              ([callee]) => `
                calls = 0;
                ${callee}(arg());
                process.stdout.write(${JSON.stringify(callee)} + ": " + (calls ? "kept" : typeof ${callee}.bind(null)) + "\\n");`,
            )
            .join("")}
        `,
      },
      drop: ["debug", "debug.a.bind", "ASSERT", "my.logger", "lib.log.info", "renamed.log"],
      define: { renamed: "other" },
      minifySyntax,
      run: {
        stdout: bindOfDroppedCallee
          .map(([callee, expected, minified]) => `${callee}: ${(minifySyntax && minified) || expected}`)
          .join("\n"),
      },
    });
  }
});
