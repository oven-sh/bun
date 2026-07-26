import { describe, expect, test } from "bun:test";
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

// The tee behind Request/Response.clone() structured-clones every chunk for the
// second branch. That clone must copy only the bytes the view covers: cloning the
// whole backing ArrayBuffer retains the larger shared buffer fetch() slices from.
test.each(["Request", "Response"])(
  "%s.clone() chunk clones do not retain the chunk's whole backing buffer",
  async kind => {
    const backing = new Uint8Array(1 << 20);
    const chunk = backing.subarray(17, 17 + 64);
    chunk.fill(7);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });

    const target =
      kind === "Request" ? new Request("https://example.com", { method: "POST", body: stream }) : new Response(stream);
    const clone = target.clone();

    const [originalBytes, clonedRead] = await Promise.all([target.bytes(), clone.body!.getReader().read()]);
    const clonedChunk = clonedRead.value as Uint8Array<ArrayBuffer>;

    expect(originalBytes).toEqual(chunk);
    expect(clonedChunk).toEqual(chunk);
    expect(clonedChunk.buffer.byteLength).toBe(64);
  },
);

test("fetch().clone(): chunks buffered for the unread clone own exactly their bytes", async () => {
  const total = 8 * 1024 * 1024;
  const chunk = new Uint8Array(64 * 1024).fill(42);
  await using server = Bun.serve({
    port: 0,
    fetch() {
      let sent = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (sent >= total) return controller.close();
            controller.enqueue(chunk);
            sent += chunk.byteLength;
          },
        }),
      );
    },
  });

  const response = await fetch(server.url);
  const clone = response.clone();

  // Read the original to completion: the cache-a-copy pattern. Everything the
  // clone will ever emit is now sitting in its queue.
  const original = await response.bytes();
  expect(original.byteLength).toBe(total);

  let bytes = 0;
  let backing = 0;
  for await (const teed of clone.body!) {
    bytes += teed.byteLength;
    backing += teed.buffer.byteLength;
  }
  // fetch() delivers chunks as views into a larger shared receive buffer; the
  // clones queued for the second branch must not each retain a copy of it.
  expect({ bytes, backing }).toEqual({ bytes: total, backing: total });
});

// clone() on a locked-stream body must throw a single catchable TypeError.
// It must not also report the error as uncaught: that sets exit code 1 and
// clears the pending exception even though the user handled the throw.
test.each(["Request", "Response"])(
  "%s.clone() on a locked stream body throws a catchable TypeError and does not fail the process",
  async kind => {
    const construct =
      kind === "Request"
        ? `new Request("http://example.com/", { method: "POST", body: stream, duplex: "half" })`
        : `new Response(stream)`;
    const script = `
      const stream = new ReadableStream({ start() {} });
      const target = ${construct};
      target.body.getReader(); // lock the body stream
      try {
        target.clone();
        console.log("no throw");
      } catch (e) {
        console.log("caught " + e.constructor.name + ": " + e.message);
      }
      // Give the event loop a turn so a deferred error report would surface.
      await new Promise(resolve => setImmediate(resolve));
      console.log("done");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: ["caught TypeError: Body is disturbed or locked", "done"],
      stderr: "",
      exitCode: 0,
    });
  },
);

// clone()'s usability check now fires before the stream is teed, so the
// readableStreamTee C++ bridge's exception propagation (which used to be
// covered by the test above) is exercised via `new Request(lockedRequest)`,
// which still tees. It must throw a single catchable TypeError, not also
// report it as uncaught (exit code 1) or surface a bogus follow-up error.
test("new Request(request) with a locked stream body throws a catchable TypeError from the tee and does not fail the process", async () => {
  const script = `
    const stream = new ReadableStream({ start() {} });
    const source = new Request("http://example.com/", { method: "POST", body: stream, duplex: "half" });
    source.body.getReader(); // lock the body stream
    try {
      new Request(source);
      console.log("no throw");
    } catch (e) {
      console.log("caught " + e.constructor.name + ": " + e.message);
    }
    // Give the event loop a turn so a deferred error report would surface.
    await new Promise(resolve => setImmediate(resolve));
    console.log("done");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
    stdout: ["caught TypeError: Invalid state: ReadableStream is locked", "done"],
    stderr: "",
    exitCode: 0,
  });
});

