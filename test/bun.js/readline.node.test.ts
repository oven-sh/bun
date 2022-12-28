import { beforeEach, describe, it } from "bun:test";

import readline from "node:readline";
import { Writable } from "node:stream";
import {
  createCallCheckCtx,
  assert,
  strictEqual,
  deepStrictEqual,
  throws,
} from "./node-test-helpers";

const {
  [Symbol.for("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__")]: _internal,
} = readline;
const { CSI } = _internal;

class TestWritable extends Writable {
  data;
  constructor() {
    super();
    this.data = "";
  }
  _write(chunk, encoding, callback) {
    this.data += chunk.toString();
    callback();
  }
}

const writable = new TestWritable();

describe("CSI", () => {
  it("should be defined", () => {
    assert(CSI);
  });

  it("should have all the correct clear sequences", () => {
    strictEqual(CSI.kClearToLineBeginning, "\x1b[1K");
    strictEqual(CSI.kClearToLineEnd, "\x1b[0K");
    strictEqual(CSI.kClearLine, "\x1b[2K");
    strictEqual(CSI.kClearScreenDown, "\x1b[0J");
    strictEqual(CSI`1${2}3`, "\x1b[123");
  });
});

describe("readline.clearScreenDown()", () => {
  it("should put clear screen sequence into writable when called", (done) => {
    const { mustCall } = createCallCheckCtx(done);

    strictEqual(readline.clearScreenDown(writable), true);
    deepStrictEqual(writable.data, CSI.kClearScreenDown);
    strictEqual(readline.clearScreenDown(writable, mustCall()), true);
  });

  it("should throw on invalid callback", () => {
    // Verify that clearScreenDown() throws on invalid callback.
    throws(() => {
      readline.clearScreenDown(writable, null);
    }, /ERR_INVALID_ARG_TYPE/);
  });

  it("should that clearScreenDown() does not throw on null or undefined stream", (done) => {
    const { mustCall } = createCallCheckCtx(done);
    strictEqual(
      readline.clearScreenDown(
        null,
        mustCall((err) => {
          strictEqual(err, null);
        }),
      ),
      true,
    );
    strictEqual(readline.clearScreenDown(undefined, mustCall()), true);
  });
});

describe("readline.clearLine()", () => {
  beforeEach(() => {
    writable.data = "";
  });

  it("should clear to the left of cursor when given -1 as direction", () => {
    strictEqual(readline.clearLine(writable, -1), true);
    deepStrictEqual(writable.data, CSI.kClearToLineBeginning);
  });

  it("should clear to the right of cursor when given 1 as direction", () => {
    strictEqual(readline.clearLine(writable, 1), true);
    deepStrictEqual(writable.data, CSI.kClearToLineEnd);
  });

  it("should clear whole line when given 0 as direction", () => {
    strictEqual(readline.clearLine(writable, 0), true);
    deepStrictEqual(writable.data, CSI.kClearLine);
  });

  it("should call callback after clearing line", (done) => {
    const { mustCall } = createCallCheckCtx(done);
    strictEqual(readline.clearLine(writable, -1, mustCall()), true);
    deepStrictEqual(writable.data, CSI.kClearToLineBeginning);
  });

  it("should throw on an invalid callback", () => {
    // Verify that clearLine() throws on invalid callback.
    throws(() => {
      readline.clearLine(writable, 0, null);
    }, /ERR_INVALID_ARG_TYPE/);
  });

  it("shouldn't throw on on null or undefined stream", (done) => {
    const { mustCall } = createCallCheckCtx(done);
    // Verify that clearLine() does not throw on null or undefined stream.
    strictEqual(readline.clearLine(null, 0), true);
    strictEqual(readline.clearLine(undefined, 0), true);
    strictEqual(
      readline.clearLine(
        null,
        0,
        mustCall((err) => {
          strictEqual(err, null);
        }),
      ),
      true,
    );
    strictEqual(readline.clearLine(undefined, 0, mustCall()), true);
  });
});

