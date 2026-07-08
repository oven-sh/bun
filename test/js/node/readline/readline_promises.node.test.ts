import { createTest } from "node-harness";
import { EventEmitter } from "node:events";
import readlinePromises from "node:readline/promises";
import { PassThrough } from "node:stream";
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
});

describe("readline/promises.Interface.question()", () => {
  it("returns a rejected promise (not a sync throw) on a closed interface", async () => {
    const rl = readlinePromises.createInterface({ input: new PassThrough() });
    rl.close();
    const result = rl.question("q? ");
    expect(result).toBeInstanceOf(Promise);
    const err = await result.then(
      () => null,
      e => e,
    );
    expect({ name: err?.name, code: err?.code }).toEqual({ name: "Error", code: "ERR_USE_AFTER_CLOSE" });
  });

  it("returns a rejected promise (not a sync throw) for an invalid options.signal", async () => {
    const rl = readlinePromises.createInterface({ input: new PassThrough() });
    try {
      const result = rl.question("q? ", { signal: 42 as any });
      expect(result).toBeInstanceOf(Promise);
      const err = await result.then(
        () => null,
        e => e,
      );
      expect({ name: err?.name, code: err?.code }).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    } finally {
      rl.close();
    }
  });

  it("returns a rejected promise for an already-aborted signal", async () => {
    const rl = readlinePromises.createInterface({ input: new PassThrough() });
    try {
      const result = rl.question("q? ", { signal: AbortSignal.abort("why") });
      expect(result).toBeInstanceOf(Promise);
      const err = await result.then(
        () => null,
        e => e,
      );
      expect({ name: err?.name, code: err?.code, cause: err?.cause }).toEqual({
        name: "AbortError",
        code: "ABORT_ERR",
        cause: "why",
      });
    } finally {
      rl.close();
    }
  });
});
