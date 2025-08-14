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
    // import.meta.env tests
    if (backend === "cli")
      itBundled("import-meta-env/inline", {
        env: {
          VITE_FOO: "vite_bar",
          VITE_BAZ: "vite_123",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(import.meta.env.VITE_FOO);
        console.log(import.meta.env.VITE_BAZ);
      `,
        },
        run: {
          env: {
            VITE_FOO: "vite_barz",
            VITE_BAZ: "vite_123z",
          },
          stdout: "vite_bar\nvite_123\n",
        },
      });

    itBundled("import-meta-env/disable", {
      env: {
        VITE_FOO: "vite_bar",
        VITE_BAZ: "vite_123",
      },
      backend: backend,
      dotenv: "disable",
      files: {
        "/a.js": `
        console.log(import.meta.env.VITE_FOO);
        console.log(import.meta.env.VITE_BAZ);
      `,
      },
      run: {
        stdout: "undefined\nundefined\n",
      },
    });

    if (backend === "cli")
      itBundled("import-meta-env/pattern-matching", {
        env: {
          VITE_PUBLIC_FOO: "vite_public_value",
          VITE_PUBLIC_BAR: "vite_another_public",
          VITE_PRIVATE_SECRET: "vite_secret_value",
        },
        dotenv: "VITE_PUBLIC_*",
        backend: backend,
        files: {
          "/a.js": `
        console.log(import.meta.env.VITE_PUBLIC_FOO);
        console.log(import.meta.env.VITE_PUBLIC_BAR);
        console.log(import.meta.env.VITE_PRIVATE_SECRET);
      `,
        },
        run: {
          env: {
            VITE_PUBLIC_FOO: "VITE_BAD_FOO",
            VITE_PUBLIC_BAR: "VITE_BAD_BAR",
          },
          stdout: "vite_public_value\nvite_another_public\nundefined\n",
        },
      });

    // Test mixing process.env and import.meta.env
    if (backend === "cli")
      itBundled("mixed-env/inline", {
        env: {
          NODE_ENV: "production",
          VITE_API_URL: "https://api.prod.com",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(process.env.NODE_ENV);
        console.log(import.meta.env.VITE_API_URL);
        console.log(import.meta.env.NODE_ENV);
        console.log(process.env.VITE_API_URL);
      `,
        },
        run: {
          env: {
            NODE_ENV: "development",
            VITE_API_URL: "https://api.dev.com",
          },
          stdout: "production\nhttps://api.prod.com\nproduction\nhttps://api.prod.com\n",
        },
      });
  });
}
