import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(120_000);

// Code under test, typed and untyped, in a file of its own: the tests replace what it calls.
const app = {
  "app.ts": `
    export function find(text: string, part: string): number { return text.indexOf(part); }
    export function findUntyped(text: any, part: any) { return text.indexOf(part); }
    export function fold(text: string): string { return text.normalize("NFC"); }
    export function has(list: number[], item: number): boolean { return list.includes(item); }
    export function joined(list: string[]): string { return list.join("-"); }
    export function lookUp(map: Map<string, number>, key: string): number | undefined { return map.get(key); }
    export function count(map: Map<string, number>): number { return map.size; }
    export function listOf(items: Iterable<number>): number[] { return Array.from(items); }
    export function frozen<T extends object>(value: T): T { return Object.freeze(value); }
    export function glued(a: Uint8Array, b: Uint8Array): string { return Buffer.concat([a, b]).toString(); }
    export function first<T>(a: Promise<T>, b: Promise<T>): Promise<T> { return Promise.race([a, b]); }
    export function unique(items: number[]): Set<number> { return new Set(items); }
    export function matches(pattern: string, text: string): boolean { return new RegExp(pattern).test(text); }
    export function sumOfCodes(text: string): number {
      let sum = 0;
      for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
      return sum;
    }`,
};
const imports = `
  import { afterEach, expect, jest, mock, spyOn, test, vi } from "bun:test";
  import { count, find, findUntyped, first, fold, frozen, glued, has, joined, listOf, lookUp, matches, sumOfCodes, unique } from "./app";`;

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("tests-replace-built-ins", files);
  const plain = await runTests(String(dir), ...flags);
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot", ...flags)).toEqual(plain);
}

test("a spy on a prototype method records the calls of compiled code", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("recorded", () => {
        const spy = spyOn(String.prototype, "indexOf");
        console.log(find("abc", "c"), findUntyped("abc", "b"), "abc".indexOf("a"));
        console.log(JSON.stringify(spy.mock.calls), JSON.stringify(spy.mock.contexts), JSON.stringify(spy.mock.results));
        expect(spy).toHaveBeenCalledTimes(3);
        spy.mockRestore();
      });`,
  });
});

test("a spy's implementation replaces the method, and mockRestore() gives it back", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      const uses = () => console.log(find("abc", "c"), findUntyped("abc", "c"), has([1, 2], 2), joined(["a", "b"]));
      test("replaced", () => {
        uses();
        const spies = [
          spyOn(String.prototype, "indexOf").mockReturnValue(77),
          spyOn(Array.prototype, "includes").mockImplementation(() => false),
          spyOn(Array.prototype, "join").mockImplementation(function (this: string[]) { return "joined " + this.length; }),
        ];
        uses();
        for (const spy of spies) spy.mockRestore();
        uses();
        console.log(String.prototype.indexOf.name, Array.prototype.includes.length, typeof Array.prototype.join);
      });`,
  });
});

test("mock.restore() gives back every member that was spied on", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      afterEach(() => { mock.restore(); });
      test("spied on", () => {
        spyOn(String.prototype, "normalize").mockReturnValue("spied");
        jest.spyOn(Map.prototype, "get").mockReturnValue(5);
        vi.spyOn(Array, "from").mockReturnValue([9]);
        console.log(fold("e\\u0301"), lookUp(new Map([["a", 1]]), "a"), listOf(new Set([1, 2])));
      });
      test("restored", () => {
        console.log(fold("e\\u0301").length, lookUp(new Map([["a", 1]]), "a"), listOf(new Set([1, 2])));
      });`,
  });
});

test("a static member is spied on", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("statics", async () => {
        const spies = [spyOn(Array, "from"), spyOn(Object, "freeze"), spyOn(Buffer, "concat"), spyOn(Promise, "race"), spyOn(Atomics, "store")];
        console.log(listOf([1, 2]), Object.isFrozen(frozen({ a: 1 })), glued(Buffer.from("a"), Buffer.from("b")));
        console.log(await first(Promise.resolve(1), new Promise<number>(() => {})));
        console.log(Atomics.store(new Int32Array(new SharedArrayBuffer(8)), 0, 7));
        console.log(spies.map(spy => spy.mock.calls.length));
        mock.restore();
      });`,
  });
});

