import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

test("Request with string body can be cloned", async () => {
  const body = "Hello, world!";
  const request = new Request("https://example.com", { method: "POST", body });
  const clonedRequest = request.clone();

  const originalBody = await request.text();
  const clonedBody = await clonedRequest.text();

  expect(originalBody).toBe(body);
  expect(clonedBody).toBe(body);
});

test("Response with string body can be cloned", async () => {
  const body = "Hello, world!";
  const response = new Response(body);
  const clonedResponse = response.clone();

  const originalBody = await response.text();
  const clonedBody = await clonedResponse.text();

  expect(originalBody).toBe(body);
  expect(clonedBody).toBe(body);
});

test("Request with ArrayBuffer body can be cloned", async () => {
  const body = new ArrayBuffer(8);
  new Uint8Array(body).set([1, 2, 3, 4, 5, 6, 7, 8]);
  const request = new Request("https://example.com", { method: "POST", body });
  const clonedRequest = request.clone();

  const originalBody = new Uint8Array(await request.arrayBuffer());
  const clonedBody = new Uint8Array(await clonedRequest.arrayBuffer());

  expect(originalBody).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  expect(clonedBody).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
});

test("Response with ArrayBuffer body can be cloned", async () => {
  const body = new ArrayBuffer(8);
  new Uint8Array(body).set([1, 2, 3, 4, 5, 6, 7, 8]);
  const response = new Response(body);
  const clonedResponse = response.clone();

  const originalBody = new Uint8Array(await response.arrayBuffer());
  const clonedBody = new Uint8Array(await clonedResponse.arrayBuffer());

  expect(originalBody).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  expect(clonedBody).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
});

test("Request with Uint8Array body can be cloned", async () => {
  const body = new Uint8Array([1, 2, 3, 4, 5]);
  const request = new Request("https://example.com", { method: "POST", body });
  const clonedRequest = request.clone();

  const originalBody = new Uint8Array(await request.arrayBuffer());
  const clonedBody = new Uint8Array(await clonedRequest.arrayBuffer());

  expect(originalBody).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(clonedBody).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
});

test("Response with Uint8Array body can be cloned", async () => {
  const body = new Uint8Array([1, 2, 3, 4, 5]);
  const response = new Response(body);
  const clonedResponse = response.clone();

  const originalBody = new Uint8Array(await response.arrayBuffer());
  const clonedBody = new Uint8Array(await clonedResponse.arrayBuffer());

  expect(originalBody).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(clonedBody).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
});

test("Request with mixed body types can be cloned", async () => {
  const bodies = [
    "Hello, world!",
    new ArrayBuffer(8),
    new Uint8Array([1, 2, 3, 4, 5]),
    new ReadableStream({
      start(controller) {
        controller.enqueue("Stream");
        controller.close();
      },
    }),
  ];

  for (const body of bodies) {
    const request = new Request("https://example.com", { method: "POST", body });
    const clonedRequest = request.clone();

    let originalBody, clonedBody;

    if (typeof body === "string") {
      originalBody = await request.text();
      clonedBody = await clonedRequest.text();
    } else {
      originalBody = new Uint8Array(await request.arrayBuffer());
      clonedBody = new Uint8Array(await clonedRequest.arrayBuffer());
    }

    expect(originalBody).toEqual(clonedBody);
  }
});

test("Response with mixed body types can be cloned", async () => {
  const bodies = [
    "Hello, world!",
    new ArrayBuffer(8),
    new Uint8Array([1, 2, 3, 4, 5]),
    new ReadableStream({
      start(controller) {
        controller.enqueue("Stream");
        controller.close();
      },
    }),
  ];

  for (const body of bodies) {
    const response = new Response(body);
    const clonedResponse = response.clone();

    let originalBody, clonedBody;

    if (typeof body === "string") {
      originalBody = await response.text();
      clonedBody = await clonedResponse.text();
    } else {
      originalBody = new Uint8Array(await response.arrayBuffer());
      clonedBody = new Uint8Array(await clonedResponse.arrayBuffer());
    }

    expect(originalBody).toEqual(clonedBody);
  }
});

test("Request with non-ASCII string body can be cloned", async () => {
  const body = "Hello, 世界! 🌍 Здравствуй, мир!";
  const request = new Request("https://example.com", { method: "POST", body });
  const clonedRequest = request.clone();

  const originalBody = await request.text();
  const clonedBody = await clonedRequest.text();

  expect(originalBody).toBe(body);
  expect(clonedBody).toBe(body);
});

