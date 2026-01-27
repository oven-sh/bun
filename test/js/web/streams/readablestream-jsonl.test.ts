import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("ReadableStream.jsonl()", () => {
  test("basic jsonl parsing", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a": 1}\n{"b": 2}\n{"c": 3}\n'));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  test("handles chunks split across JSON boundaries", async () => {
    const stream = new ReadableStream({
      start(controller) {
        // Split {"a": 1}\n{"b": 2} across chunks
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.enqueue(new TextEncoder().encode(' 1}\n{"b"'));
        controller.enqueue(new TextEncoder().encode(": 2}\n"));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles trailing content without newline", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a": 1}\n{"b": 2}'));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles empty lines", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a": 1}\n\n{"b": 2}\n\n'));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles whitespace-only lines", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a": 1}\n   \n{"b": 2}\n'));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("parses complex JSON objects", async () => {
    const obj1 = { name: "test", values: [1, 2, 3], nested: { a: "b" } };
    const obj2 = { unicode: "日本語", emoji: "🎉" };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify(obj1) + "\n" + JSON.stringify(obj2) + "\n"));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([obj1, obj2]);
  });

  test("throws on invalid JSON", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a": 1}\n{invalid json}\n'));
        controller.close();
      },
    });

    const results: unknown[] = [];
    let error: Error | null = null;
    try {
      for await (const obj of stream.jsonl()) {
        results.push(obj);
      }
    } catch (e) {
      error = e as Error;
    }

    expect(results).toEqual([{ a: 1 }]);
    expect(error).toBeInstanceOf(SyntaxError);
  });

  test("works with Response.body", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response('{"x": 1}\n{"y": 2}\n{"z": 3}\n', {
          headers: { "content-type": "application/x-ndjson" },
        });
      },
    });

    const response = await fetch(server.url);
    const results: unknown[] = [];
    for await (const obj of response.body!.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ x: 1 }, { y: 2 }, { z: 3 }]);
  });

  test("throws TypeError for non-ReadableStream", () => {
    // @ts-expect-error - testing runtime error
    expect(() => ReadableStream.prototype.jsonl.call({})).toThrow(TypeError);
  });

  test("throws TypeError when stream is locked", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    // Lock the stream
    stream.getReader();

    expect(() => stream.jsonl()).toThrow(TypeError);
  });

  test("handles string chunks", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue('{"a": 1}\n');
        controller.enqueue('{"b": 2}\n');
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });

  test("handles empty stream", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([]);
  });

  test("handles stream with only whitespace", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("   \n\n   \n"));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual([]);
  });

  test("works with Bun.spawn stdout", async () => {
    const jsonData = [{ line: 1 }, { line: 2 }, { line: 3 }];
    const script = jsonData.map(d => `console.log(JSON.stringify(${JSON.stringify(d)}))`).join(";");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
    });

    const results: unknown[] = [];
    for await (const obj of proc.stdout.jsonl()) {
      results.push(obj);
    }

    expect(results).toEqual(jsonData);
    expect(await proc.exited).toBe(0);
  });

  test("handles CRLF line endings", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a": 1}\r\n{"b": 2}\r\n'));
        controller.close();
      },
    });

    const results: unknown[] = [];
    for await (const obj of stream.jsonl()) {
      results.push(obj);
    }

    // The \r will be included in the trim, so this should work
    expect(results).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