test("an assignment replaces a member, and another one puts it back", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("assigned", () => {
        const original = String.prototype.normalize;
        const forms: unknown[] = [];
        String.prototype.normalize = function (this: string, form?: string) { forms.push(form); return original.call(this, form); };
        try {
          console.log(fold("e\\u0301").length, "e\\u0301".normalize("NFD").length, forms);
        } finally {
          String.prototype.normalize = original;
        }
        console.log(fold("e\\u0301").length, forms, String.prototype.normalize === original);
      });
      test("assigned to a static member", () => {
        const original = Array.from;
        (Array as any).from = () => ["replaced"];
        console.log(listOf([1]));
        Array.from = original;
        console.log(listOf([1]));
      });`,
  });
});

test("Object.defineProperty, Reflect.set and delete replace a member", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("defined", () => {
        const before = Object.getOwnPropertyDescriptor(Array.prototype, "includes")!;
        console.log(before.writable, before.enumerable, before.configurable);
        Object.defineProperty(Array.prototype, "includes", { ...before, value() { return "defined"; } });
        console.log(has([1], 1));
        Object.defineProperty(Array.prototype, "includes", before);
        console.log(has([1], 1));
      });
      test("set by Reflect", () => {
        const original = Map.prototype.get;
        console.log(Reflect.set(Map.prototype, "get", () => "reflected"), lookUp(new Map(), "a"));
        console.log(Reflect.set(Map.prototype, "get", original), lookUp(new Map([["a", 1]]), "a"));
      });
      test("deleted", () => {
        const original = String.prototype.indexOf;
        console.log(delete (String.prototype as any).indexOf, "indexOf" in String.prototype);
        try { find("abc", "c"); } catch (error) { console.log((error as Error).constructor.name); }
        String.prototype.indexOf = original;
        console.log(find("abc", "c"));
      });`,
  });
});

test("a getter is replaced", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("getter", () => {
        const before = Object.getOwnPropertyDescriptor(Map.prototype, "size")!;
        const map = new Map([["a", 1]]);
        console.log(count(map), map.size);
        Object.defineProperty(Map.prototype, "size", { ...before, get() { return 42; } });
        console.log(count(map), map.size);
        Object.defineProperty(Map.prototype, "size", before);
        console.log(count(map), map.size);
      });`,
  });
});

test("a built-in function that looks a replaced method up calls the replacement", async () => {
  await expectCompiledToRunAsPlain({
    "text.ts": `
      export function asText(list: number[]): string { return String(list) + list.toString() + \`\${list}\`; }
      export function mapOf(pairs: [string, number][]): Map<string, number> { return new Map(pairs); }
      export function setOf(items: number[]): Set<number> { return new Set(items); }
      export function all(items: number[]): Promise<number[]> { return Promise.all(items); }
      export function written(date: Date): string { return JSON.stringify({ date }); }`,
    "one.test.ts": `
      import { mock, spyOn, test } from "bun:test";
      import { all, asText, mapOf, setOf, written } from "./text";
      test("looked up", async () => {
        const spies = [
          spyOn(Array.prototype, "join"), spyOn(Map.prototype, "set"), spyOn(Set.prototype, "add"), spyOn(Promise, "resolve"), spyOn(Date.prototype, "toISOString"),
        ];
        console.log(asText([1, 2]), mapOf([["a", 1], ["b", 2]]).size, new Map([["c", 3]]).get("c"), setOf([1, 1, 2]).size, new Set([4]).has(4));
        console.log(await all([1, 2]), written(new Date(0)));
        console.log(spies.map(spy => spy.mock.calls.length));
        mock.restore();
        console.log(asText([1, 2]), mapOf([["a", 1]]).size, setOf([1]).size, await all([3]), written(new Date(0)));
      });`,
  });
});

