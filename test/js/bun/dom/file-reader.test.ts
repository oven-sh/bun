import { FileReader, ProgressEvent, Window } from "bun:dom";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

type Method = "readAsText" | "readAsArrayBuffer" | "readAsDataURL" | "readAsBinaryString";

function read(method: Method, blob: Blob, ...rest: string[]) {
  const reader = new FileReader();
  const events: string[] = [];
  const { promise, resolve } = Promise.withResolvers<{ reader: FileReader; events: string[] }>();
  for (const type of ["loadstart", "progress", "load", "abort", "error", "loadend"]) {
    reader.addEventListener(type, event => {
      events.push(`${type} ${reader.readyState} ${(event as ProgressEvent).loaded}/${(event as ProgressEvent).total}`);
      if (type === "loadend") resolve({ reader, events });
    });
  }
  (reader[method] as (blob: Blob, ...rest: string[]) => void)(blob, ...rest);
  return promise;
}

describe("FileReader", () => {
  test("is on the window and not on the global object", () => {
    expect(new new Window().FileReader()).toBeInstanceOf(FileReader);
    expect("FileReader" in globalThis).toBe(false);
    expect([FileReader.EMPTY, FileReader.LOADING, FileReader.DONE]).toEqual([0, 1, 2]);
  });

  test("a script that waited for load is in time for loadend", async () => {
    const reader = new FileReader();
    reader.readAsText(new Blob(["hello"]));
    await new Promise(resolve => reader.addEventListener("load", resolve, { once: true }));
    await new Promise(resolve => reader.addEventListener("loadend", resolve, { once: true }));
    expect(reader.result).toBe("hello");
  });

  test("readAsText fires loadstart, progress, load, loadend as tasks", async () => {
    const reader = new FileReader();
    expect([reader.readyState, reader.result, reader.error]).toEqual([0, null, null]);

    const { events, reader: done } = await read("readAsText", new Blob(["héllo"]));
    expect(events).toEqual(["loadstart 1 0/0", "progress 1 6/6", "load 2 6/6", "loadend 2 6/6"]);
    expect(done.result).toBe("héllo");
    expect(done.error).toBeNull();
  });

  test("nothing is fired before the method returns", async () => {
    const reader = new FileReader();
    let fired = false;
    reader.onloadstart = () => (fired = true);
    const ended = new Promise(resolve => (reader.onloadend = resolve));
    reader.readAsText(new Blob(["x"]));
    expect([fired, reader.readyState, reader.result]).toEqual([false, 1, null]);
    const event = await ended;
    expect(event).toBeInstanceOf(ProgressEvent);
    expect((event as ProgressEvent).target).toBe(reader);
  });

  test("readAsArrayBuffer", async () => {
    const { reader } = await read("readAsArrayBuffer", new Blob([new Uint8Array([1, 2, 255])]));
    expect(reader.result).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(reader.result as ArrayBuffer)]).toEqual([1, 2, 255]);
    expect(reader.result).toBe(reader.result);
  });

  test("readAsBinaryString", async () => {
    const { reader } = await read("readAsBinaryString", new Blob([new Uint8Array([0, 65, 200, 255])]));
    expect(reader.result).toBe("\0A\xC8\xFF");
  });

  test.each([
    [new Blob(["hi"], { type: "text/plain" }), "data:text/plain;base64,aGk="],
    [new File(["hi"], "a.png", { type: "image/png" }), "data:image/png;base64,aGk="],
    [new Blob(["hi"]), "data:application/octet-stream;base64,aGk="],
    [new Blob([]), "data:application/octet-stream;base64,"],
  ])("readAsDataURL %#", async (blob, expected) => {
    expect((await read("readAsDataURL", blob)).reader.result).toBe(expected);
  });

  test("an empty blob gives an empty string and no progress event", async () => {
    const { reader, events } = await read("readAsText", new Blob([]));
    expect(reader.result).toBe("");
    expect(events).toEqual(["loadstart 1 0/0", "load 2 0/0", "loadend 2 0/0"]);
  });

  describe("the encoding of readAsText", () => {
    const euro = new Uint8Array([0x80]);
    test.each([
      ["the argument", new Blob([euro]), ["windows-1252"], "€"],
      ["the charset of the type", new Blob([euro], { type: "text/plain;charset=windows-1252" }), [], "€"],
      ["the argument before the type", new Blob([euro], { type: "text/plain;charset=utf-8" }), ["windows-1252"], "€"],
      ["UTF-8 without either", new Blob([euro]), [], "�"],
      ["UTF-8 for a label nobody knows", new Blob(["é"]), ["no-such-encoding"], "é"],
      ["utf-16be", new Blob([new Uint8Array([0, 0x68, 0, 0x69])]), ["utf-16be"], "hi"],
      ["a UTF-8 byte order mark", new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 0x68])]), [], "h"],
      ["a UTF-16LE byte order mark", new Blob([new Uint8Array([0xff, 0xfe, 0x68, 0])]), [], "h"],
      [
        "a UTF-16BE byte order mark before the argument",
        new Blob([new Uint8Array([0xfe, 0xff, 0, 0x68])]),
        ["utf-8"],
        "h",
      ],
    ])("%s", async (_, blob, rest, expected) => {
      expect((await read("readAsText", blob, ...rest)).reader.result).toBe(expected);
    });
  });

  test("a second read while one is going on throws InvalidStateError", async () => {
    const reader = new FileReader();
    const ended = new Promise(resolve => (reader.onloadend = resolve));
    reader.readAsText(new Blob(["a"]));
    expect(() => reader.readAsText(new Blob(["b"]))).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
    await ended;
    expect(reader.result).toBe("a");
  });

  test("a reader can be used again, from its own load listener too", async () => {
    const reader = new FileReader();
    const results: unknown[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    reader.onload = () => {
      results.push(reader.result);
      if (results.length === 1) reader.readAsText(new Blob(["second"]));
      else resolve();
    };
    reader.readAsText(new Blob(["first"]));
    await promise;
    expect(results).toEqual(["first", "second"]);
  });

  test("abort() fires abort and loadend at once, and nothing afterwards", async () => {
    const reader = new FileReader();
    const events: string[] = [];
    for (const type of ["loadstart", "progress", "load", "abort", "error", "loadend"])
      reader.addEventListener(type, () => events.push(type));
    reader.abort();
    expect(events).toEqual([]);

    reader.readAsText(new Blob(["x"]));
    reader.abort();
    expect(events).toEqual(["abort", "loadend"]);
    expect([reader.readyState, reader.result, reader.error?.name]).toEqual([2, null, "AbortError"]);

    const other = await read("readAsText", new Blob(["later"]));
    expect(other.reader.result).toBe("later");
    expect(events).toEqual(["abort", "loadend"]);
  });

  test("anything but a Blob is a TypeError", () => {
    const reader = new FileReader();
    for (const value of [undefined, null, "text", {}, new ArrayBuffer(1)])
      expect(() => reader.readAsText(value as Blob)).toThrow(TypeError);
    expect(reader.readyState).toBe(0);
  });

  test("does not look at Blob.prototype", async () => {
    const { arrayBuffer } = Blob.prototype;
    Blob.prototype.arrayBuffer = () => Promise.reject(new Error("replaced"));
    try {
      expect((await read("readAsText", new Blob(["real"]))).reader.result).toBe("real");
    } finally {
      Blob.prototype.arrayBuffer = arrayBuffer;
    }
  });

  test("reads a file on disk", async () => {
    using dir = tempDir("file-reader", { "hello.txt": "from disk" });
    const { reader, events } = await read("readAsText", Bun.file(join(String(dir), "hello.txt")));
    expect(reader.result).toBe("from disk");
    expect(events.at(-2)).toBe("load 2 9/9");
  });

  test("a file that is not there is a NotFoundError", async () => {
    using dir = tempDir("file-reader", {});
    const { reader, events } = await read("readAsText", Bun.file(join(String(dir), "missing.txt")));
    expect(events.map(event => event.split(" ")[0])).toEqual(["loadstart", "error", "loadend"]);
    expect([reader.readyState, reader.result, reader.error?.name]).toEqual([2, null, "NotFoundError"]);
  });

  test("a reader nobody holds still finishes", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    (() => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(new Blob(["kept alive"]));
    })();
    Bun.gc(true);
    expect(await promise).toBe("kept alive");
  });

  test("shows an upload's preview, as a component would", async () => {
    const { document, FileReader } = new Window();
    const image = document.body.appendChild(document.createElement("img"));
    const reader = new FileReader();
    const loaded = new Promise<void>(resolve => {
      reader.onload = () => {
        image.src = reader.result as string;
        resolve();
      };
    });
    reader.readAsDataURL(new File([new Uint8Array([137, 80, 78, 71])], "pixel.png", { type: "image/png" }));
    await loaded;
    expect(image.getAttribute("src")).toBe("data:image/png;base64,iVBORw==");
  });
});
