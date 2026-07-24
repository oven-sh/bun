import { describe, expect } from "bun:test";
import { itBundled } from "./expectBundled";

for (let backend of ["api", "cli"] as const) {
  describe(`bundler/${backend}`, () => {
    // TODO: make this work as expected with process.env isntead of relying on the initial env vars.
    if (backend === "cli")
      itBundled("env/inline", {
        env: {
          FOO: "bar",
          BAZ: "123",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(process.env.FOO);
        console.log(process.env.BAZ);
      `,
        },
        run: {
          env: {
            FOO: "barz",
            BAZ: "123z",
          },
          stdout: "bar\n123\n",
        },
      });

    itBundled("env/inline system", {
      env: {
        PATH: process.env.PATH,
      },
      backend: backend,
      dotenv: "inline",
      files: {
        "/a.js": `
        console.log(process.env.PATH);
      `,
      },
      run: {
        env: {
          PATH: "/fail",
        },
        stdout: process.env.PATH + "\n",
      },
    });

    // Test disable mode - no env vars are inlined
    itBundled("env/disable", {
      env: {
        FOO: "bar",
        BAZ: "123",
      },
      backend: backend,
      dotenv: "disable",
      files: {
        "/a.js": `
        console.log(process.env.FOO);
        console.log(process.env.BAZ);
      `,
      },
      run: {
        stdout: "undefined\nundefined\n",
      },
    });

    // TODO: make this work as expected with process.env isntead of relying on the initial env vars.
    // Test pattern matching - only vars with prefix are inlined
    if (backend === "cli")
      itBundled("env/pattern-matching", {
        env: {
          PUBLIC_FOO: "public_value",
          PUBLIC_BAR: "another_public",
          PRIVATE_SECRET: "secret_value",
        },
        dotenv: "PUBLIC_*",
        backend: backend,
        files: {
          "/a.js": `
        console.log(process.env.PUBLIC_FOO);
        console.log(process.env.PUBLIC_BAR);
        console.log(process.env.PRIVATE_SECRET);
      `,
        },
        run: {
          env: {
            PUBLIC_FOO: "BAD_FOO",
            PUBLIC_BAR: "BAD_BAR",
          },
          stdout: "public_value\nanother_public\nundefined\n",
        },
      });

    // An explicit `define` entry for process.env.X must win over the
    // env-option-derived entry for the same X, even when X is set in the
    // build environment.
    if (backend === "cli")
      for (const target of ["browser", "node", "bun"] as const) {
        itBundled(`env/inline-define-precedence-${target}`, {
          env: {
            APP_MODE: "fromenv",
          },
          backend,
          target,
          dotenv: "inline",
          define: {
            "process.env.APP_MODE": '"FROMDEFINE"',
          },
          files: {
            "/a.js": `
          console.log(process.env.APP_MODE);
        `,
          },
          onAfterBundle(api) {
            const out = api.readFile("out.js");
            expect(out).toContain('"FROMDEFINE"');
            expect(out).not.toContain("fromenv");
          },
          run: {
            env: {
              APP_MODE: "runtime",
            },
            stdout: "FROMDEFINE\n",
          },
        });
      }

    if (backend === "cli")
      itBundled("env/prefix-define-precedence", {
        env: {
          APP_MODE: "fromenv",
          APP_OTHER: "other_fromenv",
        },
        backend,
        target: "node",
        dotenv: "APP_*",
        define: {
          "process.env.APP_MODE": '"FROMDEFINE"',
        },
        files: {
          "/a.js": `
        console.log(process.env.APP_MODE);
        console.log(process.env.APP_OTHER);
      `,
        },
        onAfterBundle(api) {
          const out = api.readFile("out.js");
          expect(out).toContain('"FROMDEFINE"');
          expect(out).not.toContain('"fromenv"');
          expect(out).toContain('"other_fromenv"');
        },
        run: {
          env: {
            APP_MODE: "runtime",
            APP_OTHER: "runtime_other",
          },
          stdout: "FROMDEFINE\nother_fromenv\n",
        },
      });

    if (backend === "cli")
      // Test nested environment variable references
      itBundled("nested-refs", {
        env: {
          BASE_URL: "https://api.example.com",
          SHOULD_PRINT_BASE_URL: "process.env.BASE_URL",
          SHOULD_PRINT_$BASE_URL: "$BASE_URL",
        },
        dotenv: "inline",
        backend: backend,
        files: {
          "/a.js": `
      // Test nested references
      console.log(process.env.SHOULD_PRINT_BASE_URL);
      console.log(process.env.SHOULD_PRINT_$BASE_URL);
    `,
        },
        run: {
          env: {
            "BASE_URL": "https://api.example.com",
          },
          stdout: "process.env.BASE_URL\n$BASE_URL",
        },
      });
  });
}
