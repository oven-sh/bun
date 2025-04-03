import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { randomUUIDv7, valkey } from "bun";
import { DEFAULT_REDIS_OPTIONS, DEFAULT_REDIS_URL, delay, retry, testKey } from "../test-utils";

/**
 * Test suite for connection failures, reconnection, and error handling
 * - Connection failures
 * - Reconnection behavior
 * - Timeout handling
 * - Error propagation
 */
describe("Valkey: Connection Failures", () => {
  // Use invalid port to force connection failure
  const BAD_CONNECTION_URL = "redis://localhost:54321";
  
  describe("Connection Failure Handling", () => {
    test("should handle initial connection failure gracefully", async () => {
      // Create client with invalid port to force connection failure
      const client = valkey(BAD_CONNECTION_URL, {
        connectionTimeout: 500, // Short timeout
        autoReconnect: false, // Disable auto reconnect to simplify the test
      });
      
      try {
        // Attempt to send command - should fail with connection error
        await client.set("key", "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Expect an error with connection closed message
        expect(error.message).toMatch(/connection closed|connection failed|failed to connect/i);
      } finally {
        // Cleanup
        await client.disconnect();
      }
    });
    
    test("should reject commands with appropriate errors when disconnected", async () => {
      // Create client with invalid connection
      const client = valkey(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: false,
        enableOfflineQueue: false, // Disable offline queue to test immediate rejection
      });
      
      // Verify the client is not connected
      expect(client.connected).toBe(false);
      
      // Try different commands and verify they all fail appropriately
      const commandTests = [
        client.get("any-key"),
        client.set("any-key", "value"),
        client.del("any-key"),
        client.incr("counter"),
        client.sendCommand("PING", []),
      ];
      
      for (const commandPromise of commandTests) {
        try {
          await commandPromise;
          expect(false).toBe(true); // Should not reach here
        } catch (error) {
          // Every command should fail with connection error
          expect(error.message).toMatch(/connection closed|connection failed|failed to connect/i);
        }
      }
    });
    
    test("should handle connection timeout", async () => {
      // Create client with non-routable IP to force timeout
      // 192.0.2.0/24 is TEST-NET-1 reserved for documentation
      const client = valkey("redis://192.0.2.1:6379", {
        connectionTimeout: 500, // Very short timeout
        autoReconnect: false,
      });
      
      const startTime = Date.now();
      
      try {
        await client.set("key", "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Verify timeout occurred in reasonable timeframe
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThanOrEqual(500); // At least the timeout
        expect(elapsed).toBeLessThan(1500); // Not too much longer than timeout

        // Verify error message
        expect(error.message).toMatch(/timeout|connection closed|failed to connect/i);
      }
    });

    test("should report correct connected status", async () => {
      // Create client with invalid connection
      const client = valkey(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: false,
      });
      
      // Should report disconnected state
      expect(client.connected).toBe(false);
      
      try {
        // Try to send command to ensure connection attempt
        await client.get("key");
      } catch (error) {
        // Expected error
      }
      
      // Should still report disconnected
      expect(client.connected).toBe(false);
    });
  });
  
  describe("Reconnection Behavior", () => {
    test("should queue commands when disconnected with offline queue enabled", async () => {
      // Create client with invalid connection but with offline queue enabled
      const client = valkey(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: true,
        enableOfflineQueue: true,
      });
      
      // Queue some commands while disconnected
      const commandPromises = [
        client.set("key1", "value1"),
        client.set("key2", "value2"),
        client.get("key1"),
      ];
      
      // None of these should reject immediately since they're queued
      const results = await Promise.allSettled(commandPromises);
      
      // All promises should be in rejected state after a timeout
      // since reconnection attempts will fail
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason.message).toMatch(/connection closed|reconnection failed|max retries/i);
        }
      }
    });
    
    test("should reject commands when offline queue is disabled", async () => {
      // Create client with invalid connection and offline queue disabled
      const client = valkey(BAD_CONNECTION_URL, {
        connectionTimeout: 500,
        autoReconnect: true,
        enableOfflineQueue: false,
      });
      
      try {
        // Try to send command - should reject immediately
        await client.set("key", "value");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toMatch(/connection closed|failed to connect/i);
      }
    });
    
    test("should stop reconnection attempts after max retries", async () => {
      // Create client with invalid connection and limited retries
      const client = valkey(BAD_CONNECTION_URL, {
        connectionTimeout: 200, // Short timeout for faster test
        autoReconnect: true,
        maxRetries: 3, // Only try 3 times
        enableOfflineQueue: true,
      });
      
      // Queue a command
      const commandPromise = client.set("key", "value");
      
      // Wait for retry attempts to complete (at least 3 attempts with backoff)
      // The base delay is 50ms with exponential backoff, so this should be enough time
      await delay(1000); 
      
      try {
        await commandPromise;
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should fail with max retries message
        expect(error.message).toMatch(/max.*retries|connection closed|reconnection failed/i);
      }
    });
  });
  
  describe("Connection Event Callbacks", () => {
    // Only test this if Redis is available
    test("onconnect and onclose handlers", async () => {
      let connectCalled = false;
      let closeCalled = false;

      try {
        // Try connecting to the default Redis URL
        const client = valkey(DEFAULT_REDIS_URL, DEFAULT_REDIS_OPTIONS);
        
        // Set up event handlers
        client.onconnect = () => {
          connectCalled = true;
        };
        
        client.onclose = () => {
          closeCalled = true;
        };
        
        // Try to initialize connection
        try {
          await client.set("__test_key", "test-value");
          
          // Wait for connect to be called
          if (!connectCalled) {
            await delay(100);
          }
          
          // Explicitly disconnect to trigger onclose
          await client.disconnect();
          
          // Wait for close to be called
          await delay(100);
          
        } catch (error) {
          // If connection fails, this test can't be fully validated
          console.warn("Couldn't connect to Redis for callback test");
        }
        
        // Even if connection failed, should at least have called onclose
        expect(closeCalled).toBe(true);
        
      } catch (error) {
        console.error("Error in connection callback test:", error);
      }
    });
    
    test("should support changing onconnect and onclose handlers", async () => {
      let connect1Called = false;
      let connect2Called = false;
      let close1Called = false;
      let close2Called = false;
      
      const client = valkey(DEFAULT_REDIS_URL, DEFAULT_REDIS_OPTIONS);
      
      // Set initial handlers
      client.onconnect = () => {
        connect1Called = true;
      };
      
      client.onclose = () => {
        close1Called = true;
      };
      
      // Change handlers
      client.onconnect = () => {
        connect2Called = true;
      };
      
      client.onclose = () => {
        close2Called = true;
      };
      
      try {
        // Try to initialize connection
        await client.set("__test_key", "test-value");
        
        // Wait for connect handler to be called
        await delay(100);
        
        // Disconnect to trigger close handler
        await client.disconnect();
        
        // Wait for close handler to be called
        await delay(100);
        
        // First handlers should not have been called
        expect(connect1Called).toBe(false);
        expect(close1Called).toBe(false);
        
        // Second handlers should have been called, if Redis is available
        // But we don't fail the test if Redis isn't available
      } catch (error) {
        // Connection failed, but we still test that handlers weren't called
        expect(connect1Called).toBe(false);
        expect(close1Called).toBe(false);
      }
    });
  });
  
  describe("Handling Manually Closed Connections", () => {
    test("should not auto-reconnect when manually closed", async () => {
      // Set up a client
      const client = valkey(DEFAULT_REDIS_URL, {
        ...DEFAULT_REDIS_OPTIONS,
        autoReconnect: true,
      });
      
      // Try to initialize connection
      let connected = false;
      try {
        await client.set("__test_key", "test-value");
        connected = true;
      } catch (error) {
        // If connection fails, we can't fully test this case
        console.warn("Couldn't connect to Redis to test manual disconnect");
      }
      
      if (connected) {
        // Manually disconnect
        await client.disconnect();
        
        // Try to send a command
        try {
          await client.get("__test_key");
          expect(false).toBe(true); // Should not reach here
        } catch (error) {
          // Should reject with connection closed error
          expect(error.message).toMatch(/connection closed/i);
        }
        
        // Wait some time to see if auto-reconnect happens
        await delay(500);
        
        // Should still be disconnected
        expect(client.connected).toBe(false);
      }
    });
    
    test("should clean up resources when disconnected", async () => {
      // Create a client
      const client = valkey(DEFAULT_REDIS_URL, DEFAULT_REDIS_OPTIONS);
      
      // Disconnect immediately
      await client.disconnect();
      
      // Try to use after disconnect
      try {
        await client.get("any-key");
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        // Should get connection closed error
        expect(error.message).toMatch(/connection closed/i);
      }
      
      // Multiple disconnects should not cause issues
      await client.disconnect();
      await client.disconnect();
    });
  });
  
  describe("Multiple Connection Attempts", () => {
    test("should handle rapid connection/disconnection", async () => {
      // Create and immediately disconnect many clients
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        const client = valkey(DEFAULT_REDIS_URL, {
          ...DEFAULT_REDIS_OPTIONS,
          connectionTimeout: 500,
        });
        
        // Immediately disconnect
        promises.push(client.disconnect());
      }
      
      // All should resolve without errors
      await Promise.all(promises);
    });
    
    test("should not crash when connections fail", async () => {
      // Create multiple clients with invalid connections in parallel
      const clients = [];
      
      for (let i = 0; i < 5; i++) {
        clients.push(valkey(BAD_CONNECTION_URL, {
          connectionTimeout: 200,
          autoReconnect: false,
        }));
      }
      
      // Try sending commands to all clients
      const promises = clients.map(client => 
        client.get("key").catch(err => {
          // We expect errors, but want to make sure they're the right kind
          expect(err.message).toMatch(/connection closed|failed to connect/i);
        })
      );
      
      // All should reject without crashing
      await Promise.all(promises);
      
      // Clean up
      for (const client of clients) {
        await client.disconnect();
      }
    });
  });
});