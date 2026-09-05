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
  itBundled("drop/BindStaysCallable", {
    files: {
      "/a.js": `
        const log = console.log.bind(console);
        log("hello");
        process.stdout.write("ALIVE\\n");
      `,
    },
    drop: ["console"],
    backend: "api",
    run: { stdout: "ALIVE" },
    onAfterBundle(api) {
      api.expectFile("out.js").toContain("() => {");
      api.expectFile("out.js").not.toContain("= undefined");
    },
  });
  itBundled("drop/BindImmediateCall", {
    files: {
      "/a.js": `
        console.log.bind(console)("immediate");
        process.stdout.write("ALIVE\\n");
      `,
    },
    drop: ["console"],
    backend: "api",
    run: { stdout: "ALIVE" },
  });
  itBundled("drop/BindDotDefine", {
    files: {
      "/a.js": `
        const f = my.logger.bind(null);
        f("hello");
        process.stdout.write("ALIVE\\n");
      `,
    },
    drop: ["my.logger"],
    backend: "api",
    run: { stdout: "ALIVE" },
  });
  itBundled("drop/CallApplyStillDropped", {
    files: {
      "/a.js": `
        globalThis.console.log(console.log.call(console, "x"));
        globalThis.console.log(console.log.apply(console, ["y"]));
      `,
    },
    drop: ["console"],
    backend: "api",
    run: { stdout: "undefined\nundefined" },
  });
  itBundled("drop/BindNotCallTargetStillDropped", {
    files: {
      "/a.js": `globalThis.console.log(console.log.bind.call(console.log, console));`,
    },
    drop: ["console"],
    backend: "api",
    run: { stdout: "undefined" },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toContain("() => {");
    },
  });
  itBundled("drop/DotDefineEndingInBindStillDropped", {
    files: {
      "/a.js": `
        globalThis.handler = () => "SHOULD NOT RUN";
        globalThis.console.log(typeof Mousetrap.bind('ctrl+s', handler));
      `,
    },
    drop: ["Mousetrap.bind"],
    backend: "api",
    run: { stdout: "undefined" },
    onAfterBundle(api) {
      api.expectFile("out.js").not.toContain("() => {");
      api.expectFile("out.js").not.toContain("handler)");
    },
  });
});
