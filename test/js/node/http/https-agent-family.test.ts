import { test, expect, describe } from "bun:test";
import https from "node:https";
import dns from "node:dns";

describe("https.Agent family option", () => {
  test("should pass family option to DNS lookup", async () => {
    // Mock DNS lookup to verify family option is passed through
    let capturedOptions: any = null;
    const originalLookup = dns.lookup;
    
    // Mock lookup function to capture options
    const mockLookup = (hostname: string, options: any, callback: any) => {
      capturedOptions = { ...options };
      // Call the real lookup to get actual results
      originalLookup(hostname, options, callback);
    };
    
    try {
      // Test with family: 6
      const agent6 = new https.Agent({ family: 6 });
      expect(agent6.options.family).toBe(6);
      
      // Create request that should use DNS lookup
      const req = https.request({
        hostname: 'example.com', // Use a hostname that requires DNS lookup
        path: '/',
        agent: agent6,
        lookup: mockLookup
      }, (res) => {
        // Don't need to handle response for this test
      });
      
      // End the request to trigger DNS lookup
      req.end();
      
      // Wait for DNS lookup to be called
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify family option was passed to DNS lookup
      expect(capturedOptions).not.toBeNull();
      expect(capturedOptions.family).toBe(6);
      expect(capturedOptions.all).toBe(true);
      
      req.destroy();
    } finally {
      // Restore original lookup
      dns.lookup = originalLookup;
    }
  });

  test("should pass family: 4 option to DNS lookup", async () => {
    let capturedOptions: any = null;
    const originalLookup = dns.lookup;
    
    const mockLookup = (hostname: string, options: any, callback: any) => {
      capturedOptions = { ...options };
      originalLookup(hostname, options, callback);
    };
    
    try {
      const agent4 = new https.Agent({ family: 4 });
      expect(agent4.options.family).toBe(4);
      
      const req = https.request({
        hostname: 'example.com',
        path: '/',
        agent: agent4,
        lookup: mockLookup
      }, (res) => {});
      
      req.end();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(capturedOptions).not.toBeNull();
      expect(capturedOptions.family).toBe(4);
      expect(capturedOptions.all).toBe(true);
      
      req.destroy();
    } finally {
      dns.lookup = originalLookup;
    }
  });

  test("should not pass family option when not specified", async () => {
    let capturedOptions: any = null;
    const originalLookup = dns.lookup;
    
    const mockLookup = (hostname: string, options: any, callback: any) => {
      capturedOptions = { ...options };
      originalLookup(hostname, options, callback);
    };
    
    try {
      const agent = new https.Agent(); // No family specified
      expect(agent.options.family).toBeUndefined();
      
      const req = https.request({
        hostname: 'example.com',
        path: '/',
        agent: agent,
        lookup: mockLookup
      }, (res) => {});
      
      req.end();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(capturedOptions).not.toBeNull();
      expect(capturedOptions.family).toBeUndefined();
      expect(capturedOptions.all).toBe(true);
      
      req.destroy();
    } finally {
      dns.lookup = originalLookup;
    }
  });

  test("should work with different hosts and preserve agent family setting", () => {
    const agent6 = new https.Agent({ family: 6 });
    const agent4 = new https.Agent({ family: 4 });
    
    // Test that agent maintains its family setting
    expect(agent6.options.family).toBe(6);
    expect(agent4.options.family).toBe(4);
    
    // Test that agent name includes family for connection pooling
    const name6 = agent6.getName({ host: 'example.com', port: 443, family: 6 });
    const name4 = agent4.getName({ host: 'example.com', port: 443, family: 4 });
    
    expect(name6).toContain(':6');
    expect(name4).toContain(':4');
  });
});