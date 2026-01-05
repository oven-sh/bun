// Regression test for https://github.com/oven-sh/bun/issues/24593
// WebSocket server.publish() crashes on Windows with perMessageDeflate enabled for large messages
import { serve } from "bun";
import { describe, expect, test } from "bun:test";

// Generate a realistic ~109KB JSON message similar to the original reproduction
function generateLargeMessage(): string {
  const items = [];
  for (let i = 0; i < 50; i++) {
    items.push({
      id: 6000 + i,
      pickListId: 444,
      externalRef: null,
      sku: `405053843${String(i).padStart(4, "0")}`,
      sequence: i + 1,
      requestedQuantity: 1,
      pickedQuantity: 0,
      dischargedQuantity: 0,
      state: "allocated",
      allocatedAt: new Date().toISOString(),
      startedAt: null,
      cancelledAt: null,
      pickedAt: null,
      placedAt: null,
      dischargedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      allocations: Array.from({ length: 20 }, (_, j) => ({
        id: 9000 + i * 20 + j,
        pickListItemId: 6000 + i,
        productId: 36000 + j,
        state: "reserved",
        reservedAt: new Date().toISOString(),
        startedAt: null,
        pickedAt: null,
        placedAt: null,
        cancelledAt: null,
        quantity: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        location: {
          id: 1000 + j,
          name: `Location-${j}`,
          zone: `Zone-${Math.floor(j / 5)}`,
          aisle: `Aisle-${j % 10}`,
          shelf: `Shelf-${j % 20}`,
          position: j,
        },
        product: {
          id: 36000 + j,
          sku: `SKU-${String(j).padStart(6, "0")}`,
          name: `Product Name ${j} with some additional description text`,
          category: `Category-${j % 5}`,
          weight: 1.5 + j * 0.1,
          dimensions: { width: 10, height: 20, depth: 30 },
        },
      })),
    });
  }
  return JSON.stringify({
    id: 444,
    externalRef: null,
    description: "Generated pick list",
    stockId: null,
    priority: 0,
    state: "allocated",
    picksInSequence: true,
    allocatedAt: new Date().toISOString(),
    startedAt: null,
    pausedAt: null,
    pickedAt: null,
    placedAt: null,
    cancelledAt: null,
    dischargedAt: null,
    collectedAt: null,
    totalRequestedQuantity: 50,
    totalPickedQuantity: 0,
    totalDischargedQuantity: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items,
  });
}

describe("WebSocket server.publish with perMessageDeflate", () => {
  test("should handle large message publish without crash", async () => {
    // Create a ~109KB JSON message (similar to the reproduction)
    const largeMessage = generateLargeMessage();
    expect(largeMessage.length).toBeGreaterThan(100000);

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("test");
        },
        message() {},
        close() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    const { promise: messagePromise, resolve: resolveMessage, reject: rejectMessage } = Promise.withResolvers<string>();

    client.onopen = () => resolveOpen();
    client.onerror = e => {
      rejectOpen(e);
      rejectMessage(new Error("WebSocket error"));
    };
    client.onmessage = event => resolveMessage(event.data);

    await openPromise;

    // This is the critical test - server.publish() with a large compressed message
    // On Windows, this was causing a segfault in memcpy during the compression path
    const published = server.publish("test", largeMessage);
    expect(published).toBeGreaterThan(0); // Returns bytes sent, should be > 0

    const received = await messagePromise;
    expect(received.length).toBe(largeMessage.length);
    expect(received).toBe(largeMessage);

    client.close();
  });

  test("should handle multiple large message publishes", async () => {
    // Test multiple publishes in succession to catch potential buffer corruption
    const largeMessage = generateLargeMessage();

    let messagesReceived = 0;
    const expectedMessages = 5;

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("multi-test");
        },
        message() {},
        close() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    const {
      promise: allMessagesReceived,
      resolve: resolveMessages,
      reject: rejectMessages,
    } = Promise.withResolvers<void>();

    client.onopen = () => resolveOpen();
    client.onerror = e => {
      rejectOpen(e);
      rejectMessages(e instanceof Error ? e : new Error("WebSocket error"));
    };
    client.onmessage = event => {
      messagesReceived++;
      expect(event.data.length).toBe(largeMessage.length);
      if (messagesReceived === expectedMessages) {
        resolveMessages();
      }
    };

    await openPromise;

    // Publish multiple times in quick succession
    for (let i = 0; i < expectedMessages; i++) {
      const published = server.publish("multi-test", largeMessage);
      expect(published).toBeGreaterThan(0); // Returns bytes sent
    }

    await allMessagesReceived;
    expect(messagesReceived).toBe(expectedMessages);

    client.close();
  });

  test("should handle publish to multiple subscribers", async () => {
    // Test publishing to multiple clients - this exercises the publishBig loop
    const largeMessage = generateLargeMessage();

    const numClients = 3;
    const clientsReceived: boolean[] = new Array(numClients).fill(false);

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("broadcast");
        },
        message() {},
        close() {},
      },
    });

    const clients: WebSocket[] = [];
    try {
      const allClientsOpen = Promise.all(
        Array.from({ length: numClients }, (_, i) => {
          return new Promise<void>((resolve, reject) => {
            const client = new WebSocket(`ws://localhost:${server.port}`);
            clients.push(client);
            client.onopen = () => resolve();
            client.onerror = e => reject(e);
          });
        }),
      );

      await allClientsOpen;

      const allMessagesReceived = Promise.all(
        clients.map(
          (client, i) =>
            new Promise<void>(resolve => {
              client.onmessage = event => {
                expect(event.data.length).toBe(largeMessage.length);
                clientsReceived[i] = true;
                resolve();
              };
            }),
        ),
      );

      // Publish to all subscribers
      const published = server.publish("broadcast", largeMessage);
      expect(published).toBeGreaterThan(0); // Returns bytes sent

      await allMessagesReceived;
      expect(clientsReceived.every(r => r)).toBe(true);
    } finally {
      for (const c of clients) {
        try {
          c.close();
        } catch {}
      }
    }
  });

  // CORK_BUFFER_SIZE is 16KB - test messages right at this boundary
  // since messages >= CORK_BUFFER_SIZE use publishBig path
  const CORK_BUFFER_SIZE = 16 * 1024;

  test.each([
    { name: "just under 16KB", size: CORK_BUFFER_SIZE - 100 },
    { name: "exactly 16KB", size: CORK_BUFFER_SIZE },
    { name: "just over 16KB", size: CORK_BUFFER_SIZE + 100 },
  ])("should handle message at CORK_BUFFER_SIZE boundary: $name", async ({ size }) => {
    const message = Buffer.alloc(size, "D").toString();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("boundary-test");
        },
        message() {},
        close() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    const { promise: messagePromise, resolve: resolveMessage, reject: rejectMessage } = Promise.withResolvers<string>();

    let openSettled = false;
    client.onopen = () => {
      openSettled = true;
      resolveOpen();
    };
    client.onerror = e => {
      if (!openSettled) {
        openSettled = true;
        rejectOpen(e);
      } else {
        rejectMessage(e);
      }
    };
    client.onmessage = event => resolveMessage(event.data);

    await openPromise;

    server.publish("boundary-test", message);

    const received = await messagePromise;
    expect(received.length).toBe(size);

    client.close();
  });
});
