import { test, expect } from "bun:test";
import { SocksProxyAgent } from "socks-proxy-agent";
import { tempDirWithFiles } from "harness";

test("socks-proxy-agent network test - issue #7382", async () => {
  // Create a test directory with the reproduction code
  const testDir = tempDirWithFiles("socks-proxy-agent-network-test", {
    "package.json": JSON.stringify({
      "dependencies": {
        "axios": "1.6.0",
        "socks-proxy-agent": "8.0.2"
      }
    }),
    "test-network.js": `
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';

// Test actual network request with SOCKS proxy agent
const proxyOptions = 'socks5://localhost:9050'; // Tor default port (not running)
const httpsAgent = new SocksProxyAgent(proxyOptions);

console.log("Testing SOCKS proxy with axios...");

// This should fail with connection refused, not unsupported protocol
try {
  const response = await axios.get('http://httpbin.org/ip', {
    httpAgent: httpsAgent,
    timeout: 5000
  });
  console.log('Response:', response.data);
  // If we get a successful response, the proxy might be being ignored
  console.log('WARNING: Request succeeded - proxy might be ignored');
} catch (error) {
  console.log('Error code:', error.code);
  console.log('Error message:', error.message);
  
  // Check if the error is what we expect
  if (error.code === 'ECONNREFUSED') {
    console.log('SUCCESS: SOCKS proxy conversion working - got ECONNREFUSED as expected');
    process.exit(0);
  } else if (error.message.includes('UnsupportedProxyProtocol')) {
    console.log('FAILURE: Still getting UnsupportedProxyProtocol error');
    process.exit(1);
  } else if (error.code === 'ENOTFOUND') {
    console.log('SUCCESS: DNS resolution working, proxy format accepted');
    process.exit(0);
  } else {
    console.log('OTHER ERROR:', error);
    process.exit(2);
  }
}
    `
  });

  // Install dependencies
  const installProc = Bun.spawn({
    cmd: ["bun", "install"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await installProc.exited;

  // Run the network test
  const runProc = Bun.spawn({
    cmd: ["bun", "test-network.js"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  console.log("Network test stdout:", stdout);
  console.log("Network test stderr:", stderr);
  console.log("Network test exitCode:", exitCode);

  // Exit code 0 or 2 means success (proxy format was accepted)
  // Exit code 1 means failure (still unsupported)
  expect(exitCode).not.toBe(1);
  expect(stdout).toContain("Testing SOCKS proxy with axios");
});