test("Response with non-ASCII string body can be cloned", async () => {
  const body = "こんにちは、世界! 🌎 Bonjour, le monde!";
  const response = new Response(body);
  const clonedResponse = response.clone();

  const originalBody = await response.text();
  const clonedBody = await clonedResponse.text();

  expect(originalBody).toBe(body);
  expect(clonedBody).toBe(body);
});

test("Request with streaming non-ASCII body can be cloned", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("Hello, ");
      controller.enqueue("世界");
      controller.enqueue("! 🌏 ");
      controller.enqueue("Olá, mundo!");
      controller.close();
    },
  });

  const request = new Request("https://example.com", { method: "POST", body: stream });
  const clonedRequest = request.clone();

  const originalBody = await request.text();
  const clonedBody = await clonedRequest.text();

  expect(originalBody).toBe("Hello, 世界! 🌏 Olá, mundo!");
  expect(clonedBody).toBe("Hello, 世界! 🌏 Olá, mundo!");
});

test("Response with streaming non-ASCII body can be cloned", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("Здравствуй, ");
      controller.enqueue("мир");
      controller.enqueue("! 🌍 ");
      controller.enqueue("Hola, mundo!");
      controller.close();
    },
  });

  const response = new Response(stream);
  const clonedResponse = response.clone();

  const originalBody = await response.text();
  const clonedBody = await clonedResponse.text();

  expect(originalBody).toBe("Здравствуй, мир! 🌍 Hola, mundo!");
  expect(clonedBody).toBe("Здравствуй, мир! 🌍 Hola, mundo!");
});

test("Request with mixed non-ASCII body types can be cloned", async () => {
  const bodies = [
    "Hello, 世界! 🌍",
    new TextEncoder().encode("こんにちは、世界! 🌎"),
    new ReadableStream({
      start(controller) {
        controller.enqueue("Здравствуй, ");
        controller.enqueue("мир");
        controller.enqueue("! 🌏");
        controller.close();
      },
    }),
  ];

  for (const body of bodies) {
    const request = new Request("https://example.com", { method: "POST", body });
    const clonedRequest = request.clone();

    let originalBody, clonedBody;

    if (typeof body === "string") {
      originalBody = await request.text();
      clonedBody = await clonedRequest.text();
    } else if (body instanceof Uint8Array) {
      originalBody = new TextDecoder().decode(await request.arrayBuffer());
      clonedBody = new TextDecoder().decode(await clonedRequest.arrayBuffer());
    } else {
      originalBody = await request.text();
      clonedBody = await clonedRequest.text();
    }

    expect(originalBody).toEqual(clonedBody);
  }
});

test("ReadableStream with mixed content (starting with string) can be converted to text", async () => {
  const mixedContent = [
    "Hello, 世界! 🌍",
    new Uint8Array([240, 159, 140, 141]), // 🌍 emoji
    new ArrayBuffer(4),
    "Здравствуй, мир!",
  ];

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      await 1; // Delay in a microtask
      if (index < mixedContent.length) {
        controller.enqueue(mixedContent[index++]);
      } else {
        controller.close();
      }
    },
  });

  const text = await stream.text();
  expect(typeof text).toBe("string");
  expect(text).toContain("Hello, 世界!");
  expect(text).toContain("🌍");
  expect(text).toContain("Здравствуй, мир!");
});

test("ReadableStream with mixed content (starting with Uint8Array) can be converted to ArrayBuffer", async () => {
  const mixedContent = [
    new Uint8Array([72, 101, 108, 108, 111]), // "Hello" in ASCII
    "世界! 🌍",
    new ArrayBuffer(4),
    "Здравствуй, мир!",
  ];

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      await 1; // Delay in a microtask
      if (index < mixedContent.length) {
        controller.enqueue(mixedContent[index++]);
      } else {
        controller.close();
      }
    },
  });

  const arrayBuffer = await Bun.readableStreamToArrayBuffer(stream);
  expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
  const text = new TextDecoder().decode(arrayBuffer);
  expect(text).toContain("Hello");
  expect(text).toContain("世界!");
  expect(text).toContain("🌍");
  expect(text).toContain("Здравствуй, мир!");
});

