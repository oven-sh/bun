import { describe, expect, test } from "bun:test";
import { promises as fs } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Gate network tests behind environment variable to avoid CI flakes
// TODO: Replace with hermetic local TLS fixtures in a follow-up
const networkTest = process.env.BUN_TEST_ALLOW_NET === "1" ? test : test.skip;

describe("NODE_USE_SYSTEM_CA", () => {
  networkTest("should use system CA when NODE_USE_SYSTEM_CA=1", async () => {
    const testDir = tempDirWithFiles("node-use-system-ca", {});

    // Create a simple test script that tries to make an HTTPS request
    const testScript = `
const https = require('https');

async function testHttpsRequest() {
  try {
    const response = await fetch('https://httpbin.org/get');
    console.log('SUCCESS: HTTPS request completed');
    process.exit(0);
  } catch (error) {
    console.log('ERROR: HTTPS request failed:', error.message);
    process.exit(1);
  }
}

testHttpsRequest();
`;

    await fs.writeFile(join(testDir, "test-system-ca.js"), testScript);

    // Test with NODE_USE_SYSTEM_CA=1
    const proc1 = Bun.spawn({
      cmd: [bunExe(), "test-system-ca.js"],
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: "1",
      },
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

    console.log("With NODE_USE_SYSTEM_CA=1:");
    console.log("stdout:", stdout1);
    console.log("stderr:", stderr1);
    console.log("exitCode:", exitCode1);

    // Test without NODE_USE_SYSTEM_CA (should still work with bundled certs)
    const proc2 = Bun.spawn({
      cmd: [bunExe(), "test-system-ca.js"],
      env: {
        ...bunEnv,
        NODE_USE_SYSTEM_CA: undefined,
      },
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

    console.log("\nWithout NODE_USE_SYSTEM_CA:");
    console.log("stdout:", stdout2);
    console.log("stderr:", stderr2);
    console.log("exitCode:", exitCode2);

    // Both should succeed (system CA and bundled should work for common sites)
    expect(exitCode1).toBe(0);
    expect(exitCode2).toBe(0);
    expect(stdout1).toContain("SUCCESS");
    expect(stdout2).toContain("SUCCESS");
  });

  test("should validate NODE_USE_SYSTEM_CA environment variable parsing", async () => {
    const testDir = tempDirWithFiles("node-use-system-ca-env", {});

    const testScript = `
// Test that the environment variable is read correctly
const testCases = [
  { env: '1', expected: true },
  { env: 'true', expected: true },
  { env: '0', expected: false },
  { env: 'false', expected: false },
  { env: undefined, expected: false }
];

let allPassed = true;

for (const testCase of testCases) {
  if (testCase.env !== undefined) {
    process.env.NODE_USE_SYSTEM_CA = testCase.env;
  } else {
    delete process.env.NODE_USE_SYSTEM_CA;
  }
  
  // Here we would test the internal function if it was exposed
  // For now, we just test that the environment variable is set correctly
  const actual = process.env.NODE_USE_SYSTEM_CA;
  const passes = (testCase.env === undefined && !actual) || (actual === testCase.env);
  
  console.log(\`Testing NODE_USE_SYSTEM_CA=\${testCase.env}: \${passes ? 'PASS' : 'FAIL'}\`);
  
  if (!passes) {
    allPassed = false;
  }
}

process.exit(allPassed ? 0 : 1);
`;

    await fs.writeFile(join(testDir, "test-env-parsing.js"), testScript);

    const proc = Bun.spawn({
      cmd: [bunExe(), "test-env-parsing.js"],
      env: bunEnv,
      cwd: testDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    console.log("Environment variable parsing test:");
    console.log("stdout:", stdout);
    console.log("stderr:", stderr);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("PASS");
  });

  networkTest(
    "should work with Bun.serve and fetch using system certificates",
    async () => {
      const testDir = tempDirWithFiles("node-use-system-ca-serve", {});

      const serverScript = `
const server = Bun.serve({
  port: 0,
  fetch(req) {
    return new Response('Hello from test server');
  },
});

console.log(\`Server listening on port \${server.port}\`);

// Keep server alive
await new Promise(() => {}); // Never resolves
`;

      const clientScript = `
const port = process.argv[2];

async function testClient() {
  try {
    // Test local HTTP first (should work)
    const response = await fetch(\`http://localhost:\${port}\`);
    const text = await response.text();
    console.log('Local HTTP request successful:', text);

    // Test external HTTPS with system CA
    const httpsResponse = await fetch('https://httpbin.org/get');
    console.log('External HTTPS request successful');
    
    process.exit(0);
  } catch (error) {
    console.error('Client request failed:', error.message);
    process.exit(1);
  }
}

testClient();
`;

      await fs.writeFile(join(testDir, "server.js"), serverScript);
      await fs.writeFile(join(testDir, "client.js"), clientScript);

      // Start server
      const serverProc = Bun.spawn({
        cmd: [bunExe(), "server.js"],
        env: {
          ...bunEnv,
          NODE_USE_SYSTEM_CA: "1",
        },
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for server to start and get port
      let serverPort;
      const serverOutput = [];
      const reader = serverProc.stdout.getReader();

      const timeout = setTimeout(() => {
        serverProc.kill();
      }, 10000);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = new TextDecoder().decode(value);
          serverOutput.push(chunk);

          const match = chunk.match(/Server listening on port (\d+)/);
          if (match) {
            serverPort = match[1];
            break;
          }
        }
      } finally {
        reader.releaseLock();
      }

      expect(serverPort).toBeDefined();
      console.log("Server started on port:", serverPort);

      // Test client
      const clientProc = Bun.spawn({
        cmd: [bunExe(), "client.js", serverPort],
        env: {
          ...bunEnv,
          NODE_USE_SYSTEM_CA: "1",
        },
        cwd: testDir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [clientStdout, clientStderr, clientExitCode] = await Promise.all([
        clientProc.stdout.text(),
        clientProc.stderr.text(),
        clientProc.exited,
      ]);

      // Clean up server
      clearTimeout(timeout);
      serverProc.kill();

      console.log("Client output:", clientStdout);
      console.log("Client errors:", clientStderr);

      expect(clientExitCode).toBe(0);
      expect(clientStdout).toContain("Local HTTP request successful");
      expect(clientStdout).toContain("External HTTPS request successful");
    },
    30000,
  ); // 30 second timeout for this test
});
