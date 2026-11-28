import { createTest } from "node-harness";
import { EventEmitter } from "node:events";
import readlinePromises from "node:readline/promises";
import { Duplex, type DuplexOptions, PassThrough, Transform, Writable } from "node:stream";
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
    const fi: any = new FakeInput();
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
    const fi: any = new FakeInput();
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
    assert.strictEqual((rl as any).closed, true);
  });
});

describe("readline/promises.Readline", () => {
  const sink = () =>
    new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });

  const noop = () => {};
  // @types/node leaves `writable` out of DuplexOptions.
  const notWritable = { writable: false } as DuplexOptions;

  it.each<[string, () => unknown]>([
    ["a destroyed Writable", () => sink().destroy()],
    ["a Writable destroyed with an error", () => sink().on("error", noop).destroy(new Error("boom"))],
    ["an ended Writable", () => sink().end()],
    ["an ended PassThrough", () => new PassThrough().end()],
    ["a PassThrough with writable: false", () => new PassThrough(notWritable)],
    ["a Duplex with writable: false", () => new Duplex({ ...notWritable, read() {} })],
    ["a Transform with writable: false", () => new Transform(notWritable)],
    ["an object with write() that is not a stream", () => ({ write() {} })],
    ["a Writable whose write is not a function", () => Object.defineProperty(sink(), "write", { value: null })],
  ])("the constructor throws ERR_INVALID_ARG_TYPE for %s", (_, make) => {
    const stream = make() as Writable;
    const construct = () => new readlinePromises.Readline(stream);
    expect(construct).toThrowWithCode(TypeError, "ERR_INVALID_ARG_TYPE");
    expect(construct).toThrow('The "stream" argument must be an instance of Writable. Received ');
  });

  it.each<[string, () => Writable]>([
    ["a Writable", sink],
    ["a PassThrough", () => new PassThrough()],
  ])("the constructor accepts %s and commit() resolves with null", async (_, make) => {
    const readline = new readlinePromises.Readline(make());
    expect(await readline.clearLine(0).commit()).toBeNull();
  });
});