test("a global class is replaced", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("through globalThis", () => {
        const Original = Set;
        let made = 0;
        class Counting<T> extends Original<T> { constructor(items?: Iterable<T>) { super(items); made++; } }
        console.log(unique([1, 1, 2]).size, made);
        globalThis.Set = Counting as SetConstructor;
        try {
          console.log(unique([1, 1, 2]).size, made, unique([]) instanceof Counting, new Set([3]).has(3));
        } finally {
          globalThis.Set = Original;
        }
        console.log(unique([1, 1, 2]).size, made, unique([]) instanceof Counting, Set === Original);
      });
      test("by its name", () => {
        const Original = RegExp;
        const patterns: string[] = [];
        // @ts-expect-error
        RegExp = function (pattern: string) { patterns.push(pattern); return new Original(pattern); };
        try {
          console.log(matches("a+", "caat"), patterns, /a/ instanceof Original);
        } finally {
          // @ts-expect-error
          RegExp = Original;
        }
        console.log(matches("b", "caat"), patterns);
      });`,
  });
});

test("a method of Object.prototype, RegExp.prototype, Promise.prototype and Headers.prototype is replaced", async () => {
  await expectCompiledToRunAsPlain({
    "uses.ts": `
      export function owns(object: object, key: string): boolean { return object.hasOwnProperty(key); }
      export function ownsUntyped(object: any, key: any) { return object.hasOwnProperty(key); }
      export function found(pattern: RegExp, text: string): string | undefined { return pattern.exec(text)?.[0]; }
      export function tested(pattern: RegExp, text: string): boolean { return pattern.test(text); }
      export function swapped(pattern: RegExp, text: string): string { return text.replace(pattern, "-"); }
      export function after(promise: Promise<number>, then: () => void): Promise<number> { return promise.finally(then); }
      export function header(name: string, value: string): string | null {
        const headers = new Headers();
        headers.set(name, value);
        return headers.get(name);
      }`,
    "one.test.ts": `
      import { mock, spyOn, test } from "bun:test";
      import { after, found, header, owns, ownsUntyped, swapped, tested } from "./uses";
      const uses = async () => {
        console.log(owns({ a: 1 }, "a"), ownsUntyped({ a: 1 }, "b"), found(/b+/, "abbc"), tested(/b/, "abc"), swapped(/b/, "abc"));
        console.log(await after(Promise.resolve(1), () => console.log("then")), header("a", "b"));
      };
      test("replaced", async () => {
        await uses();
        const spies = [
          spyOn(Object.prototype, "hasOwnProperty"), spyOn(RegExp.prototype, "exec"), spyOn(Promise.prototype, "finally"), spyOn(Headers.prototype, "set"),
        ];
        await uses();
        console.log(spies.map(spy => spy.mock.calls.length));
        spies[0].mockReturnValue(false);
        spies[1].mockReturnValue(null);
        spies[3].mockImplementation(() => {});
        await uses();
        mock.restore();
        await uses();
      });`,
  });
});

test("a test adds a name to Object.prototype and to Function.prototype, and takes it away", async () => {
  await expectCompiledToRunAsPlain({
    "reads.ts": `
      type Options = { proxy?: string; port: number };
      export function proxyOf(options: Options): string | undefined { return options.proxy; }
      export function read(object: any, key: string) { return object[key]; }
      export function keysOf(object: object): string[] { const keys = []; for (const key in object) keys.push(key); return keys; }
      export function hasKey(object: object, key: string): boolean { return key in object; }
      export function copy(options: Options): Options { return { ...options }; }
      export function marked(callee: Function): unknown { return (callee as any).marked; }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { copy, hasKey, keysOf, marked, proxyOf, read } from "./reads";
      const uses = () => console.log(
        proxyOf({ port: 1 }), proxyOf({ port: 1, proxy: "own" }), read({}, "proxy"), read([], "proxy"), ({} as any).proxy, keysOf({ port: 1 }), hasKey({}, "proxy"),
        JSON.stringify(copy({ port: 2 })), marked(() => 1), marked(uses), marked(Math.max), Object.isExtensible(Object.prototype),
      );
      test("added", () => {
        uses();
        (Object.prototype as any).proxy = "inherited";
        (Function.prototype as any).marked = true;
        uses();
        delete (Object.prototype as any).proxy;
        Reflect.deleteProperty(Function.prototype, "marked");
        uses();
        for (const holder of [Object.prototype, Function.prototype]) Reflect.set(holder, "proxy", "by a loop");
        uses();
        for (const holder of [Object.prototype, Function.prototype]) delete (holder as any).proxy;
        uses();
      });`,
  });
});

test("what a test asks about a built-in object that it leaves alone is answered as in plain Bun", async () => {
  await expectCompiledToRunAsPlain(
    {
      "one.test.ts": `
      import { test } from "bun:test";
      const objects: [string, object][] = [
        ["Object.prototype", Object.prototype], ["Function.prototype", Function.prototype], ["Array.prototype", Array.prototype], ["Promise.prototype", Promise.prototype],
        ["RegExp.prototype", RegExp.prototype], ["Headers.prototype", Headers.prototype], ["Math", Math], ["Object", Object],
      ];
      test("asked", () => {
        for (const [name, object] of objects) {
          const described = Object.getOwnPropertyDescriptor(object, "toString") ?? Object.getOwnPropertyDescriptor(object, "then");
          console.log(name, Reflect.isExtensible(object), Object.isExtensible(object), Object.isFrozen(object), Object.isSealed(object), described?.writable, described?.configurable);
        }
      });
      test("frozen", () => {
        console.log(Object.isFrozen(Object.freeze(Object.prototype)), Object.isFrozen(Object.freeze(Array.prototype)), Reflect.isExtensible(Object.prototype), [1, 2].map(n => n + 1), ({}).toString());
      });`,
    },
    "--isolate",
  );
});

test("rows of a table and a helper of another name, two steps from the test file, cost no second build", async () => {
  using dir = tempDir("tests-replace-built-ins", {
    ...app,
    "helpers/stub.ts": `
      import { rows } from "./rows";
      export function stub(holder: any, name: string, replacement: unknown) { const original = holder[name]; holder[name] = replacement; return () => { holder[name] = original; }; }
      export function stubRows() { return rows.map(([holder, name]) => stub(holder, name, () => "row")); }`,
    "helpers/rows.ts": `export const rows: [object, string][] = [[Array.prototype, "join"], [String.prototype, "normalize"]];`,
    "one.test.ts": `${imports}
      import { stub, stubRows } from "./helpers/stub";
      test("stubbed", () => {
        const restore = [stub(String.prototype, "indexOf", () => 5), ...stubRows()];
        (Object.prototype as any).polluted = "yes";
        console.log(find("abc", "c"), joined(["a", "b"]), fold("e"), ({} as any).polluted);
        for (const undo of restore) undo();
        delete (Object.prototype as any).polluted;
        console.log(find("abc", "c"), joined(["a", "b"]), fold("e"), ({} as any).polluted);
      });`,
  });
  const plain = await runTests(String(dir));
  expect(plain.stdout).toContain("5 row row yes\n2 a-b e undefined");
  const logged = await run([bunExe(), "test", "--aot"], String(dir), { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" });
  expect(logged.stdout).toContain("5 row row yes\n2 a-b e undefined");
  expect(logged.stderr).not.toContain("AOT build starts over | replaced built-ins added");
  expect(logged.stderr).not.toContain("AOT build starts over | names opened");
});

test("a loop that has run many times calls the replacement, and the original once it is back", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("hot", () => {
        const text = "abcdefghij".repeat(1000);
        let total = 0;
        for (let turn = 0; turn < 200; turn++) total += sumOfCodes(text);
        console.log(total);
        const spy = spyOn(String.prototype, "charCodeAt").mockReturnValue(1);
        console.log(sumOfCodes(text), spy.mock.calls.length);
        spy.mockRestore();
        console.log(sumOfCodes(text));
      });
      test("replaced inside the loop", () => {
        let sum = 0;
        let spy: ReturnType<typeof spyOn> | undefined;
        const letters = ["a", "b"];
        for (let i = 0; i < 10; i++) {
          if (i === 5) spy = spyOn(String.prototype, "charCodeAt").mockReturnValue(1000);
          sum += letters[i % 2].charCodeAt(0);
        }
        spy!.mockRestore();
        console.log(sum);
      });`,
  });
});

