import { describe, expect } from "bun:test";
import { dirname, join } from "path";
import { itBundled } from "./expectBundled";

// Import attributes (`with { ... }`) travel with the import record: an import
// that stays in the output keeps its clause for every target, the module
// graph keys a file by (path, attributes), and `type` picks the loader.

const externalEntry = /* js */ `
  import a from "./x.json" with { type: "json" };
  export { default as b } from "./y.json" with { type: "json" };
  export * from "./z.json" with { type: "json" };
  export * as ns from "./n.json" with { type: "json" };
  import q from "pkg" with { custom: "thing" };
  import "./side-effect.js" with { type: "js", "quoted-key": "v" };
  const c = import("./w.json", { with: { type: "json" } });
  console.log(a, q, c);
`;

const externalOutput = [
  `import a from "./x.json" with { type: "json" };`,
  `from "./y.json" with { type: "json" };`,
  `export * from "./z.json" with { type: "json" };`,
  `import q from "pkg" with { custom: "thing" };`,
  `"./side-effect.js" with { type: "js", "quoted-key": "v" };`,
  `import("./w.json", { with: { type: "json" } })`,
];
// The linker turns `export * as ns from` into an import plus an export clause.
const bundledExternalOutput = [...externalOutput, `import * as ns from "./n.json" with { type: "json" };`];
const noBundleOutput = [...externalOutput, `export * as ns from "./n.json" with { type: "json" };`];

