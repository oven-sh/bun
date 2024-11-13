import { spawnSync, Glob } from "bun";
import { beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join, dirname } from "path";

const jsNativeApiRoot = join(__dirname, "node-napi-tests/test/js-native-api");
const nodeApiRoot = join(__dirname, "node-napi-tests/test/node-api");

const jsNativeApiTests = Array.from(new Glob("**/*.js").scanSync(jsNativeApiRoot));
const nodeApiTests = Array.from(new Glob("**/*.js").scanSync(nodeApiRoot));

// These js-native-api tests are known to fail and will be fixed in later PRs
const failingJsNativeApiTests = [
  // Fails because Bun doesn't implement node_api_create_property_key_latin1
  "test_string/test.js",
  // Fails because Bun doesn't implement node_api_create_property_key_latin1
  "test_string/test_null.js",
];

// These are the tests from node-api that failed as of commit 83f536f4d, except for those that
// passed in Bun v1.1.34. It'll take some time to get all these to work, as we've been focusing more
// on js-native-api tests so far, and we don't want these tests to pollute CI. But we do want to
// know if we regressed any of the other tests.
const failingNodeApiTests = [
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
  "test_make_callback_recurse/test.js",
  "test_buffer/test.js",
  "test_instance_data/test.js",
  "test_make_callback/test-async-hooks.js",
  "test_async_context/test.js",
  "test_async_context/test-gcable.js",
  "test_async_context/test-gcable-callback.js",
  "test_async/test.js",
  "test_async/test-uncaught.js",
  "test_async/test-async-hooks.js",
  "test_general/test.js",
  "test_env_teardown_gc/test.js",
  "test_worker_terminate/test.js",
];

beforeAll(() => {
  const directories = jsNativeApiTests
    .map(t => join(jsNativeApiRoot, t))
    .concat(nodeApiTests.map(t => join(nodeApiRoot, t)))
    .map(t => dirname(t));
  const uniqueDirectories = Array.from(new Set(directories));

  for (const dir of uniqueDirectories) {
    console.log(dir);
    const result = spawnSync({
      cmd: [bunExe(), "x", "node-gyp", "build", "--debug"],
      cwd: dir,
      stderr: "pipe",
      stdout: "ignore",
      stdin: "inherit",
      env: bunEnv,
    });
    if (!result.success) {
      throw new Error(`node-gyp build in ${dir} failed: ${result.stderr.toString()}`);
    }
  }
});

describe.each([
  ["js-native-api", jsNativeApiTests, jsNativeApiRoot, failingJsNativeApiTests],
  ["node-api", nodeApiTests, nodeApiRoot, failingNodeApiTests],
])("%s tests", (_name, tests, root, failing) => {
  describe.each(tests)("%s", test => {
    it.skipIf(failing.includes(test))("passes", () => {
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
    });
  });
});
