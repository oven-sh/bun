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
  itBundled("drop/ImportedIdentifierCall", {
    files: {
      "/a.js": `
        import { devlog } from "./log";
        devlog("secret");
        process.stdout.write("KEEP\\n");
      `,
      "/log.js": `export const devlog = (...a) => process.stdout.write("DEVLOG " + a.join(",") + "\\n");`,
    },
    run: { stdout: "KEEP" },
    drop: ["devlog"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude(`"secret"`);
    },
  });
  itBundled("drop/ImportedDefaultCall", {
    files: {
      "/a.js": `
        import devlog from "./log";
        devlog("secret");
        process.stdout.write("KEEP\\n");
      `,
      "/log.js": `export default (...a) => process.stdout.write("DEVLOG " + a.join(",") + "\\n");`,
    },
    run: { stdout: "KEEP" },
    drop: ["devlog"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude(`"secret"`);
    },
  });
  itBundled("drop/LocalFunctionCall", {
    files: {
      "/a.js": `
        function localfn(s) { process.stdout.write("LOCAL " + s + "\\n"); }
        localfn("x");
        process.stdout.write("KEEP\\n");
      `,
    },
    run: { stdout: "KEEP" },
    drop: ["localfn"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude(`localfn("x")`);
    },
  });
  itBundled("drop/LocalConstCall", {
    files: {
      "/a.js": `
        const devlog2 = (s) => process.stdout.write("DEVLOG2 " + s + "\\n");
        devlog2("y");
        process.stdout.write("KEEP\\n");
      `,
    },
    run: { stdout: "KEEP" },
    drop: ["devlog2"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude(`devlog2("y")`);
    },
  });
  itBundled("drop/ImportedNamespaceRoot", {
    files: {
      "/a.js": `
        import * as ns from "./log";
        ns.devlog("namespace");
        process.stdout.write("KEEP\\n");
      `,
      "/log.js": `export const devlog = (...a) => process.stdout.write("DEVLOG " + a.join(",") + "\\n");`,
    },
    run: { stdout: "KEEP" },
    drop: ["ns"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude(`"namespace"`);
    },
  });
  itBundled("drop/BoundDotDefine", {
    files: {
      "/a.js": `
        const logger = { debug: (s) => process.stdout.write("DEBUG " + s + "\\n") };
        logger.debug("bound");
        process.stdout.write("KEEP\\n");
      `,
    },
    run: { stdout: "KEEP" },
    drop: ["logger.debug"],
    backend: "api",
    onAfterBundle(api) {
      api.expectFile("out.js").not.toInclude(`"bound"`);
    },
  });
  itBundled("drop/BoundIdentifierNonCallNotReplaced", {
    files: {
      "/a.js": `
        const devlog = (s) => process.stdout.write("DEVLOG " + s + "\\n");
        const ref = devlog;
        ref("alive");
      `,
    },
    run: { stdout: "DEVLOG alive" },
    drop: ["devlog"],
    backend: "api",
  });
  itBundled("drop/BoundDotNonCallNotReplaced", {
    files: {
      "/a.js": `
        const logger = { debug: (s) => process.stdout.write("DEBUG " + s + "\\n") };
        const ref = logger.debug;
        ref("alive");
      `,
    },
    run: { stdout: "DEBUG alive" },
    drop: ["logger.debug"],
    backend: "api",
  });
  itBundled("drop/DefineDoesNotReplaceBoundIdentifier", {
    files: {
      "/a.js": `
        const FOO = "local";
        console.log(FOO);
      `,
    },
    run: { stdout: "local" },
    define: { FOO: '"replaced"' },
    backend: "api",
  });
});
