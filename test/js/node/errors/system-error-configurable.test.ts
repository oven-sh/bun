/**
 * Node leaves every own property of a system error configurable, so user code
 * can delete or redefine it. Bun built these errors in native code with
 * PropertyAttribute::DontDelete: `delete err.path` threw "TypeError: Unable to
 * delete property." in strict mode and Object.defineProperty(err, "code", ...)
 * threw too.
 *
 * errno, code, syscall, path, dest and hostname are plain assignments in Node:
 * https://github.com/nodejs/node/blob/v26.3.0/src/api/exceptions.cc#L141-L149 (UVException: fs)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L743-L745 (ErrnoException: child_process)
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L833-L838 (DNSException)
 * ERR_SYSTEM_ERROR defines info (not writable) and errno and syscall (accessors
 * onto info) with `configurable: true`, and fills info with plain assignments:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/internal/errors.js#L295-L346
 * https://github.com/nodejs/node/blob/v26.3.0/src/env.cc#L1644-L1684
 * Bun still has info writable and errno and syscall as data properties, so the
 * ERR_SYSTEM_ERROR tests here check `configurable` and `delete` only.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from. It cannot import
 * from "harness" for the same reason, so it manages its own temporary directory.
 */
import assert from "node:assert";
import child_process from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

describe("own properties of a system error are configurable", () => {
  let dir: string;
  let missing: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "system-error-configurable-"));
    missing = path.join(dir, "missing");
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function thrownBy(fn: () => unknown): any {
    try {
      fn();
    } catch (e) {
      return e;
    }
    assert.fail("expected the call to throw");
  }

  const renameError = () => thrownBy(() => fs.renameSync(missing, missing + "-moved"));
  const notDeleted = (object: object, keys: string[]) =>
    keys.filter(key => !Reflect.deleteProperty(object, key) || Object.hasOwn(object, key));

  const renameKeys = ["errno", "code", "syscall", "path", "dest"];
  const errnoErrors: [string, string[], () => unknown][] = [
    ["fs.renameSync", renameKeys, renameError],
    ["fs.rename callback", renameKeys, () => new Promise(resolve => fs.rename(missing, missing + "-moved", resolve))],
    ["fs.promises.rename", renameKeys, () => fs.promises.rename(missing, missing + "-moved").catch(e => e)],
    ["fs.closeSync", ["errno", "code", "syscall"], () => thrownBy(() => fs.closeSync(1 << 20))],
    ["child_process.spawnSync", ["errno", "code", "syscall", "path"], () => child_process.spawnSync(missing).error],
    // Not an IP address: the resolver rejects it without a query.
    [
      "dns.promises.reverse",
      ["errno", "code", "syscall", "hostname"],
      () => dns.promises.reverse("not-an-ip").catch(e => e),
    ],
  ];

  for (const [label, keys, produce] of errnoErrors) {
    test(`${label}: ${keys.join(", ")} are plain properties`, async () => {
      const err: any = await produce();
      assert.ok(err instanceof Error);

      assert.deepStrictEqual(
        Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(err, key)])),
        Object.fromEntries(
          keys.map(key => [key, { value: err[key], writable: true, enumerable: true, configurable: true }]),
        ),
      );
      assert.deepStrictEqual(notDeleted(err, keys), []);
    });
  }

  // winston's format.metadata() moves each enumerable property off the error it logs:
  // https://github.com/winstonjs/logform/blob/v2.7.0/metadata.js#L11-L15
  test("a strict-mode delete of each enumerable property of an fs error does not throw", () => {
    const err = renameError();
    const moved: Record<string, unknown> = {};
    for (const key of Object.keys(err)) {
      moved[key] = err[key];
      delete err[key];
    }

    assert.deepStrictEqual(Object.keys(moved).sort(), [...renameKeys].sort());
    assert.deepStrictEqual(Object.keys(err), []);
  });

  // err-code sets the new code this way and returns another object when it throws:
  // https://github.com/IndigoUnited/js-err-code/blob/v2.0.3/index.js#L5-L9
  test("Object.defineProperty redefines code on an fs error", () => {
    const err = renameError();
    Object.defineProperty(err, "code", { value: "ERR_NOT_FOUND", enumerable: true, configurable: true });

    assert.strictEqual(err.code, "ERR_NOT_FOUND");
  });

  const systemErrors: [string, () => unknown][] = [
    ["os.getPriority", () => os.getPriority(-1)],
    ["os.setPriority", () => os.setPriority(-1, 0)],
  ];

  for (const [label, fn] of systemErrors) {
    test(`${label} ERR_SYSTEM_ERROR: the properties of the error and of info are configurable`, () => {
      const err = thrownBy(fn);
      assert.strictEqual(err.code, "ERR_SYSTEM_ERROR");

      const notConfigurable = (object: object, keys: string[]) =>
        keys.filter(key => Object.getOwnPropertyDescriptor(object, key)?.configurable !== true);
      const { info } = err;
      const infoKeys = ["errno", "code", "message", "syscall"];
      const errorKeys = ["info", "errno", "syscall"];

      assert.deepStrictEqual(
        { info: notConfigurable(info, infoKeys), error: notConfigurable(err, errorKeys) },
        { info: [], error: [] },
      );
      assert.deepStrictEqual(
        { info: notDeleted(info, infoKeys), error: notDeleted(err, errorKeys) },
        { info: [], error: [] },
      );
    });
  }
});
