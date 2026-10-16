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
          out(typeof console.log.bind(console));
          out("ALIVE");
        `,
      },
      drop: ["console", "my.logger", "Bun.inspect"],
      run: { stdout: "function\nALIVE" },
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
  // A dropped call loses its arguments, and so does `.bind`: `ASSERT` does not exist at
  // run time, and `label.cjs` must not be bundled.
  itBundled("drop/BindArgumentsAreRemoved", {
    files: {
      "/a.js": `
        const fail = () => process.stdout.write("FAIL\\n");
        const check = ASSERT.ok.bind(ASSERT, fail());
        check(false);
        console.log.bind(console, require("./label.cjs"))("FAIL");
        process.stdout.write("ALIVE\\n");
      `,
      "/label.cjs": `
        process.stdout.write("LABEL\\n");
        module.exports = "[app]";
      `,
    },
    drop: ["console", "ASSERT"],
    run: { stdout: "ALIVE" },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toContain("LABEL");
    },
  });
  // These call the dropped function, or a method of the dropped name, so they stay `undefined`.
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
      `,
    },
    drop: ["console", "Mousetrap", "hotkeys.bind", "app.keys.bind"],
    run: { stdout: "undefined\nundefined\nundefined\nundefined\nundefined\nundefined\nundefined" },
  });
  // The define renames `app` after the drop key matched it.
  itBundled("drop/BindDropKeyWithDefinedRoot", {
    files: {
      "/a.js": `
        const out = value => process.stdout.write(value + "\\n");
        const fail = () => out("FAIL");
        out(app.keys.bind("ctrl+s", fail()));
      `,
    },
    drop: ["app.keys.bind"],
    define: { app: "other" },
    run: { stdout: "undefined" },
  });
});
