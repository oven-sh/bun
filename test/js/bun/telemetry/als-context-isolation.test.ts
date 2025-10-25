import { AsyncLocalStorage } from "async_hooks";
import { describe, expect, test } from "bun:test";
import http from "http";

describe("AsyncLocalStorage context isolation with concurrent requests", () => {
  test("ALS context should NOT leak between concurrent async HTTP requests", async () => {
    const als = new AsyncLocalStorage();
    const contextsSeen = new Map<number, Set<string>>();
    let port: number;

    // Create HTTP server with async handler that yields
    const server = http.createServer(async (req, res) => {
      const requestId = parseInt(req.url!.slice(1));

      // Set ALS context for this request
      als.run(`request-${requestId}`, async () => {
        const initialContext = als.getStore();
        if (!contextsSeen.has(requestId)) {
          contextsSeen.set(requestId, new Set());
        }
        contextsSeen.get(requestId)!.add(initialContext as string);

        // Yield to allow other requests to interleave
        await Bun.sleep(5);

        // Check context after yielding
        const afterYieldContext = als.getStore();
        contextsSeen.get(requestId)!.add(afterYieldContext as string);

        // Do another async operation
        await fetch("https://example.com").catch(() => {});

        // Check context after fetch
        const afterFetchContext = als.getStore();
        contextsSeen.get(requestId)!.add(afterFetchContext as string);

        res.writeHead(200);
        res.end(`Request ${requestId} saw contexts: ${Array.from(contextsSeen.get(requestId)!).join(", ")}`);
      });
    });

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    try {
      // Fire 10 concurrent requests
      const requests = Array.from({ length: 10 }, (_, i) => fetch(`http://localhost:${port}/${i}`));

      const responses = await Promise.all(requests);
      const bodies = await Promise.all(responses.map(r => r.text()));

      // Each request should only see its own context
      for (let i = 0; i < 10; i++) {
        const contexts = contextsSeen.get(i);
        expect(contexts).toBeDefined();
        expect(contexts!.size).toBe(1);
        expect(contexts!.has(`request-${i}`)).toBe(true);

        // Verify the response confirms this
        expect(bodies[i]).toBe(`Request ${i} saw contexts: request-${i}`);
      }
    } finally {
      server.close();
    }
  });

  test("Direct enterWith() without als.run() - tests the ACTUAL instrumentation pattern", async () => {
    const als = new AsyncLocalStorage();
    const contextLog: Array<{ requestId: number; phase: string; context: any }> = [];
    let port: number;

    const server = http.createServer(async (req, res) => {
      const requestId = parseInt(req.url!.slice(1));

      // Simulate what BunNodeInstrumentation does: enterWith() BEFORE handler runs
      als.enterWith(`span-${requestId}`);

      contextLog.push({ requestId, phase: "start", context: als.getStore() });

      // Yield to allow interleaving (simulates async handler)
      await Bun.sleep(5);

      contextLog.push({ requestId, phase: "after-yield", context: als.getStore() });

      // Another async operation
      await new Promise(resolve => setImmediate(resolve));

      contextLog.push({ requestId, phase: "after-immediate", context: als.getStore() });

      res.writeHead(200);
      res.end(`ok-${requestId}`);
    });

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    try {
      // Fire 10 concurrent requests
      await Promise.all(Array.from({ length: 10 }, (_, i) => fetch(`http://localhost:${port}/${i}`)));

      // Analyze context log for each request
      for (let i = 0; i < 10; i++) {
        const requestLog = contextLog.filter(entry => entry.requestId === i);
        const contexts = new Set(requestLog.map(entry => entry.context));

        console.log(`Request ${i} contexts:`, Array.from(contexts));

        // If context leaks, we'll see different span IDs
        // If Bun's AsyncContextFrame works, we'll only see span-${i}
        expect(contexts.size).toBe(1);
        expect(contexts.has(`span-${i}`)).toBe(true);
      }
    } finally {
      server.close();
    }
  });
});
