import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A 1000-byte object on a mock endpoint that implements Range per RFC 7233:
//   - `bytes=-n` returns the last n bytes (suffix range)
//   - `bytes=a-` returns from a to the end
//   - `bytes=a-b` returns [a, b] inclusive, clamping b to the last byte
//   - a first-byte-pos past the last byte is 416 Range Not Satisfiable
// AWS S3, MinIO and Cloudflare R2 all behave this way.
//
// Spawned as a subprocess because the S3 client picks up HTTP_PROXY without
// consulting NO_PROXY, so an inherited proxy would hijack the request.
const fixture = /* ts */ `
const OBJ = new Uint8Array(1000).map((_, i) => i & 0x7f);
using server = Bun.serve({
  port: 0,
  fetch(req) {
    const range = req.headers.get("range");
    process.stdout.write(JSON.stringify({ range }) + "\\n");
    if (!range) return new Response(OBJ, { headers: { ETag: '"x"' } });
    const m = /^bytes=(\\d*)-(\\d*)$/.exec(range);
    let a = 0, b = OBJ.length - 1, status = 206;
    if (!m) {
      status = 416;
    } else if (m[1] === "") {
      a = Math.max(0, OBJ.length - Number(m[2]));
    } else {
      a = Number(m[1]);
      b = m[2] === "" ? b : Math.min(Number(m[2]), b);
    }
    if (status !== 416 && a >= OBJ.length) status = 416;
    if (status === 416)
      return new Response(
        '<?xml version="1.0"?><Error><Code>InvalidRange</Code><Message>The requested range is not satisfiable</Message></Error>',
        { status: 416, headers: { "Content-Range": "bytes */" + OBJ.length } },
      );
    return new Response(OBJ.subarray(a, b + 1), {
      status: 206,
      headers: { ETag: '"x"', "Content-Range": "bytes " + a + "-" + b + "/" + OBJ.length },
    });
  },
});
const c = new Bun.S3Client({
  endpoint: server.url.href,
  bucket: "b",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  region: "us-east-1",
});
const [mode, ...args] = process.argv.slice(1);
let slice = c.file("k");
for (const group of args.join(" ").split("/"))
  slice = slice.slice(...group.split(" ").filter(Boolean).map(Number));
let got;
if (mode === "bytes") got = await slice.bytes();
else if (mode === "text") got = new TextEncoder().encode(await slice.text());
else if (mode === "arrayBuffer") got = new Uint8Array(await slice.arrayBuffer());
else if (mode === "stream") got = new Uint8Array(await Bun.readableStreamToArrayBuffer(slice.stream()));
else throw new Error("bad mode");
process.stdout.write(JSON.stringify({ len: got.length, first: got[0] ?? null }) + "\\n");
`;

type Result = { range: string | null; len: number; first: number | null };