// https://fetch.spec.whatwg.org/#dom-request-clone (step 1)
// https://fetch.spec.whatwg.org/#dom-response-clone (step 1)
// clone() must throw a TypeError when "this is unusable": the body is non-null
// and its stream is disturbed or locked. Without the check, the clone of a
// consumed body "succeeds" and silently carries an empty body.
describe("clone() throws when the body is disturbed or locked", () => {
  function expectUnusable(target: Request | Response) {
    expect(() => target.clone()).toThrow(TypeError);
    expect(() => target.clone()).toThrow("Body is disturbed or locked");
  }

  test("Request: consumed string body", async () => {
    const request = new Request("http://example.com/", { method: "POST", body: "hello world" });
    await request.text();
    expectUnusable(request);
  });

  test("Request: consumed user ReadableStream body", async () => {
    const request = new Request("http://example.com/", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
    });
    await request.text();
    expectUnusable(request);
  });

  test("Request: consumed FormData body", async () => {
    const form = new FormData();
    form.append("name", "value");
    const request = new Request("http://example.com/", { method: "POST", body: form });
    await request.text();
    expectUnusable(request);
  });

  test("Request: locked body (reader acquired, never read)", () => {
    const request = new Request("http://example.com/", { method: "POST", body: "hello world" });
    request.body!.getReader();
    expectUnusable(request);
  });

  test("Request: read in flight on a stream body", async () => {
    let controller!: ReadableStreamDefaultController;
    const request = new Request("http://example.com/", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
    });
    const pending = request.text();
    expectUnusable(request);
    // The original read must still complete after the rejected clone.
    controller.enqueue(new TextEncoder().encode("hello"));
    controller.close();
    expect(await pending).toBe("hello");
  });

  test("Response: consumed string body", async () => {
    const response = new Response("hello world");
    await response.text();
    expectUnusable(response);
  });

  test("Response: consumed Blob body", async () => {
    const response = new Response(new Blob(["hello world"]));
    await response.arrayBuffer();
    expectUnusable(response);
  });

  test("Response: consumed user ReadableStream body", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
    );
    await response.text();
    expectUnusable(response);
  });

  test("Response: locked body (reader acquired, never read)", () => {
    const response = new Response("hello world");
    response.body!.getReader();
    expectUnusable(response);
  });

  test("Response: fetch() response disturbed by a reader", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("hello from server"),
    });
    const response = await fetch(server.url);
    const reader = response.body!.getReader();
    await reader.read();
    expectUnusable(response);
  });

  test("Bun.serve: clone() of an already-read incoming request throws", async () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const original = await req.text();
        try {
          req.clone();
          resolve(`no throw (original=${JSON.stringify(original)})`);
        } catch (e) {
          resolve(`${(e as Error).constructor.name}: ${(e as Error).message}`);
        }
        return new Response("ok");
      },
    });
    await fetch(server.url, { method: "POST", body: "hello" });
    expect(await promise).toBe("TypeError: Body is disturbed or locked");
  });

  test("Bun.serve: clone() of an unread incoming request still works", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          const cloned = req.clone();
          resolve(await Promise.all([req.text(), cloned.text()]));
        } catch (e) {
          reject(e);
        }
        return new Response("ok");
      },
    });
    await fetch(server.url, { method: "POST", body: "hello" });
    expect(await promise).toEqual(["hello", "hello"]);
  });

  // `routes:` handlers receive a BunRequest subclass whose own `clone` is a
  // separate native entry point (JSBunRequest::clone -> Request__clone) from
  // Request.prototype.clone; it must run the same usability check.
  test("Bun.serve routes: clone() of an already-read BunRequest throws", async () => {
    const results: string[] = [];
    const handler = async (req: Request) => {
      await req.text();
      try {
        const cloned = req.clone();
        results.push(`no throw, clone.text()=${JSON.stringify(await cloned.text())}`);
      } catch (e) {
        results.push(`${(e as Error).constructor.name}: ${(e as Error).message}`);
      }
      return new Response("ok");
    };
    await using server = Bun.serve({
      port: 0,
      routes: { "/param/:id": handler, "/static": handler },
    });
    await fetch(new URL("/param/1", server.url), { method: "POST", body: "hello" });
    await fetch(new URL("/static", server.url), { method: "POST", body: "hello" });
    expect(results).toEqual(["TypeError: Body is disturbed or locked", "TypeError: Body is disturbed or locked"]);
  });

  test("Bun.serve routes: clone() of an unread BunRequest still works", async () => {
    const results: string[][] = [];
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/param/:id": async (req: Request) => {
          const cloned = req.clone();
          results.push(await Promise.all([req.text(), cloned.text()]));
          return new Response("ok");
        },
      },
    });
    await fetch(new URL("/param/1", server.url), { method: "POST", body: "hello" });
    expect(results).toEqual([["hello", "hello"]]);
  });

  test("clone() still succeeds on a null body", () => {
    expect(new Request("http://example.com/").clone().body).toBeNull();
    expect(new Response(null).clone().body).toBeNull();
  });

  test("clone() still succeeds after the body getter materialized a stream", async () => {
    // Accessing .body locks nothing and disturbs nothing; clone must work.
    const response = new Response("hello world");
    expect(response.body!.locked).toBe(false);
    const cloned = response.clone();
    expect(await Promise.all([response.text(), cloned.text()])).toEqual(["hello world", "hello world"]);
  });
});

