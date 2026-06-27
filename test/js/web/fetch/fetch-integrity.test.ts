// https://github.com/oven-sh/bun/issues/5650
// WHATWG fetch, main fetch step 22: when the request has non-empty integrity
// metadata, the response body must be fully read and verified before the
// fetch() promise settles; a digest mismatch is a network error (TypeError).
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const MISMATCH_MESSAGE =
  "Integrity check failed: the response body does not match the digest in the request's 'integrity' option";

const BODY = "subresource integrity response body";
// Larger than uSockets' 512 KiB receive buffer, so the client is guaranteed to
// take more than one socket read. This is the regression test for the
// BodyReceiveMode backpressure deadlock: waiting for the body without forcing
// BufferAll would pause the transport after the first chunk forever.
const BIG_BODY = Buffer.alloc(2 * 1024 * 1024, "integrity!").toString();

function sri(algo: "sha256" | "sha384" | "sha512", data: string): string {
  return `${algo}-${createHash(algo).update(data).digest("base64")}`;
}

// A syntactically valid digest of the wrong content.
function wrong(algo: "sha256" | "sha384" | "sha512"): string {
  return sri(algo, "not the body");
}

// Resolved by the /slow handler with its stream controller once the first
// chunk has been enqueued, so the abort test can await a real condition
// instead of a timer and can finish the server-side stream afterward.
let slowBodyStarted = Promise.withResolvers<ReadableStreamDefaultController>();

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/body":
        return new Response(BODY);
      case "/big":
        return new Response(BIG_BODY);
      case "/gzip":
        return new Response(gzipSync(Buffer.from(BODY)), {
          headers: { "content-encoding": "gzip" },
        });
      case "/redirect":
        return new Response(null, { status: 302, headers: { location: "/body" } });
      case "/slow":
        // First chunk goes out, then the stream stays open until the test ends it.
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("first chunk"));
              slowBodyStarted.resolve(controller);
            },
          }),
        );
    }
    return new Response("not found", { status: 404 });
  },
});
afterAll(() => server.stop(true));

const url = (path: string) => new URL(path, server.url).href;

async function expectIntegrityRejection(promise: Promise<Response>) {
  await expect(promise).rejects.toBeInstanceOf(TypeError);
  await expect(promise).rejects.toThrow(MISMATCH_MESSAGE);
}

