import { describe } from "bun:test";
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

    // Test optional chaining with process?.env?.VAR
    if (backend === "cli")
      itBundled("env/optional-chaining", {
        env: {
          MY_VAR: "my_value",
          ANOTHER: "another_value",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        // Test optional chaining patterns
        console.log(process?.env?.MY_VAR);
        console.log(process?.env?.ANOTHER);
        // Mixed optional chaining
        console.log(process?.env.MY_VAR);
        console.log(process.env?.MY_VAR);
      `,
        },
        run: {
          env: {
            MY_VAR: "wrong",
            ANOTHER: "wrong",
          },
          stdout: "my_value\nanother_value\nmy_value\nmy_value\n",
        },
      });

    // Test optional chaining with bracket notation
    if (backend === "cli")
      itBundled("env/optional-chaining-bracket", {
        env: {
          BRACKET_VAR: "bracket_value",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        // Test optional chaining with bracket notation
        console.log(process?.env?.["BRACKET_VAR"]);
        console.log(process?.env["BRACKET_VAR"]);
        console.log(process.env?.["BRACKET_VAR"]);
      `,
        },
        run: {
          env: {
            BRACKET_VAR: "wrong",
          },
          stdout: "bracket_value\nbracket_value\nbracket_value\n",
        },
      });

    // Test import.meta.env.* inlining
    if (backend === "cli")
      itBundled("env/import-meta-env", {
        env: {
          VITE_API_URL: "https://api.example.com",
          MY_SECRET: "secret123",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        // Test import.meta.env.* inlining (Vite compatibility)
        console.log(import.meta.env.VITE_API_URL);
        console.log(import.meta.env.MY_SECRET);
      `,
        },
        run: {
          env: {
            VITE_API_URL: "wrong",
            MY_SECRET: "wrong",
          },
          stdout: "https://api.example.com\nsecret123\n",
        },
      });

    // Test import.meta.env with prefix matching
    if (backend === "cli")
      itBundled("env/import-meta-env-prefix", {
        env: {
          VITE_PUBLIC: "public_value",
          VITE_PRIVATE: "private_value",
          OTHER_VAR: "other_value",
        },
        backend: backend,
        dotenv: "VITE_*",
        files: {
          "/a.js": `
        // Test import.meta.env with prefix matching
        console.log(import.meta.env.VITE_PUBLIC);
        console.log(import.meta.env.VITE_PRIVATE);
        console.log(import.meta.env.OTHER_VAR);
      `,
        },
        run: {
          env: {
            VITE_PUBLIC: "wrong",
            VITE_PRIVATE: "wrong",
          },
          stdout: "public_value\nprivate_value\nundefined\n",
        },
      });
  });
}
