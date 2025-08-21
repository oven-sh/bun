import { test, expect, describe } from "bun:test";
import fetch from "node-fetch";
import https from "node:https";

describe("node-fetch agent family support", () => {
  test("should use https.request when agent with family is provided", () => {
    // Mock https.request to verify it gets called
    let httpsRequestCalled = false;
    let capturedOptions: any = null;
    
    const originalRequest = https.request;
    https.request = function(...args: any[]) {
      httpsRequestCalled = true;
      capturedOptions = args[0]; // First argument is the options object
      
      // Return a mock request that immediately errors to avoid network calls
      const mockReq = {
        on: () => mockReq,
        write: () => {},
        end: () => {
          // Simulate immediate error to avoid hanging
          process.nextTick(() => {
            if (mockReq.errorCallback) {
              mockReq.errorCallback(new Error("Mock connection error"));
            }
          });
        },
        errorCallback: null as any,
      };
      
      // Override on('error') to capture the callback
      const originalOn = mockReq.on;
      mockReq.on = function(event: string, callback: any) {
        if (event === 'error') {
          mockReq.errorCallback = callback;
        }
        return originalOn.call(this);
      };
      
      return mockReq as any;
    };
    
    const agent = new https.Agent({ family: 6 });
    
    return fetch('https://test.example/', { agent })
      .catch(err => {
        // Ignore the mock error, we just want to verify behavior
      })
      .finally(() => {
        // Restore original function
        https.request = originalRequest;
        
        // Verify https.request was called
        expect(httpsRequestCalled).toBe(true);
        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions.agent).toBe(agent);
      });
  });

  test("should use native fetch when no agent is provided", async () => {
    // Mock https.request to verify it doesn't get called
    let httpsRequestCalled = false;
    
    const originalRequest = https.request;
    https.request = function(...args: any[]) {
      httpsRequestCalled = true;
      return originalRequest.apply(this, args);
    };
    
    try {
      // This should use native Bun.fetch, not https.request
      await fetch('https://httpbin.org/status/200');
    } catch (err) {
      // Ignore any connection errors
    } finally {
      // Restore original function
      https.request = originalRequest;
    }
    
    // Verify https.request was NOT called
    expect(httpsRequestCalled).toBe(false);
  });

  test("should use native fetch when agent exists but has no family option", async () => {
    // Mock https.request to verify it doesn't get called  
    let httpsRequestCalled = false;
    
    const originalRequest = https.request;
    https.request = function(...args: any[]) {
      httpsRequestCalled = true;
      return originalRequest.apply(this, args);
    };
    
    // Agent without family option should use native fetch
    const agent = new https.Agent({ keepAlive: true });
    
    try {
      await fetch('https://httpbin.org/status/200', { agent });
    } catch (err) {
      // Ignore any connection errors
    } finally {
      // Restore original function
      https.request = originalRequest;
    }
    
    // Verify https.request was NOT called
    expect(httpsRequestCalled).toBe(false);
  });

  test("should handle IPv4 family value", () => {
    let capturedOptions: any = null;
    
    const originalRequest = https.request;
    https.request = function(...args: any[]) {
      capturedOptions = args[0];
      
      const mockReq = {
        on: () => mockReq,
        write: () => {},
        end: () => process.nextTick(() => mockReq.errorCallback?.(new Error("Mock error"))),
        errorCallback: null as any,
      };
      
      mockReq.on = function(event: string, callback: any) {
        if (event === 'error') mockReq.errorCallback = callback;
        return mockReq;
      };
      
      return mockReq as any;
    };
    
    const agent = new https.Agent({ family: 4 });
    
    return fetch('https://test.example/', { agent })
      .catch(() => {}) // Ignore mock error
      .finally(() => {
        https.request = originalRequest;
        
        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions.agent.options.family).toBe(4);
      });
  });

  test("should handle IPv6 family value", () => {
    let capturedOptions: any = null;
    
    const originalRequest = https.request;
    https.request = function(...args: any[]) {
      capturedOptions = args[0];
      
      const mockReq = {
        on: () => mockReq,
        write: () => {},
        end: () => process.nextTick(() => mockReq.errorCallback?.(new Error("Mock error"))),
        errorCallback: null as any,
      };
      
      mockReq.on = function(event: string, callback: any) {
        if (event === 'error') mockReq.errorCallback = callback;
        return mockReq;
      };
      
      return mockReq as any;
    };
    
    const agent = new https.Agent({ family: 6 });
    
    return fetch('https://test.example/', { agent })
      .catch(() => {}) // Ignore mock error
      .finally(() => {
        https.request = originalRequest;
        
        expect(capturedOptions).not.toBeNull();
        expect(capturedOptions.agent.options.family).toBe(6);
      });
  });
});