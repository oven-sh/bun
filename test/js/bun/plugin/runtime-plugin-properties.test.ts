import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Tests for https://github.com/oven-sh/bun/issues/3894
// Runtime plugin onLoad should receive namespace, loader, and other properties

test("runtime plugin onLoad receives namespace property", async () => {
  using dir = tempDir("runtime-plugin-namespace", {
    "test.ts": /* ts */ `
      import { plugin } from "bun";

      plugin({
        name: "namespace-test",
        setup(builder) {
          builder.onResolve({ filter: /\.custom$/ }, (args) => {
            return {
              path: args.path,
              namespace: "custom-namespace",
            };
          });

          builder.onLoad({ filter: /.*/, namespace: "custom-namespace" }, (args) => {
            return {
              exports: {
                namespace: args.namespace,
                path: args.path,
              },
              loader: "object",
            };
          });
        },
      });

      const result = await import("./test.custom");
      console.log(JSON.stringify(result));
    `,
    "test.custom": "dummy file",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  expect(result.namespace).toBe("custom-namespace");
  expect(result.path).toBe("./test.custom");
  expect(stderr).not.toContain("undefined");
  expect(exitCode).toBe(0);
});

test("runtime plugin onLoad receives loader property based on file extension", async () => {
  using dir = tempDir("runtime-plugin-loader", {
    "test.ts": /* ts */ `
      import { plugin } from "bun";

      plugin({
        name: "loader-test",
        setup(builder) {
          builder.onResolve({ filter: /\.js$/ }, (args) => {
            return {
              path: args.path,
              namespace: "loader-test",
            };
          });

          builder.onLoad({ filter: /.*/, namespace: "loader-test" }, (args) => {
            console.log(JSON.stringify({ loader: args.loader }));
            return {
              exports: {},
              loader: "object",
            };
          });
        },
      });

      await import("./test.js");
    `,
    "test.js": "",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  expect(result.loader).toBe("js");
  expect(exitCode).toBe(0);
});

test("runtime plugin with query string uses namespace workaround", async () => {
  using dir = tempDir("plugin-query-namespace", {
    "test.ts": /* ts */ `
      import { plugin } from "bun";

      const queryMap = new Map();

      plugin({
        name: "query-namespace-test",
        setup(builder) {
          builder.onResolve({ filter: /\.custom/ }, (args) => {
            const [path, query = ""] = args.path.split("?");
            const parsed = Object.fromEntries(new URLSearchParams(query));

            // Store query data (workaround for missing pluginData)
            if (Object.keys(parsed).length > 0) {
              queryMap.set(path, parsed);
            }

            return {
              path,
              namespace: "custom",
            };
          });

          builder.onLoad({ filter: /.*/, namespace: "custom" }, (args) => {
            const queryData = queryMap.get(args.path) || {};

            return {
              exports: {
                namespace: args.namespace,
                loader: args.loader,
                queryData,
              },
              loader: "object",
            };
          });
        },
      });

      const result = await import("./test.custom?type=example&id=123");
      console.log(JSON.stringify(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());

  expect(result.namespace).toBe("custom");
  expect(result.loader).toBe("file");
  expect(result.queryData).toEqual({ type: "example", id: "123" });
  expect(exitCode).toBe(0);
});

test("runtime plugin onLoad receives all properties", async () => {
  using dir = tempDir("runtime-plugin-all-props", {
    "test.ts": /* ts */ `
      import { plugin } from "bun";

      plugin({
        name: "all-props-test",
        setup(builder) {
          builder.onResolve({ filter: /file\.ts$/ }, (args) => {
            return {
              path: args.path,
              namespace: "test-namespace",
            };
          });

          builder.onLoad({ filter: /.*/, namespace: "test-namespace" }, (args) => {
            const props = {
              hasPath: "path" in args,
              hasNamespace: "namespace" in args,
              hasLoader: "loader" in args,
              namespace: args.namespace,
              loader: args.loader,
              allKeys: Object.keys(args).sort(),
            };
            console.log(JSON.stringify(props));
            return {
              exports: {},
              loader: "object",
            };
          });
        },
      });

      await import("./file.ts");
    `,
    "file.ts": "export default 42;",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const props = JSON.parse(stdout.trim());

  expect(props.hasPath).toBe(true);
  expect(props.hasNamespace).toBe(true);
  expect(props.hasLoader).toBe(true);
  expect(props.namespace).toBe("test-namespace");
  expect(props.loader).toBe("tsx");
  expect(props.allKeys).toEqual(["loader", "namespace", "path"]);
  expect(exitCode).toBe(0);
});
