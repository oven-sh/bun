import { expect, test } from "bun:test";
import inspector from "node:inspector";

test("inspector.url()", () => {
  expect(inspector.url()).toBeUndefined();
});

test("inspector.console", () => {
  expect(inspector.console).toBeObject();
});

test("inspector.open()", () => {
  expect(() => inspector.open()).toThrow(/not yet implemented/);
});

test("inspector.close()", () => {
  expect(() => inspector.close()).toThrow(/not yet implemented/);
});

test("inspector.waitForDebugger()", () => {
  expect(() => inspector.waitForDebugger()).toThrow(/not yet implemented/);
});

test("Runtime.consoleAPICalled is emitted while the Runtime domain is enabled", () => {
  const session = new inspector.Session();
  session.connect();
  try {
    const seen: any[] = [];
    session.on("Runtime.consoleAPICalled", message => seen.push(message));
    session.post("Runtime.enable");
    console.log("hello", 42);
    expect(seen).toHaveLength(1);
    expect(seen[0].params.type).toBe("log");
    expect(seen[0].params.args[0]).toEqual({ type: "string", value: "hello" });
    expect(seen[0].params.args[1]).toEqual({ type: "number", value: 42, description: "42" });
    session.post("Runtime.disable");
    console.log("after disable");
    expect(seen).toHaveLength(1);
  } finally {
    session.disconnect();
  }
});

test("a consoleAPICalled listener that logs does not recurse", () => {
  const session = new inspector.Session();
  session.connect();
  try {
    let emissions = 0;
    session.on("Runtime.consoleAPICalled", () => {
      emissions++;
      console.log("from listener");
    });
    session.post("Runtime.enable");
    console.log("outer");
    expect(emissions).toBe(1);
  } finally {
    session.disconnect();
  }
});

test("a throwing consoleAPICalled listener does not break console.log or other sessions", () => {
  const s1 = new inspector.Session();
  const s2 = new inspector.Session();
  s1.connect();
  s2.connect();
  const warnings: Error[] = [];
  const onWarning = (w: Error) => warnings.push(w);
  process.on("warning", onWarning);
  try {
    let s2Saw = 0;
    s1.on("Runtime.consoleAPICalled", () => {
      throw new Error("listener boom");
    });
    s2.on("Runtime.consoleAPICalled", () => s2Saw++);
    s1.post("Runtime.enable");
    s2.post("Runtime.enable");
    expect(() => console.log("still works")).not.toThrow();
    expect(s2Saw).toBe(1);
  } finally {
    process.off("warning", onWarning);
    s1.disconnect();
    s2.disconnect();
  }
});

test("disconnect does not clobber a console method reassigned by user code", () => {
  const session = new inspector.Session();
  session.connect();
  const before = console.log;
  try {
    session.post("Runtime.enable");
    const mine = (..._args: unknown[]) => {};
    console.log = mine;
    session.disconnect();
    expect(console.log).toBe(mine);
  } finally {
    console.log = before;
  }
});
