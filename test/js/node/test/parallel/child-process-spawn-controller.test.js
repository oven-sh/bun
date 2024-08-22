//#FILE: test-child-process-spawn-controller.js
//#SHA1: 2d44482177b850844df83ff3277e3e289055fdc7
//-----------------
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const aliveScript = path.join(__dirname, "..", "fixtures", "child-process-stay-alive-forever.js");

test("Verify that passing an AbortSignal works", done => {
  const controller = new AbortController();
  const { signal } = controller;

  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });

  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    done();
  });

  controller.abort();
});

test("Verify that passing an AbortSignal with custom abort error works", done => {
  const controller = new AbortController();
  const { signal } = controller;
  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });

  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    expect(e.cause.name).toBe("Error");
    expect(e.cause.message).toBe("boom");
    done();
  });

  controller.abort(new Error("boom"));
});

test("Verify abort with string reason", done => {
  const controller = new AbortController();
  const { signal } = controller;
  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });

  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    expect(e.cause).toBe("boom");
    done();
  });

  controller.abort("boom");
});

test("Verify that passing an already-aborted signal works", done => {
  const signal = AbortSignal.abort();

  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    done();
  });
});

test("Verify that passing an already-aborted signal with custom abort error works", done => {
  const signal = AbortSignal.abort(new Error("boom"));
  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    expect(e.cause.name).toBe("Error");
    expect(e.cause.message).toBe("boom");
    done();
  });
});

test("Verify abort with string reason (pre-aborted signal)", done => {
  const signal = AbortSignal.abort("boom");
  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    expect(e.cause).toBe("boom");
    done();
  });
});

test("Verify that waiting a bit and closing works", done => {
  const controller = new AbortController();
  const { signal } = controller;

  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });

  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    done();
  });

  setTimeout(() => controller.abort(), 1);
});

test("Test passing a different killSignal", done => {
  const controller = new AbortController();
  const { signal } = controller;

  const cp = spawn(process.execPath, [aliveScript], {
    signal,
    killSignal: "SIGKILL",
  });

  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGKILL");
  });

  cp.on("error", e => {
    expect(e.name).toBe("AbortError");
    done();
  });

  setTimeout(() => controller.abort(), 1);
});

test("Test aborting a cp before close but after exit", done => {
  const controller = new AbortController();
  const { signal } = controller;

  const cp = spawn(process.execPath, [aliveScript], {
    signal,
  });

  cp.on("exit", () => {
    controller.abort();
  });

  cp.on("error", () => {
    done(new Error("Should not be called"));
  });

  cp.on("close", () => {
    done();
  });

  setTimeout(() => cp.kill(), 1);
});

//<#END_FILE: test-child-process-spawn-controller.js