describe("fetch() integrity", () => {
  test.each(["sha256", "sha384", "sha512"] as const)("%s: a matching digest resolves", async algo => {
    const res = await fetch(url("/body"), { integrity: sri(algo, BODY) });
    expect(await res.text()).toBe(BODY);
    expect(res.status).toBe(200);
  });

  test.each(["sha256", "sha384", "sha512"] as const)("%s: a mismatched digest rejects", async algo => {
    await expectIntegrityRejection(fetch(url("/body"), { integrity: wrong(algo) }));
  });

  test("the strongest algorithm group is the one that must match", async () => {
    // sha512 outranks sha256; only the sha512 digest is consulted.
    await expect(
      fetch(url("/body"), { integrity: `${wrong("sha256")} ${sri("sha512", BODY)}` }).then(r => r.text()),
    ).resolves.toBe(BODY);
    await expectIntegrityRejection(fetch(url("/body"), { integrity: `${sri("sha256", BODY)} ${wrong("sha512")}` }));
  });

  test("any digest in the strongest group may match", async () => {
    const res = await fetch(url("/body"), { integrity: `${wrong("sha256")} ${sri("sha256", BODY)}` });
    expect(await res.text()).toBe(BODY);
  });

  test("unrecognized algorithms are ignored", async () => {
    // No recognized token -> the metadata set is empty -> no check.
    for (const integrity of ["md5-AAAA", "sha1-AAAA", "not-even-close", "???"]) {
      const res = await fetch(url("/body"), { integrity });
      expect(await res.text()).toBe(BODY);
    }
    // A recognized algorithm mixed with unrecognized ones is still enforced.
    await expectIntegrityRejection(fetch(url("/body"), { integrity: `md5-AAAA ${wrong("sha256")}` }));
  });

  test("a recognized algorithm with an undecodable value never matches", async () => {
    // The entry is present (so the set is non-empty) but can never equal a
    // real digest, so the fetch must fail rather than vacuously succeed.
    await expectIntegrityRejection(fetch(url("/body"), { integrity: "sha256-$$$$$$$$" }));
  });

  test("an empty or absent integrity option performs no check", async () => {
    expect(await fetch(url("/body"), { integrity: "" }).then(r => r.text())).toBe(BODY);
    expect(await fetch(url("/body")).then(r => r.text())).toBe(BODY);
  });

  test("the algorithm token is case-insensitive", async () => {
    const upper = sri("sha256", BODY).replace(/^sha256/, "SHA256");
    expect(await fetch(url("/body"), { integrity: upper }).then(r => r.text())).toBe(BODY);
  });

  test("option expressions after '?' are ignored", async () => {
    expect(await fetch(url("/body"), { integrity: `${sri("sha256", BODY)}?foo=bar` }).then(r => r.text())).toBe(BODY);
    await expectIntegrityRejection(fetch(url("/body"), { integrity: `${wrong("sha256")}?foo=bar` }));
  });

  test("the URL-safe base64 alphabet is accepted", async () => {
    const urlSafe = sri("sha512", BODY).replace(/\+/g, "-").replace(/\//g, "_");
    expect(await fetch(url("/body"), { integrity: urlSafe }).then(r => r.text())).toBe(BODY);
  });

  test("the digest is computed over the decoded (decompressed) body", async () => {
    const res = await fetch(url("/gzip"), { integrity: sri("sha256", BODY) });
    expect(await res.text()).toBe(BODY);
  });

  test("the digest is computed over the final response after redirects", async () => {
    const res = await fetch(url("/redirect"), { integrity: sri("sha256", BODY) });
    expect(await res.text()).toBe(BODY);
    await expectIntegrityRejection(fetch(url("/redirect"), { integrity: wrong("sha256") }));
  });

  // The body here spans multiple socket reads. Regression test for the
  // backpressure deadlock described at the top of this file.
  test("a body larger than one socket read is fully buffered and verified", async () => {
    const res = await fetch(url("/big"), { integrity: sri("sha512", BIG_BODY) });
    expect(await res.text()).toBe(BIG_BODY);
    await expectIntegrityRejection(fetch(url("/big"), { integrity: wrong("sha512") }));
  });

  test("aborting while the body is buffering rejects instead of hanging", async () => {
    const started = (slowBodyStarted = Promise.withResolvers<ReadableStreamDefaultController>());
    const controller = new AbortController();
    const promise = fetch(url("/slow"), { integrity: wrong("sha256"), signal: controller.signal });
    // If the fetch settles before the server has even started the body (a
    // regression in option parsing, say), surface that instead of hanging.
    promise.then(
      () => started.reject(new Error("fetch resolved before the body started buffering")),
      err => started.reject(err),
    );
    // The response never completes on its own; abort once the first chunk is
    // on the wire so the fetch is genuinely mid-buffering.
    const stream = await started.promise;
    try {
      controller.abort();
      await expect(promise).rejects.toThrow(/abort/i);
    } finally {
      // Finish the server-side stream even when the assertion fails: without
      // this, afterAll's server.stop(true) can hang on the open-ended response
      // (a pre-existing race, reproducible on main without `integrity`).
      // close() throws if the client's abort already cancelled the stream,
      // which achieves the same thing.
      try {
        stream.close();
      } catch {}
    }
  });
});

// WHATWG fetch, main fetch step 22 is scheme-agnostic; node rejects these too.
describe("data: URL integrity", () => {
  const dataUrl = `data:text/plain,${BODY}`;

  test("a matching digest resolves", async () => {
    const res = await fetch(dataUrl, { integrity: sri("sha256", BODY) });
    expect(await res.text()).toBe(BODY);
  });

  test("a mismatched digest rejects", async () => {
    await expectIntegrityRejection(fetch(dataUrl, { integrity: wrong("sha256") }));
    await expectIntegrityRejection(fetch(new Request(dataUrl, { integrity: wrong("sha512") })));
  });

  test("an empty or unrecognized integrity option performs no check", async () => {
    expect(await fetch(dataUrl, { integrity: "" }).then(r => r.text())).toBe(BODY);
    expect(await fetch(dataUrl, { integrity: "md5-AAAA" }).then(r => r.text())).toBe(BODY);
  });
});

describe("Request integrity", () => {
  test("the integrity option is reflected by the getter", () => {
    expect(new Request(url("/body")).integrity).toBe("");
    expect(new Request(url("/body"), { integrity: "sha256-abc" }).integrity).toBe("sha256-abc");
  });

  test("a present non-string integrity is stringified (WebIDL DOMString)", async () => {
    expect(new Request(url("/body"), { integrity: 123 as any }).integrity).toBe("123");
    expect(new Request(url("/body"), { integrity: null as any }).integrity).toBe("null");
    // A present init member replaces the base Request's value even when it
    // is not a string; "123" parses to no recognized algorithm, so no check.
    const bad = new Request(url("/body"), { integrity: wrong("sha256") });
    expect(new Request(bad, { integrity: 123 as any }).integrity).toBe("123");
    expect(await fetch(bad, { integrity: 123 as any }).then(r => r.text())).toBe(BODY);
  });

  test("integrity survives clone() and Request-from-Request construction", () => {
    const base = new Request(url("/body"), { integrity: "sha384-xyz" });
    expect(base.clone().integrity).toBe("sha384-xyz");
    expect(new Request(base).integrity).toBe("sha384-xyz");
    expect(new Request(base, { method: "POST" }).integrity).toBe("sha384-xyz");
    expect(new Request(base, { integrity: "sha512-www" }).integrity).toBe("sha512-www");
    expect(new Request(base, { integrity: "" }).integrity).toBe("");
  });

  test("fetch(request) enforces the Request's integrity", async () => {
    const ok = await fetch(new Request(url("/body"), { integrity: sri("sha256", BODY) }));
    expect(await ok.text()).toBe(BODY);
    await expectIntegrityRejection(fetch(new Request(url("/body"), { integrity: wrong("sha256") })));
  });

  test("the init argument overrides the Request's integrity", async () => {
    const bad = new Request(url("/body"), { integrity: wrong("sha256") });
    // An explicit empty string clears it.
    expect(await fetch(bad, { integrity: "" }).then(r => r.text())).toBe(BODY);
    // And a different digest replaces it.
    expect(await fetch(bad, { integrity: sri("sha512", BODY) }).then(r => r.text())).toBe(BODY);
  });
});
