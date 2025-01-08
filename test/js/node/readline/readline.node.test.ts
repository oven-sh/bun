// @ts-nocheck
import { createTest } from "node-harness";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { PassThrough, Writable } from "node:stream";
const { beforeEach, describe, it, createDoneDotAll, createCallCheckCtx, assert } = createTest(import.meta.path);

var {
  CSI,
  utils: { getStringWidth, stripVTControlCharacters },
  // @ts-ignore
} = readline[Symbol.for("__BUN_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED__")];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

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

class FakeInput extends EventEmitter {
  resume() {}
  pause() {}
  write() {}
  end() {}
}

function isWarned(emitter) {
  for (const name in emitter) {
    const listeners = emitter[name];
    if (listeners.warned) return true;
  }
  return false;
}

function getInterface(options) {
  const fi = new FakeInput();
  const rli = new readline.Interface({
    input: fi,
    output: fi,
    ...options,
  });
  return [rli, fi];
}

function assertCursorRowsAndCols(rli, rows, cols) {
  const cursorPos = rli.getCursorPos();
  assert.strictEqual(cursorPos.rows, rows);
  assert.strictEqual(cursorPos.cols, cols);
}

const writable = new TestWritable();
const input = new FakeInput();

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("CSI", () => {
  it("should be defined", () => {
    assert.ok(CSI);
  });

  it("should have all the correct clear sequences", () => {
    assert.strictEqual(CSI.kClearToLineBeginning, "\x1b[1K");
    assert.strictEqual(CSI.kClearToLineEnd, "\x1b[0K");
    assert.strictEqual(CSI.kClearLine, "\x1b[2K");
    assert.strictEqual(CSI.kClearScreenDown, "\x1b[0J");
    assert.strictEqual(CSI`1${2}3`, "\x1b[123");
  });
});

