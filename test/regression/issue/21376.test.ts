// Regression test for issue 21376: WebSocket client receives repeated messages when working with big payloads
// https://github.com/oven-sh/bun/issues/21376

import { test, expect } from "bun:test";
import { WebSocketServer } from "ws";
import { randomBytes, randomUUID } from "crypto";

test("WebSocket client should not repeat messages with large payloads", async () => {
  const port = 0; // Let the system assign a port
  let serverPort: number;
  
  const wss = new WebSocketServer({ port });
  
  await new Promise<void>((resolve) => {
    wss.on("listening", () => {
      serverPort = (wss.address() as any).port;
      resolve();
    });
  });

  const receivedMessages = new Set<string>();
  const expectedMessages = new Set<string>();
  
  const messagePromises: Promise<void>[] = [];
  
  // Use a promise to track when all expected messages are received
  let resolveTest: () => void;
  let rejectTest: (error: Error) => void;
  const testPromise = new Promise<void>((resolve, reject) => {
    resolveTest = resolve;
    rejectTest = reject;
  });

  wss.on("connection", (ws) => {
    const sendData = (megabytes: number) => {
      const payload = {
        id: randomUUID(),
        data: randomBytes(1024 * 1024 * megabytes).toString("base64"),
      };
      
      expectedMessages.add(payload.id);
      ws.send(JSON.stringify(payload));
    };

    // Send multiple moderately large messages to trigger the bug without causing crashes
    sendData(2); // 2 MB
    sendData(1);  // 1 MB
    sendData(3); // 3 MB
  });

  const client = new WebSocket(`ws://localhost:${serverPort}`);
  
  let timeoutId: Timer;
  
  client.addEventListener("open", () => {
    // Set a timeout to resolve the test after a reasonable time
    timeoutId = setTimeout(() => {
      if (receivedMessages.size === expectedMessages.size) {
        resolveTest();
      } else {
        rejectTest(new Error(`Expected ${expectedMessages.size} unique messages, but received ${receivedMessages.size}`));
      }
    }, 5000); // 5 second timeout
  });

  client.addEventListener("message", (event) => {
    try {
      const parsed = JSON.parse(event.data.toString());
      const messageId = parsed.id;
      
      // Check if we've already received this message
      if (receivedMessages.has(messageId)) {
        clearTimeout(timeoutId);
        client.close();
        wss.close();
        rejectTest(new Error(`Received duplicate message with ID: ${messageId}`));
        return;
      }
      
      receivedMessages.add(messageId);
      
      // Check if we've received all expected messages
      if (receivedMessages.size === expectedMessages.size) {
        clearTimeout(timeoutId);
        client.close();
        wss.close();
        resolveTest();
      }
    } catch (error) {
      clearTimeout(timeoutId);
      client.close();
      wss.close();
      rejectTest(new Error(`Failed to parse message: ${error}`));
    }
  });

  client.addEventListener("error", (error) => {
    clearTimeout(timeoutId);
    wss.close();
    rejectTest(new Error(`WebSocket error: ${error}`));
  });

  await testPromise;
  
  // Verify we received exactly the expected messages
  expect(receivedMessages.size).toBe(expectedMessages.size);
  for (const expectedId of expectedMessages) {
    expect(receivedMessages.has(expectedId)).toBe(true);
  }
}, 30000); // 30 second test timeout