async function run(mode: "bytes" | "text" | "arrayBuffer" | "stream", ...args: (number | "/")[]): Promise<Result> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture, mode, ...args.map(String)],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`exit ${exitCode}\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
  const lines = stdout
    .trim()
    .split("\n")
    .map(l => JSON.parse(l));
  return { range: lines[0].range, len: lines[1].len, first: lines[1].first };
}

describe("S3File.slice() Range header", () => {
  describe.each(["bytes", "text", "arrayBuffer", "stream"] as const)("via .%s()", mode => {
    it.concurrent.each([1, 5, 500])("slice(-%d) sends a suffix range", async n => {
      expect(await run(mode, -n)).toEqual({ range: `bytes=-${n}`, len: n, first: (1000 - n) & 0x7f });
    });

    it.concurrent("slice(200) with no end sends an open-ended range", async () => {
      expect(await run(mode, 200)).toEqual({ range: "bytes=200-", len: 800, first: 200 & 0x7f });
    });

    it.concurrent("slice(6, 10) still sends an absolute range", async () => {
      expect(await run(mode, 6, 10)).toEqual({ range: "bytes=6-9", len: 4, first: 6 });
    });

    it.concurrent("slice(0, 5) still sends an absolute range", async () => {
      expect(await run(mode, 0, 5)).toEqual({ range: "bytes=0-4", len: 5, first: 0 });
    });

    it.concurrent("slice(0) with no end fetches the whole object (no Range header)", async () => {
      expect(await run(mode, 0)).toEqual({ range: null, len: 1000, first: 0 });
    });

    it.concurrent("slice() with no args fetches the whole object (no Range header)", async () => {
      expect(await run(mode)).toEqual({ range: null, len: 1000, first: 0 });
    });
  });

  it.concurrent("slice(-10).slice(3) re-slices a suffix as a shorter suffix", async () => {
    expect(await run("bytes", -10, "/", 3)).toEqual({ range: "bytes=-7", len: 7, first: 993 & 0x7f });
  });

  it.concurrent("slice(-10).slice(-5) re-slices a suffix as a shorter suffix", async () => {
    expect(await run("bytes", -10, "/", -5)).toEqual({ range: "bytes=-5", len: 5, first: 995 & 0x7f });
  });

  it.concurrent("slice(-10).slice(3, 10) reaching the end stays a suffix", async () => {
    expect(await run("bytes", -10, "/", 3, 10)).toEqual({ range: "bytes=-7", len: 7, first: 993 & 0x7f });
  });

  it.concurrent("slice(-10).slice(0, 3) does not silently return a wrong suffix", async () => {
    // [len-10, len-7) cannot be expressed as an RFC 7233 range without the
    // total length, so this must fail loudly rather than return `bytes=-3`.
    const err = await run("bytes", -10, "/", 0, 3).then(
      () => null,
      e => String(e),
    );
    expect(err).toContain("InvalidRange");
  });

  it.concurrent("slice(-10).slice(3, 7) does not silently return a wrong suffix", async () => {
    const err = await run("bytes", -10, "/", 3, 7).then(
      () => null,
      e => String(e),
    );
    expect(err).toContain("InvalidRange");
  });

  it.concurrent.each([[10], [20], [10, 10]])(
    "slice(-10).slice(%p) is an empty re-slice and must not download the whole object",
    async (...args) => {
      const got = await run("bytes", -10, "/", ...(args as number[])).then(
        r => ({ ok: true, ...r }),
        e => ({ ok: false, err: String(e) }),
      );
      if (got.ok) {
        expect(got).toEqual({ ok: true, range: null, len: 0, first: null });
      } else {
        expect(got.err).toContain("InvalidRange");
      }
    },
  );

  it.concurrent("slice(200).slice(50) chains open-ended offsets", async () => {
    expect(await run("bytes", 200, "/", 50)).toEqual({ range: "bytes=250-", len: 750, first: 250 & 0x7f });
  });

  // A negative re-slice of an open-ended parent cannot be expressed as an
  // RFC 7233 range without the total length; it must 416 rather than emit a
  // whole-object suffix. `F/-F` is the exact-collision case where the generic
  // arithmetic lands on the sentinel.
  it.concurrent.each([
    [700, -500],
    [700, -700],
  ])("slice(%d).slice(%d) does not return bytes before the parent's start", async (a, b) => {
    const err = await run("bytes", a, "/", b).then(
      r => `ok len=${r.len}`,
      e => String(e),
    );
    expect(err).toContain("InvalidRange");
  });

  it.concurrent("slice(-Infinity) fetches the whole object and can be re-sliced without panicking", async () => {
    expect(await run("bytes", -Infinity)).toEqual({ range: null, len: 1000, first: 0 });
    expect(await run("bytes", -Infinity, "/", 0, 5)).toEqual({ range: "bytes=0-4", len: 5, first: 0 });
  });

  for (const huge of [2 ** 52 - 1, Number.MAX_SAFE_INTEGER]) {
    it.concurrent(`slice(${huge}) does not collide with the suffix sentinel`, async () => {
      // A start at or past 2^52-1 must not be encoded as the suffix sentinel
      // (which would drop the Range header and download the whole object).
      const { range, len } = await run("bytes", huge).catch(e => {
        const m = /"range":("[^"]*"|null)/.exec(String(e));
        return { range: m ? JSON.parse(m[1]) : undefined, len: undefined };
      });
      expect(range).not.toBeNull();
      expect(range).not.toMatch(/^bytes=-/);
      expect(len).not.toBe(1000);
    });
  }
});