test("a preload replaces a member for every test file", async () => {
  await expectCompiledToRunAsPlain(
    {
      ...app,
      "preload.ts": `
        import { spyOn } from "bun:test";
        (globalThis as any).searches = spyOn(String.prototype, "indexOf");`,
      "a.test.ts": `
        import { expect, test } from "bun:test";
        import { find } from "./app";
        test("a", () => { (globalThis as any).searches.mockClear(); console.log(find("abc", "b")); expect((globalThis as any).searches).toHaveBeenCalledWith("b"); });`,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { findUntyped } from "./app";
        test("b", () => { (globalThis as any).searches.mockClear(); console.log(findUntyped("abc", "c")); expect((globalThis as any).searches).toHaveBeenCalledTimes(1); });`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("with --isolate a replacement ends with its file", async () => {
  await expectCompiledToRunAsPlain(
    {
      ...app,
      "a.test.ts": `${imports}
        test("a", () => { String.prototype.indexOf = () => -5; console.log(find("abc", "b")); });`,
      "b.test.ts": `${imports}
        test("b", () => { console.log(find("abc", "b"), String.prototype.indexOf.name); });`,
    },
    "--isolate",
  );
});

test("a helper that is handed the object and the name replaces the member", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "helper.ts": `
      import { spyOn } from "bun:test";
      export function counting(target: object, name: string) { return spyOn(target as any, name); }
      export function stub(target: any, name: string, replacement: unknown) {
        const original = target[name];
        target[name] = replacement;
        return () => { target[name] = original; };
      }`,
    "one.test.ts": `${imports}
      import { counting, stub } from "./helper";
      test("spied on by a helper", () => {
        const spy = counting(String.prototype, "indexOf");
        console.log(find("abc", "c"), spy.mock.calls.length);
        spy.mockRestore();
      });
      test("stored by a helper", () => {
        const undo = stub(Array.prototype, "join", () => "stubbed");
        console.log(joined(["a", "b"]));
        undo();
        console.log(joined(["a", "b"]));
      });
      test("rows of a table", () => {
        const rows: [object, string][] = [[Map.prototype, "get"], [Array, "from"]];
        const originals = rows.map(([holder, key]) => (holder as any)[key]);
        for (const [holder, key] of rows) console.log(Reflect.set(holder, key, () => key));
        console.log(lookUp(new Map(), "a"), listOf([]));
        rows.forEach(([holder, key], index) => Reflect.set(holder, key, originals[index]));
        console.log(lookUp(new Map([["a", 1]]), "a"), listOf([1]));
      });`,
  });
});

test("a member that no test names stays read-only, and the write throws", async () => {
  using dir = tempDir("tests-replace-built-ins", {
    "one.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      const name = process.argv.length > 1000 ? "at" : ["last", "Index", "Of"].join("");
      test("stored", () => {
        expect(() => { (String.prototype as any)[name] = () => 1; }).toThrow("Cannot assign to String.prototype.lastIndexOf because built-in objects are read-only");
      });
      test("spied on", () => {
        expect(() => spyOn(String.prototype as any, name)).toThrow("Cannot spy on 'lastIndexOf'");
      });
      test("added", () => {
        (Object.prototype as any).seen = 1;
        delete (Object.prototype as any).seen;
        expect(() => { (Object.prototype as any)[name] = 1; }).toThrow("built-in objects are read-only");
        expect(() => { (Object.prototype as any)[Symbol.iterator] = 1; }).toThrow("built-in objects are read-only");
        expect(() => { (Object.prototype as any)[0] = 1; }).toThrow("built-in objects are read-only");
        expect(() => { Object.prototype.toString = () => ""; }).toThrow("built-in objects are read-only");
        expect(() => Object.setPrototypeOf(Object.prototype, {})).toThrow();
      });`,
  });
  expect((await runTests(String(dir), "--aot")).results).toEqual(["pass stored", "pass spied on", "pass added"]);
});
