import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("module federation runtime loads an ESM remote entry and caches it", async () => {
  using dir = tempDir("module-federation-runtime", {
    "remote-entry.js": `
      globalThis.remoteEntryImportCount = (globalThis.remoteEntryImportCount ?? 0) + 1;
      let initCount = 0;
      let lastShareScope;
      const modules = {
        "./Button": () => ({ default: "button", initCount, shared: lastShareScope.react.version }),
      };
      export function get(request) {
        const factory = modules[request];
        if (!factory) throw new Error("unknown expose " + request);
        return factory;
      }
      export function init(shareScope) {
        initCount++;
        lastShareScope = shareScope;
        return initCount;
      }
    `,
    "host.js": `
      import { initShareScope, loadRemote, registerRemote } from "bun:module-federation-runtime";

      initShareScope("default", { react: { version: "19.0.0" } });
      registerRemote("remote", new URL("./remote-entry.js", import.meta.url).href, "module");

      const first = await loadRemote("remote/Button");
      const second = await loadRemote("remote/Button");
      console.log(JSON.stringify({
        first,
        second,
        importCount: globalThis.remoteEntryImportCount,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "host.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(
    `"{"first":{"default":"button","initCount":1,"shared":"19.0.0"},"second":{"default":"button","initCount":1,"shared":"19.0.0"},"importCount":1}"`,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation runtime loads a script global remote and caches the script", async () => {
  let serveFetchCount = 0;
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/remoteEntry.js") {
        return new Response("not found", { status: 404 });
      }

      serveFetchCount++;
      return new Response(
        `
          globalThis.scriptRemoteEvalCount = (globalThis.scriptRemoteEvalCount ?? 0) + 1;
          let initCount = 0;
          let lastShareScope;
          globalThis.app = {
            init(shareScope) {
              initCount++;
              lastShareScope = shareScope;
            },
            get(request) {
              if (request !== "./Button") throw new Error("unknown expose " + request);
              return () => ({ default: "script-button", initCount, shared: lastShareScope.react.version });
            },
          };
        `,
        { headers: { "Content-Type": "application/javascript" } },
      );
    },
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { initShareScope, loadRemote, registerRemote } from "bun:module-federation-runtime";

        initShareScope("default", { react: { version: "19.0.0" } });
        registerRemote("remote", "app@${server.url}remoteEntry.js");

        const first = await loadRemote("remote/Button");
        const second = await loadRemote("remote/Button");
        console.log(JSON.stringify({
          first,
          second,
          evalCount: globalThis.scriptRemoteEvalCount,
        }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(
    `"{"first":{"default":"script-button","initCount":1,"shared":"19.0.0"},"second":{"default":"script-button","initCount":1,"shared":"19.0.0"},"evalCount":1}"`,
  );
  expect(serveFetchCount).toBe(1);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation runtime loads a script remote from a manifest URL", async () => {
  let manifestFetchCount = 0;
  let remoteEntryFetchCount = 0;
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/mf-manifest.json") {
        manifestFetchCount++;
        return Response.json({
          name: "manifestApp",
          remoteEntry: {
            path: "remoteEntry.js",
            type: "script",
          },
        });
      }
      if (pathname !== "/remoteEntry.js") {
        return new Response("not found", { status: 404 });
      }

      remoteEntryFetchCount++;
      return new Response(
        `
          globalThis.manifestRemoteEvalCount = (globalThis.manifestRemoteEvalCount ?? 0) + 1;
          let initCount = 0;
          globalThis.manifestApp = {
            init() {
              initCount++;
            },
            get(request) {
              if (request !== "./Button") throw new Error("unknown expose " + request);
              return () => ({ default: "manifest-button", initCount });
            },
          };
        `,
        { headers: { "Content-Type": "application/javascript" } },
      );
    },
  });
  using dir = tempDir("module-federation-runtime-manifest-url", {
    "host.js": `
      import { loadRemote, registerRemote } from "bun:module-federation-runtime";

      registerRemote("remote", { manifest: "${server.url}mf-manifest.json" });
      const first = await loadRemote("remote/Button");
      const second = await loadRemote("remote/Button");
      console.log(JSON.stringify({
        first,
        second,
        evalCount: globalThis.manifestRemoteEvalCount,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "host.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(
    `"{"first":{"default":"manifest-button","initCount":1},"second":{"default":"manifest-button","initCount":1},"evalCount":1}"`,
  );
  expect(manifestFetchCount).toBe(1);
  expect(remoteEntryFetchCount).toBe(1);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation runtime loads a module remote from a manifest object", async () => {
  using dir = tempDir("module-federation-runtime-manifest-object", {
    "remote-entry.js": `
      let initCount = 0;
      export function init() {
        initCount++;
      }
      export function get(request) {
        if (request !== "./Button") throw new Error("unknown expose " + request);
        return () => ({ default: "manifest-object-button", initCount });
      }
    `,
    "host.js": `
      import { loadRemote, registerRemote } from "bun:module-federation-runtime";

      registerRemote("remote", {
        manifest: {
          remoteEntry: new URL("./remote-entry.js", import.meta.url).href,
          type: "module",
        },
      });
      const button = await loadRemote("remote/Button");
      console.log(JSON.stringify(button));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "host.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(
    `"{"default":"manifest-object-button","initCount":1}"`,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation runtime plugins observe remote load lifecycle and options", async () => {
  using dir = tempDir("module-federation-runtime-plugins", {
    "remote-entry.js": `
      export function init() {}
      export function get(request) {
        if (request !== "./Button") throw new Error("unknown expose " + request);
        return () => ({ default: "plugin-button" });
      }
    `,
    "host.js": `
      import { loadRemote, registerRemote, registerRuntimePlugin } from "bun:module-federation-runtime";

      const calls = [];
      registerRuntimePlugin({
        namedPlugin: {
          beforeLoadRemote(context) {
            calls.push(["before", context.remote.alias, context.request, context.options.flag]);
          },
          afterLoadRemote(context) {
            calls.push(["after", context.remote.alias, context.request, context.options.flag]);
          },
          errorLoadRemote(context) {
            calls.push(["error", context.remote.alias, context.error.message]);
          },
        },
      }, { flag: "enabled" });
      registerRemote("remote", new URL("./remote-entry.js", import.meta.url).href, "module");
      const button = await loadRemote("remote/Button");
      console.log(JSON.stringify({ button, calls }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "host.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(
    `"{"button":{"default":"plugin-button"},"calls":[["before","remote","./Button","enabled"],["after","remote","./Button","enabled"]]}"`,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation runtime plugins report hook failures", async () => {
  using dir = tempDir("module-federation-runtime-plugin-errors", {
    "remote-entry.js": `
      export function init() {}
      export function get(request) {
        if (request !== "./Button") throw new Error("unknown expose " + request);
        return () => ({ default: "plugin-button" });
      }
    `,
    "host.js": `
      import { loadRemote, registerRemote, registerRuntimePlugin } from "bun:module-federation-runtime";

      registerRuntimePlugin({
        beforeLoadRemote() {
          throw new Error("before failed");
        },
        errorLoadRemote(context) {
          console.log("error hook saw " + context.error.message);
        },
      });
      registerRemote("remote", new URL("./remote-entry.js", import.meta.url).href, "module");
      try {
        await loadRemote("remote/Button");
      } catch (error) {
        console.log("load failed " + error.message);
      }
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "host.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
    "error hook saw before failed
    load failed before failed"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation container init is idempotent", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { createContainer } from "bun:module-federation-runtime";
        let initCount = 0;
        const container = createContainer({
          get(request) {
            return () => ({ request, initCount });
          },
          init() {
            return ++initCount;
          },
        });
        const firstInit = container.init({});
        const secondInit = container.init({});
        const factory = await container.get("Button");
        console.log(JSON.stringify({ firstInit, secondInit, module: factory() }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(
    `"{"firstInit":1,"secondInit":1,"module":{"request":"./Button","initCount":1}}"`,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation shared singleton reuses a compatible provider", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { consumeShared, registerShared } from "bun:module-federation-runtime";

        let initCount = 0;
        registerShared("shared-lib", {
          version: "1.2.3",
          singleton: true,
          get() {
            initCount++;
            return { from: "host", initCount };
          },
        });

        const first = await consumeShared("shared-lib", { requiredVersion: "^1.0.0" });
        const second = await consumeShared("shared-lib", { requiredVersion: "^1.0.0" });
        console.log(JSON.stringify({ first, second, same: first === second, initCount }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(
    `"{"first":{"from":"host","initCount":1},"second":{"from":"host","initCount":1},"same":true,"initCount":1}"`,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation shared versions fallback or report clear errors", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { consumeShared, registerShared } from "bun:module-federation-runtime";

        registerShared("shared-lib", {
          version: "1.2.3",
          get() {
            return { from: "host" };
          },
        });

        const fallback = await consumeShared("shared-lib", {
          requiredVersion: "^2.0.0",
          fallback() {
            return { from: "fallback" };
          },
        });

        try {
          await consumeShared("shared-lib", {
            requiredVersion: "^3.0.0",
            import: false,
          });
        } catch (error) {
          try {
            await consumeShared("shared-lib", {
              requiredVersion: "^2.0.0",
              strictVersion: true,
              fallback() {
                return { from: "strict-fallback" };
              },
            });
          } catch (strictError) {
            console.log(JSON.stringify({ fallback, message: error.message, strictMessage: strictError.message }));
          }
        }
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(JSON.parse(stdout)).toEqual({
    fallback: { from: "fallback" },
    message:
      'Module Federation shared "shared-lib" does not satisfy required version "^3.0.0" in share scope "default". Available versions: 1.2.3.',
    strictMessage:
      'Module Federation shared "shared-lib" does not satisfy required version "^2.0.0" in share scope "default". Available versions: 1.2.3.',
  });
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation remote init does not initialize shared twice", async () => {
  using dir = tempDir("module-federation-runtime-shared-remote", {
    "remote-entry.js": `
      import { createContainer, registerShared } from "bun:module-federation-runtime";

      let initCount = 0;
      let sharedFactoryCount = 0;
      const container = createContainer({
        get() {
          return () => ({ initCount });
        },
        init() {
          initCount++;
          registerShared("shared-lib", {
            version: "1.0.0",
            singleton: true,
            get() {
              sharedFactoryCount++;
              return { sharedFactoryCount };
            },
          });
        },
      });

      export const get = container.get;
      export const init = container.init;
      export default container;
    `,
    "host.js": `
      import { consumeShared, loadRemote, registerRemote } from "bun:module-federation-runtime";

      registerRemote("remote", new URL("./remote-entry.js", import.meta.url).href, "module");
      const first = await loadRemote("remote/Button");
      const sharedFirst = await consumeShared("shared-lib", { requiredVersion: "^1.0.0" });
      const second = await loadRemote("remote/Button");
      const sharedSecond = await consumeShared("shared-lib", { requiredVersion: "^1.0.0" });
      console.log(JSON.stringify({
        first,
        second,
        sharedFirst,
        sharedSecond,
        same: sharedFirst === sharedSecond,
      }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "host.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(
    `"{"first":{"initCount":1},"second":{"initCount":1},"sharedFirst":{"sharedFactoryCount":1},"sharedSecond":{"sharedFactoryCount":1},"same":true}"`,
  );
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("module federation runtime reports clear errors", async () => {
  using dir = tempDir("module-federation-runtime-errors", {
    "missing-get.js": `
      export function init() {}
    `,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        import { loadRemote, registerRemote } from "bun:module-federation-runtime";
        for (const action of [
          () => loadRemote("missing/Button"),
          () => loadRemote("bad"),
          () => registerRemote("bad", "file:///missing.js", "global"),
          () => {
            registerRemote("missingGet", new URL("./missing-get.js", import.meta.url).href, "module");
            return loadRemote("missingGet/Button");
          },
        ]) {
          try {
            await action();
          } catch (error) {
            console.log(error.message);
          }
        }
      `,
    ],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "Module Federation remote "missing" is not registered.
    Invalid Module Federation remote specifier "bad". Expected "remote/exposed".
    Module Federation remote "bad" has unsupported type "global". Supported types are "module" and "script".
    Module Federation remote "missingGet" container is missing get()."
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
