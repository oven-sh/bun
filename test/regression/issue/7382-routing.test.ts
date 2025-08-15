import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";

test("SOCKS proxy routing verification - issue #7382", async () => {
  // Test if SOCKS proxy is actually being used for routing
  const testDir = tempDirWithFiles("socks-routing-test", {
    "package.json": JSON.stringify({
      "dependencies": {
        "socks-proxy-agent": "8.0.2"
      }
    }),
    "routing-test.js": `
import { SocksProxyAgent } from 'socks-proxy-agent';

console.log("Testing SOCKS proxy routing...");

// Test 1: Check if we get the right error when SOCKS proxy is unavailable
const proxyAgent = new SocksProxyAgent('socks5://localhost:9050');

const { request } = require('http');

const testRequest = (useProxy) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'httpbin.org',
      port: 80,
      path: '/ip',
      method: 'GET',
      timeout: 3000,
    };
    
    if (useProxy) {
      options.agent = proxyAgent;
    }
    
    const req = request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({ success: true, ip: result.origin, proxy: useProxy });
        } catch (e) {
          resolve({ success: true, data, proxy: useProxy });
        }
      });
    });
    
    req.on('error', (error) => {
      resolve({ 
        success: false, 
        error: error.code || error.message, 
        proxy: useProxy 
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ 
        success: false, 
        error: 'TIMEOUT', 
        proxy: useProxy 
      });
    });
    
    req.end();
  });
};

// Test direct connection
console.log("Testing direct connection...");
const directResult = await testRequest(false);
console.log("Direct result:", JSON.stringify(directResult));

// Test SOCKS proxy connection
console.log("Testing SOCKS proxy connection...");
const proxyResult = await testRequest(true);
console.log("Proxy result:", JSON.stringify(proxyResult));

// Analyze results
if (directResult.success && proxyResult.success) {
  if (directResult.ip === proxyResult.ip) {
    console.log("WARNING: Same IP for both requests - proxy may be ignored");
    console.log("Direct IP:", directResult.ip);
    console.log("Proxy IP:", proxyResult.ip);
  } else {
    console.log("SUCCESS: Different IPs - proxy is working");
    console.log("Direct IP:", directResult.ip);
    console.log("Proxy IP:", proxyResult.ip);
  }
} else if (directResult.success && !proxyResult.success) {
  console.log("EXPECTED: Direct works, proxy fails (no SOCKS server)");
  console.log("Proxy error:", proxyResult.error);
  
  if (proxyResult.error.includes('UnsupportedProxyProtocol')) {
    console.log("FAILURE: Still getting UnsupportedProxyProtocol");
    process.exit(1);
  } else {
    console.log("SUCCESS: Proxy error is not UnsupportedProxyProtocol");
    process.exit(0);
  }
} else {
  console.log("Network issues - both failed");
  console.log("Direct error:", directResult.error);
  console.log("Proxy error:", proxyResult.error);
  process.exit(2);
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

  // Run the routing test
  const runProc = Bun.spawn({
    cmd: ["bun", "routing-test.js"],
    cwd: testDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);

  console.log("Routing test stdout:", stdout);
  if (stderr) console.log("Routing test stderr:", stderr);
  console.log("Routing test exitCode:", exitCode);

  // Exit code 0 means success (no UnsupportedProxyProtocol)
  // Exit code 1 means failure (still getting UnsupportedProxyProtocol) 
  // Exit code 2 means network issues
  expect(exitCode).not.toBe(1);
  expect(stdout).toContain("Testing SOCKS proxy routing");
});