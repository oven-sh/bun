/**
 * Regression test for issue #21982: write EBADF error when socket becomes detached
 * 
 * The issue occurs when:
 * 1. High-volume network operations are in progress (like with NATS.js)
 * 2. The server/network abruptly closes the connection
 * 3. The readable stream ends and triggers a write operation
 * 4. But the underlying socket has become detached
 * 5. Previously, Bun would throw a synchronous EBADF error instead of handling gracefully
 * 
 * The fix ensures that writes to detached sockets return false instead of throwing.
 */

import { test, expect } from "bun:test";
import { createServer } from "net";
import { connect as netConnect } from "net";
import { EventEmitter } from "events";
import { Readable, Writable } from "stream";
import { tempDirWithFiles } from "harness";

test("socket write to detached socket should return false, not throw EBADF", async () => {
  let serverSocket: any;
  
  const server = createServer((socket) => {
    serverSocket = socket;
    socket.write('INITIAL_DATA\r\n');
  });
  
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  
  const port = server.address()!.port;
  const client = netConnect(port, 'localhost');
  
  await new Promise<void>((resolve) => {
    client.on('connect', resolve);
  });
  
  // Force the socket to become detached by destroying the server side
  serverSocket.destroy();
  
  // Give time for the detachment to propagate
  await new Promise(resolve => setTimeout(resolve, 50));
  
  // This should return a boolean (true or false), not throw EBADF
  // The exact value depends on timing, but it should never throw
  let threwEBADF = false;
  let result: boolean;
  try {
    result = client.write('DATA_AFTER_DETACH');
    expect(typeof result).toBe('boolean');
  } catch (error) {
    if ((error as any).code === 'EBADF') {
      threwEBADF = true;
    }
    throw error;
  }
  
  // The key test: should never throw EBADF
  expect(threwEBADF).toBe(false);
  
  client.destroy();
  server.close();
});

test("high-volume writes during connection close should not throw EBADF", async () => {
  const errors: Error[] = [];
  let serverSocket: any;
  
  const server = createServer((socket) => {
    serverSocket = socket;
    socket.write('CONNECT_OK\r\n');
    
    // Close connection after a short delay to create race condition
    setTimeout(() => {
      socket.destroy();
    }, 20);
  });
  
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  
  const port = server.address()!.port;
  const client = netConnect(port, 'localhost');
  
  await new Promise<void>((resolve) => {
    client.on('connect', resolve);
  });
  
  client.on('error', (error) => {
    errors.push(error);
  });
  
  // Start high-volume writes that will race with connection close
  const writePromises: Promise<void>[] = [];
  for (let i = 0; i < 50; i++) {
    writePromises.push(new Promise<void>((resolve) => {
      setImmediate(() => {
        try {
          const result = client.write(`HIGH_VOLUME_DATA_${i}\r\n`);
          // Write should return boolean, never throw EBADF
          expect(typeof result).toBe('boolean');
          resolve();
        } catch (error) {
          // If any error is thrown, it should NOT be EBADF
          expect((error as any).code).not.toBe('EBADF');
          resolve();
        }
      });
    }));
  }
  
  await Promise.allSettled(writePromises);
  
  // Verify no EBADF errors were thrown or emitted
  const ebadafErrors = errors.filter(err => (err as any).code === 'EBADF');
  expect(ebadafErrors).toHaveLength(0);
  
  client.destroy();
  server.close();
});

