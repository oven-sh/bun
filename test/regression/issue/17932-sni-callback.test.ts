import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("SNI callback support - issue #17932", async () => {
  // Test that TLS servers support SNICallback
  const code = `
const tls = require("tls");

console.log("Testing SNI callback support...");

// Test 1: Basic SNICallback acceptance
try {
  const server = tls.createServer({
    SNICallback: (hostname, callback) => {
      console.log("SNI callback invoked for hostname:", hostname);
      callback(null, null);
    }
  });
  
  if (typeof server.SNICallback !== "function") {
    throw new Error("SNICallback not stored properly");
  }
  
  server.close();
  console.log("✓ TLS server accepts SNICallback");
} catch (error) {
  console.error("✗ TLS server SNICallback failed:", error.message);
  process.exit(1);
}

// Test 2: SNICallback validation
try {
  tls.createServer({
    SNICallback: "invalid"
  });
  console.error("✗ Should have thrown for invalid SNICallback");
  process.exit(1);
} catch (error) {
  if (error.message.includes("SNICallback") && error.message.includes("function")) {
    console.log("✓ SNICallback validation works");
  } else {
    console.error("✗ Wrong validation error:", error.message);
    process.exit(1);
  }
}

// Test 3: setSecureContext with SNICallback
try {
  const server = tls.createServer({});
  
  server.setSecureContext({
    SNICallback: (hostname, callback) => {
      callback(null, null);
    }
  });
  
  if (typeof server.SNICallback !== "function") {
    throw new Error("setSecureContext didn't set SNICallback");
  }
  
  server.close();
  console.log("✓ setSecureContext supports SNICallback");
} catch (error) {
  console.error("✗ setSecureContext SNICallback failed:", error.message);
  process.exit(1);
}

console.log("All SNI callback tests passed!");
`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  console.log("stdout:", stdout);
  if (stderr) console.log("stderr:", stderr);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("✓ TLS server accepts SNICallback");
  expect(stdout).toContain("✓ SNICallback validation works");
  expect(stdout).toContain("✓ setSecureContext supports SNICallback");
  expect(stdout).toContain("All SNI callback tests passed!");
});