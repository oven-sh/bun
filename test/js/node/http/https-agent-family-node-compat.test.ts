import { describe, expect, test } from "bun:test";
import https from "node:https";

describe("https.Agent family option Node.js compatibility", () => {
  test("DNS lookup should receive options in Node.js compatible format", () => {
    // Verify that our implementation matches Node.js behavior for DNS lookup options
    let capturedOptions: any = null;

    const mockLookup = (hostname: string, options: any, callback: any) => {
      capturedOptions = { ...options };

      // Mock response matching Node.js format
      if (options.family === 6) {
        callback(null, [
          { address: "2001:db8::1", family: 6 },
          { address: "2001:db8::2", family: 6 },
        ]);
      } else if (options.family === 4) {
        callback(null, [
          { address: "192.0.2.1", family: 4 },
          { address: "192.0.2.2", family: 4 },
        ]);
      } else {
        callback(null, [
          { address: "192.0.2.1", family: 4 },
          { address: "2001:db8::1", family: 6 },
        ]);
      }
    };

    const agent = new https.Agent({ family: 6 });

    const req = https.request(
      {
        hostname: "example.test",
        path: "/",
        agent: agent,
        lookup: mockLookup,
      },
      () => {},
    );

    req.on("error", () => {}); // Ignore connection errors
    req.end();

    return new Promise(resolve => {
      setTimeout(() => {
        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions.family).toBe(6);
        expect(capturedOptions.all).toBe(true);

        // Verify the format matches Node.js expectations
        expect(typeof capturedOptions.family).toBe("number");
        expect(typeof capturedOptions.all).toBe("boolean");

        req.destroy();
        resolve(undefined);
      }, 50);
    });
  });

  test("Agent.getName should be compatible with Node.js format", () => {
    const agent6 = new https.Agent({ family: 6 });
    const agent4 = new https.Agent({ family: 4 });

    // Test that getName includes family like Node.js does
    const name6 = agent6.getName({ host: "example.com", port: 443, family: 6 });
    const name4 = agent4.getName({ host: "example.com", port: 443, family: 4 });

    // Should include family in name for connection pooling compatibility
    expect(name6).toMatch(/.*:6$/);
    expect(name4).toMatch(/.*:4$/);

    // Format should be consistent
    expect(name6).toContain("example.com:443");
    expect(name4).toContain("example.com:443");
  });

  test("Agent options should store family value like Node.js", () => {
    // Test different family values that Node.js supports
    const agent6 = new https.Agent({ family: 6 });
    const agent4 = new https.Agent({ family: 4 });
    const agent0 = new https.Agent({ family: 0 }); // Node.js supports 0 for dual stack
    const agentDefault = new https.Agent();

    expect(agent6.options.family).toBe(6);
    expect(agent4.options.family).toBe(4);
    expect(agent0.options.family).toBe(0);
    expect(agentDefault.options.family).toBeUndefined();
  });

  test("should maintain Node.js behavior for IP address hostnames", () => {
    // When hostname is already an IP, DNS lookup should be skipped
    let lookupCalled = false;

    const mockLookup = () => {
      lookupCalled = true;
      throw new Error("Lookup should not be called for IP addresses");
    };

    const agent = new https.Agent({ family: 6 });

    // IPv4 address should skip lookup despite IPv6 family setting
    const req = https.request(
      {
        hostname: "127.0.0.1",
        path: "/",
        port: 8443,
        agent: agent,
        lookup: mockLookup,
      },
      () => {},
    );

    req.on("error", () => {}); // Ignore connection error
    req.end();

    // Give it time to potentially call lookup
    return new Promise(resolve => {
      setTimeout(() => {
        expect(lookupCalled).toBe(false);
        req.destroy();
        resolve(undefined);
      }, 50);
    });
  });
});
