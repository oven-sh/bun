import { describe, expect, test } from "bun:test";
import { gcTick, isLinux } from "harness";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

test("Blob.arrayBuffer copy-on-write is not shared", async () => {
  // 8 MB is the threshold for copy-on-write without --smol.
  const bytes = new Uint8Array((1024 * 1024 * 8 * 1.5) | 0);
  bytes.fill(42);
  bytes[bytes.length - 100] = 43;
  const blob = new Blob([bytes]);
  bytes.fill(8);

  const buf = new Uint8Array(await blob.arrayBuffer());
  expect(buf.length).toBe(blob.size);
  expect(buf[0]).toBe(42);
  expect(buf[buf.length - 1]).toBe(42);

  buf[0] = 0;

  const buf2 = new Uint8Array(await blob.arrayBuffer());
  expect(buf2[0]).toBe(42);
  buf2[0] = 1;
  expect(buf2[buf.length - 1]).toBe(42);

  const buf3 = new Uint8Array(await blob.slice(0, 1).arrayBuffer());
  expect(buf3[0]).toBe(42);
  buf3[0] = 2;
  expect(buf3.length).toBe(1);

  const buf4 = new Uint8Array(await blob.slice(blob.size - 100).arrayBuffer());
  expect(buf4[0]).toBe(43);
  buf4[0] = 3;
  expect(buf4.length).toBe(100);

  expect(buf[0]).toBe(0);
  expect(buf2[0]).toBe(1);
  expect(buf3[0]).toBe(2);
  expect(buf4[0]).toBe(3);
});

