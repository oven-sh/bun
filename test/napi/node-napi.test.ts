import { spawnSync, spawn, Glob } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isCI, isMusl } from "harness";
import { join, dirname } from "path";
import os from "node:os";

const jsNativeApiRoot = join(__dirname, "node-napi-tests", "test", "js-native-api");
const nodeApiRoot = join(__dirname, "node-napi-tests", "test", "node-api");

const jsNativeApiTests = Array.from(new Glob("**/*.js").scanSync(jsNativeApiRoot));
const nodeApiTests = Array.from(new Glob("**/*.js").scanSync(nodeApiRoot));

// These js-native-api tests are known to fail and will be fixed in later PRs
let failingJsNativeApiTests = [
  // Fails because Bun doesn't support creating empty external strings
  "test_string/test.js",
];

// These are the tests from node-api that failed as of commit 83f536f4d, except for those that
// passed in Bun v1.1.34. It'll take some time to get all these to work, as we've been focusing more
// on js-native-api tests so far, and we don't want these tests to pollute CI. But we do want to
// know if we regressed any of the other tests.
let failingNodeApiTests = [
  "test_uv_threadpool_size/test.js",
  "test_uv_threadpool_size/node-options.js",
  "test_uv_loop/test.js",
  "test_callback_scope/test-resolve-async.js",
  "test_callback_scope/test-async-hooks.js",
  "test_fatal/test.js",
  "test_fatal/test2.js",
  "test_fatal/test_threads.js",
  "test_threadsafe_function/test.js",
  "test_threadsafe_function/test_legacy_uncaught_exception.js",
  "test_worker_buffer_callback/test.js",
  "test_worker_buffer_callback/test-free-called.js", // TODO(@heimskr)
  "test_make_callback_recurse/test.js",
  "test_buffer/test.js",
  "test_instance_data/test.js",
  "test_make_callback/test-async-hooks.js",
  "test_async_context/test.js",
  "test_async_context/test-gcable.js",
  "test_async_context/test-gcable-callback.js",
  "test_async_cleanup_hook/test.js",
  "test_async/test.js",
  "test_async/test-uncaught.js",
  "test_async/test-async-hooks.js",
  "test_general/test.js",
  "test_env_teardown_gc/test.js",
  "test_worker_terminate/test.js",
];

if (process.platform == "win32") {
  failingNodeApiTests.push("test_callback_scope/test.js"); // TODO: remove once #12827 is fixed

  for (const i in failingJsNativeApiTests) {
    failingJsNativeApiTests[i] = failingJsNativeApiTests[i].replaceAll("/", "\\");
  }
  for (const i in failingNodeApiTests) {
    failingNodeApiTests[i] = failingNodeApiTests[i].replaceAll("/", "\\");
  }
}

if (isMusl) {
  failingNodeApiTests = nodeApiTests;
  failingJsNativeApiTests = jsNativeApiTests;
}

beforeAll(async () => {
  const directories = jsNativeApiTests
    .filter(t => !failingJsNativeApiTests.includes(t))
    .map(t => join(jsNativeApiRoot, t))
    .concat(nodeApiTests.filter(t => !failingNodeApiTests.includes(t)).map(t => join(nodeApiRoot, t)))
    .map(t => dirname(t));
  const uniqueDirectories = Array.from(new Set(directories));

  async function buildOne(dir: string) {
    const child = spawn({
      cmd: [bunExe(), "x", "node-gyp", "rebuild", "--debug"],
      cwd: dir,
      stderr: "pipe",
      stdout: "ignore",
      stdin: "inherit",
      env: {
        ...bunEnv,
        npm_config_target: "v23.2.0",
        // on linux CI, node-gyp will default to g++ and the version installed there is very old,
        // so we make it use clang instead
        ...(process.platform == "linux" && isCI
          ? { "CC": "/usr/lib/llvm-18/bin/clang", CXX: "/usr/lib/llvm-18/bin/clang++" }
          : {}),
      },
    });
    await child.exited;
    if (child.exitCode !== 0) {
      const stderr = await new Response(child.stderr).text();
      throw new Error(`node-gyp rebuild in ${dir} failed:\n${stderr}`);
    }
  }

  async function worker() {
    while (uniqueDirectories.length > 0) {
      const dir = uniqueDirectories.pop();
      await buildOne(dir!);
    }
  }

  const parallelism = Math.min(8, os.cpus().length, 1 /* TODO(@heimskr): remove */);
  const jobs = [];
  for (let i = 0; i < parallelism; i++) {
    jobs.push(worker());
  }

  await Promise.all(jobs);
}, 600000);

describe.each([
  ["js-native-api", jsNativeApiTests, jsNativeApiRoot, failingJsNativeApiTests],
  ["node-api", nodeApiTests, nodeApiRoot, failingNodeApiTests],
])("%s tests", (_name, tests, root, failing) => {
  describe.each(tests)("%s", test => {
    it.skipIf(failing.includes(test))(
      "passes",
      () => {
        const result = spawnSync({
          cmd: [bunExe(), "run", test],
          cwd: root,
          stderr: "inherit",
          stdout: "ignore",
          stdin: "inherit",
          env: bunEnv,
        });
        expect(result.success).toBeTrue();
        expect(result.exitCode).toBe(0);
      },
      60000, // timeout
    );
  });
});