describe("readline.clearScreenDown()", () => {
  it("should put clear screen sequence into writable when called", done => {
    const { mustCall } = createCallCheckCtx(done);

    assert.strictEqual(readline.clearScreenDown(writable), true);
    assert.deepStrictEqual(writable.data, CSI.kClearScreenDown);
    assert.strictEqual(readline.clearScreenDown(writable, mustCall()), true);
  });

  it("should throw on invalid callback", () => {
    // Verify that clearScreenDown() throws on invalid callback.
    expect(() => {
      readline.clearScreenDown(writable, null);
    }).toThrowError(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  it("should that clearScreenDown() does not throw on null or undefined stream", done => {
    const { mustCall } = createCallCheckCtx(done);
    assert.strictEqual(
      readline.clearScreenDown(
        null,
        mustCall(err => {
          assert.strictEqual(err, null);
        }),
      ),
      true,
    );
    assert.strictEqual(readline.clearScreenDown(undefined, mustCall()), true);
  });
});

describe("readline.clearLine()", () => {
  beforeEach(() => {
    writable.data = "";
  });

  it("should clear to the left of cursor when given -1 as direction", () => {
    assert.strictEqual(readline.clearLine(writable, -1), true);
    assert.deepStrictEqual(writable.data, CSI.kClearToLineBeginning);
  });

  it("should clear to the right of cursor when given 1 as direction", () => {
    assert.strictEqual(readline.clearLine(writable, 1), true);
    assert.deepStrictEqual(writable.data, CSI.kClearToLineEnd);
  });

  it("should clear whole line when given 0 as direction", () => {
    assert.strictEqual(readline.clearLine(writable, 0), true);
    assert.deepStrictEqual(writable.data, CSI.kClearLine);
  });

  it("should call callback after clearing line", done => {
    const { mustCall } = createCallCheckCtx(done);
    assert.strictEqual(readline.clearLine(writable, -1, mustCall()), true);
    assert.deepStrictEqual(writable.data, CSI.kClearToLineBeginning);
  });

  it("should throw on an invalid callback", () => {
    // Verify that clearLine() throws on invalid callback.
    expect(() => {
      readline.clearLine(writable, 0, null);
    }).toThrowError(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  it("should not throw on null or undefined stream", done => {
    const { mustCall } = createCallCheckCtx(done);
    // Verify that clearLine() does not throw on null or undefined stream.
    assert.strictEqual(readline.clearLine(null, 0), true);
    assert.strictEqual(readline.clearLine(undefined, 0), true);
    assert.strictEqual(
      readline.clearLine(
        null,
        0,
        mustCall(err => {
          assert.strictEqual(err, null);
        }),
      ),
      true,
    );
    assert.strictEqual(readline.clearLine(undefined, 0, mustCall()), true);
  });
});

describe("readline.moveCursor()", () => {
  it("shouldn't write when moveCursor(0, 0) is called", done => {
    const { mustCall } = createCallCheckCtx(done);
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
    ].forEach(set => {
      writable.data = "";
      assert.strictEqual(readline.moveCursor(writable, set[0], set[1]), true);
      assert.deepStrictEqual(writable.data, set[2]);
      writable.data = "";
      assert.strictEqual(readline.moveCursor(writable, set[0], set[1], mustCall()), true);
      assert.deepStrictEqual(writable.data, set[2]);
    });
  });

  it("should throw on invalid callback", () => {
    // Verify that moveCursor() throws on invalid callback.
    expect(() => {
      readline.moveCursor(writable, 1, 1, null);
    }).toThrowError(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  it("should not throw on null or undefined stream", done => {
    const { mustCall } = createCallCheckCtx(done);
    // Verify that moveCursor() does not throw on null or undefined stream.
    assert.strictEqual(readline.moveCursor(null, 1, 1), true);
    assert.strictEqual(readline.moveCursor(undefined, 1, 1), true);
    assert.strictEqual(
      readline.moveCursor(
        null,
        1,
        1,
        mustCall(err => {
          assert.strictEqual(err, null);
        }),
      ),
      true,
    );
    assert.strictEqual(readline.moveCursor(undefined, 1, 1, mustCall()), true);
  });
});

describe("readline.cursorTo()", () => {
  beforeEach(() => {
    writable.data = "";
  });

  it("should not throw on undefined or null as stream", done => {
    const { mustCall } = createCallCheckCtx(done);
    // Undefined or null as stream should not throw.
    assert.strictEqual(readline.cursorTo(null), true);
    assert.strictEqual(readline.cursorTo(), true);
    assert.strictEqual(readline.cursorTo(null, 1, 1, mustCall()), true);
    assert.strictEqual(
      readline.cursorTo(
        undefined,
        1,
        1,
        mustCall(err => {
          assert.strictEqual(err, null);
        }),
      ),
      true,
    );
  });

  it("should not write if given invalid cursor position - [string, undefined]", () => {
    assert.strictEqual(readline.cursorTo(writable, "a"), true);
    assert.strictEqual(writable.data, "");
  });

  it("should not write if given invalid cursor position - [string, string]", () => {
    assert.strictEqual(readline.cursorTo(writable, "a", "b"), true);
    assert.strictEqual(writable.data, "");
  });

  it("should throw when x is not a number", () => {
    assert.throws(() => readline.cursorTo(writable, "a", 1), {
      name: "TypeError",
      code: "ERR_INVALID_CURSOR_POS",
      message: "Cannot set cursor row without setting its column",
    });
    assert.strictEqual(writable.data, "");
  });

  it("should write when given value cursor positions", done => {
    const { mustCall } = createCallCheckCtx(done);

    assert.strictEqual(readline.cursorTo(writable, 1, "a"), true);
    assert.strictEqual(writable.data, "\x1b[2G");

    writable.data = "";
    assert.strictEqual(readline.cursorTo(writable, 1), true);
    assert.strictEqual(writable.data, "\x1b[2G");

    writable.data = "";
    assert.strictEqual(readline.cursorTo(writable, 1, 2), true);
    assert.strictEqual(writable.data, "\x1b[3;2H");

    writable.data = "";
    assert.strictEqual(readline.cursorTo(writable, 1, 2, mustCall()), true);
    assert.strictEqual(writable.data, "\x1b[3;2H");

    writable.data = "";
    assert.strictEqual(readline.cursorTo(writable, 1, mustCall()), true);
    assert.strictEqual(writable.data, "\x1b[2G");
  });

  it("should throw on invalid callback", () => {
    // Verify that cursorTo() throws on invalid callback.
    expect(() => {
      readline.cursorTo(writable, 1, 1, null);
    }).toThrowError(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });

  it("should throw if x or y is NaN", () => {
    // Verify that cursorTo() throws if x or y is NaN.
    assert.throws(() => {
      readline.cursorTo(writable, NaN);
    }, "ERR_INVALID_ARG_VALUE");

    assert.throws(() => {
      readline.cursorTo(writable, 1, NaN);
    }, "ERR_INVALID_ARG_VALUE");

    assert.throws(() => {
      readline.cursorTo(writable, NaN, NaN);
    }, "ERR_INVALID_ARG_VALUE");
  });
});

describe("readline.emitKeyPressEvents()", () => {
  // emitKeypressEvents is thoroughly tested in test-readline-keys.js.
  // However, that test calls it implicitly. This is just a quick sanity check
  // to verify that it works when called explicitly.

  const expectedSequence = ["f", "o", "o"];
  const expectedKeys = [
    { sequence: "f", name: "f", ctrl: false, meta: false, shift: false },
    { sequence: "o", name: "o", ctrl: false, meta: false, shift: false },
    { sequence: "o", name: "o", ctrl: false, meta: false, shift: false },
  ];

  it("should emit the expected sequence when keypress listener added after called", () => {
    const stream = new PassThrough();
    const sequence: any[] = [];
    const keys: any[] = [];

    readline.emitKeypressEvents(stream);
    stream.on("keypress", (s, k) => {
      sequence.push(s);
      keys.push(k);
    });
    stream.write("foo");

    assert.deepStrictEqual(sequence, expectedSequence);
    assert.deepStrictEqual(keys, expectedKeys);
  });

  it("should emit the expected sequence when keypress listener added before called", () => {
    const stream = new PassThrough();
    const sequence: any[] = [];
    const keys: any[] = [];

    stream.on("keypress", (s, k) => {
      sequence.push(s);
      keys.push(k);
    });
    readline.emitKeypressEvents(stream);
    stream.write("foo");

    assert.deepStrictEqual(sequence, expectedSequence);
    assert.deepStrictEqual(keys, expectedKeys);
  });

  it("should allow keypress listeners to be removed and added again", () => {
    const stream = new PassThrough();
    const sequence: any[] = [];
    const keys: any[] = [];
    const keypressListener = (s, k) => {
      sequence.push(s);
      keys.push(k);
    };

    stream.on("keypress", keypressListener);
    readline.emitKeypressEvents(stream);
    stream.removeListener("keypress", keypressListener);
    stream.write("foo");

    assert.deepStrictEqual(sequence, []);
    assert.deepStrictEqual(keys, []);

    stream.on("keypress", keypressListener);
    stream.write("foo");

    assert.deepStrictEqual(sequence, expectedSequence);
    assert.deepStrictEqual(keys, expectedKeys);
  });
});

describe("readline.Interface", () => {
  it("should allow valid escapeCodeTimeout to be set", () => {
    const fi = new FakeInput();
    const rli = new readline.Interface({
      input: fi,
      output: fi,
      escapeCodeTimeout: 50,
    });
    assert.strictEqual(rli.escapeCodeTimeout, 50);
    rli.close();
  });

  it("should throw on invalid escapeCodeTimeout", () => {
    [null, {}, NaN, "50"].forEach(invalidInput => {
      assert.throws(
        () => {
          const fi = new FakeInput();
          const rli = new readline.Interface({
            input: fi,
            output: fi,
            escapeCodeTimeout: invalidInput,
          });
          rli.close();
        },
        {
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
        },
      );
    });
  });

  it("should create valid instances of readline.Interface", () => {
    const input = new FakeInput();
    const rl = readline.Interface({ input });
    assert.ok(rl instanceof readline.Interface);
  });

  it("should call completer when input emits data", done => {
    const { mustCall } = createCallCheckCtx(done);
    const fi = new FakeInput();
    const rli = new readline.Interface(
      fi,
      fi,
      mustCall(line => [[], line]),
      true,
    );

    assert.ok(rli instanceof readline.Interface);
    fi.emit("data", "a\t");
    rli.close();
  });

  it("should allow crlfDelay to be set", () => {
    [undefined, 50, 0, 100.5, 5000].forEach(crlfDelay => {
      const [rli] = getInterface({ crlfDelay });
      assert.strictEqual(rli.crlfDelay, Math.max(crlfDelay || 100, 100));
      rli.close();
    });
  });

  it("should throw if completer is not a function or is undefined", () => {
    ["not an array", 123, 123n, {}, true, Symbol(), null].forEach(invalid => {
      assert.throws(
        () => {
          readline.createInterface({
            input,
            completer: invalid,
          });
        },
        {
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
        },
      );
    });
  });

  it("should throw if history is not an array", () => {
    ["not an array", 123, 123, {}, true, Symbol(), null].forEach(history => {
      assert.throws(
        () => {
          readline.createInterface({
            input,
            history,
          });
        },
        {
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
        },
      );
    });
  });

  it("should throw if historySize is not a positive number", () => {
    ["not a number", -1, NaN, {}, true, Symbol(), null].forEach(historySize => {
      assert.throws(
        () => {
          readline.createInterface({
            input,
            historySize,
          });
        },
        {
          // TODO: Revert to Range error when properly implemented errors with multiple bases
          // name: "RangeError",
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
        },
      );
    });
  });

  it("should throw on invalid tabSize", () => {
    // Check for invalid tab sizes.
    assert.throws(
      () =>
        new readline.Interface({
          input,
          tabSize: 0,
        }),
      { code: "ERR_OUT_OF_RANGE" },
    );

    assert.throws(
      () =>
        new readline.Interface({
          input,
          tabSize: "4",
        }),
      { code: "ERR_INVALID_ARG_TYPE" },
    );

    assert.throws(
      () =>
        new readline.Interface({
          input,
          tabSize: 4.5,
        }),
      {
        code: "ERR_OUT_OF_RANGE",
        // message:
        //   'The value of "tabSize" is out of range. ' +
        //   "It must be an integer. Received 4.5",
      },
    );
  });

  // Sending a single character with no newline
  it("should not emit line when only a single character sent with no newline", done => {
    const { mustNotCall } = createCallCheckCtx(done);
    const fi = new FakeInput();
    const rli = new readline.Interface(fi, {});
    rli.on("line", mustNotCall());
    fi.emit("data", "a");
    rli.close();
  });

  it("should treat \\r like \\n when alone", done => {
    const { mustCall } = createCallCheckCtx(done);
    // Sending multiple newlines at once that does not end with a new line and a
    // `end` event(last line is). \r should behave like \n when alone.
    const [rli, fi] = getInterface({ terminal: true });
    const expectedLines = ["foo", "bar", "baz", "bat"];
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, expectedLines.shift());
      }, expectedLines.length - 1),
    );
    fi.emit("data", expectedLines.join("\r"));
    rli.close();
  });

  // \r at start of input should output blank line
  it("should output blank line when \\r at start of input", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true });
    const expectedLines = ["", "foo"];
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, expectedLines.shift());
      }, expectedLines.length),
    );
    fi.emit("data", "\rfoo\r");
    rli.close();
  });

  // \t does not become part of the input when there is a completer function
  it("should not include \\t in input when there is a completer function", done => {
    const { mustCall } = createCallCheckCtx(done);
    const completer = line => [[], line];
    const [rli, fi] = getInterface({ terminal: true, completer });
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "foo");
      }),
    );
    for (const character of "\tfo\to\t") {
      fi.emit("data", character);
    }
    fi.emit("data", "\n");
    rli.close();
  });

  // \t when there is no completer function should behave like an ordinary
  // character
  it("should treat \\t as an ordinary character when there is no completer function", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true });
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "\t");
      }),
    );
    fi.emit("data", "\t");
    fi.emit("data", "\n");
    rli.close();
  });

  // Adding history lines should emit the history event with
  // the history array
  it("should emit history event when adding history lines", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true });
    const expectedLines = ["foo", "bar", "baz", "bat"];
    rli.on(
      "history",
      mustCall(history => {
        const expectedHistory = expectedLines.slice(0, history.length).reverse();
        assert.deepStrictEqual(history, expectedHistory);
      }, expectedLines.length),
    );
    for (const line of expectedLines) {
      fi.emit("data", `${line}\n`);
    }
    rli.close();
  });

  // Altering the history array in the listener should not alter
  // the line being processed
  it("should not alter the line being processed when history is altered", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true });
    const expectedLine = "foo";
    rli.on(
      "history",
      mustCall(history => {
        assert.strictEqual(history[0], expectedLine);
        history.shift();
      }),
    );
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, expectedLine);
        assert.strictEqual(rli.history.length, 0);
      }),
    );
    fi.emit("data", `${expectedLine}\n`);
    rli.close();
  });

  // Duplicate lines are removed from history when
  // `options.removeHistoryDuplicates` is `true`
  it("should remove duplicate lines from history when removeHistoryDuplicates is true", () => {
    const [rli, fi] = getInterface({
      terminal: true,
      removeHistoryDuplicates: true,
    });
    const expectedLines = ["foo", "bar", "baz", "bar", "bat", "bat"];
    // ['foo', 'baz', 'bar', bat'];
    let callCount = 0;
    rli.on("line", line => {
      assert.strictEqual(line, expectedLines[callCount]);
      callCount++;
    });
    fi.emit("data", `${expectedLines.join("\n")}\n`);
    assert.strictEqual(callCount, expectedLines.length);
    fi.emit("keypress", ".", { name: "up" }); // 'bat'
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'bar'
    assert.notStrictEqual(rli.line, expectedLines[--callCount]);
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'baz'
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'foo'
    assert.notStrictEqual(rli.line, expectedLines[--callCount]);
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    assert.strictEqual(callCount, 0);
    fi.emit("keypress", ".", { name: "down" }); // 'baz'
    assert.strictEqual(rli.line, "baz");
    assert.strictEqual(rli.historyIndex, 2);
    fi.emit("keypress", ".", { name: "n", ctrl: true }); // 'bar'
    assert.strictEqual(rli.line, "bar");
    assert.strictEqual(rli.historyIndex, 1);
    fi.emit("keypress", ".", { name: "n", ctrl: true });
    assert.strictEqual(rli.line, "bat");
    assert.strictEqual(rli.historyIndex, 0);
    // Activate the substring history search.
    fi.emit("keypress", ".", { name: "down" }); // 'bat'
    assert.strictEqual(rli.line, "bat");
    assert.strictEqual(rli.historyIndex, -1);
    // Deactivate substring history search.
    fi.emit("keypress", ".", { name: "backspace" }); // 'ba'
    assert.strictEqual(rli.historyIndex, -1);
    assert.strictEqual(rli.line, "ba");
    // Activate the substring history search.
    fi.emit("keypress", ".", { name: "down" }); // 'ba'
    assert.strictEqual(rli.historyIndex, -1);
    assert.strictEqual(rli.line, "ba");
    fi.emit("keypress", ".", { name: "down" }); // 'ba'
    assert.strictEqual(rli.historyIndex, -1);
    assert.strictEqual(rli.line, "ba");
    fi.emit("keypress", ".", { name: "up" }); // 'bat'
    assert.strictEqual(rli.historyIndex, 0);
    assert.strictEqual(rli.line, "bat");
    fi.emit("keypress", ".", { name: "up" }); // 'bar'
    assert.strictEqual(rli.historyIndex, 1);
    assert.strictEqual(rli.line, "bar");
    fi.emit("keypress", ".", { name: "up" }); // 'baz'
    assert.strictEqual(rli.historyIndex, 2);
    assert.strictEqual(rli.line, "baz");
    fi.emit("keypress", ".", { name: "up" }); // 'ba'
    assert.strictEqual(rli.historyIndex, 4);
    assert.strictEqual(rli.line, "ba");
    fi.emit("keypress", ".", { name: "up" }); // 'ba'
    assert.strictEqual(rli.historyIndex, 4);
    assert.strictEqual(rli.line, "ba");
    // Deactivate substring history search and reset history index.
    fi.emit("keypress", ".", { name: "right" }); // 'ba'
    assert.strictEqual(rli.historyIndex, -1);
    assert.strictEqual(rli.line, "ba");
    // Substring history search activated.
    fi.emit("keypress", ".", { name: "up" }); // 'ba'
    assert.strictEqual(rli.historyIndex, 0);
    assert.strictEqual(rli.line, "bat");
    rli.close();
  });

  // Duplicate lines are not removed from history when
  // `options.removeHistoryDuplicates` is `false`
  it("should not remove duplicate lines from history when removeHistoryDuplicates is false", () => {
    const [rli, fi] = getInterface({
      terminal: true,
      removeHistoryDuplicates: false,
    });
    const expectedLines = ["foo", "bar", "baz", "bar", "bat", "bat"];
    let callCount = 0;
    rli.on("line", line => {
      assert.strictEqual(line, expectedLines[callCount]);
      callCount++;
    });
    fi.emit("data", `${expectedLines.join("\n")}\n`);
    assert.strictEqual(callCount, expectedLines.length);
    fi.emit("keypress", ".", { name: "up" }); // 'bat'
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'bar'
    assert.notStrictEqual(rli.line, expectedLines[--callCount]);
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'baz'
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'bar'
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    fi.emit("keypress", ".", { name: "up" }); // 'foo'
    assert.strictEqual(rli.line, expectedLines[--callCount]);
    assert.strictEqual(callCount, 0);
    rli.close();
  });

  // Regression test for repl freeze, #1968:
  // check that nothing fails if 'keypress' event throws.
  it("should not fail if keypress throws", () => {
    const [rli, fi] = getInterface({ terminal: true });
    const keys = [] as string[];
    const err = new Error("bad thing happened");
    fi.on("keypress", (key: string) => {
      keys.push(key);
      if (key === "X") {
        throw err;
      }
    });
    expect(() => fi.emit("data", "fooX")).toThrow(err);
    fi.emit("data", "bar");
    assert.strictEqual(keys.join(""), "fooXbar");
    rli.close();
  });

  // History is bound
  it("should bind history", () => {
    const [rli, fi] = getInterface({ terminal: true, historySize: 2 });
    const lines = ["line 1", "line 2", "line 3"];
    fi.emit("data", lines.join("\n") + "\n");
    assert.strictEqual(rli.history.length, 2);
    assert.strictEqual(rli.history[0], "line 3");
    assert.strictEqual(rli.history[1], "line 2");
  });

  // Question
  it("should handle question", () => {
    const [rli] = getInterface({ terminal: true });
    const expectedLines = ["foo"];
    rli.question(expectedLines[0], () => rli.close());
    assertCursorRowsAndCols(rli, 0, expectedLines[0].length);
    rli.close();
  });

  // Sending a multi-line question
  it("should handle multi-line questions", () => {
    const [rli] = getInterface({ terminal: true });
    const expectedLines = ["foo", "bar"];
    rli.question(expectedLines.join("\n"), () => rli.close());
    assertCursorRowsAndCols(rli, expectedLines.length - 1, expectedLines.slice(-1)[0].length);
    rli.close();
  });

  it("should handle beginning and end of line", () => {
    // Beginning and end of line
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    assertCursorRowsAndCols(rli, 0, 0);
    fi.emit("keypress", ".", { ctrl: true, name: "e" });
    assertCursorRowsAndCols(rli, 0, 19);
    rli.close();
  });

  it("should handle back and forward one character", () => {
    // Back and Forward one character
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    assertCursorRowsAndCols(rli, 0, 19);

    // Back one character
    fi.emit("keypress", ".", { ctrl: true, name: "b" });
    assertCursorRowsAndCols(rli, 0, 18);
    // Back one character
    fi.emit("keypress", ".", { ctrl: true, name: "b" });
    assertCursorRowsAndCols(rli, 0, 17);
    // Forward one character
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    assertCursorRowsAndCols(rli, 0, 18);
    // Forward one character
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    assertCursorRowsAndCols(rli, 0, 19);
    rli.close();
  });

  // Back and Forward one astral character
  it("should handle going back and forward one astral character", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "💻");

    // Move left one character/code point
    fi.emit("keypress", ".", { name: "left" });
    assertCursorRowsAndCols(rli, 0, 0);

    // Move right one character/code point
    fi.emit("keypress", ".", { name: "right" });
    assertCursorRowsAndCols(rli, 0, 2);

    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "💻");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // Two astral characters left
  it("should handle two astral characters left", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "💻");

    // Move left one character/code point
    fi.emit("keypress", ".", { name: "left" });
    assertCursorRowsAndCols(rli, 0, 0);

    fi.emit("data", "🐕");
    assertCursorRowsAndCols(rli, 0, 2);

    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "🐕💻");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // Two astral characters right
  it("should handle two astral characters right", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "💻");

    // Move left one character/code point
    fi.emit("keypress", ".", { name: "right" });
    assertCursorRowsAndCols(rli, 0, 2);

    fi.emit("data", "🐕");
    assertCursorRowsAndCols(rli, 0, 4);

    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "💻🐕");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  it("should handle wordLeft and wordRight", () => {
    // `wordLeft` and `wordRight`
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    fi.emit("keypress", ".", { ctrl: true, name: "left" });
    assertCursorRowsAndCols(rli, 0, 16);
    fi.emit("keypress", ".", { meta: true, name: "b" });
    assertCursorRowsAndCols(rli, 0, 10);
    fi.emit("keypress", ".", { ctrl: true, name: "right" });
    assertCursorRowsAndCols(rli, 0, 16);
    fi.emit("keypress", ".", { meta: true, name: "f" });
    assertCursorRowsAndCols(rli, 0, 19);
    rli.close();
  });

  // `deleteWordLeft`
  it("should handle deleteWordLeft", done => {
    const { mustCall } = createCallCheckCtx(done);
    [
      { ctrl: true, name: "w" },
      { ctrl: true, name: "backspace" },
      { meta: true, name: "backspace" },
    ].forEach(deleteWordLeftKey => {
      let [rli, fi] = getInterface({ terminal: true, prompt: "" });
      fi.emit("data", "the quick brown fox");
      fi.emit("keypress", ".", { ctrl: true, name: "left" });
      rli.on(
        "line",
        mustCall(line => {
          assert.strictEqual(line, "the quick fox");
        }),
      );
      fi.emit("keypress", ".", deleteWordLeftKey);
      fi.emit("data", "\n");
      rli.close();

      // No effect if pressed at beginning of line
      [rli, fi] = getInterface({ terminal: true, prompt: "" });
      fi.emit("data", "the quick brown fox");
      fi.emit("keypress", ".", { ctrl: true, name: "a" });
      rli.on(
        "line",
        mustCall(line => {
          assert.strictEqual(line, "the quick brown fox");
        }),
      );
      fi.emit("keypress", ".", deleteWordLeftKey);
      fi.emit("data", "\n");
      rli.close();
    });
  });

  // `deleteWordRight`
  it("should handle deleteWordRight", done => {
    const { mustCall } = createCallCheckCtx(done);
    [
      { ctrl: true, name: "delete" },
      { meta: true, name: "delete" },
      { meta: true, name: "d" },
    ].forEach(deleteWordRightKey => {
      let [rli, fi] = getInterface({ terminal: true, prompt: "" });
      fi.emit("data", "the quick brown fox");
      fi.emit("keypress", ".", { ctrl: true, name: "left" });
      fi.emit("keypress", ".", { ctrl: true, name: "left" });
      rli.on(
        "line",
        mustCall(line => {
          assert.strictEqual(line, "the quick fox");
        }),
      );
      fi.emit("keypress", ".", deleteWordRightKey);
      fi.emit("data", "\n");
      rli.close();

      // No effect if pressed at end of line
      [rli, fi] = getInterface({ terminal: true, prompt: "" });
      fi.emit("data", "the quick brown fox");
      rli.on(
        "line",
        mustCall(line => {
          assert.strictEqual(line, "the quick brown fox");
        }),
      );
      fi.emit("keypress", ".", deleteWordRightKey);
      fi.emit("data", "\n");
      rli.close();
    });
  });

  // deleteLeft
  it("should handle deleteLeft", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    assertCursorRowsAndCols(rli, 0, 19);

    // Delete left character
    fi.emit("keypress", ".", { ctrl: true, name: "h" });
    assertCursorRowsAndCols(rli, 0, 18);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "the quick brown fo");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // deleteLeft astral character
  it("should handle deleteLeft astral character", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "💻");
    assertCursorRowsAndCols(rli, 0, 2);
    // Delete left character
    fi.emit("keypress", ".", { ctrl: true, name: "h" });
    assertCursorRowsAndCols(rli, 0, 0);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // deleteRight
  it("should handle deleteRight", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");

    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    assertCursorRowsAndCols(rli, 0, 0);

    // Delete right character
    fi.emit("keypress", ".", { ctrl: true, name: "d" });
    assertCursorRowsAndCols(rli, 0, 0);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "he quick brown fox");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // deleteRight astral character
  it("should handle deleteRight of astral characters", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "💻");

    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    assertCursorRowsAndCols(rli, 0, 0);

    // Delete right character
    fi.emit("keypress", ".", { ctrl: true, name: "d" });
    assertCursorRowsAndCols(rli, 0, 0);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // deleteLineLeft
  it("should handle deleteLineLeft", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    assertCursorRowsAndCols(rli, 0, 19);

    // Delete from current to start of line
    fi.emit("keypress", ".", { ctrl: true, shift: true, name: "backspace" });
    assertCursorRowsAndCols(rli, 0, 0);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // deleteLineRight
  it("should handle deleteLineRight", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");

    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    assertCursorRowsAndCols(rli, 0, 0);

    // Delete from current to end of line
    fi.emit("keypress", ".", { ctrl: true, shift: true, name: "delete" });
    assertCursorRowsAndCols(rli, 0, 0);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  // yank
  it("should handle yank", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    assertCursorRowsAndCols(rli, 0, 19);

    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    // Move forward one char
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    // Delete the right part
    fi.emit("keypress", ".", { ctrl: true, shift: true, name: "delete" });
    assertCursorRowsAndCols(rli, 0, 1);

    // Yank
    fi.emit("keypress", ".", { ctrl: true, name: "y" });
    assertCursorRowsAndCols(rli, 0, 19);

    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "the quick brown fox");
      }),
    );

    fi.emit("data", "\n");
    rli.close();
  });

  // yank pop
  it("should handle yank pop", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    assertCursorRowsAndCols(rli, 0, 19);

    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    // Move forward one char
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    // Delete the right part
    fi.emit("keypress", ".", { ctrl: true, shift: true, name: "delete" });
    assertCursorRowsAndCols(rli, 0, 1);
    // Yank
    fi.emit("keypress", ".", { ctrl: true, name: "y" });
    assertCursorRowsAndCols(rli, 0, 19);

    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    // Move forward four chars
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    fi.emit("keypress", ".", { ctrl: true, name: "f" });
    // Delete the right part
    fi.emit("keypress", ".", { ctrl: true, shift: true, name: "delete" });
    assertCursorRowsAndCols(rli, 0, 4);
    // Go to the start of the line
    fi.emit("keypress", ".", { ctrl: true, name: "a" });
    assertCursorRowsAndCols(rli, 0, 0);

    // Yank: 'quick brown fox|the '
    fi.emit("keypress", ".", { ctrl: true, name: "y" });
    // Yank pop: 'he quick brown fox|the'
    fi.emit("keypress", ".", { meta: true, name: "y" });
    assertCursorRowsAndCols(rli, 0, 18);

    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "he quick brown foxthe ");
      }),
    );

    fi.emit("data", "\n");
    rli.close();
  });

  // Close readline interface
  it("Should close readline interface", () => {
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("keypress", ".", { ctrl: true, name: "c" });
    assert.ok(rli.closed);
  });

  // Multi-line input cursor position
  it("should handle multi-line input cursors", () => {
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.columns = 10;
    fi.emit("data", "multi-line text");
    assertCursorRowsAndCols(rli, 1, 5);
    rli.close();
  });

  // Multi-line input cursor position and long tabs
  it("should handle long tabs", () => {
    const [rli, fi] = getInterface({
      tabSize: 16,
      terminal: true,
      prompt: "",
    });
    fi.columns = 10;
    fi.emit("data", "multi-line\ttext \t");
    assert.strictEqual(rli.cursor, 17);
    assertCursorRowsAndCols(rli, 3, 2);
    rli.close();
  });

  // Check for the default tab size.
  it("should use the default tab size", () => {
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick\tbrown\tfox");
    assert.strictEqual(rli.cursor, 19);
    // The first tab is 7 spaces long, the second one 3 spaces.
    assertCursorRowsAndCols(rli, 0, 27);
  });

  // Multi-line prompt cursor position
  it("should handle multi-line prompt cursor position", () => {
    const [rli, fi] = getInterface({
      terminal: true,
      prompt: "\nfilledline\nwraping text\n> ",
    });
    fi.columns = 10;
    fi.emit("data", "t");
    assertCursorRowsAndCols(rli, 4, 3);
    rli.close();
  });

  // Undo & Redo
  it("should undo and redo", () => {
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    fi.emit("data", "the quick brown fox");
    assertCursorRowsAndCols(rli, 0, 19);

    // Delete the last eight chars
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ",", { ctrl: true, shift: false, name: "k" });

    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ".", { ctrl: true, shift: false, name: "b" });
    fi.emit("keypress", ",", { ctrl: true, shift: false, name: "k" });

    assertCursorRowsAndCols(rli, 0, 11);
    // Perform undo twice
    fi.emit("keypress", ",", { sequence: "\x1F" });
    expect(rli.line).toEqual("the quick brown");
    fi.emit("keypress", ",", { sequence: "\x1F" });
    expect(rli.line).toEqual("the quick brown fox");
    // Perform redo twice
    fi.emit("keypress", ",", { sequence: "\x1E" });
    expect(rli.line).toEqual("the quick brown");
    fi.emit("keypress", ",", { sequence: "\x1E" });
    expect(rli.line).toEqual("the quick b");
    fi.emit("data", "\n");
    rli.close();
  });

  // Clear the whole screen
  it("should clear the whole screen", done => {
    const { mustCall } = createCallCheckCtx(done);
    const [rli, fi] = getInterface({ terminal: true, prompt: "" });
    const lines = ["line 1", "line 2", "line 3"];
    fi.emit("data", lines.join("\n"));
    fi.emit("keypress", ".", { ctrl: true, name: "l" });
    assertCursorRowsAndCols(rli, 0, 6);
    rli.on(
      "line",
      mustCall(line => {
        assert.strictEqual(line, "line 3");
      }),
    );
    fi.emit("data", "\n");
    rli.close();
  });

  it("should treat wide characters as two columns", () => {
    assert.strictEqual(getStringWidth("a"), 1);
    assert.strictEqual(getStringWidth("あ"), 2);
    assert.strictEqual(getStringWidth("谢"), 2);
    assert.strictEqual(getStringWidth("고"), 2);
    assert.strictEqual(getStringWidth(String.fromCodePoint(0x1f251)), 2);
    assert.strictEqual(getStringWidth("abcde"), 5);
    assert.strictEqual(getStringWidth("古池や"), 6);
    assert.strictEqual(getStringWidth("ノード.js"), 9);
    assert.strictEqual(getStringWidth("你好"), 4);
    assert.strictEqual(getStringWidth("안녕하세요"), 10);
    assert.strictEqual(getStringWidth("A\ud83c\ude00BC"), 5);
    assert.strictEqual(getStringWidth("👨‍👩‍👦‍👦"), 2);
    assert.strictEqual(getStringWidth("🐕𐐷あ💻😀"), 9);
    // TODO(BridgeAR): This should have a width of 4.
    assert.strictEqual(getStringWidth("⓬⓪"), 2);
    assert.strictEqual(getStringWidth("\u0301\u200D\u200E"), 0);
  });

  // // Check if vt control chars are stripped
  // assert.strictEqual(stripVTControlCharacters('\u001b[31m> \u001b[39m'), '> ');
  // assert.strictEqual(
  //   stripVTControlCharacters('\u001b[31m> \u001b[39m> '),
  //   '> > '
  // );
  // assert.strictEqual(stripVTControlCharacters('\u001b[31m\u001b[39m'), '');
  // assert.strictEqual(stripVTControlCharacters('> '), '> ');
  // assert.strictEqual(getStringWidth('\u001b[31m> \u001b[39m'), 2);
  // assert.strictEqual(getStringWidth('\u001b[31m> \u001b[39m> '), 4);
  // assert.strictEqual(getStringWidth('\u001b[31m\u001b[39m'), 0);
  // assert.strictEqual(getStringWidth('> '), 2);

  // // Check EventEmitter memory leak
  // for (let i = 0; i < 12; i++) {
  //   const rl = readline.createInterface({
  //     input: process.stdin,
  //     output: process.stdout
  //   });
  //   rl.close();
  //   assert.strictEqual(isWarned(process.stdin._events), false);
  //   assert.strictEqual(isWarned(process.stdout._events), false);
  // }

  // [true, false].forEach((terminal) => {
  //   // Disable history
  //   {
  //     const [rli, fi] = getInterface({ terminal, historySize: 0 });
  //     assert.strictEqual(rli.historySize, 0);

  //     fi.emit('data', 'asdf\n');
  //     assert.deepStrictEqual(rli.history, []);
  //     rli.close();
  //   }

  //   // Default history size 30
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     assert.strictEqual(rli.historySize, 30);

  //     fi.emit('data', 'asdf\n');
  //     assert.deepStrictEqual(rli.history, terminal ? ['asdf'] : []);
  //     rli.close();
  //   }

  //   // Sending a full line
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, 'asdf');
  //     }));
  //     fi.emit('data', 'asdf\n');
  //   }

  //   // Sending a blank line
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, '');
  //     }));
  //     fi.emit('data', '\n');
  //   }

  //   // Sending a single character with no newline and then a newline
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     let called = false;
  //     rli.on('line', (line) => {
  //       called = true;
  //       assert.strictEqual(line, 'a');
  //     });
  //     fi.emit('data', 'a');
  //     assert.ok(!called);
  //     fi.emit('data', '\n');
  //     assert.ok(called);
  //     rli.close();
  //   }

  //   // Sending multiple newlines at once
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     const expectedLines = ['foo', 'bar', 'baz'];
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, expectedLines.shift());
  //     }, expectedLines.length));
  //     fi.emit('data', `${expectedLines.join('\n')}\n`);
  //     rli.close();
  //   }

  //   // Sending multiple newlines at once that does not end with a new line
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     const expectedLines = ['foo', 'bar', 'baz', 'bat'];
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, expectedLines.shift());
  //     }, expectedLines.length - 1));
  //     fi.emit('data', expectedLines.join('\n'));
  //     rli.close();
  //   }

  //   // Sending multiple newlines at once that does not end with a new(empty)
  //   // line and a `end` event
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     const expectedLines = ['foo', 'bar', 'baz', ''];
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, expectedLines.shift());
  //     }, expectedLines.length - 1));
  //     rli.on('close', mustCall());
  //     fi.emit('data', expectedLines.join('\n'));
  //     fi.emit('end');
  //     rli.close();
  //   }

  //   // Sending a multi-byte utf8 char over multiple writes
  //   {
  //     const buf = Buffer.from('☮', 'utf8');
  //     const [rli, fi] = getInterface({ terminal });
  //     let callCount = 0;
  //     rli.on('line', (line) => {
  //       callCount++;
  //       assert.strictEqual(line, buf.toString('utf8'));
  //     });
  //     for (const i of buf) {
  //       fi.emit('data', Buffer.from([i]));
  //     }
  //     assert.strictEqual(callCount, 0);
  //     fi.emit('data', '\n');
  //     assert.strictEqual(callCount, 1);
  //     rli.close();
  //   }

  //   // Calling readline without `new`
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, 'asdf');
  //     }));
  //     fi.emit('data', 'asdf\n');
  //     rli.close();
  //   }

  //   // Calling the question callback
  //   {
  //     const [rli] = getInterface({ terminal });
  //     rli.question('foo?', mustCall((answer) => {
  //       assert.strictEqual(answer, 'bar');
  //     }));
  //     rli.write('bar\n');
  //     rli.close();
  //   }

  //   // Calling the question callback with abort signal
  //   {
  //     const [rli] = getInterface({ terminal });
  //     const { signal } = new AbortController();
  //     rli.question('foo?', { signal }, mustCall((answer) => {
  //       assert.strictEqual(answer, 'bar');
  //     }));
  //     rli.write('bar\n');
  //     rli.close();
  //   }

  //   // Calling the question multiple times
  //   {
  //     const [rli] = getInterface({ terminal });
  //     rli.question('foo?', mustCall((answer) => {
  //       assert.strictEqual(answer, 'baz');
  //     }));
  //     rli.question('bar?', mustNotCall(() => {
  //     }));
  //     rli.write('baz\n');
  //     rli.close();
  //   }

  //   // Calling the promisified question
  //   {
  //     const [rli] = getInterface({ terminal });
  //     const question = util.promisify(rli.question).bind(rli);
  //     question('foo?')
  //     .then(mustCall((answer) => {
  //       assert.strictEqual(answer, 'bar');
  //     }));
  //     rli.write('bar\n');
  //     rli.close();
  //   }

  //   // Calling the promisified question with abort signal
  //   {
  //     const [rli] = getInterface({ terminal });
  //     const question = util.promisify(rli.question).bind(rli);
  //     const { signal } = new AbortController();
  //     question('foo?', { signal })
  //     .then(mustCall((answer) => {
  //       assert.strictEqual(answer, 'bar');
  //     }));
  //     rli.write('bar\n');
  //     rli.close();
  //   }

  //   // Aborting a question
  //   {
  //     const ac = new AbortController();
  //     const signal = ac.signal;
  //     const [rli] = getInterface({ terminal });
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, 'bar');
  //     }));
  //     rli.question('hello?', { signal }, mustNotCall());
  //     ac.abort();
  //     rli.write('bar\n');
  //     rli.close();
  //   }

  //   // Aborting a promisified question
  //   {
  //     const ac = new AbortController();
  //     const signal = ac.signal;
  //     const [rli] = getInterface({ terminal });
  //     const question = util.promisify(rli.question).bind(rli);
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, 'bar');
  //     }));
  //     question('hello?', { signal })
  //     .then(mustNotCall())
  //     .catch(mustCall((error) => {
  //       assert.strictEqual(error.name, 'AbortError');
  //     }));
  //     ac.abort();
  //     rli.write('bar\n');
  //     rli.close();
  //   }

  //   // pre-aborted signal
  //   {
  //     const signal = AbortSignal.abort();
  //     const [rli] = getInterface({ terminal });
  //     rli.pause();
  //     rli.on('resume', mustNotCall());
  //     rli.question('hello?', { signal }, mustNotCall());
  //     rli.close();
  //   }

  //   // pre-aborted signal promisified question
  //   {
  //     const signal = AbortSignal.abort();
  //     const [rli] = getInterface({ terminal });
  //     const question = util.promisify(rli.question).bind(rli);
  //     rli.on('resume', mustNotCall());
  //     rli.pause();
  //     question('hello?', { signal })
  //     .then(mustNotCall())
  //     .catch(mustCall((error) => {
  //       assert.strictEqual(error.name, 'AbortError');
  //     }));
  //     rli.close();
  //   }

  //   // Call question after close
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     rli.question('What\'s your name?', mustCall((name) => {
  //       assert.strictEqual(name, 'Node.js');
  //       rli.close();
  //       assert.throws(() => {
  //         rli.question('How are you?', mustNotCall());
  //       }, {
  //         name: 'Error',
  //         code: 'ERR_USE_AFTER_CLOSE'
  //       });
  //       assert.notStrictEqual(rli.getPrompt(), 'How are you?');
  //     }));
  //     fi.emit('data', 'Node.js\n');
  //   }

  //   // Call promisified question after close
  //   {
  //     const [rli, fi] = getInterface({ terminal });
  //     const question = util.promisify(rli.question).bind(rli);
  //     question('What\'s your name?').then(mustCall((name) => {
  //       assert.strictEqual(name, 'Node.js');
  //       rli.close();
  //       question('How are you?')
  //         .then(mustNotCall(), expectsError({
  //           code: 'ERR_USE_AFTER_CLOSE',
  //           name: 'Error'
  //         }));
  //       assert.notStrictEqual(rli.getPrompt(), 'How are you?');
  //     }));
  //     fi.emit('data', 'Node.js\n');
  //   }

  //   // Can create a new readline Interface with a null output argument
  //   {
  //     const [rli, fi] = getInterface({ output: null, terminal });
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, 'asdf');
  //     }));
  //     fi.emit('data', 'asdf\n');

  //     rli.setPrompt('ddd> ');
  //     rli.prompt();
  //     rli.write("really shouldn't be seeing this");
  //     rli.question('What do you think of node.js? ', (answer) => {
  //       console.log('Thank you for your valuable feedback:', answer);
  //       rli.close();
  //     });
  //   }

  //   // Calling the getPrompt method
  //   {
  //     const expectedPrompts = ['$ ', '> '];
  //     const [rli] = getInterface({ terminal });
  //     for (const prompt of expectedPrompts) {
  //       rli.setPrompt(prompt);
  //       assert.strictEqual(rli.getPrompt(), prompt);
  //     }
  //   }

  //   {
  //     const expected = terminal ?
  //       ['\u001b[1G', '\u001b[0J', '$ ', '\u001b[3G'] :
  //       ['$ '];

  //     const output = new Writable({
  //       write: mustCall((chunk, enc, cb) => {
  //         assert.strictEqual(chunk.toString(), expected.shift());
  //         cb();
  //         rl.close();
  //       }, expected.length)
  //     });

  //     const rl = readline.createInterface({
  //       input: new Readable({ read: mustCall() }),
  //       output,
  //       prompt: '$ ',
  //       terminal
  //     });

  //     rl.prompt();

  //     assert.strictEqual(rl.getPrompt(), '$ ');
  //   }

  //   {
  //     const fi = new FakeInput();
  //     assert.deepStrictEqual(fi.listeners(terminal ? 'keypress' : 'data'), []);
  //   }

  //   // Emit two line events when the delay
  //   // between \r and \n exceeds crlfDelay
  //   {
  //     const crlfDelay = 200;
  //     const [rli, fi] = getInterface({ terminal, crlfDelay });
  //     let callCount = 0;
  //     rli.on('line', () => {
  //       callCount++;
  //     });
  //     fi.emit('data', '\r');
  //     setTimeout(mustCall(() => {
  //       fi.emit('data', '\n');
  //       assert.strictEqual(callCount, 2);
  //       rli.close();
  //     }), crlfDelay + 10);
  //   }

  //   // For the purposes of the following tests, we do not care about the exact
  //   // value of crlfDelay, only that the behaviour conforms to what's expected.
  //   // Setting it to Infinity allows the test to succeed even under extreme
  //   // CPU stress.
  //   const crlfDelay = Infinity;

  //   // Set crlfDelay to `Infinity` is allowed
  //   {
  //     const delay = 200;
  //     const [rli, fi] = getInterface({ terminal, crlfDelay });
  //     let callCount = 0;
  //     rli.on('line', () => {
  //       callCount++;
  //     });
  //     fi.emit('data', '\r');
  //     setTimeout(mustCall(() => {
  //       fi.emit('data', '\n');
  //       assert.strictEqual(callCount, 1);
  //       rli.close();
  //     }), delay);
  //   }

  //   // Sending multiple newlines at once that does not end with a new line
  //   // and a `end` event(last line is)

  //   // \r\n should emit one line event, not two
  //   {
  //     const [rli, fi] = getInterface({ terminal, crlfDelay });
  //     const expectedLines = ['foo', 'bar', 'baz', 'bat'];
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, expectedLines.shift());
  //     }, expectedLines.length - 1));
  //     fi.emit('data', expectedLines.join('\r\n'));
  //     rli.close();
  //   }

  //   // \r\n should emit one line event when split across multiple writes.
  //   {
  //     const [rli, fi] = getInterface({ terminal, crlfDelay });
  //     const expectedLines = ['foo', 'bar', 'baz', 'bat'];
  //     let callCount = 0;
  //     rli.on('line', mustCall((line) => {
  //       assert.strictEqual(line, expectedLines[callCount]);
  //       callCount++;
  //     }, expectedLines.length));
  //     expectedLines.forEach((line) => {
  //       fi.emit('data', `${line}\r`);
  //       fi.emit('data', '\n');
  //     });
  //     rli.close();
  //   }

  //   // Emit one line event when the delay between \r and \n is
  //   // over the default crlfDelay but within the setting value.
  //   {
  //     const delay = 125;
  //     const [rli, fi] = getInterface({ terminal, crlfDelay });
  //     let callCount = 0;
  //     rli.on('line', () => callCount++);
  //     fi.emit('data', '\r');
  //     setTimeout(mustCall(() => {
  //       fi.emit('data', '\n');
  //       assert.strictEqual(callCount, 1);
  //       rli.close();
  //     }), delay);
  //   }
  // });

  // // Ensure that the _wordLeft method works even for large input
  // {
  //   const input = new Readable({
  //     read() {
  //       this.push('\x1B[1;5D'); // CTRL + Left
  //       this.push(null);
  //     },
  //   });
  //   const output = new Writable({
  //     write: mustCall((data, encoding, cb) => {
  //       assert.strictEqual(rl.cursor, rl.line.length - 1);
  //       cb();
  //     }),
  //   });
  //   const rl = new readline.createInterface({
  //     input,
  //     output,
  //     terminal: true,
  //   });
  //   rl.line = `a${' '.repeat(1e6)}a`;
  //   rl.cursor = rl.line.length;
  // }

  // {
  //   const fi = new FakeInput();
  //   const signal = AbortSignal.abort();

  //   const rl = readline.createInterface({
  //     input: fi,
  //     output: fi,
  //     signal,
  //   });
  //   rl.on('close', mustCall());
  //   assert.strictEqual(getEventListeners(signal, 'abort').length, 0);
  // }

  // {
  //   const fi = new FakeInput();
  //   const ac = new AbortController();
  //   const { signal } = ac;
  //   const rl = readline.createInterface({
  //     input: fi,
  //     output: fi,
  //     signal,
  //   });
  //   assert.strictEqual(getEventListeners(signal, 'abort').length, 1);
  //   rl.on('close', mustCall());
  //   ac.abort();
  //   assert.strictEqual(getEventListeners(signal, 'abort').length, 0);
  // }

  // {
  //   const fi = new FakeInput();
  //   const ac = new AbortController();
  //   const { signal } = ac;
  //   const rl = readline.createInterface({
  //     input: fi,
  //     output: fi,
  //     signal,
  //   });
  //   assert.strictEqual(getEventListeners(signal, "abort").length, 1);
  //   rl.close();
  //   assert.strictEqual(getEventListeners(signal, "abort").length, 0);
  // }

  // {
  //   // Constructor throws if signal is not an abort signal
  //   assert.throws(() => {
  //     readline.createInterface({
  //       input: new FakeInput(),
  //       signal: {},
  //     });
  //   }, {
  //     name: 'TypeError',
  //     code: 'ERR_INVALID_ARG_TYPE'
  //   });
  // }
});

