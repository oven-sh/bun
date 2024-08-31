//#FILE: test-child-process-fork-abort-signal.js
//#SHA1: 4805d5dd4e3cb22ffd5a21fd9d92b6ccd6bc73cf
//-----------------
"use strict";

const fixtures = require("../common/fixtures");
const { fork } = require("child_process");

test("aborting a forked child_process after calling fork", done => {
  const ac = new AbortController();
  const { signal } = ac;
  const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
    done();
  });
  cp.on("error", err => {
    expect(err.name).toBe("AbortError");
    done();
  });
  process.nextTick(() => ac.abort());
});

test("aborting with custom error", done => {
  const ac = new AbortController();
  const { signal } = ac;
  const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
    done();
  });
  cp.on("error", err => {
    expect(err.name).toBe("AbortError");
    expect(err.cause.name).toBe("Error");
    expect(err.cause.message).toBe("boom");
    done();
  });
  process.nextTick(() => ac.abort(new Error("boom")));
});

test("passing an already aborted signal to a forked child_process", done => {
  const signal = AbortSignal.abort();
  const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
    done();
  });
  cp.on("error", err => {
    expect(err.name).toBe("AbortError");
    done();
  });
});

test("passing an aborted signal with custom error to a forked child_process", done => {
  const signal = AbortSignal.abort(new Error("boom"));
  const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
    signal,
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGTERM");
    done();
  });
  cp.on("error", err => {
    expect(err.name).toBe("AbortError");
    expect(err.cause.name).toBe("Error");
    expect(err.cause.message).toBe("boom");
    done();
  });
});

test("passing a different kill signal", done => {
  const signal = AbortSignal.abort();
  const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
    signal,
    killSignal: "SIGKILL",
  });
  cp.on("exit", (code, killSignal) => {
    expect(code).toBeNull();
    expect(killSignal).toBe("SIGKILL");
    done();
  });
  cp.on("error", err => {
    expect(err.name).toBe("AbortError");
    done();
  });
});

test("aborting a cp before close but after exit", done => {
  const ac = new AbortController();
  const { signal } = ac;
  const cp = fork(fixtures.path("child-process-stay-alive-forever.js"), {
    signal,
  });
  cp.on("exit", () => {
    ac.abort();
    done();
  });
  cp.on("error", () => {
    done(new Error("Should not have errored"));
  });

  setTimeout(() => cp.kill(), 1);
});

//<#END_FILE: test-child-process-fork-abort-signal.js
