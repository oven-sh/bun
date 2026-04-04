import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

test.skipIf(isWindows)(
  "threadsafe JSCallback does not segfault when called from multiple native threads",
  async () => {
    using dir = tempDir("ffi-threadsafe-28113", {
      "repro.c": `
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>

#define NUM_THREADS 4
#define ITERATIONS 1000

typedef void (*callback_fn)(void);
static callback_fn g_callback = NULL;

static void* worker_thread(void* arg) {
    for (int i = 0; i < ITERATIONS; i++) {
        g_callback();
    }
    return NULL;
}

void run_threads(callback_fn cb) {
    g_callback = cb;
    pthread_t threads[NUM_THREADS];
    for (int i = 0; i < NUM_THREADS; i++) {
        pthread_create(&threads[i], NULL, worker_thread, NULL);
    }
    for (int i = 0; i < NUM_THREADS; i++) {
        pthread_join(threads[i], NULL);
    }
}
`,
      "test.js": `
import { dlopen, JSCallback, suffix } from "bun:ffi";
import { resolve } from "path";

const libPath = resolve(import.meta.dir, "librepro." + suffix);
const lib = dlopen(libPath, {
    run_threads: { args: ["ptr"], returns: "void" },
});

const expected = 4 * 1000;
let counter = 0;
const callback = new JSCallback(
    () => { counter++; },
    { threadsafe: true, args: [], returns: "void" }
);

lib.symbols.run_threads(callback.ptr);

// Poll until all queued threadsafe callback tasks have been processed
const deadline = Date.now() + 10000;
while (counter < expected && Date.now() < deadline) {
    await Bun.sleep(50);
}

console.log("counter=" + counter);
callback.close();
lib.close();
`,
    });

    const dirStr = String(dir);
    const ext = process.platform === "darwin" ? "dylib" : "so";

    // Compile the native library
    await using compile = Bun.spawn({
      cmd: ["gcc", "-shared", "-fPIC", "-o", `librepro.${ext}`, "repro.c", "-lpthread"],
      cwd: dirStr,
      env: bunEnv,
      stderr: "pipe",
    });

    const [compileStderr, compileExit] = await Promise.all([compile.stderr.text(), compile.exited]);
    if (compileExit !== 0) {
      throw new Error(`Failed to compile native library: ${compileStderr}`);
    }

    // Run the test script
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: dirStr,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("counter=");

    // The counter should be 4000 (4 threads * 1000 iterations)
    const match = stdout.match(/counter=(\d+)/);
    expect(match).not.toBeNull();
    const counter = parseInt(match![1]);
    expect(counter).toBe(4000);

    expect(exitCode).toBe(0);
  },
  30_000,
);
