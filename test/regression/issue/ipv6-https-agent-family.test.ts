import { test, expect, describe } from "bun:test";
import https from "node:https";

describe("IPv6 HTTPS Agent family regression test", () => {
  test("HTTPS agent should pass family option to DNS lookup", () => {
    // This is a regression test for the issue where IPv6 family setting
    // in https.Agent was being ignored during DNS resolution
    
    let dnsLookupOptions: any = null;
    
    // Mock lookup to capture the options passed to DNS
    const mockLookup = (hostname: string, options: any, callback: any) => {
      dnsLookupOptions = { ...options };
      // Return mock IPv6 addresses
      callback(null, [
        { address: "2001:db8::1", family: 6 },
        { address: "2001:db8::2", family: 6 }
      ]);
    };
    
    const httpsAgent = new https.Agent({ family: 6 });
    
    // Create request similar to the user's code
    const req = https.request({
      hostname: 'test.example.com',
      path: '/ip',
      agent: httpsAgent,
      lookup: mockLookup
    }, (res) => {});
    
    req.on('error', (err) => {
      // Expected since we're using mock addresses
    });
    
    req.end();
    
    return new Promise(resolve => {
      setTimeout(() => {
        // Verify that DNS lookup was called with family: 6
        expect(dnsLookupOptions).not.toBeNull();
        expect(dnsLookupOptions.family).toBe(6);
        expect(dnsLookupOptions.all).toBe(true);
        req.destroy();
        resolve(undefined);
      }, 100);
    });
  });
  
  test("family option should be ignored when using IP address directly", () => {
    // When hostname is already an IP, family option should be ignored
    // but agent should still store the option correctly
    
    const agent = new https.Agent({ family: 6 });
    expect(agent.options.family).toBe(6);
    
    // Using an IP address directly - this should skip DNS lookup entirely
    // The family option should still be stored in agent but not used for connection
    const req = https.request({
      hostname: '127.0.0.1', // IPv4 address
      path: '/',
      port: 8443,
      agent: agent
    }, (res) => {});
    
    req.on('error', (err) => {
      // Expected connection error since no server is listening
    });
    
    // This should not throw or crash
    req.end();
    req.destroy();
  });
});