import { test, expect, describe } from "bun:test";
import https from "node:https";

describe("https.Agent family option (no network)", () => {
  test("Agent should store family option correctly", () => {
    const agent6 = new https.Agent({ family: 6 });
    expect(agent6.options.family).toBe(6);
    
    const agent4 = new https.Agent({ family: 4 });
    expect(agent4.options.family).toBe(4);
    
    const agentDefault = new https.Agent();
    expect(agentDefault.options.family).toBeUndefined();
  });

  test("Agent.getName should include family in connection name", () => {
    const agent6 = new https.Agent({ family: 6 });
    const agent4 = new https.Agent({ family: 4 });
    
    const name6 = agent6.getName({ host: 'example.com', port: 443, family: 6 });
    const name4 = agent4.getName({ host: 'example.com', port: 443, family: 4 });
    const nameDefault = agent6.getName({ host: 'example.com', port: 443 });
    
    expect(name6).toContain(':6');
    expect(name4).toContain(':4');
    // Without family parameter, should not include family in name
    expect(nameDefault).not.toMatch(/:6$/);
  });

  test("DNS lookup function gets set by default in ClientRequest", () => {
    // This test verifies that our fix to set options.lookup works
    let lookupWasCalled = false;
    let capturedLookupOptions: any = null;
    
    const mockLookup = (hostname: string, options: any, callback: any) => {
      lookupWasCalled = true;
      capturedLookupOptions = { ...options };
      // Call callback with error to avoid actual connection
      callback(new Error("Test DNS error"));
    };
    
    const agent = new https.Agent({ family: 6 });
    
    const req = https.request({
      hostname: 'test.example',
      path: '/',
      agent: agent,
      lookup: mockLookup
    }, (res) => {});
    
    req.on('error', (err) => {
      // Ignore the test DNS error
    });
    
    req.end();
    
    // Give it a moment for the lookup to be called
    return new Promise(resolve => {
      setTimeout(() => {
        expect(lookupWasCalled).toBe(true);
        expect(capturedLookupOptions).not.toBeNull();
        expect(capturedLookupOptions.family).toBe(6);
        expect(capturedLookupOptions.all).toBe(true);
        req.destroy();
        resolve(undefined);
      }, 50);
    });
  });
});