test("ReadableStream with mixed content (starting with ArrayBuffer) can be converted to Uint8Array", async () => {
  const mixedContent = [
    new ArrayBuffer(4),
    "Hello, 世界! 🌍",
    new Uint8Array([240, 159, 140, 141]), // 🌍 emoji
    "Здравствуй, мир!",
  ];

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      await 1; // Delay in a microtask
      if (index < mixedContent.length) {
        controller.enqueue(mixedContent[index++]);
      } else {
        controller.close();
      }
    },
  });

  const uint8Array = await Bun.readableStreamToBytes(stream);
  expect(uint8Array).toBeInstanceOf(Uint8Array);
  const text = new TextDecoder().decode(uint8Array);
  expect(text).toContain("Hello, 世界!");
  expect(text).toContain("🌍");
  expect(text).toContain("Здравствуй, мир!");
});

test("ReadableStream with mixed content (starting with string) can be converted to ArrayBuffer using Response", async () => {
  const mixedContent = [
    "Hello, ",
    "世界! ",
    new Uint8Array([240, 159, 140, 141]), // 🌍 emoji
    "Здравствуй, мир!",
  ];

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      await 1; // Delay in a microtask
      if (index < mixedContent.length) {
        controller.enqueue(mixedContent[index++]);
      } else {
        controller.close();
      }
    },
  });

  const response = new Response(stream);
  const arrayBuffer = await response.arrayBuffer();
  expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
  const text = new TextDecoder().decode(arrayBuffer);
  expect(text).toContain("Hello");
  expect(text).toContain("世界!");
  expect(text).toContain("🌍");
  expect(text).toContain("Здравствуй, мир!");
});

test("ReadableStream with mixed content (starting with ArrayBuffer) can be converted to Uint8Array using Response", async () => {
  const mixedContent = [
    new ArrayBuffer(4),
    "Hello, 世界! 🌍",
    new Uint8Array([240, 159, 140, 141]), // 🌍 emoji
    "Здравствуй, мир!",
  ];

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      await 1; // Delay in a microtask
      if (index < mixedContent.length) {
        controller.enqueue(mixedContent[index++]);
      } else {
        controller.close();
      }
    },
  });

  const response = new Response(stream);
  const uint8Array = await response.bytes();
  expect(uint8Array).toBeInstanceOf(Uint8Array);
  const text = new TextDecoder().decode(uint8Array);
  expect(text).toStartWith("\0\0\0\0");
  expect(text).toContain("Hello, 世界!");
  expect(text).toContain("🌍");
  expect(text).toContain("Здравствуй, мир!");
});

test("Blob type from a consumed Response keeps the original content-type after clones with different content-types are consumed", async () => {
  // The Response and its clones share one underlying body store. Consuming a clone
  // with a different Content-Type must not change (or invalidate) the type of a Blob
  // that was already returned from a previous .blob() call on a sibling.
  const script = `
    const originalType = "application/x-original-type-0000000000000001";
    const replacementType = "application/x-replaced-type-0000000000000002";
    const churnType = "application/x-scribble-type-0000000000000003";

    const r1 = new Response(new Blob(["x"]), { headers: { "content-type": originalType } });
    const clones = [];
    for (let i = 0; i < 8; i++) clones.push(r1.clone());

    // Consume the original first; its Blob's type should remain originalType.
    const b1 = await r1.blob();

    // Consume every clone (same shared store) with a different, same-length content-type.
    const cloneTypes = [];
    for (const clone of clones) {
      clone.headers.set("content-type", replacementType);
      cloneTypes.push((await clone.blob()).type);
    }

    // Consume a batch of unrelated bodies whose content-type has the same length,
    // recycling any recently released same-sized native allocations.
    const churned = [];
    for (let i = 0; i < 64; i++) {
      const r = new Response(new Blob(["y"]), { headers: { "content-type": churnType } });
      churned.push(await r.blob());
    }

    console.log(b1.type);
    console.log(cloneTypes.every(type => type === replacementType) ? "clone-ok" : "clone-bad");
    console.log(churned.every(b => b.type === churnType) ? "churn-ok" : "churn-bad");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim().split("\n")).toEqual(["application/x-original-type-0000000000000001", "clone-ok", "churn-ok"]);
  expect(exitCode).toBe(0);
});