test("NATS-like transport pattern should handle detached socket gracefully", async () => {
  let foundEBADF = false;
  
  // Simulate the exact pattern from the NATS.js stack trace
  class MockTransport extends EventEmitter {
    constructor(private socket: any) {
      super();
      
      this.readable = new Readable({
        read() {
          // Will be controlled externally
        }
      });
      
      this.writable = new Writable({
        write: (chunk, encoding, callback) => {
          try {
            // This simulates the write operation that was throwing EBADF
            const result = this.socket.write(chunk, encoding);
            callback();
          } catch (error) {
            if ((error as any).code === 'EBADF') {
              foundEBADF = true;
            }
            callback(error);
          }
        }
      });
      
      // Set up the event chain that triggered the original issue
      this.readable.on('end', () => {
        // This simulates endReadableNT -> emit -> transport write chain
        process.nextTick(() => {
          try {
            this.writable.write('END_STREAM_MARKER');
          } catch (error) {
            if ((error as any).code === 'EBADF') {
              foundEBADF = true;
            }
          }
        });
      });
      
      this.socket.on('close', () => {
        // End the readable stream, triggering the write
        this.readable.push(null);
      });
    }
    
    readable: Readable;
    writable: Writable;
  }
  
  const server = createServer((socket) => {
    socket.write('INFO {"server":"mock"}\r\n');
    
    // Abruptly close after client starts operations
    setTimeout(() => {
      socket.destroy();
    }, 30);
  });
  
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  
  const port = server.address()!.port;
  
  // Create multiple concurrent connections to increase race chance
  const transportPromises: Promise<void>[] = [];
  for (let i = 0; i < 5; i++) {
    transportPromises.push(new Promise<void>((resolve) => {
      const client = netConnect(port, 'localhost');
      const transport = new MockTransport(client);
      
      client.on('connect', () => {
        // Send some data then wait for close
        transport.readable.push('PING\r\n');
        transport.readable.push('CONNECT\r\n');
      });
      
      client.on('close', () => {
        resolve();
      });
      
      client.on('error', (error) => {
        if ((error as any).code === 'EBADF') {
          foundEBADF = true;
        }
        resolve();
      });
    }));
  }
  
  await Promise.allSettled(transportPromises);
  
  // The key test: EBADF should NOT be thrown
  expect(foundEBADF).toBe(false);
  
  server.close();
});

test("socket._write should handle detached socket consistently with other methods", async () => {
  // Test that all socket write methods handle detached sockets consistently
  let serverSocket: any;
  
  const server = createServer((socket) => {
    serverSocket = socket;
    socket.write('CONNECTED\r\n');
  });
  
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  
  const port = server.address()!.port;
  const client = netConnect(port, 'localhost');
  
  await new Promise<void>((resolve) => {
    client.on('connect', resolve);
  });
  
  // Detach the socket
  serverSocket.destroy();
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Test various write methods - none should throw EBADF
  try {
    const writeResult = client.write('test1');
    expect(typeof writeResult).toBe('boolean');
  } catch (error) {
    expect((error as any).code).not.toBe('EBADF');
  }
  
  try {
    client.end('test2');
    // end() should complete without throwing EBADF
  } catch (error) {
    expect((error as any).code).not.toBe('EBADF');
  }
  
  client.destroy();
  server.close();
});

test("buffered write operations should not throw EBADF on detached socket", async () => {
  // This test specifically targets the writeBuffered method that was fixed
  let serverSocket: any;
  
  const server = createServer((socket) => {
    serverSocket = socket;
    socket.write('READY\r\n');
  });
  
  await new Promise<void>((resolve) => {
    server.listen(0, resolve);
  });
  
  const port = server.address()!.port;
  const client = netConnect(port, 'localhost');
  
  await new Promise<void>((resolve) => {
    client.on('connect', resolve);
  });
  
  // Fill up the buffer by writing without draining
  client.cork();
  for (let i = 0; i < 100; i++) {
    client.write(`BUFFERED_DATA_${i}_${Date.now()}\r\n`);
  }
  
  // Detach the socket while buffer is full
  serverSocket.destroy();
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Uncork should not throw EBADF, even with detached socket
  try {
    client.uncork();
    // Should complete without error
  } catch (error) {
    expect((error as any).code).not.toBe('EBADF');
  }
  
  client.destroy();
  server.close();
});