import { test, expect } from "bun:test";

test("Request with streaming body can be cloned", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("Hello");
      controller.enqueue(" ");
      controller.enqueue("World");
      controller.close();
    },
  });

  const request = new Request("https://example.com", { method: "POST", body: stream });
  const clonedRequest = request.clone();

  const originalBody = await request.text();
  const clonedBody = await clonedRequest.text();

  expect(originalBody).toBe("Hello World");
  expect(clonedBody).toBe("Hello World");
});

test("Response with streaming body can be cloned", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("Test");
      controller.enqueue(" ");
      controller.enqueue("Data");
      controller.close();
    },
  });

  const response = new Response(stream);
  const clonedResponse = response.clone();

  const originalBody = await response.text();
  const clonedBody = await clonedResponse.text();

  expect(originalBody).toBe("Test Data");
  expect(clonedBody).toBe("Test Data");
});

test("Request with large streaming body can be cloned", async () => {
  let largeData = "x".repeat(1024 * 1024); // 1MB of data
  let chunks = [];
  for (let chunkSize = 1024; chunkSize <= 1024 * 1024; chunkSize *= 2) {
    chunks.push(largeData.slice(0, chunkSize));
  }
  largeData = chunks.join("");
  const stream = new ReadableStream({
    start(controller) {
      for (let chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const request = new Request("https://example.com", { method: "POST", body: stream });
  const clonedRequest = request.clone();

  const originalBody = await request.text();
  const clonedBody = await clonedRequest.text();

  expect(originalBody).toBe(largeData);
  expect(clonedBody).toBe(largeData);
});

test("Request with large streaming body can be cloned (pull)", async () => {
  let largeData = "x".repeat(1024 * 1024); // 1MB of data
  let chunks = [];
  for (let chunkSize = 1024; chunkSize <= 1024 * 1024; chunkSize *= 2) {
    chunks.push(largeData.slice(0, chunkSize));
  }
  largeData = chunks.join("");
  const stream = new ReadableStream({
    async pull(controller) {
      await 42;
      for (let chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const request = new Request("https://example.com", { method: "POST", body: stream });
  const clonedRequest = request.clone();

  const originalBody = await request.text();
  const clonedBody = await clonedRequest.text();

  expect(originalBody).toBe(largeData);
  expect(clonedBody).toBe(largeData);
});

test("Response with chunked streaming body can be cloned", async () => {
  const chunks = ["Chunk1", "Chunk2", "Chunk3"];
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      controller.close();
    },
  });

  const response = new Response(stream);
  const clonedResponse = response.clone();

  const originalBody = await response.text();
  const clonedBody = await clonedResponse.text();

  expect(originalBody).toBe(chunks.join(""));
  expect(clonedBody).toBe(chunks.join(""));
});

test("Request with streaming body can be cloned multiple times", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("Multi");
      controller.enqueue("Clone");
      controller.enqueue("Test");
      controller.close();
    },
  });

  const request = new Request("https://example.com", { method: "POST", body: stream });
  const clonedRequest1 = request.clone();
  const clonedRequest2 = request.clone();

  const originalBody = await request.text();
  const clonedBody1 = await clonedRequest1.text();
  const clonedBody2 = await clonedRequest2.text();

  expect(originalBody).toBe("MultiCloneTest");
  expect(clonedBody1).toBe("MultiCloneTest");
  expect(clonedBody2).toBe("MultiCloneTest");
});
