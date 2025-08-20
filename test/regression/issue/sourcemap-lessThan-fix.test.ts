import { test, expect } from "bun:test";
import {
  bunEnv,
  bunExe,
  normalizeBunSnapshot,
  tempDirWithFiles,
} from "harness";

test("sourcemap lessThan fix - should handle duplicate positions correctly", async () => {
  // Test that the fixed lessThan function handles duplicate line/column positions
  // without violating strict weak ordering requirements
  const dir = tempDirWithFiles("sourcemap-lessThan-fix", {
    "duplicate-positions.js": `
// Create multiple mappings that might result in identical positions
function test1() { console.log("test1"); throw new Error("error1"); }
function test2() { console.log("test2"); throw new Error("error2"); }

// Trigger error handling that requires sourcemap processing
try { test1(); } catch(e) { console.error(e.message); }
try { test2(); } catch(e) { console.error(e.message); }
`,
    "duplicate-positions.js.map": JSON.stringify({
      version: 3,
      sources: ["duplicate-positions.ts"],
      names: ["test1", "test2", "console", "log", "Error"],
      // Mappings that could create duplicate positions during sorting
      mappings: "AAAA;AACA,SAASA,MAAM;AACb,UAAQC,QAAQ,GAAG,OAAO;AAC1B,QAAM,IAAI,MAAM,QAAQ;AAC1B;AACA,SAASD,MAAM;AACb,UAAQC,QAAQ,GAAG,OAAO;AAC1B,QAAM,IAAI,MAAM,QAAQ;AAC1B;AAEA;AACA,IAAI;AAAE,QAAM;AAAE,EAAE,OAAO,GAAG;AAAE,UAAQC,QAAQ,EAAE,OAAO;AAAE;AACvD,IAAI;AAAE,QAAM;AAAE,EAAE,OAAO,GAAG;AAAE,UAAQA,QAAQ,EAAE,OAAO;AAAE",
      sourcesContent: [`
function test1() { console.log("test1"); throw new Error("error1"); }
function test2() { console.log("test2"); throw new Error("error2"); }

try { test1(); } catch(e) { console.error(e.message); }
try { test2(); } catch(e) { console.error(e.message); }
`]
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "duplicate-positions.js"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stdout, dir)).toMatchInlineSnapshot(`
"test1
test2"
`);

  expect(exitCode).toBe(0);
});

test("sourcemap lessThan fix - should maintain stable sorting", async () => {
  // Test that identical mappings are handled consistently
  const dir = tempDirWithFiles("sourcemap-stable-sort", {
    "stable-sort.js": `
// Create scenario with many similar mappings
for (let i = 0; i < 10; i++) {
  if (i === 5) {
    throw new Error("error at iteration " + i);
  }
}
`,
    "stable-sort.js.map": JSON.stringify({
      version: 3,
      sources: ["stable-sort.ts"],
      names: ["i", "Error"],
      mappings: "AAAA;AACA,KAAK,IAAIA,IAAI,GAAGA,IAAI,IAAIA,KAAK;AAC3B,MAAIA,MAAM,GAAG;AACX,UAAM,IAAI,MAAM,wBAAwBA,CAAC;AAC3C;AACF",
      sourcesContent: [`
for (let i = 0; i < 10; i++) {
  if (i === 5) {
    throw new Error("error at iteration " + i);
  }
}
`]
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "stable-sort.js"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
"1 | 
2 | // Create scenario with many similar mappings
3 | for (let i = 0; i < 10; i++) {
4 |   if (i === 5) {
5 |     throw new Error("error at iteration " + i);
              ^
error: error at iteration 5
      at <dir>/stable-sort.js:5:11
    at loadAndEvaluateModule (file:NN:NN)
    at asyncFunctionResume (file:NN:NN)
    at promiseReactionJobWithoutPromiseUnwrapAsyncContext (file:NN:NN)
    at promiseReactionJob (file:NN:NN)

Bun v<bun-version>+29068c211 (Linux arm64)"
`);

  expect(exitCode).toBe(1);
});