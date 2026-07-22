import { createTest } from "node-harness";
import { EventEmitter } from "node:events";
import readlinePromises from "node:readline/promises";
const { describe, it, expect, createDoneDotAll, createCallCheckCtx, assert } = createTest(import.meta.path);

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

class FakeInput extends EventEmitter {
  output = "";
  resume() {}
  pause() {}
  write(data: any) {
    this.output += data;
  }
  end() {}
  reset() {
    this.output = "";
  }
}

// Awaits a promise that must reject, and hands back the rejection reason.
async function rejectionOf(promise: Promise<unknown>): Promise<any> {
  let resolved = false;
  const err = await promise.then(
    () => void (resolved = true),
    (e: any) => e,
  );
  assert.strictEqual(resolved, false);
  return err;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("readline/promises.createInterface()", () => {
  it("should throw an error when failed completion", done => {
    const createDone = createDoneDotAll(done);
    const { mustCall, mustNotCall } = createCallCheckCtx(createDone());

    const fi = new FakeInput();
    // @ts-ignore
    const rli = new readlinePromises.Interface({
      input: fi,
      output: fi,
      terminal: true,
      completer: mustCall(() => Promise.reject(new Error("message"))),
    });

    rli.on("line", mustNotCall());
    fi.emit("data", "\t");
    queueMicrotask(() => {
      expect(fi.output).toMatch(/^Tab completion error/);
      rli.close();
      done();
    });
  });

  it("should support Symbol.dispose for using statements", () => {
    const fi = new FakeInput();
    let closed = false;

    {
      using rl = readlinePromises.createInterface({
        input: fi,
        output: fi,
      });

      rl.on("close", () => {
        closed = true;
      });

      // Verify the interface has the Symbol.dispose method
      assert.strictEqual(typeof rl[Symbol.dispose], "function");
      assert.strictEqual(!closed, true);
    }

    // After exiting the using block, the interface should be closed
    assert.strictEqual(closed, true);
  });

  it("should support Symbol.dispose as alias for close()", () => {
    const fi = new FakeInput();
    let closed = false;

    const rl = readlinePromises.createInterface({
      input: fi,
      output: fi,
    });

    rl.on("close", () => {
      closed = true;
    });

    // Verify Symbol.dispose exists and works the same as close()
    assert.strictEqual(typeof rl[Symbol.dispose], "function");
    assert.strictEqual(!closed, true);

    rl[Symbol.dispose]();

    assert.strictEqual(closed, true);
    assert.strictEqual(rl.closed, true);
  });

  describe("use after close", () => {
    const useAfterClose = { name: "Error", code: "ERR_USE_AFTER_CLOSE", message: "readline was closed" };

    function closedInterface() {
      const fi = new FakeInput();
      const rl = readlinePromises.createInterface({ input: fi, output: fi });
      rl.close();
      return rl;
    }

    it("question() rejects instead of throwing synchronously", async () => {
      const rl = closedInterface();
      const promise = rl.question("how are you?");
      assert.strictEqual(promise instanceof Promise, true);

      const err = await rejectionOf(promise);
      assert.strictEqual(err.name, useAfterClose.name);
      assert.strictEqual(err.code, useAfterClose.code);
      assert.strictEqual(err.message, useAfterClose.message);
    });

    it("prompt(), write(), pause() and resume() throw ERR_USE_AFTER_CLOSE", () => {
      const rl = closedInterface();
      assert.throws(() => rl.prompt(), useAfterClose);
      assert.throws(() => rl.write("foo\n"), useAfterClose);
      assert.throws(() => rl.pause(), useAfterClose);
      assert.throws(() => rl.resume(), useAfterClose);
    });
  });

  it("question() rejects rather than throwing when options.signal is not an AbortSignal", async () => {
    const fi = new FakeInput();
    const rl = readlinePromises.createInterface({ input: fi, output: fi });
    try {
      const promise = rl.question("how are you?", { signal: {} } as any);
      assert.strictEqual(promise instanceof Promise, true);

      const err = await rejectionOf(promise);
      assert.strictEqual(err.code, "ERR_INVALID_ARG_TYPE");
      assert.strictEqual(fi.output, "");
    } finally {
      rl.close();
    }
  });
});
