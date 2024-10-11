import { itBundled } from "./expectBundled";

describe("bundler", () => {
  itBundled("js/drop", {
    files: {
      "/a.js": `console.log("hello");`,
    },
    run: { stdout: "" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("js/drop-reassign-keeps-output", {
    files: {
      "/a.js": `var call = console.log; call("hello");`,
    },
    run: { stdout: "hello" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("js/drop-assign-keeps-output", {
    files: {
      "/a.js": `var call = console.log("a"); globalThis.console.log(call);`,
    },
    run: { stdout: "undefined" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("js/drop-unary-expression", {
    files: {
      "/a.js": `Bun.inspect.table(); console.log("hello");`,
    },
    run: { stdout: "" },
    drop: ["console"],
    backend: "api",
  });
  itBundled("js/drop-0-args", {
    files: {
      "/a.js": `console.log();`,
    },
    run: { stdout: "" },
    drop: ["console"],
  });
  itBundled("js/drop-becomes-undefined", {
    files: {
      "/a.js": `console.log(Bun.inspect.table());`,
    },
    run: { stdout: "undefined" },
    drop: ["Bun.inspect.table"],
  });
  itBundled("js/drop-becomes-undefined-nested-1", {
    files: {
      "/a.js": `console.log(Bun.inspect.table());`,
    },
    run: { stdout: "undefined" },
    drop: ["Bun.inspect"],
  });
  itBundled("js/drop-becomes-undefined-nested-2", {
    files: {
      "/a.js": `console.log(Bun.inspect.table());`,
    },
    run: { stdout: "undefined" },
    drop: ["Bun"],
  });
  itBundled("js/drop-assign-target", {
    files: {
      "/a.js": `console.log(
      (
      Bun.inspect.table = (() => 123) 
    )());`,
    },
    run: { stdout: "123" },
    drop: ["Bun"],
  });
  itBundled("js/drop-delete-assign-target", {
    files: {
      "/a.js": `console.log((delete Bun.inspect()));`,
    },
    run: { stdout: "true" },
    drop: ["Bun"],
  });
});
