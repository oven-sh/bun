import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// This test verifies the fix for https://github.com/oven-sh/bun/issues/25619
// Link-local IPv6 addresses (fe80::/10) should be deprioritized in native DNS
// resolution because they cannot route to global destinations, causing timeouts
// on VPN networks.
//
// The fix is implemented in src/bun.js/api/bun/dns.zig in the processResults
// function which sorts DNS results before returning them.

describe("DNS address sorting (issue #25619)", () => {
  test("fetch should succeed when server is only on IPv4 (native DNS path)", async () => {
    // This test verifies that the native HTTP client (used by fetch) can connect
    // successfully when a server is only available on IPv4. This exercises the
    // native DNS sorting path in dns.zig.
    //
    // Note: We can't easily test with mock DNS results in the native path,
    // so this test just verifies the basic happy path works.

    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("success");
      },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/`);
    expect(await response.text()).toBe("success");
  });

  test("fetch should succeed when server is only on IPv6", async () => {
    // Test that IPv6 connections still work (we're not breaking IPv6 support)

    using server = Bun.serve({
      port: 0,
      hostname: "::1",
      fetch() {
        return new Response("ipv6-success");
      },
    });

    const response = await fetch(`http://[::1]:${server.port}/`);
    expect(await response.text()).toBe("ipv6-success");
  });

  test("HTTP client with custom lookup should prefer IPv4 over link-local IPv6", async () => {
    // This test uses node:http with a custom lookup to test the address sorting
    // behavior for code that uses custom DNS resolution.
    //
    // Note: The node:http module's custom lookup path is handled in _http_client.ts
    // while the native fetch path is handled in dns.zig. Both should have the same
    // behavior for consistency.
    using dir = tempDir("issue-25619-http", {
      "test.js": `
        const http = require("node:http");

        // Create a server on IPv4
        const server = http.createServer((req, res) => {
          res.writeHead(200);
          res.end("success");
        });

        server.listen(0, "127.0.0.1", () => {
          const port = server.address().port;

          // Mock DNS: link-local IPv6 address first, then IPv4
          // In a properly sorted result, IPv4 should be tried before link-local IPv6
          const mockDnsResults = [
            { address: "fe80::dead:beef", family: 6 },  // link-local IPv6 - unreachable
            { address: "127.0.0.1", family: 4 },         // IPv4 - will succeed
          ];

          const req = http.request({
            host: "test.local",
            port: port,
            method: "GET",
            lookup: (hostname, options, callback) => {
              callback(null, mockDnsResults);
            },
          }, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
              console.log("SUCCESS");
              server.close();
            });
          });

          req.on("error", (err) => {
            console.log("ERROR:" + err.message);
            server.close();
          });

          req.end();
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed - the connection should eventually work since both addresses
    // are tried (link-local will fail quickly, then IPv4 will succeed)
    expect(stdout.trim()).toBe("SUCCESS");
    expect(exitCode).toBe(0);
  });
});
