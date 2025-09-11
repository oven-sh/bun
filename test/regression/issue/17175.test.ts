import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("direct ReadableStream should not trigger cancel when successfully consumed", async () => {
  const cancelReasons: any[] = [];
  
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const stream = new ReadableStream({
        type: 'direct',
        pull(controller) {
          controller.write('Hello');
          controller.close();
        },
        cancel(reason) {
          cancelReasons.push(reason);
        },
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain' },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();
  
  expect(text).toBe('Hello');
  expect(cancelReasons).toHaveLength(0);
});

test("direct ReadableStream with async pull should not trigger cancel when successfully consumed", async () => {
  const cancelReasons: any[] = [];
  
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const stream = new ReadableStream({
        type: 'direct',
        async pull(controller) {
          await Bun.sleep(10);
          controller.write('Hello');
          controller.close();
        },
        cancel(reason) {
          cancelReasons.push(reason);
        },
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain' },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();
  
  expect(text).toBe('Hello');
  expect(cancelReasons).toHaveLength(0);
});

test("direct ReadableStream with await controller.close() should not trigger cancel", async () => {
  const cancelReasons: any[] = [];
  
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const stream = new ReadableStream({
        type: 'direct',
        async pull(controller) {
          controller.write('Hello');
          await controller.close();
        },
        cancel(reason) {
          cancelReasons.push(reason);
        },
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain' },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();
  
  expect(text).toBe('Hello');
  expect(cancelReasons).toHaveLength(0);
});

test("direct ReadableStream should only cancel when client disconnects", async () => {
  const cancelReasons: any[] = [];
  let streamController: any;
  
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const stream = new ReadableStream({
        type: 'direct',
        async pull(controller) {
          streamController = controller;
          controller.write('Start');
          await Bun.sleep(100);
        },
        cancel(reason) {
          cancelReasons.push(reason);
        },
      });

      return new Response(stream, {
        headers: { 'Content-Type': 'text/plain' },
      });
    },
  });

  const controller = new AbortController();
  const fetchPromise = fetch(`http://localhost:${server.port}/`, { signal: controller.signal });
  
  await Bun.sleep(50);
  controller.abort();
  
  await fetchPromise.catch(() => {});
  await Bun.sleep(100);
  
  expect(cancelReasons.length).toBeGreaterThan(0);
});