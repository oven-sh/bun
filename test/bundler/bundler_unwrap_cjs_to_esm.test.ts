import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("minify.unwrapCJSToESM", () => {
  test("removes __commonJS wrapper for specified package with conditional exports", async () => {
    // Conditional module.exports normally causes __commonJS wrapper
    using dir = tempDir("unwrap-cjs-esm", {
      "entry.js": `
        import { hello } from 'my-cjs-pkg';
        console.log(hello);
      `,
      "node_modules/my-cjs-pkg/index.js": `
        var hello = "world";
        if (typeof process !== "undefined") {
          module.exports.hello = hello;
        } else {
          module.exports.hello = "browser";
        }
      `,
      "node_modules/my-cjs-pkg/package.json": JSON.stringify({
        name: "my-cjs-pkg",
        version: "1.0.0",
        main: "index.js",
      }),
    });

    // First verify that WITHOUT unwrapCJSToESM, we get __commonJS
    const buildWithout = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
    });
    expect(buildWithout.success).toBe(true);
    const outputWithout = await buildWithout.outputs[0].text();
    expect(outputWithout).toContain("__commonJS");

    // Now verify that WITH unwrapCJSToESM, __commonJS wrapper is removed
    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      minify: {
        unwrapCJSToESM: ["my-cjs-pkg"],
      },
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    const output = await build.outputs[0].text();
    expect(output).not.toContain("__commonJS");

    // Verify the bundle actually runs correctly
    const tmpFile = join(String(dir), "out.js");
    await Bun.write(tmpFile, output);
    await using proc = Bun.spawn({
      cmd: [bunExe(), tmpFile],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("world");
    expect(exitCode).toBe(0);
  });

  test("wildcard pattern matches scoped packages", async () => {
    using dir = tempDir("unwrap-cjs-esm-wc", {
      "entry.js": `
        import { value } from '@my-scope/sub-pkg';
        console.log(value);
      `,
      "node_modules/@my-scope/sub-pkg/index.js": `
        var val = 42;
        if (typeof process !== "undefined") {
          module.exports.value = val;
        } else {
          module.exports.value = 0;
        }
      `,
      "node_modules/@my-scope/sub-pkg/package.json": JSON.stringify({
        name: "@my-scope/sub-pkg",
        version: "1.0.0",
        main: "index.js",
      }),
    });

    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      minify: {
        unwrapCJSToESM: ["@my-scope/*"],
      },
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    const output = await build.outputs[0].text();
    expect(output).not.toContain("__commonJS");

    const tmpFile = join(String(dir), "out.js");
    await Bun.write(tmpFile, output);
    await using proc = Bun.spawn({
      cmd: [bunExe(), tmpFile],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("42");
    expect(exitCode).toBe(0);
  });

  test("default React packages still work without configuration", async () => {
    using dir = tempDir("unwrap-cjs-esm-react", {
      "entry.js": `
        import { hello } from 'react';
        console.log(hello);
      `,
      "node_modules/react/index.js": `
        var hello = "from-react";
        if (typeof process !== "undefined") {
          module.exports.hello = hello;
        } else {
          module.exports.hello = "browser";
        }
      `,
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        version: "19.0.0",
        main: "index.js",
      }),
    });

    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    const output = await build.outputs[0].text();
    // React is in the default unwrap list, so CJS should be unwrapped
    expect(output).not.toContain("__commonJS");

    const tmpFile = join(String(dir), "out.js");
    await Bun.write(tmpFile, output);
    await using proc = Bun.spawn({
      cmd: [bunExe(), tmpFile],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("from-react");
    expect(exitCode).toBe(0);
  });

  test("user config extends default list, not replaces it", async () => {
    // Both react (default) and custom-pkg (user-specified) should be unwrapped
    using dir = tempDir("unwrap-cjs-esm-extend", {
      "entry.js": `
        import { a } from 'react';
        import { b } from 'custom-pkg';
        console.log(a, b);
      `,
      "node_modules/react/index.js": `
        var a = "react-val";
        if (typeof process !== "undefined") {
          module.exports.a = a;
        } else {
          module.exports.a = "browser";
        }
      `,
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        version: "19.0.0",
        main: "index.js",
      }),
      "node_modules/custom-pkg/index.js": `
        var b = "custom-val";
        if (typeof process !== "undefined") {
          module.exports.b = b;
        } else {
          module.exports.b = "browser";
        }
      `,
      "node_modules/custom-pkg/package.json": JSON.stringify({
        name: "custom-pkg",
        version: "1.0.0",
        main: "index.js",
      }),
    });

    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      minify: {
        unwrapCJSToESM: ["custom-pkg"],
      },
    });

    expect(build.success).toBe(true);
    expect(build.outputs).toHaveLength(1);
    const output = await build.outputs[0].text();
    expect(output).not.toContain("__commonJS");

    const tmpFile = join(String(dir), "out.js");
    await Bun.write(tmpFile, output);
    await using proc = Bun.spawn({
      cmd: [bunExe(), tmpFile],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("react-val custom-val");
    expect(exitCode).toBe(0);
  });

  test("unlisted packages still get __commonJS wrapper", async () => {
    // A package NOT in the unwrap list should still get wrapped
    using dir = tempDir("unwrap-cjs-esm-unlisted", {
      "entry.js": `
        import { hello } from 'other-pkg';
        console.log(hello);
      `,
      "node_modules/other-pkg/index.js": `
        var hello = "world";
        if (typeof process !== "undefined") {
          module.exports.hello = hello;
        } else {
          module.exports.hello = "browser";
        }
      `,
      "node_modules/other-pkg/package.json": JSON.stringify({
        name: "other-pkg",
        version: "1.0.0",
        main: "index.js",
      }),
    });

    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.js")],
      minify: {
        unwrapCJSToESM: ["some-other-pkg"],
      },
    });

    expect(build.success).toBe(true);
    const output = await build.outputs[0].text();
    // other-pkg is NOT in the unwrap list, so it should still have __commonJS
    expect(output).toContain("__commonJS");
  });
});
