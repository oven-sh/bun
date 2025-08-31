/**
 * Regression test for GitHub issue #4459
 * https://github.com/oven-sh/bun/issues/4459
 * 
 * Issue: "server.getConnections is not implemented"
 * Expected: getConnections should work exactly like Node.js
 */

import { test, expect } from "bun:test";
import * as net from "net";

test("issue #4459: server.getConnections should be implemented and work like Node.js", async () => {
  const server = net.createServer();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  const results: Array<{ err: any; count: number }> = [];

  server.listen(0, () => {
    const port = server.address()!.port;
    
    // Test 1: No connections initially
    server.getConnections((err, count) => {
      results.push({ err, count });

      // Test 2: Create connection and verify count increases
      const client1 = net.createConnection(port, () => {
        setTimeout(() => {
          server.getConnections((err, count) => {
            results.push({ err, count });

            // Test 3: Create second connection
            const client2 = net.createConnection(port, () => {
              setTimeout(() => {
                server.getConnections((err, count) => {
                  results.push({ err, count });

                  // Test 4: Close one connection
                  client1.end();
                  setTimeout(() => {
                    server.getConnections((err, count) => {
                      results.push({ err, count });

                      // Test 5: Close second connection
                      client2.end();
                      setTimeout(() => {
                        server.getConnections((err, count) => {
                          results.push({ err, count });
                          
                          server.close();
                          resolve();
                        });
                      }, 50);
                    });
                  }, 50);
                });
              }, 50);
            });

            client2.on("error", reject);
          });
        }, 50);
      });

      client1.on("error", reject);
    });
  });

  server.on("error", reject);

  await promise;

  // Now we can safely use expect() outside the callbacks
  expect(results).toHaveLength(5);
  expect(results[0]).toEqual({ err: null, count: 0 }); // No connections initially
  expect(results[1]).toEqual({ err: null, count: 1 }); // After client1 connects
  expect(results[2]).toEqual({ err: null, count: 2 }); // After client2 connects
  expect(results[3]).toEqual({ err: null, count: 1 }); // After client1 disconnects
  expect(results[4]).toEqual({ err: null, count: 0 }); // After client2 disconnects
});

test("issue #4459: getConnections should support method chaining", () => {
  const server = net.createServer();
  
  // Method should return the server instance for chaining
  const result = server.getConnections(() => {});
  expect(result).toBe(server);
  
  server.close();
});

test("issue #4459: getConnections should work when server is not listening", () => {
  const server = net.createServer();
  let callbackCalled = false;
  let callbackErr: any = undefined;
  let callbackCount: number = -1;
  
  const callback = (err: any, count: number) => {
    callbackCalled = true;
    callbackErr = err;
    callbackCount = count;
  };
  
  // Should call callback with 0 connections when not listening
  server.getConnections(callback);
  
  expect(callbackCalled).toBe(true);
  expect(callbackErr).toBeNull();
  expect(callbackCount).toBe(0);
});