describe("bundler", () => {
  for (const target of ["bun", "node", "browser"] as const) {
    itBundled(`import-attributes/external-keeps-attributes-${target}`, {
      target,
      external: ["*"],
      files: { "/entry.js": externalEntry },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        for (const line of bundledExternalOutput) {
          expect(out).toContain(line);
        }
      },
    });

    itBundled(`import-attributes/no-bundle-keeps-attributes-${target}`, {
      target,
      bundling: false,
      files: { "/entry.js": externalEntry },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        for (const line of noBundleOutput) {
          expect(out).toContain(line);
        }
      },
    });

    // `with` and `assert` are keywords in the output too, so minified code is
    // `"./x.json"with{type:"json"}`.
    itBundled(`import-attributes/minified-external-${target}`, {
      target,
      external: ["*"],
      minifyWhitespace: true,
      files: {
        "/entry.js": /* js */ `
          import a from "./x.json" with { type: "json" };
          export * from "./z.json" with { type: "json" };
          console.log(a);
        `,
      },
      onAfterBundle(api) {
        const out = api.readFile("/out.js");
        expect(out).toContain(`from"./x.json"with{type:"json"}`);
        expect(out).toContain(`export*from"./z.json"with{type:"json"}`);
      },
    });
  }

  // The legacy `assert` keyword is accepted and printed as `with`.
  itBundled("import-attributes/assert-prints-as-with", {
    target: "node",
    external: ["*"],
    files: {
      "/entry.js": /* js */ `
        import a from "./x.json" assert { type: "json" };
        console.log(a);
      `,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain(`import a from "./x.json" with { type: "json" };`);
      expect(out).not.toContain("assert");
    },
  });

  // `with` is a keyword: a newline before it is fine. (`assert` is not.)
  itBundled("import-attributes/newline-before-with", {
    target: "node",
    external: ["*"],
    files: {
      "/entry.js": `import a from "./x.json"\nwith { type: "json" };\nimport "./y.json"\nwith { type: "json" };\nconsole.log(a);\n`,
    },
    onAfterBundle(api) {
      const out = api.readFile("/out.js");
      expect(out).toContain(`import a from "./x.json" with { type: "json" };`);
      expect(out).toContain(`"./y.json" with { type: "json" };`);
    },
  });

  itBundled("import-attributes/duplicate-key-is-an-error", {
    files: {
      "/entry.js": `import "x" with { a: "b", a: "b" };`,
    },
    bundleErrors: {
      "/entry.js": ['Duplicate import attribute "a"'],
    },
  });

  // Two imports of one file with different attributes are two modules, in
  // either order; the first import no longer decides the loader for both.
  for (const [name, first, second] of [
    ["text-then-json", "text", "json"],
    ["json-then-text", "json", "text"],
  ] as const) {
    itBundled(`import-attributes/same-path-different-type-${name}`, {
      target: "bun",
      files: {
        "/entry.js": /* js */ `
          import first from "./data.json" with { type: "${first}" };
          import second from "./data.json" with { type: "${second}" };
          import plain from "./data.json";
          console.log(typeof first, typeof second, typeof plain);
        `,
        "/data.json": `{"a":1}`,
      },
      run: { stdout: `${first === "text" ? "string" : "object"} ${second === "text" ? "string" : "object"} object` },
    });
  }

  itBundled("import-attributes/same-path-different-type-dynamic", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        const a = await import("./data.json", { with: { type: "text" } });
        const b = await import("./data.json", { with: { type: "json" } });
        const c = await import("./data.json");
        console.log(typeof a.default, typeof b.default, typeof c.default, b.default.a);
      `,
      "/data.json": `{"a":1}`,
    },
    run: { stdout: "string object object 1" },
  });

  // The same holds when an onResolve plugin answers the resolution ...
  itBundled("import-attributes/same-path-different-type-onresolve-plugin", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        import first from "data:data.json" with { type: "text" };
        import second from "data:data.json" with { type: "json" };
        console.log(typeof first, typeof second);
      `,
      "/data.json": `{"a":1}`,
    },
    plugins(builder) {
      builder.onResolve({ filter: /^data:/ }, args => ({
        path: join(dirname(args.importer), args.path.slice("data:".length)),
      }));
    },
    run: { stdout: "string object" },
  });

  // ... and when a plugin's onResolve declines and the bundler resolves the file itself.
  itBundled("import-attributes/same-path-different-type-onresolve-no-match", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        import first from "./data.json" with { type: "text" };
        import second from "./data.json" with { type: "json" };
        console.log(typeof first, typeof second);
      `,
      "/data.json": `{"a":1}`,
    },
    plugins(builder) {
      builder.onResolve({ filter: /\.json$/ }, () => undefined);
    },
    run: { stdout: "string object" },
  });

  itBundled("import-attributes/unknown-type-with-onresolve-no-match", {
    files: {
      "/entry.js": /* js */ `
        import x from "./data.json" with { type: "nope" };
        console.log(x);
      `,
      "/data.json": `{"a":1}`,
    },
    plugins(builder) {
      builder.onResolve({ filter: /\.json$/ }, () => undefined);
    },
    bundleErrors: {
      "/entry.js": ['Importing with a type attribute of "nope" is not supported'],
    },
  });

  // Re-exports carry the attribute to the bundled module too.
  itBundled("import-attributes/bundled-re-exports", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        import { b, ns } from "./reexport.js";
        console.log(typeof b, JSON.stringify(ns.default));
      `,
      "/reexport.js": /* js */ `
        export { default as b } from "./data.json" with { type: "text" };
        export * as ns from "./data.json" with { type: "json" };
      `,
      "/data.json": `{"a":1}`,
    },
    run: { stdout: 'string {"a":1}' },
  });

  // An unknown `type` is an error for a file the bundler loads, and is left
  // alone on an external import.
  itBundled("import-attributes/unknown-type-is-an-error", {
    files: {
      "/entry.js": /* js */ `
        import x from "./data.json" with { type: "nope" };
        console.log(x);
      `,
      "/data.json": `{"a":1}`,
    },
    bundleErrors: {
      "/entry.js": ['Importing with a type attribute of "nope" is not supported'],
    },
  });

  itBundled("import-attributes/unknown-type-on-external-is-kept", {
    target: "node",
    external: ["./data.json"],
    files: {
      "/entry.js": /* js */ `
        import x from "./data.json" with { type: "nope" };
        console.log(x);
      `,
    },
    onAfterBundle(api) {
      expect(api.readFile("/out.js")).toContain(`import x from "./data.json" with { type: "nope" };`);
    },
  });

  // Non-`type` keys do not change how a bundled file loads.
  itBundled("import-attributes/custom-key-on-bundled-file", {
    target: "bun",
    files: {
      "/entry.js": /* js */ `
        import x from "./data.json" with { type: "json", custom: "thing" };
        console.log(JSON.stringify(x));
      `,
      "/data.json": `{"a":1}`,
    },
    run: { stdout: '{"a":1}' },
  });

  describe("bytes loader", () => {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    const check = /* js */ `
      console.log(
        data instanceof Uint8Array,
        data.constructor === Uint8Array,
        data.length,
        Array.from(data).join(","),
      );
    `;
    const expected = "true true 5 1,2,3,4,5";

    for (const target of ["bun", "node", "browser"] as const) {
      itBundled(`import-attributes/bytes-${target}`, {
        target,
        files: {
          "/entry.js": /* js */ `
            import data from "./data.bin" with { type: "bytes" };
            ${check}
          `,
          "/data.bin": bytes,
        },
        run: { stdout: expected, runtime: target === "bun" ? "bun" : "node" },
      });
    }

    itBundled("import-attributes/bytes-minified", {
      target: "node",
      minifySyntax: true,
      minifyWhitespace: true,
      minifyIdentifiers: true,
      files: {
        "/entry.js": /* js */ `
          import data from "./data.bin" with { type: "bytes" };
          ${check}
        `,
        "/data.bin": bytes,
      },
      run: { stdout: expected, runtime: "node" },
    });

    itBundled("import-attributes/bytes-cjs", {
      target: "node",
      format: "cjs",
      files: {
        "/entry.js": /* js */ `
          import data from "./data.bin" with { type: "bytes" };
          ${check}
        `,
        "/data.bin": bytes,
      },
      run: { stdout: expected, runtime: "node" },
    });

    itBundled("import-attributes/bytes-dynamic-import", {
      target: "bun",
      files: {
        "/entry.js": /* js */ `
          const { default: data } = await import("./data.bin", { with: { type: "bytes" } });
          ${check}
        `,
        "/data.bin": bytes,
      },
      run: { stdout: expected },
    });

    // The inlined base64 decodes without `Buffer` too (browsers).
    itBundled("import-attributes/bytes-without-Buffer", {
      target: "browser",
      files: {
        "/entry.js": /* js */ `
          import data from "./data.bin" with { type: "bytes" };
          import odd from "./odd.bin" with { type: "bytes" };
          import empty from "./empty.bin" with { type: "bytes" };
          console.log(
            Array.from(data).join(","),
            Array.from(odd).join(","),
            empty instanceof Uint8Array,
            empty.length,
          );
        `,
        "/data.bin": bytes,
        "/odd.bin": Buffer.from([255, 0, 128, 7, 9, 200, 33]),
        "/empty.bin": Buffer.alloc(0),
      },
      runtimeFiles: {
        "/run.js": /* js */ `
          globalThis.Buffer = undefined;
          await import("./out.js");
        `,
      },
      run: { file: "/run.js", stdout: "1,2,3,4,5 255,0,128,7,9,200,33 true 0" },
    });

    // The loader can also be chosen per extension, from the CLI and the API.
    for (const backend of ["cli", "api"] as const) {
      itBundled(`import-attributes/bytes-loader-option-${backend}`, {
        backend,
        target: "bun",
        loader: { ".bin": "bytes" },
        files: {
          "/entry.js": /* js */ `
            import data from "./data.bin";
            ${check}
          `,
          "/data.bin": bytes,
        },
        run: { stdout: expected },
      });
    }

    // A standalone executable embeds the raw bytes as an asset and serves them
    // as a Uint8Array without decoding anything.
    itBundled("import-attributes/bytes-compile", {
      compile: true,
      files: {
        "/entry.js": /* js */ `
          import data from "./data.bin" with { type: "bytes" };
          import text from "./data.txt";
          ${check}
          console.log(text);
        `,
        "/data.bin": bytes,
        "/data.txt": "hello",
      },
      run: { stdout: `${expected}\nhello` },
    });
  });
});