describe("readline.moveCursor()", () => {
  // Nothing is written when moveCursor 0, 0
  [
    [0, 0, ""],
    [1, 0, "\x1b[1C"],
    [-1, 0, "\x1b[1D"],
    [0, 1, "\x1b[1B"],
    [0, -1, "\x1b[1A"],
    [1, 1, "\x1b[1C\x1b[1B"],
    [-1, 1, "\x1b[1D\x1b[1B"],
    [-1, -1, "\x1b[1D\x1b[1A"],
    [1, -1, "\x1b[1C\x1b[1A"],
  ].forEach((set) => {
    writable.data = "";
    strictEqual(readline.moveCursor(writable, set[0], set[1]), true);
    deepStrictEqual(writable.data, set[2]);
    writable.data = "";
    strictEqual(
      readline.moveCursor(writable, set[0], set[1], common.mustCall()),
      true,
    );
    deepStrictEqual(writable.data, set[2]);
  });

  // Verify that moveCursor() throws on invalid callback.
  throws(() => {
    readline.moveCursor(writable, 1, 1, null);
  }, /ERR_INVALID_ARG_TYPE/);

  // Verify that moveCursor() does not throw on null or undefined stream.
  strictEqual(readline.moveCursor(null, 1, 1), true);
  strictEqual(readline.moveCursor(undefined, 1, 1), true);
  strictEqual(
    readline.moveCursor(
      null,
      1,
      1,
      common.mustCall((err) => {
        strictEqual(err, null);
      }),
    ),
    true,
  );
  strictEqual(readline.moveCursor(undefined, 1, 1, common.mustCall()), true);
});

describe("readline.cursorTo()", () => {
  // Undefined or null as stream should not throw.
  strictEqual(readline.cursorTo(null), true);
  strictEqual(readline.cursorTo(), true);
  strictEqual(readline.cursorTo(null, 1, 1, common.mustCall()), true);
  strictEqual(
    readline.cursorTo(
      undefined,
      1,
      1,
      common.mustCall((err) => {
        strictEqual(err, null);
      }),
    ),
    true,
  );

  writable.data = "";
  strictEqual(readline.cursorTo(writable, "a"), true);
  strictEqual(writable.data, "");

  writable.data = "";
  strictEqual(readline.cursorTo(writable, "a", "b"), true);
  strictEqual(writable.data, "");

  writable.data = "";
  throws(() => readline.cursorTo(writable, "a", 1), {
    name: "TypeError",
    code: "ERR_INVALID_CURSOR_POS",
    message: "Cannot set cursor row without setting its column",
  });
  strictEqual(writable.data, "");

  writable.data = "";
  strictEqual(readline.cursorTo(writable, 1, "a"), true);
  strictEqual(writable.data, "\x1b[2G");

  writable.data = "";
  strictEqual(readline.cursorTo(writable, 1), true);
  strictEqual(writable.data, "\x1b[2G");

  writable.data = "";
  strictEqual(readline.cursorTo(writable, 1, 2), true);
  strictEqual(writable.data, "\x1b[3;2H");

  writable.data = "";
  strictEqual(readline.cursorTo(writable, 1, 2, common.mustCall()), true);
  strictEqual(writable.data, "\x1b[3;2H");

  writable.data = "";
  strictEqual(readline.cursorTo(writable, 1, common.mustCall()), true);
  strictEqual(writable.data, "\x1b[2G");

  // Verify that cursorTo() throws on invalid callback.
  throws(() => {
    readline.cursorTo(writable, 1, 1, null);
  }, /ERR_INVALID_ARG_TYPE/);

  // Verify that cursorTo() throws if x or y is NaN.
  throws(() => {
    readline.cursorTo(writable, NaN);
  }, /ERR_INVALID_ARG_VALUE/);

  throws(() => {
    readline.cursorTo(writable, 1, NaN);
  }, /ERR_INVALID_ARG_VALUE/);

  throws(() => {
    readline.cursorTo(writable, NaN, NaN);
  }, /ERR_INVALID_ARG_VALUE/);
});
