import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Python imports", () => {
  test("import simple values from Python", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
count = 42
name = "hello"
pi = 3.14
flag = True
`,
      "test.js": `
import { count, name, pi, flag } from "./test.py";
console.log(JSON.stringify({ count, name, pi, flag }));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(stdout.trim())).toEqual({
      count: 42,
      name: "hello",
      pi: 3.14,
      flag: true,
    });
    expect(exitCode).toBe(0);
  });

  test("import and access dict properties", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
data = {
    'count': 1,
    'name': 'test'
}
`,
      "test.js": `
import { data } from "./test.py";
console.log(data.count);
console.log(data.name);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("1\ntest");
    expect(exitCode).toBe(0);
  });

  test("modify dict from JS, visible in Python", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
data = {'count': 1}

def get_count():
    return data['count']

def get_new_key():
    return data.get('new_key', 'NOT SET')
`,
      "test.js": `
import { data, get_count, get_new_key } from "./test.py";

console.log("before:", get_count());
data.count = 999;
console.log("after:", get_count());

console.log("new_key before:", get_new_key());
data.new_key = "added from JS";
console.log("new_key after:", get_new_key());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("before: 1\nafter: 999\nnew_key before: NOT SET\nnew_key after: added from JS");
    expect(exitCode).toBe(0);
  });

  test("nested object access and mutation", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
data = {
    'inner': {
        'value': 42
    }
}

def get_inner_x():
    return data['inner'].get('x', 'NOT SET')
`,
      "test.js": `
import { data, get_inner_x } from "./test.py";

const inner = data.inner;
console.log("inner.value:", inner.value);

console.log("before:", get_inner_x());
inner.x = "set from JS";
console.log("after:", get_inner_x());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("inner.value: 42\nbefore: NOT SET\nafter: set from JS");
    expect(exitCode).toBe(0);
  });

  test("call Python functions with arguments", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
def add(a, b):
    return a + b

def greet(name):
    return f"Hello, {name}!"

def no_args():
    return "called with no args"
`,
      "test.js": `
import { add, greet, no_args } from "./test.py";

console.log(add(2, 3));
console.log(greet("World"));
console.log(no_args());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("5\nHello, World!\ncalled with no args");
    expect(exitCode).toBe(0);
  });

  test("Python class instantiation and methods", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
class Counter:
    def __init__(self, start=0):
        self.value = start

    def increment(self):
        self.value += 1
        return self.value

    def get(self):
        return self.value
`,
      "test.js": `
import { Counter } from "./test.py";

const counter = new Counter(10);
console.log("initial:", counter.get());
console.log("after increment:", counter.increment());
console.log("after increment:", counter.increment());
console.log("value property:", counter.value);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("initial: 10\nafter increment: 11\nafter increment: 12\nvalue property: 12");
    expect(exitCode).toBe(0);
  });

  test("assign class instance to Python dict", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
class Potato:
    def __init__(self, name):
        self.name = name

    def greet(self):
        return f"I am {self.name}"

data = {}

def check():
    if 'item' in data:
        return f"name={data['item'].name}, greet={data['item'].greet()}"
    return "not found"
`,
      "test.js": `
import { Potato, data, check } from "./test.py";

console.log("before:", check());

const spud = new Potato("Spudnik");
data.item = spud;

console.log("after:", check());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("before: not found\nafter: name=Spudnik, greet=I am Spudnik");
    expect(exitCode).toBe(0);
  });

  test("Python lists", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
items = [1, 2, 3, "four", 5.0]

def get_length():
    return len(items)
`,
      "test.js": `
import { items, get_length } from "./test.py";

console.log("length:", get_length());
console.log("items[0]:", items[0]);
console.log("items[3]:", items[3]);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("length: 5\nitems[0]: 1\nitems[3]: four");
    expect(exitCode).toBe(0);
  });

  test("None becomes null", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
nothing = None

def returns_none():
    return None
`,
      "test.js": `
import { nothing, returns_none } from "./test.py";

console.log("nothing:", nothing);
console.log("nothing === null:", nothing === null);
console.log("returns_none():", returns_none());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("nothing: null\nnothing === null: true\nreturns_none(): null");
    expect(exitCode).toBe(0);
  });

  test("toString and console.log use Python str()", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
data = {'name': 'test', 'count': 42}

class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __str__(self):
        return f"Point({self.x}, {self.y})"
`,
      "test.js": `
import { data, Point } from "./test.py";

// toString() returns Python's str()
console.log(data.toString());

// String() coercion
console.log(String(data));

// Class with custom __str__
const p = new Point(3, 4);
console.log(p.toString());

// console.log uses Python representation
console.log(data);
console.log(p);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    // Dict toString
    expect(lines[0]).toBe("{'name': 'test', 'count': 42}");
    // Dict String()
    expect(lines[1]).toBe("{'name': 'test', 'count': 42}");
    // Point toString (custom __str__)
    expect(lines[2]).toBe("Point(3, 4)");
    // console.log dict
    expect(lines[3]).toBe("{'name': 'test', 'count': 42}");
    // console.log Point
    expect(lines[4]).toBe("Point(3, 4)");
    expect(exitCode).toBe(0);
  });

  test("Python print() output appears", async () => {
    using dir = tempDir("python-test", {
      "test.py": `
def say_hello(name):
    print(f"Hello, {name}!")
    return "done"

def multi_line():
    print("Line 1")
    print("Line 2")
`,
      "test.js": `
import { say_hello, multi_line } from "./test.py";

console.log("before");
say_hello("World");
console.log("middle");
multi_line();
console.log("after");
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("before\nHello, World!\nmiddle\nLine 1\nLine 2\nafter");
    expect(exitCode).toBe(0);
  });
});

describe("JavaScript imports in Python", () => {
  test("import simple values from JavaScript", async () => {
    using dir = tempDir("python-js-test", {
      "utils.js": `
export const count = 42;
export const name = "hello";
export const pi = 3.14;
export const flag = true;
`,
      "test.py": `
import utils

print(utils.count)
print(utils.name)
print(utils.pi)
print(utils.flag)
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("42\nhello\n3.14\nTrue");
    expect(exitCode).toBe(0);
  });

  test("call JavaScript functions from Python", async () => {
    using dir = tempDir("python-js-test", {
      "jsmath.js": `
export function add(a, b) {
  return a + b;
}

export function greet(name) {
  return "Hello, " + name + "!";
}

export function noArgs() {
  return "called with no args";
}
`,
      "test.py": `
import jsmath

print(jsmath.add(2, 3))
print(jsmath.greet("Python"))
print(jsmath.noArgs())
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("5\nHello, Python!\ncalled with no args");
    expect(exitCode).toBe(0);
  });

  test("access JavaScript object properties", async () => {
    using dir = tempDir("python-js-test", {
      "config.js": `
export const config = {
  name: "MyApp",
  version: "1.0.0",
  settings: {
    debug: true,
    port: 3000
  }
};
`,
      "test.py": `
import config

print(config.config.name)
print(config.config.version)
print(config.config.settings.debug)
print(config.config.settings.port)
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("MyApp\n1.0.0\nTrue\n3000");
    expect(exitCode).toBe(0);
  });

  test("subscript access on JavaScript objects", async () => {
    using dir = tempDir("python-js-test", {
      "data.js": `
export const obj = { count: 1, name: "test" };
export const arr = [10, 20, 30];
`,
      "test.py": `
import data

print(data.obj['count'])
print(data.obj['name'])
print(data.arr[0])
print(data.arr[2])
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("1\ntest\n10\n30");
    expect(exitCode).toBe(0);
  });

  test("modify JavaScript objects from Python", async () => {
    using dir = tempDir("python-js-test", {
      "state.js": `
export const obj = { count: 1 };

export function getCount() {
  return obj.count;
}
`,
      "test.py": `
import state

print(state.getCount())
state.obj['count'] = 999
print(state.getCount())
state.obj.count = 42
print(state.getCount())
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("1\n999\n42");
    expect(exitCode).toBe(0);
  });

  test("import TypeScript from Python", async () => {
    using dir = tempDir("python-ts-test", {
      "utils.ts": `
export function multiply(a: number, b: number): number {
  return a * b;
}

export const PI: number = 3.14159;

interface Config {
  name: string;
}

export const config: Config = { name: "TypeScript" };
`,
      "test.py": `
import utils

print(utils.multiply(6, 7))
print(utils.PI)
print(utils.config.name)
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("42\n3.14159\nTypeScript");
    expect(exitCode).toBe(0);
  });

  test("bidirectional: Python calls JS which calls Python", async () => {
    using dir = tempDir("python-bidirectional", {
      "helper.py": `
def double(x):
    return x * 2

def format_result(value):
    return f"Result: {value}"
`,
      "processor.js": `
import { double, format_result } from "./helper.py";

export function process(value) {
  const doubled = double(value);
  return format_result(doubled);
}
`,
      "main.py": `
import processor

result = processor.process(21)
print(result)
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("Result: 42");
    expect(exitCode).toBe(0);
  });

  test("JavaScript undefined and null become None", async () => {
    using dir = tempDir("python-js-null", {
      "nulls.js": `
export const nothing = null;
export const undef = undefined;

export function returnsNull() {
  return null;
}

export function returnsUndefined() {
  return undefined;
}
`,
      "test.py": `
import nulls

print(nulls.nothing)
print(nulls.undef)
print(nulls.returnsNull())
print(nulls.returnsUndefined())
print(nulls.nothing is None)
print(nulls.undef is None)
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("None\nNone\nNone\nNone\nTrue\nTrue");
    expect(exitCode).toBe(0);
  });

  test("multiple imports of same module use cached version", async () => {
    using dir = tempDir("python-multi-import", {
      "counter.js": `
export let count = 0;

export function increment() {
  count++;
  return count;
}
`,
      "test.py": `
import counter
import counter as counter2

# Both should refer to the same module
print(counter.increment())
print(counter2.increment())
print(counter.count)
print(counter2.count)
print(counter is counter2)
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Both imports should share state - count increments from 1 to 2
    expect(stdout.trim()).toBe("1\n2\n2\n2\nTrue");
    expect(exitCode).toBe(0);
  });

  test("__name__ is module name when imported from JS", async () => {
    using dir = tempDir("python-name-import", {
      "my_module.py": `
def get_name():
    return __name__

module_name = __name__
`,
      "test.js": `
import { get_name, module_name } from "./my_module.py";

console.log("get_name():", get_name());
console.log("module_name:", module_name);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // __name__ should be the module name derived from filename (without .py extension)
    expect(stdout.trim()).toBe("get_name(): my_module\nmodule_name: my_module");
    expect(exitCode).toBe(0);
  });

  test("__name__ is __main__ when running Python file directly", async () => {
    using dir = tempDir("python-name-main", {
      "main.py": `
print("__name__:", __name__)

if __name__ == "__main__":
    print("running as main")
else:
    print("imported as module")
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.py"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // When running directly, __name__ should be "__main__"
    expect(stdout.trim()).toBe("__name__: __main__\nrunning as main");
    expect(exitCode).toBe(0);
  });

  test("if __name__ == '__main__' block runs only when executed directly", async () => {
    using dir = tempDir("python-main-guard", {
      "utils.py": `
def helper():
    return "helper called"

main_executed = False

if __name__ == "__main__":
    main_executed = True
    print("utils.py executed as main")
`,
      "test.js": `
import { helper, main_executed } from "./utils.py";

console.log("helper():", helper());
console.log("main_executed:", main_executed);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // When imported, the if __name__ == "__main__" block should NOT run
    expect(stdout.trim()).toBe("helper(): helper called\nmain_executed: false");
    expect(exitCode).toBe(0);
  });
});

describe("Python class instantiation requires new", () => {
  test("Python class requires new keyword like JS classes", async () => {
    using dir = tempDir("python-new-test", {
      "test.py": `
class Counter:
    def __init__(self, start=0):
        self.value = start

    def increment(self):
        self.value += 1
        return self.value
`,
      "test.js": `
import { Counter } from "./test.py";

// Using new should work
const counter = new Counter(10);
console.log("new Counter(10).value:", counter.value);

// Calling without new should throw
try {
    const bad = Counter(10);
    console.log("ERROR: Counter(10) should have thrown");
} catch (e) {
    console.log("Counter(10) threw:", e.name);
}
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("new Counter(10).value: 10\nCounter(10) threw: TypeError");
    expect(exitCode).toBe(0);
  });

  test("Python functions do not require new", async () => {
    using dir = tempDir("python-new-test", {
      "test.py": `
def add(a, b):
    return a + b
`,
      "test.js": `
import { add } from "./test.py";

// Functions should work without new
console.log("add(2, 3):", add(2, 3));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("add(2, 3): 5");
    expect(exitCode).toBe(0);
  });
});

describe("Python builtin modules with python: prefix", () => {
  test("import pathlib from python:pathlib", async () => {
    using dir = tempDir("python-builtin-test", {
      "test.js": `
import pathlib from "python:pathlib";

// pathlib.Path should be a callable class
const p = new pathlib.Path("/tmp/test");
console.log("path:", p.toString());
console.log("name:", p.name);
console.log("parent:", p.parent.toString());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("path: /tmp/test\nname: test\nparent: /tmp");
    expect(exitCode).toBe(0);
  });

  test("import named exports from python:pathlib", async () => {
    using dir = tempDir("python-builtin-test", {
      "test.js": `
import { Path, PurePath } from "python:pathlib";

const p = new Path("/home/user/file.txt");
console.log("suffix:", p.suffix);
console.log("stem:", p.stem);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("suffix: .txt\nstem: file");
    expect(exitCode).toBe(0);
  });

  test("import json from python:json", async () => {
    using dir = tempDir("python-builtin-test", {
      "test.js": `
import json from "python:json";

// Test dumps with JS object - works because JS objects become Python dicts
const data = { name: "test", count: 42 };
const encoded = json.dumps(data);
console.log("encoded:", encoded);

// Test dumps with JS array - becomes Python list
const arr = [1, 2, "three"];
const arrEncoded = json.dumps(arr);
console.log("array encoded:", arrEncoded);

// Test loads - parses JSON string into Python object
const decoded = json.loads('{"hello": "world"}');
console.log("decoded.hello:", decoded.hello);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe('encoded: {"name": "test", "count": 42}');
    expect(lines[1]).toBe('array encoded: [1, 2, "three"]');
    expect(lines[2]).toBe("decoded.hello: world");
    expect(exitCode).toBe(0);
  });

  test("import os from python:os", async () => {
    using dir = tempDir("python-builtin-test", {
      "test.js": `
import os from "python:os";

// os.getcwd() should return current working directory
const cwd = os.getcwd();
console.log("has cwd:", typeof cwd === "string" && cwd.length > 0);

// os.name should be a string (posix or nt)
console.log("os.name:", os.name);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("has cwd: true");
    expect(lines[1]).toMatch(/os\.name: (posix|nt)/);
    expect(exitCode).toBe(0);
  });
});

describe("Python/JS shared reference semantics", () => {
  test("Python list modified in JS is seen by Python", async () => {
    using dir = tempDir("python-shared-ref-test", {
      "test.py": `
def create_list():
    return [1, 2, 3]

def get_list_length(lst):
    return len(lst)

def get_list_item(lst, index):
    return lst[index]
`,
      "test.js": `
const py = await import("./test.py");

// Create a Python list
const pyList = py.create_list();
console.log("initial length:", py.get_list_length(pyList));
console.log("initial items:", pyList[0], pyList[1], pyList[2]);

// Modify the list from JS
pyList[3] = 4;  // append by index
console.log("after JS modification length:", py.get_list_length(pyList));
console.log("new item from Python:", py.get_list_item(pyList, 3));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("initial length: 3");
    expect(lines[1]).toBe("initial items: 1 2 3");
    expect(lines[2]).toBe("after JS modification length: 4");
    expect(lines[3]).toBe("new item from Python: 4");
    expect(exitCode).toBe(0);
  });

  test("Python dict modified in JS is seen by Python", async () => {
    using dir = tempDir("python-shared-ref-test", {
      "test.py": `
def create_dict():
    return {"a": 1, "b": 2}

def get_dict_keys(d):
    return sorted(list(d.keys()))

def get_dict_value(d, key):
    return d.get(key)

def dict_has_key(d, key):
    return key in d
`,
      "test.js": `
const py = await import("./test.py");

// Create a Python dict
const pyDict = py.create_dict();
console.log("initial keys:", py.get_dict_keys(pyDict).join(","));
console.log("initial a:", py.get_dict_value(pyDict, "a"));

// Modify the dict from JS
pyDict.c = 3;  // add new key
pyDict.a = 100;  // modify existing key
console.log("after JS modification has c:", py.dict_has_key(pyDict, "c"));
console.log("new value c from Python:", py.get_dict_value(pyDict, "c"));
console.log("modified value a from Python:", py.get_dict_value(pyDict, "a"));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("initial keys: a,b");
    expect(lines[1]).toBe("initial a: 1");
    expect(lines[2]).toBe("after JS modification has c: true");
    expect(lines[3]).toBe("new value c from Python: 3");
    expect(lines[4]).toBe("modified value a from Python: 100");
    expect(exitCode).toBe(0);
  });

  test("JS array modified in Python is seen by JS", async () => {
    using dir = tempDir("python-shared-ref-test", {
      "test.py": `
def append_to_list(lst, value):
    lst.append(value)
    return len(lst)

def modify_list_item(lst, index, value):
    lst[index] = value
`,
      "test.js": `
const py = await import("./test.py");

// Create a JS array
const jsArray = [1, 2, 3];
console.log("initial:", JSON.stringify(jsArray));

// Pass to Python and modify
const newLen = py.append_to_list(jsArray, 4);
console.log("after Python append, length from Python:", newLen);
console.log("after Python append, JS sees:", JSON.stringify(jsArray));

// Modify an existing item
py.modify_list_item(jsArray, 0, 100);
console.log("after Python modify, JS sees:", JSON.stringify(jsArray));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("initial: [1,2,3]");
    expect(lines[1]).toBe("after Python append, length from Python: 4");
    expect(lines[2]).toBe("after Python append, JS sees: [1,2,3,4]");
    expect(lines[3]).toBe("after Python modify, JS sees: [100,2,3,4]");
    expect(exitCode).toBe(0);
  });

  test("JS object modified in Python is seen by JS", async () => {
    using dir = tempDir("python-shared-ref-test", {
      "test.py": `
def add_key(d, key, value):
    d[key] = value

def modify_key(d, key, value):
    d[key] = value

def delete_key(d, key):
    del d[key]
`,
      "test.js": `
const py = await import("./test.py");

// Create a JS object
const jsObj = { a: 1, b: 2 };
console.log("initial:", JSON.stringify(jsObj));

// Pass to Python and add a key
py.add_key(jsObj, "c", 3);
console.log("after Python add_key, JS sees:", JSON.stringify(jsObj));

// Modify existing key
py.modify_key(jsObj, "a", 100);
console.log("after Python modify_key, JS sees:", JSON.stringify(jsObj));

// Delete a key
py.delete_key(jsObj, "b");
console.log("after Python delete_key, JS sees:", JSON.stringify(jsObj));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe('initial: {"a":1,"b":2}');
    expect(lines[1]).toBe('after Python add_key, JS sees: {"a":1,"b":2,"c":3}');
    expect(lines[2]).toBe('after Python modify_key, JS sees: {"a":100,"b":2,"c":3}');
    expect(lines[3]).toBe('after Python delete_key, JS sees: {"a":100,"c":3}');
    expect(exitCode).toBe(0);
  });

  test("nested structures maintain shared references", async () => {
    using dir = tempDir("python-shared-ref-test", {
      "test.py": `
def modify_nested(obj):
    obj["nested"]["value"] = 999
    obj["nested"]["items"].append("from_python")
`,
      "test.js": `
const py = await import("./test.py");

// Create a nested JS structure
const jsObj = {
  nested: {
    value: 1,
    items: ["a", "b"]
  }
};
console.log("initial:", JSON.stringify(jsObj));

// Python modifies nested properties
py.modify_nested(jsObj);
console.log("after Python modify:", JSON.stringify(jsObj));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe('initial: {"nested":{"value":1,"items":["a","b"]}}');
    expect(lines[1]).toBe('after Python modify: {"nested":{"value":999,"items":["a","b","from_python"]}}');
    expect(exitCode).toBe(0);
  });
});

describe("Python stdlib imports via python: prefix", () => {
  test("import collections from python:collections", async () => {
    using dir = tempDir("python-stdlib-test", {
      "test.js": `
import collections from "python:collections";

// Test Counter
const counter = new collections.Counter(["a", "b", "a", "c", "a", "b"]);
console.log("Counter most_common:", counter.most_common(2).toString());

// Test defaultdict (also a class requiring new, needs Python type as factory)
import builtins from "python:builtins";
const dd = new collections.defaultdict(builtins.int);
dd["key1"] = 1;
console.log("defaultdict:", dd["key1"]);

// Test deque
const dq = new collections.deque([1, 2, 3]);
dq.append(4);
console.log("deque length:", dq.__len__());
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toContain("Counter most_common:");
    expect(lines[1]).toBe("defaultdict: 1");
    expect(lines[2]).toBe("deque length: 4");
    expect(exitCode).toBe(0);
  });

  test("import datetime from python:datetime", async () => {
    using dir = tempDir("python-stdlib-test", {
      "test.js": `
import datetime from "python:datetime";

// Create a date
const d = new datetime.date(2024, 1, 15);
console.log("date:", d.toString());
console.log("year:", d.year);
console.log("month:", d.month);
console.log("day:", d.day);

// Create a timedelta
const td = new datetime.timedelta(1, 3600);  // 1 day + 1 hour
console.log("timedelta days:", td.days);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("date: 2024-01-15");
    expect(lines[1]).toBe("year: 2024");
    expect(lines[2]).toBe("month: 1");
    expect(lines[3]).toBe("day: 15");
    expect(lines[4]).toBe("timedelta days: 1");
    expect(exitCode).toBe(0);
  });

  test("import re from python:re", async () => {
    using dir = tempDir("python-stdlib-test", {
      "test.js": `
import re from "python:re";

// Test re.match
const match = re.match("(\\\\w+) (\\\\w+)", "Hello World");
console.log("match group(0):", match.group(0));
console.log("match group(1):", match.group(1));
console.log("match group(2):", match.group(2));

// Test re.findall
const matches = re.findall("\\\\d+", "foo 123 bar 456");
console.log("findall:", matches.toString());

// Test re.sub
const result = re.sub("\\\\d+", "X", "foo 123 bar 456");
console.log("sub:", result);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("match group(0): Hello World");
    expect(lines[1]).toBe("match group(1): Hello");
    expect(lines[2]).toBe("match group(2): World");
    expect(lines[3]).toBe("findall: ['123', '456']");
    expect(lines[4]).toBe("sub: foo X bar X");
    expect(exitCode).toBe(0);
  });

  test("import itertools from python:itertools", async () => {
    using dir = tempDir("python-stdlib-test", {
      "test.js": `
import itertools from "python:itertools";

// Test chain with spread syntax
const chained = [...new itertools.chain([1, 2], [3, 4])];
console.log("chain:", JSON.stringify(chained));

// Test cycle (take first 5 with for-of)
const cycled = [];
let count = 0;
for (const item of new itertools.cycle(["a", "b"])) {
    cycled.push(item);
    if (++count >= 5) break;
}
console.log("cycle:", JSON.stringify(cycled));

// Test permutations with spread
const perms = [...new itertools.permutations([1, 2, 3], 2)];
console.log("permutations count:", perms.length);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("chain: [1,2,3,4]");
    expect(lines[1]).toBe('cycle: ["a","b","a","b","a"]');
    expect(lines[2]).toBe("permutations count: 6");
    expect(exitCode).toBe(0);
  });

  test("import math from python:math", async () => {
    using dir = tempDir("python-stdlib-test", {
      "test.js": `
import math from "python:math";

console.log("pi:", math.pi);
console.log("e:", math.e);
console.log("sqrt(16):", math.sqrt(16));
console.log("ceil(4.2):", math.ceil(4.2));
console.log("floor(4.8):", math.floor(4.8));
console.log("factorial(5):", math.factorial(5));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toMatch(/pi: 3\.14159/);
    expect(lines[1]).toMatch(/e: 2\.718/);
    expect(lines[2]).toBe("sqrt(16): 4");
    expect(lines[3]).toBe("ceil(4.2): 5");
    expect(lines[4]).toBe("floor(4.8): 4");
    expect(lines[5]).toBe("factorial(5): 120");
    expect(exitCode).toBe(0);
  });

  test("import functools from python:functools", async () => {
    using dir = tempDir("python-stdlib-test", {
      "test.js": `
import functools from "python:functools";

// Test reduce - works with JS callbacks
const sum = functools.reduce((a, b) => a + b, [1, 2, 3, 4, 5]);
console.log("reduce sum:", sum);

// Test reduce with initial value
const sum2 = functools.reduce((a, b) => a + b, [1, 2, 3], 10);
console.log("reduce with initial:", sum2);

// Test partial is a class
const add5 = new functools.partial((a, b) => a + b, 5);
console.log("partial add5(3):", add5(3));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("reduce sum: 15");
    expect(lines[1]).toBe("reduce with initial: 16");
    expect(lines[2]).toBe("partial add5(3): 8");
    expect(exitCode).toBe(0);
  });
});

describe("Async/await interop between Python and JavaScript", () => {
  test("JS awaits Python asyncio coroutine", async () => {
    using dir = tempDir("python-async-test", {
      "async_funcs.py": `
import asyncio

async def async_add(a, b):
    await asyncio.sleep(0.1)
    return a + b

async def async_greet(name):
    await asyncio.sleep(0.05)
    return f"Hello, {name}!"
`,
      "test.js": `
import asyncio from "python:asyncio";
import { async_add, async_greet } from "./async_funcs.py";

const start = performance.now();

// Await Python coroutine
const result = await async_add(2, 3);
console.log("async_add(2, 3):", result);

// Another async call
const greeting = await async_greet("World");
console.log("async_greet:", greeting);

const elapsed = performance.now() - start;
console.log("elapsed >= 150ms:", elapsed >= 150);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("async_add(2, 3): 5");
    expect(lines[1]).toBe("async_greet: Hello, World!");
    expect(lines[2]).toBe("elapsed >= 150ms: true");
    expect(exitCode).toBe(0);
  });

  test("JS awaits Python asyncio.sleep in parallel", async () => {
    using dir = tempDir("python-async-test", {
      "test.js": `
import asyncio from "python:asyncio";

const start = performance.now();

// Run multiple Python sleeps in parallel
await Promise.all([
    asyncio.sleep(0.2),
    asyncio.sleep(0.2),
    asyncio.sleep(0.2),
]);

const elapsed = performance.now() - start;

// Should complete in ~200ms, not 600ms (parallel, not sequential)
console.log("elapsed < 400ms:", elapsed < 400);
console.log("elapsed >= 200ms:", elapsed >= 200);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("elapsed < 400ms: true\nelapsed >= 200ms: true");
    expect(exitCode).toBe(0);
  });

  test("Python awaits JS Promise (Bun.sleep)", async () => {
    using dir = tempDir("python-await-js-test", {
      "test.py": `
import asyncio

async def test_await(js_sleep, js_double):
    # Await JS async function
    result = await js_sleep(100)
    print(f"jsSleep result: {result}")

    # Await another JS async function
    doubled = await js_double(21)
    print(f"jsDouble(21): {doubled}")

    # Sequential awaits
    start = asyncio.get_event_loop().time()
    await js_sleep(100)
    await js_sleep(100)
    elapsed = asyncio.get_event_loop().time() - start
    print(f"sequential >= 200ms: {elapsed >= 0.2}")
`,
      "test.js": `
import { test_await } from "./test.py";

async function jsSleep(ms) {
    await Bun.sleep(ms);
    return \`slept for \${ms}ms\`;
}

async function jsDouble(n) {
    await Bun.sleep(50);
    return n * 2;
}

await test_await(jsSleep, jsDouble);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("jsSleep result: slept for 100ms");
    expect(lines[1]).toBe("jsDouble(21): 42");
    expect(lines[2]).toBe("sequential >= 200ms: True");
    expect(exitCode).toBe(0);
  });

  test("bidirectional async: JS and Python awaiting each other", async () => {
    using dir = tempDir("python-bidirectional-async", {
      "py_module.py": `
import asyncio

async def py_work(seconds):
    await asyncio.sleep(seconds)
    return "python done"
`,
      "test.js": `
import { py_work } from "./py_module.py";

async function jsWork(ms) {
    await Bun.sleep(ms);
    return "js done";
}

const start = performance.now();

// Run JS and Python async in parallel
const [pyResult, jsResult] = await Promise.all([
    py_work(0.2),
    jsWork(200),
]);

const elapsed = performance.now() - start;

console.log("py_work result:", pyResult);
console.log("jsWork result:", jsResult);
console.log("parallel (elapsed < 400ms):", elapsed < 400);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("py_work result: python done");
    expect(lines[1]).toBe("jsWork result: js done");
    expect(lines[2]).toBe("parallel (elapsed < 400ms): true");
    expect(exitCode).toBe(0);
  });

  test("Python interleaved awaits of JS and Python async", async () => {
    using dir = tempDir("python-interleaved-async", {
      "test.py": `
import asyncio

async def run_test(js_sleep):
    start = asyncio.get_event_loop().time()

    # Interleaved Python and JS awaits
    await asyncio.sleep(0.1)
    t1 = asyncio.get_event_loop().time() - start
    print(f"after py sleep: {t1:.1f}s")

    await js_sleep(100)
    t2 = asyncio.get_event_loop().time() - start
    print(f"after js sleep: {t2:.1f}s")

    await asyncio.sleep(0.1)
    t3 = asyncio.get_event_loop().time() - start
    print(f"after py sleep: {t3:.1f}s")

    elapsed = asyncio.get_event_loop().time() - start
    print(f"total ~0.3s: {0.25 < elapsed < 0.4}")
`,
      "test.js": `
import { run_test } from "./test.py";

async function jsSleep(ms) {
    await Bun.sleep(ms);
}

await run_test(jsSleep);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("after py sleep: 0.1s");
    expect(lines[1]).toBe("after js sleep: 0.2s");
    expect(lines[2]).toBe("after py sleep: 0.3s");
    expect(lines[3]).toBe("total ~0.3s: True");
    expect(exitCode).toBe(0);
  });
});

describe("Python isinstance checks for JS wrappers", () => {
  test("JS array passes isinstance(x, list) in Python", async () => {
    using dir = tempDir("python-isinstance-test", {
      "test.py": `
def check_list(obj):
    return isinstance(obj, list)

def check_list_and_use(obj):
    if isinstance(obj, list):
        return f"list with {len(obj)} items"
    return "not a list"
`,
      "test.js": `
import { check_list, check_list_and_use } from "./test.py";

const jsArray = [1, 2, 3];

console.log("isinstance(jsArray, list):", check_list(jsArray));
console.log("use as list:", check_list_and_use(jsArray));
console.log("empty array:", check_list([]));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("isinstance(jsArray, list): true\nuse as list: list with 3 items\nempty array: true");
    expect(exitCode).toBe(0);
  });

  test("JS object passes isinstance(x, dict) in Python", async () => {
    using dir = tempDir("python-isinstance-test", {
      "test.py": `
def check_dict(obj):
    return isinstance(obj, dict)

def check_dict_and_use(obj):
    if isinstance(obj, dict):
        return f"dict with keys: {sorted(obj.keys())}"
    return "not a dict"
`,
      "test.js": `
import { check_dict, check_dict_and_use } from "./test.py";

const jsObj = { a: 1, b: 2 };

console.log("isinstance(jsObj, dict):", check_dict(jsObj));
console.log("use as dict:", check_dict_and_use(jsObj));
console.log("empty object:", check_dict({}));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe(
      "isinstance(jsObj, dict): true\nuse as dict: dict with keys: ['a', 'b']\nempty object: true",
    );
    expect(exitCode).toBe(0);
  });

  test("Python list methods work on JS arrays", async () => {
    using dir = tempDir("python-list-methods-test", {
      "test.py": `
def use_list_methods(lst):
    lst.append(4)
    lst.insert(0, 0)
    last = lst.pop()
    lst.reverse()
    return f"after ops: {list(lst)}, popped: {last}"
`,
      "test.js": `
import { use_list_methods } from "./test.py";

const jsArray = [1, 2, 3];
console.log("initial:", JSON.stringify(jsArray));
const result = use_list_methods(jsArray);
console.log("Python result:", result);
console.log("JS sees:", JSON.stringify(jsArray));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("initial: [1,2,3]");
    // After append(4), insert(0,0), pop(), reverse(): [0,1,2,3] -> pop -> [0,1,2,3][:3] reversed = [3,2,1,0]
    expect(lines[1]).toBe("Python result: after ops: [3, 2, 1, 0], popped: 4");
    expect(lines[2]).toBe("JS sees: [3,2,1,0]");
    expect(exitCode).toBe(0);
  });

  test("Python dict methods work on JS objects", async () => {
    using dir = tempDir("python-dict-methods-test", {
      "test.py": `
def use_dict_methods(d):
    d['new_key'] = 'new_value'
    d.update({'x': 10, 'y': 20})
    val = d.pop('a', 'not found')
    keys = sorted(d.keys())
    return f"keys: {keys}, popped a: {val}"
`,
      "test.js": `
import { use_dict_methods } from "./test.py";

const jsObj = { a: 1, b: 2 };
console.log("initial:", JSON.stringify(jsObj));
const result = use_dict_methods(jsObj);
console.log("Python result:", result);
console.log("JS sees:", JSON.stringify(jsObj));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe('initial: {"a":1,"b":2}');
    expect(lines[1]).toBe("Python result: keys: ['b', 'new_key', 'x', 'y'], popped a: 1");
    expect(lines[2]).toBe('JS sees: {"b":2,"new_key":"new_value","x":10,"y":20}');
    expect(exitCode).toBe(0);
  });
});