// https://fetch.spec.whatwg.org/#concept-body-clone: clone() tees the body
// stream and *replaces* this's body stream with one tee branch. If `.body`
// was observed before the clone, the original's `.body` must become a fresh
// branch carrying every byte; the pre-clone stream object becomes the (now
// locked) tee source. The `if (res.body) { cache.put(res.clone()); use
// res.body }` middleware shape depends on this.
describe.concurrent("clone() after `.body` was observed returns a fresh tee branch for both sides", () => {
  async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
    let n = 0;
    for await (const chunk of stream) n += chunk.byteLength;
    return n;
  }

  type Observed = { before: ReadableStream; after: ReadableStream; cloned: Request | Response };

  function observeThenClone(target: Request | Response): Observed {
    const before = target.body!;
    expect(before.locked).toBe(false);
    expect(target.bodyUsed).toBe(false);

    const cloned = target.clone();
    const after = target.body!;

    // Spec: .body is a new tee branch; the pre-clone stream is the tee
    // source and is now locked.
    expect(after).not.toBe(before);
    expect(before.locked).toBe(true);
    expect(target.bodyUsed).toBe(false);
    return { before, after, cloned };
  }

  async function checkBytes({ after, cloned }: Observed, n: number) {
    const [origBytes, cloneBytes] = await Promise.all([drain(after), drain(cloned.body!)]);
    expect({ origBytes, cloneBytes }).toEqual({ origBytes: n, cloneBytes: n });
  }

  // Each body type hits a different internal representation at clone() time:
  //   - fetch() with the full body buffered → InternalBlob, then .body
  //     materializes a Blob-backed stream (the reported bug)
  //   - new Response(string) → WTFStringImpl, then .body materializes a
  //     Blob-backed stream
  //   - new Response(Uint8Array) → Blob, then .body materializes a
  //     Blob-backed stream
  //   - new Response(ReadableStream) → Locked with a user stream already
  //     rooted in the JS-side stream slot
  const N = 8192;
  const payload = Buffer.alloc(N, "a");
  const cases: Array<[string, () => Promise<Request | Response>]> = [
    [
      "fetch() Response with a buffered body",
      async () => {
        // `using` on the outer server closes it after fetch() returns; the
        // whole body has been received by then.
        await using server = Bun.serve({
          port: 0,
          fetch: () => new Response(payload, { headers: { "content-length": String(N) } }),
        });
        return await fetch(server.url);
      },
    ],
    ["Response with a string body", async () => new Response(payload.toString("latin1"))],
    ["Response with a Uint8Array body", async () => new Response(payload)],
    [
      "Response with a user ReadableStream body",
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.from(payload));
              controller.close();
            },
          }),
        ),
    ],
    [
      "Request with a string body",
      async () =>
        new Request("http://example.com/", {
          method: "POST",
          body: payload.toString("latin1"),
        }),
    ],
    [
      "Request with a user ReadableStream body",
      async () =>
        new Request("http://example.com/", {
          method: "POST",
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.from(payload));
              controller.close();
            },
          }),
          // @ts-expect-error duplex
          duplex: "half",
        }),
    ],
  ];

  for (const [label, make] of cases) {
    test(`${label}: reading .body after observe+clone yields the full payload on both sides`, async () => {
      await checkBytes(observeThenClone(await make()), N);
    });

    test(`${label}: .text() after observe+clone yields the full payload on both sides`, async () => {
      const target = await make();
      void target.body; // observe only; no reader, no lock
      const cloned = target.clone();
      const [origText, cloneText] = await Promise.all([target.text(), cloned.text()]);
      expect(origText.length).toBe(N);
      expect(cloneText.length).toBe(N);
    });
  }

  // `routes:` handlers receive a BunRequest subclass whose own `clone` is a
  // separate native entry point (JSBunRequest::clone -> Request__clone); it
  // must repoint the source's cached `.body` the same way.
  test("Bun.serve routes: BunRequest observe+clone yields a fresh tee branch carrying the full payload", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/p/:id": async (req: Request) => {
          try {
            await checkBytes(observeThenClone(req), N);
            resolve();
          } catch (e) {
            reject(e);
          }
          return new Response("ok");
        },
      },
    });
    await fetch(new URL("/p/1", server.url), { method: "POST", body: payload });
    await promise;
  });

  test("fetch() Response: second clone after observe still yields full payload", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(payload),
    });
    const response = await fetch(server.url);
    void response.body;
    const c1 = response.clone();
    void response.body;
    const c2 = response.clone();
    const [orig, b1, b2] = await Promise.all([drain(response.body!), drain(c1.body!), drain(c2.body!)]);
    expect({ orig, b1, b2 }).toEqual({ orig: N, b1: N, b2: N });
  });
});

