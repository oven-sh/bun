import * as runner from "bun:test";

export const { expect, mock, spyOn, jest, vi, expectTypeOf, setSystemTime } = runner;

type Body = (done?: (error?: unknown) => void) => unknown;
type Hook = "beforeAll" | "afterAll" | "beforeEach" | "afterEach";

interface Group {
  name: string;
  parent?: Group;
  entries: (Group | Case)[];
  hooks: Record<Hook, Body[]>;
  isSkipped: boolean;
}

interface Case {
  name: string;
  body?: Body;
  how: "run" | "skip" | "todo" | "failing";
  milliseconds: number;
}

const newGroup = (name: string, parent: Group | undefined, isSkipped: boolean): Group => ({ name, parent, entries: [], hooks: { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] }, isSkipped });

const root = newGroup("", undefined, false);
let current = root;
let defaultMilliseconds = 5000;
let isScheduled = false;
let failures = 0;

function called(body: Body, milliseconds: number): Promise<unknown> {
  const finished = new Promise((resolve, reject) => {
    if (body.length > 0) body(error => (error ? reject(error) : resolve(undefined)));
    else Promise.resolve().then(() => body()).then(resolve, reject);
  });
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out after ${milliseconds}ms`)), milliseconds)));
  return Promise.race([finished, late]).finally(() => clearTimeout(timer));
}

const told = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message.split("\n")[0]}` : String(error));

async function runHooks(group: Group, hook: Hook, path: string) {
  for (const body of group.hooks[hook]) {
    try {
      await called(body, defaultMilliseconds);
    } catch (error) {
      failures++;
      console.log(`not ok ${path} ${hook}: ${told(error)}`);
    }
  }
}

function ancestors(group: Group): Group[] {
  return group.parent ? [...ancestors(group.parent), group] : [group];
}

async function runGroup(group: Group, path: string) {
  if (group.isSkipped) return void console.log(`skipped ${path}`);
  await runHooks(group, "beforeAll", path);
  for (const entry of group.entries) {
    const name = path ? `${path} > ${entry.name}` : entry.name;
    if ("entries" in entry) {
      await runGroup(entry, name);
      continue;
    }
    if (entry.how === "skip" || entry.how === "todo" || !entry.body) {
      console.log(`${entry.how === "run" ? "todo" : entry.how} ${name}`);
      continue;
    }
    for (const outer of ancestors(group)) await runHooks(outer, "beforeEach", name);
    let error: unknown;
    let hasThrown = false;
    try {
      await called(entry.body, entry.milliseconds);
    } catch (thrown) {
      [error, hasThrown] = [thrown, true];
    }
    for (const outer of ancestors(group).reverse()) await runHooks(outer, "afterEach", name);
    if (hasThrown === (entry.how === "failing")) console.log(`ok ${name}`);
    else {
      failures++;
      console.log(`not ok ${name}: ${hasThrown ? told(error) : "expected to fail"}`);
    }
  }
  await runHooks(group, "afterAll", path);
}

function schedule() {
  if (isScheduled) return;
  isScheduled = true;
  setTimeout(async () => {
    await runGroup(root, "");
    process.exit(failures > 0 ? 1 : 0);
  }, 0);
}

const formatted = (name: string, row: unknown[]) => {
  let next = 0;
  return name.replace(/%[sdifjop#]/g, () => String(row[next++]));
};

function makeTest(how: Case["how"]) {
  const define = (name: unknown, body?: Body | number | object, options?: Body | number | { timeout?: number }) => {
    if (typeof body !== "function" && typeof options === "function") [body, options] = [options, body as number | { timeout?: number }];
    const milliseconds = typeof options === "number" ? options : ((options as { timeout?: number } | undefined)?.timeout ?? defaultMilliseconds);
    current.entries.push({ name: typeof name === "function" ? name.name : String(name), body: typeof body === "function" ? (body as Body) : undefined, how, milliseconds });
    schedule();
  };
  return define;
}

function withModifiers<Define extends (...given: any[]) => void>(make: (how: Case["how"]) => Define) {
  const each =
    (define: Define) =>
    (rows: unknown[]) =>
    (name: string, body: (...given: unknown[]) => unknown, options?: unknown) => {
      for (const row of rows) {
        const given = Array.isArray(row) ? row : [row];
        define(formatted(name, given), () => body(...given), options);
      }
    };
  const run = make("run");
  const skip = make("skip");
  const plain = (define: Define) => Object.assign(define, { each: each(define) });
  return Object.assign(run, {
    each: each(run),
    only: plain(make("run")),
    concurrent: plain(make("run")),
    serial: plain(make("run")),
    skip: plain(skip),
    todo: plain(make("todo")),
    failing: plain(make("failing")),
    if: (condition: unknown) => plain(make(condition ? "run" : "skip")),
    skipIf: (condition: unknown) => plain(make(condition ? "skip" : "run")),
    todoIf: (condition: unknown) => plain(make(condition ? "todo" : "run")),
    failingIf: (condition: unknown) => plain(make(condition ? "failing" : "run")),
    concurrentIf: () => plain(make("run")),
    serialIf: () => plain(make("run")),
  });
}

function makeDescribe(how: Case["how"]) {
  return (name: unknown, body: () => void) => {
    const group = newGroup(typeof name === "function" ? name.name : String(name), current, how !== "run" && how !== "failing");
    current.entries.push(group);
    const outer = current;
    current = group;
    try {
      if (!group.isSkipped) body();
    } finally {
      current = outer;
    }
    schedule();
  };
}

export const test = withModifiers(makeTest);
export const it = test;
export const xit = test.skip;
export const xtest = test.skip;
export const describe = withModifiers(makeDescribe);
export const xdescribe = describe.skip;

const hook = (name: Hook) => (body: Body) => void current.hooks[name].push(body);
export const beforeAll = hook("beforeAll");
export const afterAll = hook("afterAll");
export const beforeEach = hook("beforeEach");
export const afterEach = hook("afterEach");
export const onTestFinished = (_: Body) => {};

export function setDefaultTimeout(milliseconds: number) {
  defaultMilliseconds = milliseconds;
}