test("Response.arrayBuffer from a Blob body is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const buf = new Uint8Array(await new Response(blob).arrayBuffer());
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("Response.bytes from a Blob body is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const buf = await new Response(blob).bytes();
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("Request.arrayBuffer from a Blob body is not shared with the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const request = new Request("http://localhost/", { method: "POST", body: blob });
  const buf = new Uint8Array(await request.arrayBuffer());
  expect(new TextDecoder().decode(buf)).toBe("hello world");
  buf.fill(120);
  expect(await blob.text()).toBe("hello world");
});

test("Response.bytes from a Blob body is not shared with text previously read from the Blob", async () => {
  const blob = new Blob(["hello world"]);
  const text = await blob.text();
  const buf = await new Response(blob).bytes();
  buf.fill(120);
  expect(text).toBe("hello world");
  expect(await blob.text()).toBe("hello world");
});

// On Linux a Blob of 8 MB or more keeps its bytes in a memfd, and a read that
// must not share them is a copy-on-write map of that memfd. A body that is the
// last owner of the Blob hands the Blob's own map to JS instead. A write into
// it must not reach the memfd: the pages of an earlier copy that nobody has
// written yet still read the memfd.
describe("two reads of one large Blob body are not shared with each other", () => {
  // Above the 8 MB threshold for copy-on-write without --smol.
  const size = (1024 * 1024 * 8 * 1.5) | 0;
  const original = 97;
  const written = 90;
  const source = () => new Uint8Array(size).fill(original);

  // `kept` was read first. Only `mine` is written.
  function expectKeptAfterWrite(kept: Uint8Array, mine: Uint8Array) {
    expect([kept[0], kept.at(-1), mine[0], mine.at(-1)]).toEqual([original, original, original, original]);
    mine.fill(written);
    expect(kept.indexOf(written)).toBe(-1);
    expect(mine.indexOf(original)).toBe(-1);
  }

  type Body = Response | Request;
  const reads: [string, (body: Body) => Promise<Uint8Array>][] = [
    ["arrayBuffer()", async body => new Uint8Array(await body.arrayBuffer())],
    ["bytes()", body => body.bytes()],
  ];

  // Bun reads an array body as the parts of a Blob. No Blob object refers to
  // those bytes, so the body and its clone are their only owners.
  const parts = () => [source()] as unknown as BodyInit;
  const bodies: [string, () => Body][] = [
    ["new Response([bytes])", () => new Response(parts())],
    ["new Request(url, { body: [bytes] })", () => new Request("http://localhost/", { method: "POST", body: parts() })],
  ];

  describe.each(bodies)("%s", (_, makeBody) => {
    describe.each(reads)("clone().%s", (_, readFirst) => {
      test.each(reads)("then %s", async (_, readSecond) => {
        const body = makeBody();
        const kept = await readFirst(body.clone());
        const mine = await readSecond(body);
        expect(mine.length).toBe(size);
        expectKeptAfterWrite(kept, mine);
      });
    });
  });

  // The names of the memfds that hold this process's Blobs.
  function blobMemfds() {
    return readdirSync("/proc/self/fd").flatMap(fd => {
      try {
        return /^\/memfd:(memfd-num-\d+) \(deleted\)$/.exec(readlinkSync(`/proc/self/fd/${fd}`))?.[1] ?? [];
      } catch {
        // The fd that listed the directory is closed by now.
        return [];
      }
    });
  }

  // Every mapping of one memfd: its permissions, and whether it is exempt from the commit charge.
  function mappingsOf(memfd: string) {
    const mappings: { perms: string; noreserve: boolean }[] = [];
    let perms: string | undefined;
    for (const line of readFileSync("/proc/self/smaps", "utf8").split("\n")) {
      if (line.endsWith(`/memfd:${memfd} (deleted)`)) {
        perms = line.split(" ")[1];
      } else if (perms !== undefined && line.startsWith("VmFlags:")) {
        mappings.push({ perms, noreserve: line.split(/\s+/).includes("nr") });
        perms = undefined;
      }
    }
    return mappings.sort((a, b) => Number(a.noreserve) - Number(b.noreserve));
  }

  // The cases above compare bytes, so they also pass when no memfd is in use.
  // Only Linux keeps a Blob in a memfd.
  test.skipIf(!isLinux)("the bytes of a large body are in a memfd that is only mapped privately", async () => {
    // The kernel ignores MAP_NORESERVE under vm.overcommit_memory=2.
    const noreserve = readFileSync("/proc/sys/vm/overcommit_memory", "utf8").trim() !== "2";
    const storeView = { perms: "rw-p", noreserve };
    const copyOnWriteView = { perms: "rw-p", noreserve: false };

    const before = new Set(blobMemfds());
    const response = new Response(parts());
    const created = blobMemfds().filter(name => !before.has(name));
    expect(created).toHaveLength(1);

    // The clone's read maps the memfd once more. The last owner gets the store's view.
    const kept = await response.clone().bytes();
    const mine = await response.bytes();
    expect(mappingsOf(created[0])).toEqual([copyOnWriteView, storeView]);
    expect([kept.length, mine.length]).toEqual([size, size]);
  });

  // A transfer moves the memory of the second copy to another ArrayBuffer.
  const transfers: [string, (buffer: ArrayBuffer) => ArrayBuffer][] = [
    ["buffer.transfer()", buffer => buffer.transfer()],
    ["structuredClone(buffer, { transfer: [buffer] })", buffer => structuredClone(buffer, { transfer: [buffer] })],
  ];

  test.each(transfers)("a write after %s", async (_, transfer) => {
    const response = new Response(parts());
    const kept = new Uint8Array(await response.clone().arrayBuffer());
    const mine = new Uint8Array(transfer(await response.arrayBuffer()));
    expect(mine.length).toBe(size);
    expectKeptAfterWrite(kept, mine);
  });

  // A body made from a Blob object becomes the last owner once that object has
  // been collected.
  describe("after the Blob object was collected", () => {
    type Track = <T extends Blob>(blob: T) => T;

    // Resolves once every Blob passed to `track` has been finalized, which is
    // when it releases its reference on the bytes.
    async function afterBlobsAreCollected<T>(make: (track: Track) => T | Promise<T>): Promise<T> {
      let tracked = 0;
      let collected = 0;
      const registry = new FinalizationRegistry(() => collected++);
      const result = await make(blob => {
        tracked++;
        registry.register(blob, undefined);
        return blob;
      });
      while (collected < tracked) await gcTick();
      return result;
    }

    const firstReads: [string, (blob: Blob, track: Track) => Promise<Uint8Array>][] = [
      ["blob.arrayBuffer()", async blob => new Uint8Array(await blob.arrayBuffer())],
      ["blob.bytes()", blob => blob.bytes()],
      ["blob.slice(0, n).bytes()", (blob, track) => track(blob.slice(0, size - 4096)).bytes()],
      ["new Response(blob).bytes()", blob => new Response(blob).bytes()],
    ];

    test.each(firstReads)("%s, then new Response(blob).bytes()", async (_, readFirst) => {
      let kept!: Uint8Array;
      const response = await afterBlobsAreCollected(async track => {
        const blob = track(new Blob([source()]));
        kept = await readFirst(blob, track);
        return new Response(blob);
      });
      const mine = await response.bytes();
      expect(mine.length).toBe(size);
      expectKeptAfterWrite(kept, mine);
    });

    test("response.clone().arrayBuffer(), then response.arrayBuffer()", async () => {
      const response = await afterBlobsAreCollected(track => new Response(track(new Blob([source()]))));
      const kept = new Uint8Array(await response.clone().arrayBuffer());
      const mine = new Uint8Array(await response.arrayBuffer());
      expect(mine.length).toBe(size);
      expectKeptAfterWrite(kept, mine);
    });
  });
});
