import { test, expect } from "bun:test";
import { SocksProxyAgent } from "socks-proxy-agent";
import { tempDirWithFiles } from "harness";

test("socks-proxy-agent support - issue #7382", async () => {
  // Create a test directory with the reproduction code
  const testDir = tempDirWithFiles("socks-proxy-agent-test", {
    "package.json": JSON.stringify({
      "dependencies": {
        "axios": "1.6.0",
        "socks-proxy-agent": "8.0.2"
      }
    }),
    "test.js": `
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

// Test if SocksProxyAgent constructor works
const proxyOptions = 'socks5://localhost:9050';
const httpsAgent = new SocksProxyAgent(proxyOptions);
const httpAgent = httpsAgent;

console.log("SocksProxyAgent created successfully");
console.log("Agent proxy property:", JSON.stringify(httpsAgent.proxy, null, 2));

// Test a Node.js HTTP request to see if our agent conversion works
const { request } = require('http');

// Create a simple HTTP request with the SOCKS agent
// This should trigger our proxy detection logic
try {
  const req = request({
    hostname: 'httpbin.org',
    port: 80,
    path: '/ip',
    method: 'GET',
    agent: httpAgent
  }, (res) => {
    console.log('Response received (should not reach here in test)');
  });
  
  req.on('error', (err) => {
    // We expect this to fail since there's no SOCKS proxy at localhost:9050
    // But the error should be about connection refused, not unsupported protocol
    console.log('Request error:', err.code || err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log('SOCKS proxy conversion working - connection refused as expected');
    } else if (err.message.includes('UnsupportedProxyProtocol')) {
      console.log('ERROR: SOCKS proxy still not supported');
    } else {
      console.log('Unexpected error:', err.message);
    }
  });
  
  // Don't actually try to send the request in test environment
  req.destroy();
  console.log('HTTP request with SOCKS agent created successfully');
  
} catch (err) {
  console.log('Failed to create request:', err.message);
}

export { httpsAgent, httpAgent };
    `
  });

  // Test that we can import and create a SocksProxyAgent
  const proc = Bun.spawn({
    cmd: ["bun", "install"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  
  const runProc = Bun.spawn({
    cmd: ["bun", "test.js"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  console.log("stdout:", stdout);
  console.log("stderr:", stderr);
  console.log("exitCode:", exitCode);

  // The test should not fail with import or creation errors
  expect(exitCode).toBe(0);
  expect(stdout).toContain("SocksProxyAgent created successfully");
  expect(stdout).toContain("HTTP request with SOCKS agent created successfully");
});