describe("readline.createInterface()", () => {
  it("should emit line when input ends line", done => {
    const createDone = createDoneDotAll(done);
    const lineDone = createDone(2000);
    const { mustCall } = createCallCheckCtx(createDone(2000));
    const input = new PassThrough();
    const rl = readline.createInterface({
      terminal: true,
      input: input,
    });

    rl.on(
      "line",
      mustCall(data => {
        assert.strictEqual(data, "abc");
        lineDone();
      }),
    );

    input.end("abc");
  });

  it("should not emit line when input ends without newline", done => {
    const { mustNotCall } = createCallCheckCtx(done);

    const input = new PassThrough();
    const rl = readline.createInterface({
      terminal: true,
      input: input,
    });

    rl.on("line", mustNotCall("must not be called before newline"));
    input.write("abc");
  });

  it("should read line by line", done => {
    const createDone = createDoneDotAll(done);
    const { mustCall } = createCallCheckCtx(createDone(3000));
    const lineDone = createDone(2000);
    const input = new PassThrough();
    const rl = readline.createInterface({
      terminal: true,
      input: input,
    });

    rl.on(
      "line",
      mustCall(data => {
        assert.strictEqual(data, "abc");
        lineDone();
      }),
    );

    input.write("abc\n");
  });

  it("should support reading-in lines via for await...of loop", async () => {
    const sampleTextBuffer = new Buffer.from("Line1\nLine2\nLine3\nLine4");
    const bufferStream = new PassThrough();

    const rl = readline.createInterface({
      input: bufferStream,
    });

    process.nextTick(() => {
      bufferStream.end(sampleTextBuffer);
    });

    const result = [];
    for await (const line of rl) result.push(line);
    expect(result).toEqual(["Line1", "Line2", "Line3", "Line4"]);
  });

  it("should respond to home and end sequences for common pttys ", () => {
    const input = new PassThrough();
    const rl = readline.createInterface({
      terminal: true,
      input: input,
    });

    rl.write("foo");
    assert.strictEqual(rl.cursor, 3);

    const key = {
      xterm: {
        home: ["\x1b[H", { ctrl: true, name: "a" }],
        end: ["\x1b[F", { ctrl: true, name: "e" }],
      },
      gnome: {
        home: ["\x1bOH", { ctrl: true, name: "a" }],
        end: ["\x1bOF", { ctrl: true, name: "e" }],
      },
      rxvt: {
        home: ["\x1b[7", { ctrl: true, name: "a" }],
        end: ["\x1b[8", { ctrl: true, name: "e" }],
      },
      putty: {
        home: ["\x1b[1~", { ctrl: true, name: "a" }],
        end: ["\x1b[>~", { ctrl: true, name: "e" }],
      },
    };

    [key.xterm, key.gnome, key.rxvt, key.putty].forEach(key => {
      rl.write.apply(rl, key.home);
      assert.strictEqual(rl.cursor, 0);
      rl.write.apply(rl, key.end);
      assert.strictEqual(rl.cursor, 3);
    });
  });

  it("should allow for cursor movement with meta-f and meta-b", () => {
    const input = new PassThrough();
    const rl = readline.createInterface({
      terminal: true,
      input: input,
    });

    const key = {
      xterm: {
        home: ["\x1b[H", { ctrl: true, name: "a" }],
        metab: ["\x1bb", { meta: true, name: "b" }],
        metaf: ["\x1bf", { meta: true, name: "f" }],
      },
    };

    rl.write("foo bar.hop/zoo");
    rl.write.apply(rl, key.xterm.home);
    [
      { cursor: 4, key: key.xterm.metaf },
      { cursor: 7, key: key.xterm.metaf },
      { cursor: 8, key: key.xterm.metaf },
      { cursor: 11, key: key.xterm.metaf },
      { cursor: 12, key: key.xterm.metaf },
      { cursor: 15, key: key.xterm.metaf },
      { cursor: 12, key: key.xterm.metab },
      { cursor: 11, key: key.xterm.metab },
      { cursor: 8, key: key.xterm.metab },
      { cursor: 7, key: key.xterm.metab },
      { cursor: 4, key: key.xterm.metab },
      { cursor: 0, key: key.xterm.metab },
    ].forEach(function (action) {
      rl.write.apply(rl, action.key);
      assert.strictEqual(rl.cursor, action.cursor);
    });
  });

  it("should properly allow for cursor movement with meta-d", () => {
    const input = new PassThrough();
    const rl = readline.createInterface({
      terminal: true,
      input: input,
    });

    const key = {
      xterm: {
        home: ["\x1b[H", { ctrl: true, name: "a" }],
        metad: ["\x1bd", { meta: true, name: "d" }],
      },
    };

    rl.write("foo bar.hop/zoo");
    rl.write.apply(rl, key.xterm.home);
    ["bar.hop/zoo", ".hop/zoo", "hop/zoo", "/zoo", "zoo", ""].forEach(function (expectedLine) {
      rl.write.apply(rl, key.xterm.metad);
      assert.strictEqual(rl.cursor, 0);
      assert.strictEqual(rl.line, expectedLine);
    });
  });

  // TODO: Actual pseudo-tty test
  // it("should operate correctly when process.env.DUMB is set", () => {
  //   process.env.TERM = "dumb";
  //   const rl = readline.createInterface({
  //     input: process.stdin,
  //     output: process.stdout,
  //   });
  //   rl.write("text");
  //   rl.write(null, { ctrl: true, name: "u" });
  //   rl.write(null, { name: "return" });
  //   rl.write("text");
  //   rl.write(null, { name: "backspace" });
  //   rl.write(null, { name: "escape" });
  //   rl.write(null, { name: "enter" });
  //   rl.write("text");
  //   rl.write(null, { ctrl: true, name: "c" });
  // });
});
