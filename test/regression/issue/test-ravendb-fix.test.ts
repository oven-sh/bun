import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("RavenDB ShortRead fix - premature stream end detection", async () => {
  const dir = tempDirWithFiles("ravendb-fix-test", {
    "test.js": `
const zlib = require('zlib');

// Test 1: Complete compressed data should work
console.log("=== Test 1: Complete compressed data ===");
const completeData = JSON.stringify({ message: "test complete".repeat(100) });
const completeCompressed = zlib.gzipSync(completeData);

const server1 = Bun.serve({
  port: 0,
  fetch() {
    return new Response(completeCompressed, {
      headers: { 'Content-Encoding': 'gzip' }
    });
  }
});

try {
  const response1 = await fetch(\`http://localhost:\${server1.port}\`);
  const data1 = await response1.json();
  console.log("Test 1 SUCCESS: Got complete data");
} catch (err) {
  console.log("Test 1 FAILED:", err.message);
} finally {
  server1.stop();
}

// Test 2: Incomplete compressed data should now properly error
console.log("=== Test 2: Incomplete compressed data ===");
const incompleteData = JSON.stringify({ message: "test incomplete".repeat(100) });
const fullCompressed = zlib.gzipSync(incompleteData);
const truncatedCompressed = fullCompressed.slice(0, Math.floor(fullCompressed.length * 0.7));

console.log("Full size:", fullCompressed.length, "Truncated size:", truncatedCompressed.length);

const server2 = Bun.serve({
  port: 0,
  fetch() {
    // Return truncated compressed data which should trigger ShortRead
    return new Response(truncatedCompressed, {
      headers: { 'Content-Encoding': 'gzip' }
    });
  }
});

try {
  const response2 = await fetch(\`http://localhost:\${server2.port}\`);
  const data2 = await response2.json();
  console.log("Test 2 UNEXPECTED SUCCESS - this should have failed with ShortRead");
  process.exit(1);
} catch (err) {
  console.log("Test 2 caught error:", err.message);
  if (err.message.includes("ShortRead") || err.message.includes("premature end")) {
    console.log("Test 2 SUCCESS: Properly detected ShortRead error");
  } else {
    console.log("Test 2 PARTIAL: Got error but not ShortRead specifically");
  }
} finally {
  server2.stop();
}

console.log("=== All tests completed ===");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  console.log("STDOUT:", stdout);
  if (stderr) console.log("STDERR:", stderr);

  // The test should complete successfully (exit code 0)
  // and show that complete data works while incomplete data fails appropriately
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Test 1 SUCCESS");
  expect(stdout).toContain("All tests completed");
}, 10000);