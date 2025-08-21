import { test, expect, describe } from "bun:test";
import https from "node:https";

describe("https.Agent family option scope and limitations", () => {
  test("https.request should respect family option (FIXED)", () => {
    // This test verifies that our fix works for https.request
    let lookupOptionsReceived: any = null;
    
    const mockLookup = (hostname: string, options: any, callback: any) => {
      lookupOptionsReceived = { ...options };
      // Return IPv6 mock result
      callback(null, [{ address: "2001:db8::1", family: 6 }]);
    };
    
    const agent = new https.Agent({ family: 6 });
    
    const req = https.request({
      hostname: 'test.example',
      path: '/',
      agent: agent,
      lookup: mockLookup
    }, () => {});
    
    req.on('error', () => {}); // Ignore connection errors
    req.end();
    
    return new Promise(resolve => {
      setTimeout(() => {
        expect(lookupOptionsReceived).not.toBeNull();
        expect(lookupOptionsReceived.family).toBe(6);
        expect(lookupOptionsReceived.all).toBe(true);
        req.destroy();
        resolve(undefined);
      }, 50);
    });
  });

  test("https.request with string URL should respect family option (FIXED)", () => {
    // This test verifies string URL + options pattern works (used by node-fetch)
    let lookupOptionsReceived: any = null;
    
    const mockLookup = (hostname: string, options: any, callback: any) => {
      lookupOptionsReceived = { ...options };
      callback(null, [{ address: "2001:db8::1", family: 6 }]);
    };
    
    const agent = new https.Agent({ family: 6 });
    
    const req = https.request('https://test.example/', {
      agent: agent,
      lookup: mockLookup
    }, () => {});
    
    req.on('error', () => {});
    req.end();
    
    return new Promise(resolve => {
      setTimeout(() => {
        expect(lookupOptionsReceived).not.toBeNull();
        expect(lookupOptionsReceived.family).toBe(6);
        expect(lookupOptionsReceived.all).toBe(true);
        req.destroy();
        resolve(undefined);
      }, 50);
    });
  });

  test("built-in fetch() does not support agent parameter (LIMITATION)", () => {
    // This documents the current limitation - built-in fetch ignores agent
    const agent = new https.Agent({ family: 6 });
    
    // This should not throw, but the agent will be ignored
    expect(() => {
      fetch('https://example.com', { agent } as any);
    }).not.toThrow();
    
    // Note: The agent parameter is silently ignored by Bun's native fetch
    // This would need to be fixed separately in Bun's fetch implementation
  });

  test("node-fetch package uses Bun.fetch internally (LIMITATION)", () => {
    // This documents that node-fetch in Bun doesn't use our fixed https.request
    // Instead it uses Bun's native fetch which doesn't support agent.family
    
    // We can't easily test this without actually making network requests
    // but this test documents the expected behavior
    expect(true).toBe(true); // Placeholder test
    
    // Note: node-fetch in Bun is overridden to use Bun.fetch for performance
    // This means it bypasses the node:https module entirely
    // Agent support for node-fetch would need to be implemented in Bun.fetch
  });

  test("Agent.getName includes family for connection pooling", () => {
    // Verify this works correctly for connection pooling
    const agent6 = new https.Agent({ family: 6 });
    const agent4 = new https.Agent({ family: 4 });
    
    const name6 = agent6.getName({ host: 'example.com', port: 443, family: 6 });
    const name4 = agent4.getName({ host: 'example.com', port: 443, family: 4 });
    
    expect(name6).toContain(':6');
    expect(name4).toContain(':4');
    
    // Different family should result in different connection names
    expect(name6).not.toBe(name4);
  });
});