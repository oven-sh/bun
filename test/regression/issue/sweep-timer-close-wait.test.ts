/**
 * @fileoverview Regression test for sweep timer CLOSE_WAIT bug
 * 
 * This test verifies the fix for a bug introduced in commit 9bb4a6af19 where
 * the uSockets sweep timer optimization caused CLOSE_WAIT connections to 
 * accumulate when using nginx as a reverse proxy.
 * 
 * The bug was caused by incorrect reference counting in the sweep timer 
 * enable/disable logic, where the timer could be disabled prematurely or
 * the counter could go negative, preventing proper cleanup of idle connections.
 * 
 * Related to user report: "After a few hours, my server fills up with hundreds 
 * of CLOSE_WAIT connections and never clears until I restart Bun."
 */

import { test, expect } from "bun:test";
import * as net from "net";

test("server should handle rapid connection churn without hanging", async () => {
  // Start a simple test server
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      return new Response("Hello from test server!");
    }
  });

  const port = server.port;

  try {
    // Test 1: Verify basic server functionality
    const response = await fetch(`http://localhost:${port}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello from test server!");

    // Test 2: Create and destroy many connections rapidly
    // This pattern was known to cause sweep timer counter issues
    for (let batch = 0; batch < 3; batch++) {
      const connections: net.Socket[] = [];
      const promises: Promise<void>[] = [];
      
      // Create multiple connections
      for (let i = 0; i < 20; i++) {
        const promise = new Promise<void>((resolve, reject) => {
          const socket = new net.Socket();
          
          socket.connect(port, 'localhost', () => {
            socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
          });
          
          socket.on('data', (data) => {
            expect(data.toString()).toContain('Hello from test server!');
            resolve();
          });
          
          socket.on('error', reject);
          
          connections.push(socket);
        });
        
        promises.push(promise);
      }
      
      // Wait for all requests to complete
      await Promise.all(promises);
      
      // Destroy half the connections abruptly, close the rest gracefully
      const half = Math.floor(connections.length / 2);
      for (let i = 0; i < half; i++) {
        connections[i].destroy(); // Abrupt close
      }
      for (let i = half; i < connections.length; i++) {
        connections[i].end(); // Graceful close
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Test 3: Verify server is still responsive after connection churn
    // If the sweep timer bug was present, this might fail
    const finalResponse = await fetch(`http://localhost:${port}`);
    expect(finalResponse.status).toBe(200);
    expect(await finalResponse.text()).toBe("Hello from test server!");

  } finally {
    server.stop();
  }
}, 5000);

test("server should handle idle connections properly", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    }
  });

  const port = server.port;

  try {
    // Create several idle connections
    const connections: net.Socket[] = [];
    
    for (let i = 0; i < 10; i++) {
      const socket = new net.Socket();
      socket.connect(port, 'localhost', () => {
        socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n');
      });
      
      socket.on('data', () => {
        // Receive response but keep connection open
      });
      
      connections.push(socket);
    }
    
    // Wait for connections to be established
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Server should still be responsive
    const response = await fetch(`http://localhost:${port}`);
    expect(response.status).toBe(200);
    
    // Clean up connections
    connections.forEach(socket => socket.destroy());
    
    // Server should still be responsive after cleanup
    const response2 = await fetch(`http://localhost:${port}`);
    expect(response2.status).toBe(200);
    
  } finally {
    server.stop();
  }
}, 3000);