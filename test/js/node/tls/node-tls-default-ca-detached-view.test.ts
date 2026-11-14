/**
 * tls.setDefaultCACertificates() with a view whose ArrayBuffer was transferred.
 *
 * Node loads each certificate from the bytes of the view in C++, where such a view has length 0:
 * https://github.com/nodejs/node/blob/v26.12.1/src/crypto/crypto_context.cc#L128-L141
 * https://github.com/nodejs/node/blob/v26.12.1/src/crypto/crypto_context.cc#L1157-L1190
 * So it is an element with no certificate in it, as an empty view is. It is not an error of its own.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from (Node.js v26.3.0
 * and v26.12.1). It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";

const keys = (name: string) => join(import.meta.dirname, "../test/fixtures/keys", name);
const ca1 = readFileSync(keys("ca1-cert.pem"));
const ca2 = readFileSync(keys("ca2-cert.pem"));

// [name, a function that returns a view of that kind which held ca1 until its ArrayBuffer was transferred]
const detachedViews: [string, () => NodeJS.ArrayBufferView][] = (
  [
    ["Uint8Array", buffer => new Uint8Array(buffer)],
    ["Buffer", buffer => Buffer.from(buffer)],
    ["DataView", buffer => new DataView(buffer)],
  ] as [string, (buffer: ArrayBuffer) => NodeJS.ArrayBufferView][]
).map(([name, viewOf]) => [
  name,
  () => {
    const buffer = new ArrayBuffer(ca1.length);
    new Uint8Array(buffer).set(ca1);
    const view = viewOf(buffer);
    buffer.transfer();
    return view;
  },
]);

const noCertificates = {
  name: "Error",
  code: "ERR_CRYPTO_OPERATION_FAILED",
  message: "No valid certificates found in the provided array",
};

// Runs `body` and then puts the default list back.
function withDefaults(body: () => void) {
  const defaults = tls.getCACertificates("default");
  try {
    body();
  } finally {
    tls.setDefaultCACertificates(defaults);
  }
}

/** The default list after setDefaultCACertificates(certs). */
function defaultsAfter(certs: Parameters<typeof tls.setDefaultCACertificates>[0]) {
  tls.setDefaultCACertificates(certs);
  return tls.getCACertificates("default");
}

describe("tls.setDefaultCACertificates() reads a detached view as an empty one", () => {
  for (const [name, view] of detachedViews) {
    test(`${name}: alone it is no certificate, and the default list stays`, () => {
      withDefaults(() => {
        const before = tls.getCACertificates("default");
        assert.throws(() => tls.setDefaultCACertificates([view()]), noCertificates);
        assert.throws(() => tls.setDefaultCACertificates([view(), view()]), noCertificates);
        assert.deepStrictEqual(tls.getCACertificates("default"), before);
      });
    });

    test(`${name}: beside certificates it adds nothing`, () => {
      withDefaults(() => {
        const one = defaultsAfter([ca1]);
        const two = defaultsAfter([ca2, ca1]);
        assert.deepStrictEqual([one.length, two.length], [1, 2]);
        assert.deepStrictEqual(defaultsAfter([ca1, view()]), one);
        assert.deepStrictEqual(defaultsAfter([view(), ca1]), one);
        assert.deepStrictEqual(defaultsAfter([ca2, view(), ca1.toString()]), two);
      });
    });
  }

  test("a view that a later element detaches adds nothing", () => {
    withDefaults(() => {
      const buffer = new ArrayBuffer(ca1.length);
      const view = new Uint8Array(buffer);
      view.set(ca1);
      const certs: Uint8Array[] = [view, ca2];
      // setDefaultCACertificates() reads this element after it accepted `view`.
      Object.defineProperty(certs, 1, {
        get() {
          if (!buffer.detached) buffer.transfer();
          return ca2;
        },
      });
      const onlyCa2 = defaultsAfter([ca2]);
      assert.deepStrictEqual(defaultsAfter(certs), onlyCa2);
    });
  });

  // No code of the program runs between the check of an element and the read of its bytes. A replaced next() of
  // array iterators would be such code: it can detach a view that was accepted already.
  test("it reads an accepted view before a replaced array iterator can detach it", () => {
    const script = `
      const tls = require("node:tls");
      const { readFileSync } = require("node:fs");
      const ca1 = readFileSync(process.env.CA1);
      const view = new Uint8Array(new ArrayBuffer(ca1.length));
      view.set(ca1);
      const ArrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
      const { next } = ArrayIteratorPrototype;
      ArrayIteratorPrototype.next = function () {
        if (!view.buffer.detached) view.buffer.transfer();
        return next.call(this);
      };
      tls.setDefaultCACertificates([view, readFileSync(process.env.CA2)]);
      ArrayIteratorPrototype.next = next;
      console.log(JSON.stringify({ certificates: tls.getCACertificates("default").length }));
    `;
    const { stdout, stderr, status } = spawnSync(process.execPath, ["-e", script], {
      env: { ...process.env, CA1: keys("ca1-cert.pem"), CA2: keys("ca2-cert.pem") },
      encoding: "utf8",
    });
    assert.deepStrictEqual(stdout ? JSON.parse(stdout) : stderr, { certificates: 2 });
    assert.strictEqual(status, 0);
  });
});