// The two-arg `new Request(src, init)` constructor tees the source body via a
// separate path from single-arg / .clone(); with a user ReadableStream body
// (migrated into the source wrapper's stream cache at construction) it must
// consult that cache instead of teeing the now-empty native slot, or the
// derived request's body is a branch of a disconnected stream and reads hang.
// After the tee, the source's cached stream must also be repointed to its own
// branch so reading the source still works.
test("new Request(src, init) with a user ReadableStream body: both derived and source read the bytes", async () => {
  const stream = () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
  // @ts-expect-error duplex
  const make = () => new Request("http://example.com/", { method: "POST", body: stream(), duplex: "half" });
  const bytes = async (r: Request | Response) => [...new Uint8Array(await r.arrayBuffer())];

  const twoArgSrc = make();
  const twoArg = new Request(twoArgSrc, { headers: { "x-a": "1" } });
  const oneArgSrc = make();
  const oneArg = new Request(oneArgSrc);
  // Bun extension: a Response as the second argument contributes its body via
  // the sibling Response-source branch in construct_into.
  const responseSrc = new Response(stream());
  // @ts-expect-error Bun accepts a Response as init
  const fromResponse = new Request("http://example.com/", responseSrc);
  expect({
    twoArg: { derived: await bytes(twoArg), src: await bytes(twoArgSrc) },
    oneArg: { derived: await bytes(oneArg), src: await bytes(oneArgSrc) },
    fromResponse: { derived: await bytes(fromResponse), src: await bytes(responseSrc) },
  }).toEqual({
    twoArg: { derived: [1, 2, 3], src: [1, 2, 3] },
    oneArg: { derived: [1, 2, 3], src: [1, 2, 3] },
    fromResponse: { derived: [1, 2, 3], src: [1, 2, 3] },
  });
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
