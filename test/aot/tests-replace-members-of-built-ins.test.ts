import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

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
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
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

test("Object.assign and Object.defineProperties replace the members that their literals name", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("assigned", () => {
        const before = { includes: Array.prototype.includes, join: Array.prototype.join };
        Object.assign(Array.prototype, { includes() { return "assigned"; }, ["join"]() { return "assigned too"; } });
        console.log(has([1], 1), joined(["a", "b"]));
        Object.assign(Array.prototype, before);
        console.log(has([1], 1), joined(["a", "b"]));
      });
      test("assigned from the second of two", () => {
        const original = Array.from;
        Object.assign(Array, {}, { from: () => "assigned" } as any);
        console.log(listOf([1]));
        Object.assign(Array, { from: original });
        console.log(listOf([1]));
      });
      test("defined together", () => {
        const before = { get: Object.getOwnPropertyDescriptor(Map.prototype, "get")!, indexOf: Object.getOwnPropertyDescriptor(String.prototype, "indexOf")! };
        Object.defineProperties(Map.prototype, { get: { ...before.get, value: () => "defined" } });
        Object.defineProperties(String.prototype, { indexOf: { ...before.indexOf, value: () => "defined too" } });
        console.log(lookUp(new Map(), "a"), find("abc", "c"), findUntyped("abc", "c"));
        Object.defineProperties(Map.prototype, { get: before.get });
        Object.defineProperties(String.prototype, { indexOf: before.indexOf });
        console.log(lookUp(new Map([["a", 1]]), "a"), find("abc", "c"), findUntyped("abc", "c"));
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

test("a built-in function that asks its operand for a replaced method runs the replacement, and its caller sees what the replacement did", async () => {
  await expectCompiledToRunAsPlain({
    "uses.ts": `
      export const box = { n: 0 };
      // Each reads the counter in front of the call and behind it: a call that is taken to run no code of the program lets the second read go.
      function counted<T>(run: () => T): [number, T] { const before = box.n; const result = run(); return [box.n - before, result]; }
      export function sets(a: Set<number>, b: Set<number>) {
        const before = box.n;
        const answers = [a.isSubsetOf(b), a.isSupersetOf(b), a.isDisjointFrom(b), a.union(b).size, a.intersection(b).size, a.difference(b).size, a.symmetricDifference(b).size];
        return [box.n - before, ...answers];
      }
      export function setsOfItsOwn() {
        const a = new Set([1, 2]), b = new Set([2, 3, 4]);
        const before = box.n;
        const size = a.union(b).size + (a.isSubsetOf(b) ? 10 : 0);
        return [box.n - before, size];
      }
      // Nothing else writes the field, and nothing else hands the object on.
      export function changedByReplacement() {
        const item = { v: 1 };
        const a = new Set([item]), b = new Set([{ v: 2 }]);
        return [a.isSubsetOf(b), item.v, a.union(b).size, item.v];
      }
      export function patterns(text: string) {
        const before = box.n;
        const answers = [text.replace(/b/, "-"), text.replaceAll(/b/g, "+"), text.split(/b/).length, text.match(/b/)?.index, text.search(/c/), [...text.matchAll(/./g)].length, /b/.test(text)];
        return [box.n - before, ...answers];
      }
      export function texts(list: number[], date: Date) {
        const before = box.n;
        const answers = [list.toLocaleString("en-US"), String(list), JSON.stringify([date])];
        return [box.n - before, ...answers];
      }
      export function made(pairs: [string, number][], items: number[]) {
        return [
          counted(() => Map.groupBy(items, item => item % 2).size), counted(() => Object.keys(Object.groupBy(items, item => String(item % 2))).length),
          counted(() => Array.from(new Set(items)).length), counted(() => Array.from(new Map(pairs)).length), counted(() => Object.fromEntries(new Map(pairs)).a),
          counted(() => new Map(new Map(pairs)).size), counted(() => new Set(new Set(items)).size), counted(() => [...new Set(items)].length),
          counted(() => items.values().map(item => item + 1).filter(item => item > 1).toArray().length), counted(() => items.concat(items).flat().length),
        ];
      }
      export async function promised(items: number[]) {
        const before = box.n;
        const answers = [await Promise.all(items), await Promise.allSettled(items).then(all => all.length), await Promise.any(items), await Promise.race(items)];
        return [box.n - before, ...answers];
      }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { box, changedByReplacement, made, patterns, promised, sets, setsOfItsOwn, texts } from "./uses";
      function count(holder: any, name: string) {
        const original = holder[name];
        holder[name] = function (this: unknown, ...operands: unknown[]) { box.n++; return Reflect.apply(original, this, operands); };
        return () => { holder[name] = original; };
      }
      const uses = async () => {
        console.log(sets(new Set([1, 2]), new Set([2, 3, 4])), setsOfItsOwn(), patterns("abcb"), texts([1.5, 2000], new Date(0)));
        console.log(JSON.stringify(made([["a", 1], ["b", 2]], [1, 2, 3])), await promised([1, 2]));
      };
      test("counted", async () => {
        await uses();
        const restore = [
          count(Set.prototype, "has"), count(Set.prototype, "keys"), count(Set.prototype, "values"), count(Set.prototype, "add"),
          count(Map.prototype, "set"), count(Map.prototype, "get"), count(Map.prototype, "has"), count(Map.prototype, "entries"),
          count(RegExp.prototype, "exec"), count(Number.prototype, "toLocaleString"), count(Array.prototype, "join"), count(Date.prototype, "toISOString"),
          count(Promise, "resolve"), count(Array.prototype, "push"), count(Array.prototype, "values"), count(Iterator.prototype, "map"), count(Iterator.prototype, "toArray"),
        ];
        await uses();
        for (const undo of restore) undo();
        await uses();
      });
      test("changed", () => {
        console.log(changedByReplacement());
        const has = Set.prototype.has;
        Set.prototype.has = function (this: Set<unknown>, item: any) { item.v = 7; return Reflect.apply(has, this, [item]); };
        console.log(changedByReplacement());
        Set.prototype.has = has;
        console.log(changedByReplacement());
      });`,
  });
});

test("code that a test holds as text and runs replaces a method and adds a name", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      const keysOf = (value: object) => { const keys: string[] = []; for (const key in value) keys.push(key); return keys; };
      const run = (text: string) => new Function(text)();
      test("run", () => {
        const add = Set.prototype.add;
        console.log(unique([1, 2, 2]).size, keysOf({ own: 1 }));
        run("Set.prototype.add = function () { return this }");
        run(\`
          const value = \${JSON.stringify(1)};
          Object.defineProperty(Object.prototype, "planted", { value, enumerable: true, configurable: true });
          return value\`);
        console.log(unique([1, 2, 2]).size, keysOf({ own: 1 }));
        Set.prototype.add = add;
        run("delete Object.prototype.planted");
        console.log(unique([1, 2, 2]).size, keysOf({ own: 1 }));
      });`,
  });
});

test("a name is added to a prototype that the test reaches without naming it", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      const read = (value: any, name: string) => value[name];
      function readWhileInherited<T>(way: string, field: string, look: () => T): T {
        const inherited: object = Reflect.get({}, way);
        expect(Reflect.has(inherited, field)).toBe(false);
        expect(Reflect.defineProperty(inherited, field, { value: "inherited", configurable: true })).toBe(true);
        try { return look(); } finally { Reflect.deleteProperty(inherited, field); }
      }
      test("planted", () => {
        console.log(readWhileInherited("__proto__", "first", () => read({}, "first")), read({}, "first"));
        console.log(readWhileInherited("__proto__", "second", () => read([], "second")), read([], "second"));
      });`,
  });
});

test("toString, valueOf and toJSON are replaced, for calls that spell them and for conversions that do not", async () => {
  await expectCompiledToRunAsPlain({
    "uses.ts": `
      export const box = { n: 0 };
      class Own { toString() { return "own"; } }
      export function spelled(bytes: Buffer, date: Date, list: number[], error: Error, pattern: RegExp, n: number, f: () => void) {
        const before = box.n;
        const answers = [bytes.toString("latin1"), bytes.toString(), typeof date.toString(), list.toString(), error.toString(), pattern.toString(), n.toString(16), typeof f.toString(), ({}).toString(), date.valueOf(), date.toJSON()];
        return [box.n - before, ...answers];
      }
      export function converted(bytes: Buffer, date: Date, list: number[], error: Error, pattern: RegExp, n: number, boxed: Number, plain: object) {
        const before = box.n;
        const answers = [\`\${bytes}\`, typeof String(date), list + "", "" + error, [pattern, list].join("|"), \`\${n}\`, boxed + "", +boxed, String(plain), \`\${new Own()}\`, +date, date > new Date(-1), plain == "x"];
        return [box.n - before, ...answers];
      }
      export function written(date: Date, plain: { a: number }, list: unknown[], map: Map<string, number>) {
        const before = box.n;
        const answers = [JSON.stringify(date), JSON.stringify(plain), JSON.stringify(list), JSON.stringify({ date, plain, map }), JSON.stringify(1), JSON.stringify("a")];
        return [box.n - before, ...answers];
      }
      export function ofItsOwn() {
        const before = box.n;
        const answers = [\`\${[1, 2]}\`, \`\${Buffer.from("ab")}\`, JSON.stringify({ a: 1 }), String({}), \`\${new Date(0).valueOf()}\`, JSON.stringify([new Date(0)])];
        return [box.n - before, ...answers];
      }`,
    "one.test.ts": `
      import { spyOn, test } from "bun:test";
      import { box, converted, ofItsOwn, spelled, written } from "./uses";
      function count(holder: any, name: string) {
        const original = holder[name];
        holder[name] = function (this: unknown, ...operands: unknown[]) { box.n++; return Reflect.apply(original, this, operands); };
        return () => { holder[name] = original; };
      }
      const uses = () => {
        const operands = [Buffer.from("abc"), new Date(0), [1, 2], new Error("e"), /p/g, 255] as const;
        console.log(JSON.stringify(spelled(...operands, () => {})));
        console.log(JSON.stringify(converted(...operands, new Number(7), { a: 1 })));
        console.log(JSON.stringify(written(new Date(0), { a: 1 }, [1, new Date(0), { a: 2 }], new Map())), JSON.stringify(ofItsOwn()));
      };
      test("counted", () => {
        uses();
        const restore = [
          count(Buffer.prototype, "toString"), count(Date.prototype, "toString"), count(Array.prototype, "toString"), count(Error.prototype, "toString"),
          count(RegExp.prototype, "toString"), count(Number.prototype, "toString"), count(Function.prototype, "toString"), count(Object.prototype, "toString"),
          count(Date.prototype, "valueOf"), count(Number.prototype, "valueOf"), count(Object.prototype, "valueOf"), count(Date.prototype, "toJSON"),
        ];
        uses();
        for (const undo of restore) undo();
        uses();
      });
      test("spied on", () => {
        using made = spyOn(Buffer.prototype as Buffer, "toString");
        uses();
        console.log(made.mock.calls.length, JSON.stringify(made.mock.calls[0]));
      });
      `,
  });
});

// Each member alone in its run: a second replaced member of these names turns JSON.stringify into a plain call and hides the fault, and so
// does console.log(), which brings in library code that asks dates for these names. So the tests inside say what they expect.
// An import() of a name that the build cannot know takes another way through the build, so each is run with and without one.
for (const [member, replacement, written] of [
  ["toJSON", `() => "replaced"`, `["replaced"]{"at":"replaced"}"replaced"`],
  ["toISOString", `() => "replaced"`, `["replaced"]{"at":"replaced"}"replaced"`],
  ["valueOf", `() => NaN`, `[null]{"at":null}null`],
]) {
  for (const loadsUnknownName of [false, true]) {
    test(`JSON.stringify of a date calls a replaced Date.prototype.${member}${loadsUnknownName ? ", beside an import() of an unknown name" : ""}`, async () => {
      await expectCompiledToRunAsPlain({
        "one.test.ts": `
          import { expect, spyOn, test } from "bun:test";
          test("replaced", () => {
            const real = Date.prototype.${member};
            Date.prototype.${member} = (${replacement}) as any;
            let written;
            try {
              written = JSON.stringify([new Date(0)]) + JSON.stringify({ at: new Date(0) }) + JSON.stringify(new Date(0));
            } finally {
              Date.prototype.${member} = real;
            }
            expect(written).toBe(${JSON.stringify(written)});
          });
          test("spied on", () => {
            using spy = spyOn(Date.prototype, "${member}");
            expect(JSON.stringify([new Date(0)])).toBe('["1970-01-01T00:00:00.000Z"]');
            expect(spy).toHaveBeenCalledTimes(1);
          });`,
        "two.test.ts": `import { test } from "bun:test"; test("second", () => {});`,
        ...(loadsUnknownName && {
          "other.ts": `export const value = 1;`,
          "three.test.ts": `
            import { expect, test } from "bun:test";
            test("loads", async () => { expect((await import(process.env.A_NAME_NOBODY_SETS ?? "./other.ts")).value).toBe(1); });`,
        }),
      });
    });
  }
}

// `await` of a promise of the language does not read `then`; what resolves a promise with another, `catch`, `finally` and the functions of Promise that take a list do.
test("a test adds toJSON to Object.prototype, for everything that converts to JSON", async () => {
  await expectCompiledToRunAsPlain({
    "uses.ts": `// Every way this program converts something to JSON. Typed and untyped, so that compiled code has shapes to rely on.
export type Point = { x: number; y: number };
export type Row = { id: number; name: string; tags: string[]; at: Point; more?: Row };
export class Pair {
  constructor(
    public left: number,
    public right: string,
  ) {}
}
export class WithOwn {
  constructor(public n: number) {}
  toJSON() {
    return { own: this.n };
  }
}
const point = (x: number): Point => ({ x, y: x + 1 });
const row = (id: number): Row => ({ id, name: "r" + id, tags: ["a", "b"], at: point(id) });
const alias = JSON.stringify;
function attempt(make: () => unknown): string {
  try {
    return String(make());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
export const uses: Record<string, () => string> = {
  "a typed point": () => attempt(() => JSON.stringify(point(1))),
  "a typed row": () => attempt(() => JSON.stringify(row(2))),
  "a row in a row": () => attempt(() => JSON.stringify({ ...row(3), more: row(4) } satisfies Row)),
  "a list of points": () => attempt(() => JSON.stringify([point(1), point(2)])),
  "a list of numbers": () => attempt(() => JSON.stringify([1, 2, 3])),
  "an empty object": () => attempt(() => JSON.stringify({})),
  "an untyped object": () => attempt(() => JSON.stringify(JSON.parse('{"p":1,"q":[{"r":2}]}'))),
  "an instance": () => attempt(() => JSON.stringify(new Pair(1, "b"))),
  "an instance with its own toJSON": () => attempt(() => JSON.stringify(new WithOwn(5))),
  "an object with an own toJSON": () => attempt(() => JSON.stringify({ a: 1, toJSON: () => "mine" })),
  "an object without a prototype": () => attempt(() => JSON.stringify(Object.assign(Object.create(null), { a: 1 }))),
  "one without a prototype that holds an object": () => attempt(() => JSON.stringify(Object.assign(Object.create(null), { a: { b: 1 } }))),
  "a date": () => attempt(() => JSON.stringify(new Date(0))),
  "a map": () => attempt(() => JSON.stringify(new Map([[1, 2]]))),
  "a set in an object": () => attempt(() => JSON.stringify({ s: new Set([1]) })),
  "a function": () => attempt(() => JSON.stringify(function f() {})),
  "a function in an object": () => attempt(() => JSON.stringify({ f() {} })),
  "a bigint": () => attempt(() => JSON.stringify(1n)),
  "a bigint in a list": () => attempt(() => JSON.stringify([1n])),
  "a number": () => attempt(() => JSON.stringify(1.5)),
  "a text": () => attempt(() => JSON.stringify("t")),
  "a boolean, null, undefined, a symbol": () => attempt(() => [JSON.stringify(true), JSON.stringify(null), JSON.stringify(undefined), JSON.stringify(Symbol("s"))].join()),
  "boxed values": () => attempt(() => JSON.stringify([new Number(1), new String("s"), new Boolean(false)])),
  "an error": () => attempt(() => JSON.stringify(new Error("e"))),
  "a regular expression": () => attempt(() => JSON.stringify(/x/)),
  "bytes": () => attempt(() => JSON.stringify(new Uint8Array([1, 2]))),
  "a buffer": () => attempt(() => JSON.stringify(Buffer.from("a"))),
  "a URL": () => attempt(() => JSON.stringify(new URL("http://a/b"))),
  "with an indent": () => attempt(() => JSON.stringify(row(5), null, 2)),
  "with a list of keys": () => attempt(() => JSON.stringify(row(6), ["id", "at", "x"])),
  "with a function that replaces": () => attempt(() => JSON.stringify(row(7), (key, value) => (key === "tags" ? undefined : value))),
  "by another name": () => attempt(() => alias(point(8))),
  "by call": () => attempt(() => JSON.stringify.call(null, point(9))),
  "by Reflect.apply": () => attempt(() => Reflect.apply(JSON.stringify, null, [point(10)])),
  "under a computed key": () => attempt(() => (JSON as any)["string" + "ify"](point(11))),
  "in a loop": () =>
    attempt(() => {
      let length = 0;
      for (let i = 0; i < 2000; i++) length += JSON.stringify(point(i)).length;
      return length;
    }),
  "as a callback": () => attempt(() => [point(1), point(2)].map(value => JSON.stringify(value)).join("|")),
  "handed on as a callback": () => attempt(() => [point(1)].map(JSON.stringify as (value: Point) => string).join("|")),
  "in a template": () => attempt(() => \`\${JSON.stringify(point(12))}!\`),
  "the key that toJSON is told": () => attempt(() => JSON.stringify({ k: point(13), list: [point(14)] })),
};
export const later: Record<string, () => Promise<string>> = {
  "Response.json": async () => await Response.json(row(20)).text(),
  "Response.json of a list": async () => await Response.json([point(21)]).text(),
};
`,
    "tojson.test.ts": `import { expect, spyOn, test } from "bun:test";
import { later, uses } from "./uses";

async function all(title: string) {
  for (const [name, use] of Object.entries(uses)) console.log(title, "|", name, "|", use());
  for (const [name, use] of Object.entries(later)) console.log(title, "|", name, "|", await use());
}
test("before", () => all("before"));
test("a toJSON defined on Object.prototype", async () => {
  let calls = 0;
  Object.defineProperty(Object.prototype, "toJSON", {
    value(this: unknown, key: string) {
      calls++;
      return "J:" + key + ":" + typeof this;
    },
    configurable: true,
  });
  try {
    await all("defined");
  } finally {
    delete (Object.prototype as { toJSON?: unknown }).toJSON;
  }
  console.log("calls", calls);
});
test("after", () => all("after"));
test("assigned, and one that answers its own receiver", async () => {
  (Object.prototype as any).toJSON = function () {
    return this;
  };
  try {
    await all("assigned");
    console.log("in", "toJSON" in {}, Object.keys({ a: 1 }).join(), Object.hasOwn({}, "toJSON"));
    const names: string[] = [];
    for (const name in { a: 1 }) names.push(name);
    console.log("for in", names.join());
  } finally {
    delete (Object.prototype as any).toJSON;
  }
});
test("what is no function is not called", async () => {
  (Object.prototype as any).toJSON = 5;
  try {
    await all("a number");
  } finally {
    delete (Object.prototype as any).toJSON;
  }
});
test("once more after", () => all("once more"));
`,
  });
});

test("Promise.prototype.then is replaced, for calls that spell it and for what the language and Promise call by themselves", async () => {
  await expectCompiledToRunAsPlain({
    "other.ts": `export const value = 14;`,
    "uses.ts": `
export const box = { n: 0 };
const thenable = (value: number) => ({ then(resolve: (value: number) => void) { resolve(value); } });
async function answer(value: number) { return value; }
async function answerOfPromise(value: number) { return Promise.resolve(value); }
async function answerOfThenable(value: number) { return thenable(value); }
async function* steps() { yield 1; yield Promise.resolve(2); return 3; }
class Heir<T> extends Promise<T> {}
export const uses: Record<string, () => Promise<unknown>> = {
  async awaitNative() { return await Promise.resolve(1); },
  async awaitThenable() { return await thenable(2); },
  async awaitValue() { return await 3; },
  async awaitAsyncCall() { return await answer(4); },
  async resultIsPromise() { return await answerOfPromise(5); },
  async resultIsThenable() { return await answerOfThenable(5); },
  async returnsPromiseWithoutAwait() { return Promise.resolve(5); },
  async resolveOfPromise() { const p = Promise.resolve(6); return [await Promise.resolve(p), Promise.resolve(p) === p]; },
  async resolveOfThenable() { return await Promise.resolve(thenable(6)); },
  async resolvedWithPromise() { return await new Promise(resolve => resolve(Promise.resolve(7))); },
  async resolvedWithThenable() { return await new Promise(resolve => resolve(thenable(7))); },
  async spelled() { return await Promise.resolve(8).then(value => value + 1); },
  async spelledWithTwo() { return await Promise.reject(new Error("e")).then(undefined, error => error.message); },
  async spelledOnUnknown() { const p: any = [Promise.resolve(8)][0]; return await p.then((value: number) => value + 2); },
  async spelledByKey() { const key = ["th", "en"].join(""); return await (Promise.resolve(8) as any)[key]((value: number) => value + 3); },
  async thenReturnsPromise() { return await Promise.resolve(1).then(() => Promise.resolve(12)); },
  async caught() { return await Promise.reject(new Error("c")).catch(error => error.message); },
  async finallyRuns() { let ran = 0; const value = await Promise.resolve(9).finally(() => { ran++; }); return [value, ran]; },
  async all() { return await Promise.all([Promise.resolve(1), 2, thenable(3)]); },
  async allOfNothing() { return await Promise.all([]); },
  async race() { return await Promise.race([Promise.resolve(1), Promise.resolve(2)]); },
  async any() { return await Promise.any([Promise.reject(new Error("no")), Promise.resolve(2)]); },
  async allSettled() { return (await Promise.allSettled([Promise.resolve(1), Promise.reject(new Error("no"))])).map(result => result.status); },
  async forAwaitOfList() { const seen = []; for await (const value of [Promise.resolve(1), 2, thenable(3)]) seen.push(value); return seen; },
  async forAwaitOfGenerator() { const seen = []; for await (const value of steps()) seen.push(value); return seen; },
  async generatorNext() { const generator = steps(); return [await generator.next(), await generator.next(), await generator.next(), await generator.next()]; },
  async generatorReturn() { const generator = steps(); await generator.next(); return await generator.return(Promise.resolve(9) as any); },
  async imported() { const module = await import("./other"); return module.value; },
  async withResolvers() { const { promise, resolve } = Promise.withResolvers<number>(); resolve(Promise.resolve(10) as any); return await promise; },
  async heir() { return [await Heir.resolve(11), await new Heir(resolve => resolve(12)), await Heir.resolve(1).then(value => value + 1)]; },
  async awaitHeir() { const heir = Heir.resolve(13); return await heir; },
  async tried() { return await (Promise as any).try(() => 13); },
  async ownThen() { const p: any = Promise.resolve(1); p.then = (resolve: (value: number) => void) => resolve(15); return await p; },
  async timer() { return await new Promise(resolve => setTimeout(() => resolve(16), 1)); },
  async microtask() { return await new Promise(resolve => queueMicrotask(() => resolve(17))); },
  async bunSleep() { await Bun.sleep(1); return 18; },
  async fromAsync() { return await (Array as any).fromAsync([Promise.resolve(1), 2]); },
  async nested() { return await (async () => await (async () => await Promise.resolve(19))())(); },
  async inTryFinally() { try { return await Promise.resolve(20); } finally { await Promise.resolve(0); } },
  async rejectedAwait() { try { await Promise.reject(new Error("r")); } catch (error) { return (error as Error).message; } },
};
export async function run(label: string) {
  for (const [name, use] of Object.entries(uses)) {
    const before = box.n;
    let result: unknown;
    try {
      result = await use();
    } catch (error) {
      result = "threw " + String(error);
    }
    console.log(label, name, box.n - before, JSON.stringify(result));
  }
}
`,
    "typed.ts": `
import { box } from "./uses";
interface Thenable { then(resolve: (value: number) => void): void }
export async function awaitTyped(p: Promise<number>) { return await p; }
export async function returnTyped(p: Promise<number>) { return p; }
export function thenTyped(p: Promise<number>) { return p.then(value => value + 1); }
export function thenTwoTyped(p: Promise<number>) { return p.then(value => value + 1, () => -1); }
export function catchTyped(p: Promise<number>) { return p.catch(() => -1); }
export function finallyTyped(p: Promise<number>) { return p.finally(() => {}); }
export function allTyped(list: Promise<number>[]) { return Promise.all(list); }
export function raceTyped(list: Promise<number>[]) { return Promise.race(list); }
export function resolveTyped(p: Promise<number>) { return Promise.resolve(p); }
export function wrapTyped(p: Promise<number>) { return new Promise<number>(resolve => resolve(p)); }
export async function awaitThenableTyped(t: Thenable) { return await t; }
export async function awaitEither(v: number | Promise<number>) { return await v; }
export async function loopTyped(list: Promise<number>[]) { let sum = 0; for (const p of list) sum += await p; return sum; }
export async function forAwaitTyped(list: Promise<number>[]) { let sum = 0; for await (const value of list) sum += value; return sum; }
export function chainTyped(p: Promise<number>) { return p.then(a => a + 1).then(b => b + 1).catch(() => 0).finally(() => {}); }
export function readTyped(p: Promise<number>) { const then = p.then; return typeof then === "function" && then === Promise.prototype.then; }
export function callTyped(p: Promise<number>) { return Promise.prototype.then.call(p, (value: number) => value + 5); }
export function applyTyped(p: Promise<number>) { return Reflect.apply(Promise.prototype.then, p, [(value: number) => value + 6]); }
export class Holder { constructor(public p: Promise<number>) {} async get() { return await this.p; } next() { return this.p.then(value => value * 2); } }
export async function runTyped(label: string) {
  const make = () => Promise.resolve(1);
  const rows: [string, () => unknown][] = [
    ["awaitTyped", () => awaitTyped(make())], ["returnTyped", () => returnTyped(make())], ["thenTyped", () => thenTyped(make())], ["thenTwoTyped", () => thenTwoTyped(make())],
    ["catchTyped", () => catchTyped(make())], ["finallyTyped", () => finallyTyped(make())], ["allTyped", () => allTyped([make(), make()])], ["raceTyped", () => raceTyped([make(), make()])],
    ["resolveTyped", () => resolveTyped(make())], ["wrapTyped", () => wrapTyped(make())], ["awaitThenableTyped", () => awaitThenableTyped({ then(resolve) { resolve(2); } })],
    ["awaitEitherValue", () => awaitEither(3)], ["awaitEitherPromise", () => awaitEither(make())], ["loopTyped", () => loopTyped([make(), make()])], ["forAwaitTyped", () => forAwaitTyped([make(), make()])],
    ["chainTyped", () => chainTyped(make())], ["readTyped", () => readTyped(make())], ["callTyped", () => callTyped(make())], ["applyTyped", () => applyTyped(make())],
    ["holderGet", () => new Holder(make()).get()], ["holderNext", () => new Holder(make()).next()],
  ];
  for (const [name, use] of rows) {
    const before = box.n;
    const result = await use();
    console.log(label, name, box.n - before, JSON.stringify(result));
  }
}
`,
    "one.test.ts": `
import { spyOn, test } from "bun:test";
import { box, run } from "./uses";
import { runTyped } from "./typed";
const counting = (original: typeof Promise.prototype.then) =>
  function (this: unknown, ...operands: unknown[]) { box.n++; return Reflect.apply(original, this, operands); } as typeof original;
test("counted", async () => {
  await run("before");
  await runTyped("before");
  const original = Promise.prototype.then;
  Promise.prototype.then = counting(original);
  try {
    await run("replaced");
    await runTyped("replaced");
  } finally {
    Promise.prototype.then = original;
  }
  await run("after");
  await runTyped("after");
});
test("spied on", async () => {
  using spy = spyOn(Promise.prototype, "then");
  await run("spied");
  await runTyped("spied");
  console.log("calls", spy.mock.calls.length);
});
test("text that is handed over assigns it", async () => {
  (globalThis as any).box = box;
  const original = Promise.prototype.then;
  try {
    (0, eval)("const original = Promise.prototype.then; Promise.prototype.then = function (...operands) { box.n++; return Reflect.apply(original, this, operands); };");
    await run("by text");
  } finally {
    Promise.prototype.then = original;
  }
});
test("what the replacement answers is what the caller gets", () => {
  const original = Promise.prototype.then;
  Promise.prototype.then = function () { return "not a promise"; } as unknown as typeof original;
  let answers: unknown[];
  try {
    const p = Promise.resolve(1);
    answers = [p.then(() => 1), p.catch(() => 1), typeof p.finally(() => {})];
  } finally {
    Promise.prototype.then = original;
  }
  console.log("answers", JSON.stringify(answers));
});
`,
  });
});

test("the object and the name come out of lists, loops, parameters and test.each", async () => {
  await expectCompiledToRunAsPlain({
    "uses.ts": `
      export function numbers(x: number) { return [Math.ceil(x), Math.round(x), Math.sqrt(x), Math.cbrt(x), Math.hypot(x, x), Math.sin(x), Math.exp(x), Math.log2(x)]; }
      export function others(list: number[]) { return [Object.keys({ a: 1 }).length, Date.UTC(2000, 0), list.push(1), Atomics.load(new Int32Array(1), 0)]; }
      export function said(text: string) { console.log(text); console.info(text); }
      export function later(run: () => void) { return typeof setTimeout(run, 0); }`,
    "helpers/timers.ts": `
      import { spyOn } from "bun:test";
      export function stopTimers() {
        const spies = [];
        for (const name of ["setTimeout", "setInterval"] as const) {
          spies.push(spyOn(globalThis as unknown as Record<string, () => unknown>, name).mockImplementation(() => "stopped"));
        }
        return spies;
      }
      export class Quiet {
        originals: Record<string, unknown> = {};
        install(seen: string[]) {
          const con: any = console;
          for (const m of LIST) { this.originals[m] = con[m]; con[m] = (text: string) => { seen.push(m + ":" + text); }; }
        }
        remove() { const con: any = console; for (const m of LIST) con[m] = this.originals[m]; }
      }
      const LIST = ["log", "info"];`,
    "one.test.ts": `
      import { afterEach, mock, spyOn, test } from "bun:test";
      import { later, numbers, others, said } from "./uses";
      import { Quiet, stopTimers } from "./helpers/timers";
      afterEach(() => { mock.restore(); });
      const show = () => console.log(JSON.stringify(numbers(4)), JSON.stringify(others([])));
      test("loops", () => {
        for (const name of ["ceil", "round"] as const) spyOn(Math, name).mockReturnValue(-1);
        for (const holder of [Math, Number]) if ("hypot" in holder) spyOn(holder as typeof Math, "hypot").mockReturnValue(-2);
        const sin = Math.sin;
        for (const name of ["sin"] as const) Math[name] = () => -3;
        show();
        Math.sin = sin;
      });
      test("parameters", () => {
        ((holder: typeof Math) => spyOn(holder, "sqrt").mockReturnValue(-4))(Math);
        ((name: "cbrt") => spyOn(Math, name).mockReturnValue(-5))("cbrt");
        const check = (holder: any, name: string) => spyOn(holder, name).mockReturnValue(-6);
        check(Object, "keys"); check(Date, "UTC"); check(Array.prototype, "push");
        console.log(JSON.stringify(numbers(4)), Date.UTC(2000, 0), [].push(1));
      });
      test.each(["exp", "log2"] as const)("each %s", name => { spyOn(Math, name).mockReturnValue(-7); show(); });
      test("every member", () => {
        for (const name of Object.getOwnPropertyNames(Atomics)) if (typeof (Atomics as any)[name] === "function") spyOn(Atomics as any, name).mockReturnValue(-8);
        show();
      });
      test("in a helper", () => {
        const spies = stopTimers();
        console.log(later(() => {}), spies[0].mock.calls.length);
        const seen: string[] = [], quiet = new Quiet();
        quiet.install(seen);
        said("hidden");
        quiet.remove();
        said("shown");
        console.log(seen);
      });
      test("restored", show);`,
  });
});

// Each by itself: another replaced member, or a module that is opened, hides it.
test.each(["toJSON", "toISOString"])(
  "JSON.stringify asks a date for a replaced %s, with nothing else replaced in the run",
  async name => {
    await expectCompiledToRunAsPlain({
      "one.test.ts": `
      import { test } from "bun:test";
      test("replaced", () => {
        const real = Date.prototype.${name};
        Date.prototype.${name} = () => "replaced";
        console.log(JSON.stringify(new Date(0)), JSON.stringify([new Date(0)]), JSON.stringify({ at: new Date(0) }));
        Date.prototype.${name} = real;
        console.log(JSON.stringify(new Date(0)), JSON.stringify([new Date(0)]), JSON.stringify({ at: new Date(0) }));
      });`,
    });
  },
);

test.each(["fill", "map"])("a list that is made and filled in one expression calls a replaced %s", async name => {
  await expectCompiledToRunAsPlain({
    "uses.ts": `
      export function made(size: number) {
        return [new Array(2).fill(1), Array(2).fill(1), new Array(size).fill(1), new Array(2).fill(0).map((item, index) => item + index), [0, 0].fill(7)];
      }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { made } from "./uses";
      test("replaced", () => {
        let calls = 0;
        const real: any = Array.prototype.${name};
        console.log(JSON.stringify(made(3)), calls);
        (Array.prototype as any).${name} = function (...given: unknown[]) { calls++; return Reflect.apply(real, this, given); };
        console.log(JSON.stringify(made(3)), JSON.stringify(new Array(2).fill(1).map(item => item)), calls);
        Array.prototype.${name} = real;
        console.log(JSON.stringify(made(3)), calls);
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
      function plant(name: string, value: string) {
        Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true, enumerable: true });
        return () => { Reflect.deleteProperty(Object.prototype, name); };
      }
      test("stubbed", () => {
        const restore = [stub(String.prototype, "indexOf", () => 5), ...stubRows()];
        (Object.prototype as any).polluted = "yes";
        const unplant = plant("planted", "too");
        console.log(find("abc", "c"), joined(["a", "b"]), fold("e"), ({} as any).polluted, ({} as any).planted);
        for (const undo of restore) undo();
        delete (Object.prototype as any).polluted;
        unplant();
        console.log(find("abc", "c"), joined(["a", "b"]), fold("e"), ({} as any).polluted, ({} as any).planted);
      });`,
  });
  const plain = await runTests(String(dir));
  expect(plain.stdout).toContain("5 row row yes too\n2 a-b e undefined undefined");
  const logs = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
  const logged = await run([bunExe(), "test", "--timeout=60000", "--aot"], String(dir), logs);
  expect(logged.stdout).toContain("5 row row yes too\n2 a-b e undefined undefined");
  expect(logged.stderr).not.toContain("AOT build starts over | replaced built-ins added");
  expect(logged.stderr).not.toContain("AOT build starts over | names opened");
});

test("a Worker's file marks a list of objects under one key", async () => {
  await expectCompiledToRunAsPlain({
    "helpers/worker.ts": `
      const MARK = "__planted";
      function places(): [string, object][] {
        return [["Object.prototype", Object.prototype], ["Array.prototype", Array.prototype], ["Function.prototype", Function.prototype], ["parsed", JSON.parse("{}")]];
      }
      for (const [, place] of places()) Reflect.set(place, MARK, "here");
      postMessage([({} as any)[MARK], ([] as any)[MARK], (() => 1 as any)[MARK as any], Object.keys(Object.prototype)]);`,
    "start.ts": `
      export function start(options: { url: URL }): Promise<unknown> {
        const worker = new Worker(options.url);
        return new Promise(resolve => { worker.onmessage = event => { resolve(event.data); worker.terminate(); }; worker.onerror = event => resolve(event.message); });
      }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { start } from "./start";
      test("marked", async () => {
        console.log(await start({ url: new URL("./helpers/worker.ts", import.meta.url) }), ({} as any).__planted);
      });`,
  });
});

// Object.prototype is locked by a list of names in a test run. The engine took that for "not locked" and, at the first Proxy under a prototype object,
// gave every array of the realm slow storage, which compiled code does not look for in an array that it has followed: it read an empty value and crashed.
test("a Proxy becomes the prototype of a prototype object, and the arrays of compiled code stay as they are", async () => {
  await expectCompiledToRunAsPlain({
    "table.ts": `
      const rows = [{ name: "a", size: 1 }, { name: "b", size: 2 }, { name: "c", size: 3 }];
      const numbers = [1, 2, 3, 4];
      export function total(): number { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i]!.size + numbers[i]!; return sum; }
      export function names(): string { return rows.map(row => row.name).join(); }
      export function column(key: "name" | "size"): unknown[] { const cells = []; for (let i = 0; i < rows.length; i++) cells.push(rows[i]![key]); return cells; }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { column, names, total } from "./table";
      test("read", () => {
        console.log(total(), names());
        class Below {}
        Object.setPrototypeOf(Below.prototype, new Proxy(Error.prototype, {}));
        console.log(total(), names(), column("name"), column("size"), new Below() instanceof Error, [1, 2, 3].map(n => n * 2), [, 1][0]);
      });
      test("with a name added", () => {
        (Object.prototype as any).polluted = 1;
        class Other {}
        Object.setPrototypeOf(Other.prototype, new Proxy({}, {}));
        console.log(total(), names(), ({} as any).polluted);
        delete (Object.prototype as any).polluted;
      });`,
  });
});

// The same, as it was found: the element that compiled code read was empty, and it took it for a cell (SIGSEGV at 0x0).
test("a table of descriptors is read behind a Proxy that became the prototype of a prototype object", async () => {
  await expectCompiledToRunAsPlain({
    "walk2.ts": `
      function withoutPrototype<T extends object>(value: T): T {
        return Object.setPrototypeOf(value, null);
      }
      export function descriptorTable(holder: object): PropertyDescriptorMap {
        const table: PropertyDescriptorMap = withoutPrototype(Object.getOwnPropertyDescriptors(holder));
        const keys = Reflect.ownKeys(table);
        for (let i = 0; i < keys.length; i++) Object.freeze(withoutPrototype(table[keys[i] as string]!));
        return Object.freeze(table);
      }
      const TABLES = [descriptorTable(DOMException.prototype), descriptorTable(ResolveMessage.prototype), descriptorTable(BuildMessage.prototype)];
      function text(value: object, key: "name" | "message"): string | undefined {
        for (let owner: object | null = value; owner; owner = Reflect.getPrototypeOf(owner)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(owner, key);
          if (descriptor && Object.hasOwn(descriptor, "value")) return typeof descriptor.value === "string" ? descriptor.value : undefined;
        }
        for (let i = 0; i < TABLES.length; i++) {
          try {
            const found: unknown = Reflect.apply(TABLES[i]![key]!.get!, value, []);
            if (typeof found === "string") return found;
          } catch {}
        }
        return undefined;
      }
      export function copy(value: unknown) {
        if (typeof value !== "object" || value === null) return { name: undefined, message: String(value) };
        return { name: text(value, "name"), message: text(value, "message") };
      }`,
    "walk2.test.ts": `
      import { expect, test } from "bun:test";
      import { copy } from "./walk2.ts";
      function behindProxy(target: object, asked: string[]): object {
        return new Proxy(target, new Proxy({}, { get(_handler, trap) { asked.push(String(trap)); return undefined; } }));
      }
      test("the text of errors whose prototypes are proxies", () => {
        const asked: string[] = [];
        class Made {}
        Object.setPrototypeOf(Made.prototype, behindProxy(Error.prototype, asked));
        const thrown = [
          Object.setPrototypeOf(behindProxy(TypeError.prototype, asked), behindProxy(DOMException.prototype, asked)),
          new Made(),
          new DOMException("gone", "AbortError"),
          Object.setPrototypeOf(new DOMException("gone", "AbortError"), null),
        ];
        expect(thrown.map(copy).map(c => c.name + ":" + c.message)).toEqual(["TypeError:", "Error:", "Error:", "AbortError:gone"]);
      });`,
  });
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

test("Function.prototype.call, Function.prototype.apply and Reflect.apply are replaced, for every call that spells them and for no other", async () => {
  await expectCompiledToRunAsPlain({
    "tsconfig.json": "{}",
    "app.ts": `export function add(this: unknown, a: number, b: number): number { return a + b; }
export function whose(this: { name: string }, greeting: string): string { return greeting + " " + this.name; }
export const twice = (x: number): number => x * 2;
export function called(): number { return add.call(undefined, 1, 2); }
export function calledThis(): string { return whose.call({ name: "a" }, "hello"); }
export function calledUntyped(f: any, ...rest: any[]) { return f.call(...rest); }
export function calledArrow(): number { return twice.call(null, 4); }
export function calledNative(): number { return Math.max.call(Math, 3, 9); }
export function applied(): number { return add.apply(undefined, [3, 4]); }
export function appliedList(list: [number, number]): number { return add.apply(undefined, list); }
export function appliedUntyped(f: any, self: any, list: any) { return f.apply(self, list); }
export function appliedArguments(this: unknown, _a?: number, _b?: number): number { return add.apply(this, arguments as unknown as [number, number]); }
export function appliedNative(list: number[]): number { return Math.max.apply(null, list); }
export function pushed(list: number[], more: number[]): number { return Array.prototype.push.apply(list, more); }
export function sliced(this: unknown, ..._rest: number[]): string { return Array.prototype.slice.call(arguments, 1).join(); }
export function owns(object: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); }
export function tag(value: unknown): string { return Object.prototype.toString.call(value); }
export function reflected(list: [number, number]): number { return Reflect.apply(add, undefined, list); }
export function reflectedUntyped(f: any, self: any, list: any) { return Reflect.apply(f, self, list); }
export function spread(list: [number, number]): number { return add(...list); }
export function callOfCall(): number { return Function.prototype.call.call(add, undefined, 5, 6); }
export function applyOfCall(): number { return Function.prototype.call.apply(add, [undefined, 6, 7]); }
export function callOfApply(): number { return Function.prototype.apply.call(add, undefined, [7, 8]); }
export const uncurried = Function.prototype.call.bind(Array.prototype.join) as (list: unknown[], separator: string) => string;
export function Parent(this: any, a: number) { this.a = a; }
export function Child(this: any, a: number, b: number) { Parent.call(this, a); this.b = b; }
export function made(): string { return JSON.stringify(new (Child as any)(1, 2)); }
export function last(list: number[]): number { return tail.apply(undefined, list as [number, number]); }
function tail(a: number, b: number): number { return a * b; }
export function hotCall(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += add.call(undefined, i & 1, 1); return sum; }
export function hotApply(n: number): number { let sum = 0; const list: [number, number] = [1, 1]; for (let i = 0; i < n; i++) sum += add.apply(undefined, list); return sum; }
export class Shape { constructor(public sides: number) {} area(this: Shape, scale: number): number { return this.sides * scale; } }
export function method(shape: Shape): number { return shape.area.call(shape, 2) + Shape.prototype.area.apply(shape, [3]); }
`,
    "one.test.ts": `import { spyOn, test } from "bun:test";
import * as app from "./app";

const uses: [string, () => unknown][] = [
  ["called", () => app.called()],
  ["calledThis", () => app.calledThis()],
  ["calledUntyped", () => app.calledUntyped(app.add, undefined, 3, 4)],
  ["calledArrow", () => app.calledArrow()],
  ["calledNative", () => app.calledNative()],
  ["applied", () => app.applied()],
  ["appliedList", () => app.appliedList([4, 5])],
  ["appliedUntyped", () => app.appliedUntyped(app.add, undefined, [5, 6])],
  ["appliedArguments", () => app.appliedArguments(6, 7)],
  ["appliedNative", () => app.appliedNative([1, 8, 2])],
  ["pushed", () => app.pushed([1], [2, 3])],
  ["sliced", () => app.sliced(1, 2, 3)],
  ["owns", () => app.owns({ a: 1 }, "a")],
  ["tag", () => app.tag([])],
  ["reflected", () => app.reflected([8, 9])],
  ["reflectedUntyped", () => app.reflectedUntyped(app.add, undefined, [9, 10])],
  ["spread", () => app.spread([10, 11])],
  ["callOfCall", () => app.callOfCall()],
  ["applyOfCall", () => app.applyOfCall()],
  ["callOfApply", () => app.callOfApply()],
  ["uncurried", () => app.uncurried([1, 2], "+")],
  ["made", () => app.made()],
  ["last", () => app.last([3, 4])],
  ["method", () => app.method(new app.Shape(4))],
  ["hotCall", () => app.hotCall(3)],
  ["hotApply", () => app.hotApply(3)],
  ["here", () => app.add.call(undefined, 20, 1) + app.add.apply(undefined, [20, 2]) + Reflect.apply(app.add, undefined, [20, 3])],
];
let calls = 0;
function phase(name: string) {
  const lines: string[] = [];
  for (let index = 0; index < uses.length; index++) {
    const before = calls;
    const answer = uses[index][1]();
    const seen = calls - before;
    lines[lines.length] = uses[index][0] + ": " + answer + " (" + seen + ")";
  }
  return name + "\\n  " + lines.join("\\n  ");
}
const reflectApply = Reflect.apply;
function during(holder: any, name: string, replacement: Function) {
  const said = [phase("before " + name)];
  const original = holder[name];
  holder[name] = replacement;
  try { said[1] = phase("replaced " + name); } finally { holder[name] = original; }
  said[2] = phase("restored " + name);
  console.log(said.join("\\n"));
}
test("call", () => during(Function.prototype, "call", function (this: Function, self: unknown, ...rest: unknown[]) { calls++; return reflectApply(this, self, rest); }));
test("apply", () => during(Function.prototype, "apply", function (this: Function, self: unknown, list: unknown[]) { calls++; return reflectApply(this, self, list ?? []); }));
test("Reflect.apply", () => during(Reflect, "apply", function (f: Function, self: unknown, list: unknown[]) { calls++; return reflectApply(f, self, list); }));
test("loops that have run many times", () => {
  const said = [app.hotCall(200_000), app.hotApply(200_000)];
  const call = Function.prototype.call, apply = Function.prototype.apply;
  const before = calls;
  Function.prototype.call = function (this: Function, self: unknown, ...rest: unknown[]) { calls++; return reflectApply(this, self, rest); };
  Function.prototype.apply = function (this: Function, self: unknown, list: unknown[]) { calls++; return reflectApply(this, self, list ?? []); };
  try { said[2] = app.hotCall(1_000); said[3] = app.hotApply(1_000); } finally { Function.prototype.call = call; Function.prototype.apply = apply; }
  said[4] = calls - before;
  const after = calls;
  said[5] = app.hotCall(1_000); said[6] = calls - after;
  console.log(said.join());
});
test("spies", () => {
  for (const [holder, name] of [[Function.prototype, "call"], [Function.prototype, "apply"], [Reflect, "apply"]] as const) {
    const spy = spyOn(holder as any, name);
    const before = spy.mock.calls.length;
    const answers = [app.called(), app.applied(), app.reflected([1, 2]), app.tag(1)];
    const seen = spy.mock.calls.length - before;
    spy.mockRestore();
    console.log("spied " + name, JSON.stringify(answers), seen);
  }
});
`,
    "text.test.ts": `import { test } from "bun:test";
import * as app from "./app";

const runtime = \`
  const { apply } = Reflect;
  const call = Function.prototype.call, applyOfFunctions = Function.prototype.apply, bind = Function.prototype.bind;
  const seen = { reflect: 0, call: 0, apply: 0, bind: 0 };
  Reflect.apply = (f, self, args) => { seen.reflect++; return apply(f, self, args); };
  Function.prototype.call = function (self, ...args) { seen.call++; return apply(this, self, args); };
  Function.prototype.apply = function (self, args) { seen.apply++; return apply(this, self, args ?? []); };
  Function.prototype.bind = function (...args) { seen.bind++; return apply(bind, this, args); };
  return { seen, restore() { Reflect.apply = apply; Function.prototype.call = call; Function.prototype.apply = applyOfFunctions; Function.prototype.bind = bind; } };
\`;
test("a runtime that is held as text replaces all four", () => {
  const { seen, restore } = new Function(runtime)();
  let answers: unknown[];
  let counted: string;
  try {
    answers = [app.called(), app.applied(), app.reflected([1, 2]), app.tag([]), app.pushed([1], [2]), app.made(), app.method(new app.Shape(2)), app.add.bind(undefined, 1)(2)];
    counted = JSON.stringify(seen);
  } finally { restore(); }
  console.log(JSON.stringify(answers), counted);
  const before = JSON.stringify(seen);
  console.log(app.called(), app.applied(), app.reflected([1, 2]), JSON.stringify(seen) === before);
});
`,
  });
});

test("Function.prototype.bind is replaced, however it is spelled", async () => {
  await expectCompiledToRunAsPlain({
    "tsconfig.json": "{}",
    "app.ts": `export function add(this: unknown, a: number, b: number): number { return a + b; }
export function whose(this: { name: string }, greeting: string): string { return greeting + " " + this.name; }
export const twice = (x: number): number => x * 2;
export function bound(): (b: number) => number { return add.bind(undefined, 1); }
export function boundUntyped(f: any, ...rest: any[]) { return f.bind(...rest); }
export function boundThis(): (greeting: string) => string { return whose.bind({ name: "a" }); }
export function boundArrow(): () => number { return twice.bind(null, 4); }
export function boundNative(): (x: number) => number { return Math.max.bind(Math, 3); }
export function boundOfBound(): () => number { return add.bind(undefined, 1).bind(undefined, 2); }
export function boundAndCalledAtOnce(): number { return add.bind(undefined, 5)(6); }
export class Counter {
  count = 0;
  step(): number { return ++this.count; }
  handler = this.step.bind(this);
}
export class Made { constructor(public a: number, public b: number) {} }
export function boundClass(): Made { const Half = Made.bind(null, 7); return new Half(8); }
export function throughCall(f: Function): Function { return Function.prototype.bind.call(f, null, 9); }
export function throughReflect(f: Function): Function { return Reflect.apply(Function.prototype.bind, f, [null, 10]); }
export function taken(): Function { const { bind } = Function.prototype; return bind.call(add, null, 11); }
export function inLoop(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += add.bind(undefined, i)(1); return sum; }
`,
    "more.ts": `import { EventEmitter } from "node:events";
export function add(this: unknown, a: number, b: number): number { return a + b; }
export function optional(f: ((a: number, b: number) => number) | undefined): unknown { return f?.bind(undefined, 1)(2); }
export function quoted(): number { return add["bind"](undefined, 2)(3); }
export function byName(name: "bind"): number { return add[name](undefined, 3)(4); }
export function byAnyName(f: any, name: string): unknown { return f[name](undefined, 4)(5); }
export class Base { value = 5; read(): number { return this.value; } }
export class Derived extends Base { reader(): () => number { return super.read.bind(this); } }
export async function later(this: unknown, a: number): Promise<number> { return a + 1; }
export function* counting(this: unknown, from: number): Generator<number> { yield from; yield from + 1; }
export function boundAsync(): () => Promise<number> { return later.bind(undefined, 6); }
export function boundGenerator(): () => Generator<number> { return counting.bind(undefined, 7); }
export function ofEmitter(): number { const emitter = new EventEmitter(); let seen = 0; const on = emitter.on.bind(emitter); on("x", () => { seen++; }); emitter.emit("x"); return seen; }
export function asCallback(list: number[]): number[] { return list.map(add.bind(undefined, 10) as (b: number) => number); }
export function hot(n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += add.bind(undefined, 1)(i & 1); return sum; }
export const atLoad = add.bind(undefined, 100);
`,
    "one.test.ts": `import { expect, spyOn, test } from "bun:test";
import { add, bound, boundAndCalledAtOnce, boundArrow, boundClass, boundNative, boundOfBound, boundThis, boundUntyped, Counter, inLoop, taken, throughCall, throughReflect } from "./app";

const uses: [string, () => unknown][] = [
  ["bound", () => bound()(2)],
  ["boundUntyped", () => boundUntyped(add, undefined, 3)(4)],
  ["boundThis", () => boundThis()("hello")],
  ["boundArrow", () => boundArrow()()],
  ["boundNative", () => boundNative()(1)],
  ["boundOfBound", () => boundOfBound()()],
  ["boundAndCalledAtOnce", () => boundAndCalledAtOnce()],
  ["Counter", () => new Counter().handler()],
  ["boundClass", () => JSON.stringify(boundClass())],
  ["throughCall", () => throughCall(add)(1)],
  ["throughReflect", () => throughReflect(add)(1)],
  ["taken", () => taken()(1)],
  ["inLoop", () => inLoop(3)],
  ["here", () => add.bind(undefined, 20)(1)],
  ["name and length", () => { const f = bound(); return f.name + " " + f.length; }],
];
let calls = 0;
function phase(name: string) {
  const lines: string[] = [];
  for (const [what, use] of uses) {
    const before = calls;
    const answer = use();
    lines.push(what + ": " + answer + " (" + (calls - before) + ")");
  }
  console.log(name + "\\n  " + lines.join("\\n  "));
}

test("an assignment", () => {
  phase("before");
  const original = Function.prototype.bind;
  Function.prototype.bind = function (this: Function, ...rest: any[]) { calls++; return Reflect.apply(original, this, rest); };
  try { phase("replaced"); } finally { Function.prototype.bind = original; }
  phase("restored");
});

test("what the replacement answers is what the caller gets", () => {
  const original = Function.prototype.bind;
  Function.prototype.bind = function () { calls++; return () => "mine"; };
  try { phase("answers of its own"); } catch (error) { console.log("threw", (error as Error).name); } finally { Function.prototype.bind = original; }
});

test("a spy", () => {
  const spy = spyOn(Function.prototype, "bind");
  const before = spy.mock.calls.length;
  const answers = [bound()(2), boundUntyped(add, undefined, 3)(4), new Counter().handler(), inLoop(3)];
  console.log("spied", JSON.stringify(answers), spy.mock.calls.length - before);
  spy.mockRestore();
  expect(bound()(2)).toBe(3);
});
`,
    "two.test.ts": `import { test } from "bun:test";
import { add, asCallback, atLoad, boundAsync, boundGenerator, byAnyName, byName, Derived, hot, ofEmitter, optional, quoted } from "./more";

let calls = 0;
const uses: [string, () => unknown][] = [
  ["optional", () => [optional(add), optional(undefined)].join()],
  ["quoted", () => quoted()],
  ["byName", () => byName("bind")],
  ["byAnyName", () => byAnyName(add, "bi" + "nd")],
  ["super", () => new Derived().reader()()],
  ["generator", () => [...boundGenerator()()].join()],
  ["emitter", () => ofEmitter()],
  ["callback", () => asCallback([1, 2]).join()],
  ["at load", () => atLoad(1)],
];
function phase(name: string) {
  const lines: string[] = [];
  for (const [what, use] of uses) {
    const before = calls;
    const answer = use();
    lines.push(what + ": " + answer + " (" + (calls - before) + ")");
  }
  console.log(name + "\\n  " + lines.join("\\n  "));
}
test("more ways to spell it", async () => {
  phase("before");
  const original = Function.prototype.bind;
  Function.prototype.bind = function (this: Function, ...rest: any[]) { calls++; return Reflect.apply(original, this, rest); };
  try {
    phase("replaced");
    const before = calls;
    console.log("async", await boundAsync()(), calls - before);
  } finally { Function.prototype.bind = original; }
  phase("restored");
});
test("a loop that has run many times", () => {
  console.log(hot(200_000), calls);
  const original = Function.prototype.bind;
  const before = calls;
  Function.prototype.bind = function (this: Function, ...rest: any[]) { calls++; return Reflect.apply(original, this, rest); };
  try { console.log(hot(1_000), calls - before); } finally { Function.prototype.bind = original; }
  const after = calls;
  console.log(hot(1_000), calls - after);
});
test("defineProperty and delete", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Function.prototype, "bind")!;
  const before = calls;
  Object.defineProperty(Function.prototype, "bind", { ...descriptor, value(this: Function, ...rest: any[]) { calls++; return Reflect.apply(descriptor.value, this, rest); } });
  try { console.log("defined", quoted(), calls - before); } finally { Object.defineProperty(Function.prototype, "bind", descriptor); }
  delete (Function.prototype as any).bind;
  try { console.log("deleted", typeof (add as any).bind); try { quoted(); } catch (error) { console.log((error as Error).name); } } finally { Object.defineProperty(Function.prototype, "bind", descriptor); }
  console.log("back", quoted());
});
`,
  });
});

test("a member that no test names stays read-only, and the write throws", async () => {
  using dir = tempDir("tests-replace-built-ins", {
    "one.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      const name = process.argv.length > 1000 ? "at" : ["last", "Index", "Of"].join("");
      // Neither the object nor the name can be read off the file. With the object alone, every member of it would be open.
      const holder: any = Object.getPrototypeOf(process.argv.length > 1000 ? 1 : "");
      // The words are put together here: the build reads the texts of a test file as code that the test may hand on.
      const member = ["String", "prototype", name].join(".");
      const advice = "the build didn't see a test replace this one. Spell out the object and the name where the test does it, as in " + member + " = f or spyOn(" + ["String", "prototype"].join(".") + ", " + JSON.stringify(name) + ")";
      test("stored", () => {
        expect(() => { holder[name] = () => 1; }).toThrow("Cannot assign to String.prototype.lastIndexOf because built-in objects are read-only");
        expect(() => { holder[name] = () => 1; }).toThrow("Cannot assign to " + member + " because built-in objects are read-only in compiled code, and " + advice);
        expect(() => { delete holder[name]; }).toThrow("Cannot delete " + member + " because built-in objects are read-only in compiled code, and " + advice);
      });
      test("spied on", () => {
        expect(() => spyOn(holder, name)).toThrow("Cannot spy on " + member + " because built-in objects are read-only in compiled code, and " + advice);
        expect(() => spyOn(Array.prototype as any, "constructor")).toThrow("Cannot spy on Array.prototype.constructor because built-in objects are read-only in compiled code, and a test can't replace this one: it is read without being looked up. Replace a function of your own that uses it");
      });
      test("added", () => {
        (Object.prototype as any).seen = 1;
        delete (Object.prototype as any).seen;
        expect(() => { (Object.prototype as any)[name] = 1; }).toThrow("the build didn't see a test add this one. Spell out the object and the name where the test does it, as in Object.prototype." + name + " = value");
        expect(() => { (Object.prototype as any)[Symbol.iterator] = 1; }).toThrow("built-in objects are read-only");
        expect(() => { (Object.prototype as any)[0] = 1; }).toThrow("Cannot assign to Object.prototype[0] because built-in objects are read-only in compiled code, and a test can't add this one");
        expect(() => { Promise.prototype.constructor = function () {}; }).toThrow("built-in objects are read-only");
        expect(() => Object.setPrototypeOf(Object.prototype, {})).toThrow();
      });`,
  });
  expect((await runTests(String(dir), "--aot")).results).toEqual(["pass stored", "pass spied on", "pass added"]);
});

// The language reads this one by itself, once, where a walk opens: each compiled walk over a map tests the location there.
test("a spy on Map.prototype[Symbol.iterator] sees every walk over a map, however it is spelled", async () => {
  await expectCompiledToRunAsPlain({
    "tsconfig.json": "{}",
    "readers.test.ts": `import { expect, spyOn, test } from "bun:test";

type Entry = [number, string];
const make = (): Map<number, string> => new Map<number, string>([[1, "a"], [2, "b"], [3, "c"]]);
function* through(map: Map<number, string>) { yield* map; }
function take(...all: Entry[]) { return all.length; }
class Named extends Map<number, string> { label = "n"; }

// Each reader walks one map once and says what it saw.
const readers: Record<string, (map: Map<number, string>) => unknown | Promise<unknown>> = {
  forOf(map) { let s = ""; for (const [k, v] of map) s += k + v; return s; },
  forOfWhole(map) { const all: Entry[] = []; for (const e of map) all.push(e); return all; },
  forOfLeftEarly(map) { for (const [k] of map) if (k === 2) return k; return 0; },
  spread(map) { return [...map]; },
  spreadBesideOthers(map) { return [0, ...map, 9]; },
  spreadIntoCall(map) { return take(...map); },
  destructure(map) { const [first, second] = map; return [first, second]; },
  destructureRest(map) { const [first, ...rest] = map; return [first, rest]; },
  arrayFrom(map) { return Array.from(map); },
  arrayFromMapped(map) { return Array.from(map, ([k, v]) => v + k); },
  newMap(map) { return [...new Map(map).keys()]; },
  newSet(map) { return new Set(map).size; },
  fromEntries(map) { return Object.fromEntries(map); },
  delegate(map) { return Array.from(through(map)); },
  iteratorFrom(map) { return Iterator.from(map).toArray(); },
  promiseAll(map) { return Promise.all(map); },
  async forAwait(map) { const all: Entry[] = []; for await (const e of map) all.push(e); return all; },
  calledByHand(map) { return map[Symbol.iterator]().next().value; },
  calledThroughPrototype(map) { return Map.prototype[Symbol.iterator].call(map).next().value; },
  applied(map) { return (Reflect.apply(Map.prototype[Symbol.iterator], map, []) as MapIterator<Entry>).next().value; },
  readAndCompared(map) { return [map[Symbol.iterator] === Map.prototype.entries, typeof map[Symbol.iterator]]; },
  twoWalksInOneFunction(map) { let n = 0; for (const [k] of map) n += k; for (const [k] of map) n += k; return n; },
  nestedWalks(map) { let n = 0; for (const [k] of map) for (const [j] of map) n += k * j; return n; },
  walkOfAMapMadeHere() { let s = ""; for (const [k, v] of new Map([[5, "e"]])) s += k + v; return s; },
  unknownIterable(map) { const any: Iterable<unknown> = process.argv.length > 90 ? [1] : map; let n = 0; for (const _ of any) n++; return n; },
  aSetIsNotCounted() { let n = 0; for (const v of new Set([1, 2])) n += v; return [n, [...new Set([3])]]; },
  entriesIsAnotherName(map) { return [...map.entries()].length; },
  keysIsAnotherName(map) { let n = 0; for (const k of map.keys()) n += k; return n; },
};

async function round(label: string, calls: () => number) {
  const lines: string[] = [];
  for (const [name, reader] of Object.entries(readers)) {
    for (const map of [make(), new Named(make())]) {
      const before = calls();
      const seen = await reader(map);
      lines.push(\`\${label} \${name} \${map instanceof Named ? "subclass" : "map"} calls \${calls() - before} \${JSON.stringify(seen)}\`);
    }
  }
  return lines;
}

test("a spy on the iterator of maps sees every walk", async () => {
  console.log((await round("before", () => 0)).join("\\n"));
  const spy = spyOn(Map.prototype, Symbol.iterator);
  console.log((await round("spied", () => spy.mock.calls.length)).join("\\n"));
  spy.mockImplementation(function (this: Map<number, string>) { return [[7, "z"] as Entry][Symbol.iterator]() as any; });
  console.log((await round("replaced", () => spy.mock.calls.length)).join("\\n"));
  spy.mockRestore();
  console.log((await round("restored", () => spy.mock.calls.length)).join("\\n"));
  expect(Map.prototype[Symbol.iterator]).toBe(Map.prototype.entries);
});

test("assigned and defined", async () => {
  const original = Map.prototype[Symbol.iterator];
  let calls = 0;
  Map.prototype[Symbol.iterator] = function (this: Map<any, any>) { calls++; return original.call(this); };
  console.log((await round("assigned", () => calls)).join("\\n"));
  Object.defineProperty(Map.prototype, Symbol.iterator, { value: function (this: Map<any, any>) { calls += 10; return original.call(this); }, writable: true, configurable: true });
  console.log((await round("defined", () => calls)).join("\\n"));
  Map.prototype[Symbol.iterator] = original;
  console.log((await round("put back", () => calls)).join("\\n"));
});

test("a walk that is hot", () => {
  const map = make();
  const sum = (m: Map<number, string>) => { let n = 0; for (const [k] of m) n += k; return n; };
  let total = 0;
  for (let i = 0; i < 20000; i++) total += sum(map);
  const spy = spyOn(Map.prototype, Symbol.iterator);
  for (let i = 0; i < 100; i++) total += sum(map);
  console.log("hot", total, spy.mock.calls.length);
  spy.mockRestore();
  for (let i = 0; i < 100; i++) total += sum(map);
  console.log("hot", total, spy.mock.calls.length);
});
`,
  });
});

test("what replaces Map.prototype[Symbol.iterator] may yield anything, throw, or give an iterator of its own", async () => {
  await expectCompiledToRunAsPlain({
    "other-kinds.test.js": `import { spyOn, test } from "bun:test";

const make = () => new Map([[1, 2], [3, 4]]);
function whole(m) { const out = []; for (const e of m) out.push(typeof e, e.length, e[0], String(e)); return out; }
function pairs(m) { const out = []; for (const [k, v] of m) out.push(typeof k, k, typeof v, v); return out; }
function sums(m) { let n = 0; for (const [k, v] of m) n += k + v; return n; }
function spreads(m) { return [...m].map(e => typeof e + ":" + String(e)); }
function firsts(m) { const [a, b] = m; return [typeof a, String(a), typeof b, String(b)]; }
function copies(m) { try { return [...new Map(m)].map(String); } catch (error) { return error.constructor.name; } }
function froms(m) { return Array.from(m, e => typeof e); }
function* delegates(m) { yield* m; }
const all = { whole, pairs, sums, spreads, firsts, copies, froms, delegates: m => [...delegates(m)].map(e => typeof e) };
const show = label => { for (const [name, f] of Object.entries(all)) console.log(label, name, JSON.stringify(f(make()))); };

test("a replacement that yields other kinds of values", () => {
  for (let i = 0; i < 3000; i++) { sums(make()); whole(make()); pairs(make()); }
  show("before");
  const spy = spyOn(Map.prototype, Symbol.iterator);
  for (const [label, values] of [
    ["texts", ["xy", "zw"]],
    ["numbers in lists", [[1.5, "t"], ["u", 2.5]]],
    ["objects", [{ length: 9, 0: "o", 1: "p", [Symbol.iterator]() { return ["q", "r"][Symbol.iterator](); } }]],
    ["nothing", []],
    ["long lists", [[1, 2, 3, 4], [5]]],
  ]) {
    spy.mockImplementation(function () { return values[Symbol.iterator](); });
    show(label);
  }
  // An iterator that is no built-in at all, with a return method that is called where the walk is left early.
  let closed = 0;
  spy.mockImplementation(function () { let i = 0; return { next() { return i++ < 3 ? { done: false, value: [i, "v" + i] } : { done: true, value: undefined }; }, return() { closed++; return {}; } }; });
  show("by hand");
  console.log("closed", closed);
  spy.mockImplementation(function () { throw new RangeError("no walk"); });
  for (const [name, f] of Object.entries(all)) { try { console.log("throws", name, JSON.stringify(f(make()))); } catch (error) { console.log("throws", name, error.constructor.name, error.message); } }
  spy.mockImplementation(function () { return 5; });
  for (const [name, f] of Object.entries(all)) { try { console.log("no object", name, JSON.stringify(f(make()))); } catch (error) { console.log("no object", name, error.constructor.name); } }
  spy.mockRestore();
  show("restored");
});
`,
  });
});

// A set has a walk of its own like a map. An object of the host has none: whoever walks it asks the protocol.
test("the Symbol.iterator of Set, Headers and URLSearchParams is replaced like that of Map", async () => {
  await expectCompiledToRunAsPlain({
    "tsconfig.json": "{}",
    "three-more.test.ts": `import { expect, spyOn, test } from "bun:test";

function* through<T>(it: Iterable<T>) { yield* it; }
function count(...all: unknown[]) { return all.length; }
class Tagged extends Set<number> { label = "t"; }

// Each reader walks what it is handed once and says what it saw.
const setReaders: Record<string, (s: Set<number>) => unknown | Promise<unknown>> = {
  forOf(s) { let n = 0; for (const v of s) n += v; return n; },
  forOfLeftEarly(s) { for (const v of s) if (v === 2) return v; return 0; },
  spread(s) { return [...s]; },
  spreadBesideOthers(s) { return [0, ...s, 9]; },
  spreadIntoCall(s) { return count(...s); },
  spreadIntoBuiltin(s) { return Math.max(...s); },
  destructure(s) { const [a, b] = s; return [a, b]; },
  destructureRest(s) { const [a, ...rest] = s; return [a, rest]; },
  arrayFrom(s) { return Array.from(s); },
  arrayFromMapped(s) { return Array.from(s, v => v * 2); },
  newSet(s) { return new Set(s).size; },
  groupBy(s) { return Object.keys(Object.groupBy(s, v => String(v % 2))); },
  mapGroupBy(s) { return Map.groupBy(s, v => v % 2).size; },
  delegate(s) { return Array.from(through(s)); },
  iteratorFrom(s) { return Iterator.from(s).toArray(); },
  promiseAll(s) { return Promise.all(s); },
  async forAwait(s) { const all: number[] = []; for await (const v of s) all.push(v); return all; },
  calledByHand(s) { return s[Symbol.iterator]().next().value; },
  calledThroughPrototype(s) { return Set.prototype[Symbol.iterator].call(s).next().value; },
  readAndCompared(s) { return [s[Symbol.iterator] === Set.prototype.values, s[Symbol.iterator] === Set.prototype.keys]; },
  nestedWalks(s) { let n = 0; for (const a of s) for (const b of s) n += a * b; return n; },
  madeHere() { let n = 0; for (const v of new Set([5, 6])) n += v; return n; },
  unknownIterable(s) { const any: Iterable<unknown> = process.argv.length > 90 ? [1] : s; let n = 0; for (const _ of any) n++; return n; },
  valuesIsAnotherName(s) { return [...s.values()].length; },
  unionAsksForKeys(s) { return s.union(new Set([9])).size; },
  aMapIsNotCounted() { let n = 0; for (const [k] of new Map([[1, 2]])) n += k; return n; },
};
type Pairs = Iterable<[string, string]>;
const pairReaders: Record<string, (p: Pairs) => unknown | Promise<unknown>> = {
  forOf(p) { let s = ""; for (const [k, v] of p) s += k + "=" + v + ";"; return s; },
  forOfLeftEarly(p) { for (const [k] of p) return k; return ""; },
  spread(p) { return [...p]; },
  spreadIntoCall(p) { return count(...p); },
  destructure(p) { const [a, b] = p; return [a, b]; },
  arrayFrom(p) { return Array.from(p); },
  newMap(p) { return new Map(p).size; },
  fromEntries(p) { return Object.fromEntries(p); },
  delegate(p) { return Array.from(through(p)); },
  iteratorFrom(p) { return Iterator.from(p).toArray(); },
  async forAwait(p) { const all: unknown[] = []; for await (const e of p) all.push(e); return all; },
  calledByHand(p) { return p[Symbol.iterator]().next().value; },
  copyOfHeaders(p) { return [...new Headers(p as any)].length; },
  copyOfParams(p) { return new URLSearchParams(p as any).toString(); },
  intoAResponse(p) { return new Response(null, { headers: p as any }).headers.get("a"); },
};

async function round<T>(label: string, readers: Record<string, (it: T) => unknown>, makes: (() => T)[], calls: () => number) {
  for (const [name, reader] of Object.entries(readers)) {
    for (const [index, make] of makes.entries()) {
      const before = calls();
      let seen: unknown;
      try { seen = await reader(make()); } catch (error) { seen = (error as Error).constructor.name; }
      console.log(label, name, index, "calls", calls() - before, JSON.stringify(seen));
    }
  }
}

async function phases<T>(name: string, holder: object, readers: Record<string, (it: T) => unknown>, makes: (() => T)[], other: () => Iterator<unknown>) {
  await round(name + " before", readers, makes, () => 0);
  const spy = spyOn(holder as any, Symbol.iterator);
  await round(name + " spied", readers, makes, () => spy.mock.calls.length);
  spy.mockImplementation(other);
  await round(name + " replaced", readers, makes, () => spy.mock.calls.length);
  spy.mockRestore();
  await round(name + " restored", readers, makes, () => spy.mock.calls.length);
  const original = (holder as any)[Symbol.iterator];
  let calls = 0;
  (holder as any)[Symbol.iterator] = function (this: unknown) { calls++; return original.call(this); };
  await round(name + " assigned", readers, makes, () => calls);
  (holder as any)[Symbol.iterator] = original;
  await round(name + " put back", readers, makes, () => calls);
}

test("Set.prototype[Symbol.iterator]", async () => {
  await phases("set", Set.prototype, setReaders, [() => new Set([1, 2, 3]), () => new Tagged([1, 2, 3])], () => [7, 8][Symbol.iterator]());
  expect(Set.prototype[Symbol.iterator]).toBe(Set.prototype.values);
});
test("Headers.prototype[Symbol.iterator]", async () => {
  await phases<Pairs>("headers", Headers.prototype, pairReaders, [() => new Headers({ a: "1", b: "2" })], () => [["a", "z"]][Symbol.iterator]());
});
test("URLSearchParams.prototype[Symbol.iterator]", async () => {
  await phases<Pairs>("params", URLSearchParams.prototype, pairReaders, [() => new URLSearchParams("a=1&b=2")], () => [["a", "z"]][Symbol.iterator]());
});
test("a walk over a set that is hot", () => {
  const set = new Set([1, 2, 3]);
  const sum = (s: Set<number>) => { let n = 0; for (const v of s) n += v; return n; };
  let total = 0;
  for (let i = 0; i < 20000; i++) total += sum(set);
  const spy = spyOn(Set.prototype, Symbol.iterator);
  for (let i = 0; i < 100; i++) total += sum(set);
  console.log("hot", total, spy.mock.calls.length);
  spy.mockRestore();
});
`,
  });
});

test("a walk of a value that nobody knows asks too, with all four replaced at once", async () => {
  await expectCompiledToRunAsPlain({
    "unknown-kinds.test.js": `import { spyOn, test } from "bun:test";
// Nobody knows what is walked: the value comes out of a list by an index that the build cannot read.
const pick = i => [new Map([[1, 2]]), new Set([3, 4]), [5, 6], "ab", new Headers({ a: "1" }), new URLSearchParams("b=2")][(i + process.argv.length * 6) % 6];
const readers = {
  forOf(x) { const out = []; for (const v of x) out.push(v); return out; },
  spread(x) { return [...x]; },
  spreadBeside(x) { return [0, ...x, 9]; },
  spreadCall(x) { return ((...all) => all.length)(...x); },
  spreadBuiltin(x) { return String(Math.max(...x)); },
  destructure(x) { const [a, b] = x; return [a, b]; },
  rest(x) { const [a, ...others] = x; return [a, others]; },
  from(x) { return Array.from(x); },
  set(x) { return new Set(x).size; },
  delegate(x) { return [...(function* () { yield* x; })()]; },
  all(x) { return Promise.all(x); },
};
async function round(label, calls) {
  const names = Object.keys(readers);
  for (let i = 0; i < names.length; i++) for (let k = 0; k < 6; k++) {
    const before = calls();
    let seen; try { seen = await readers[names[i]](pick(k)); } catch (error) { seen = error.constructor.name; }
    console.log(label, names[i], k, "calls", calls() - before, JSON.stringify(seen));
  }
}
test("walks of values that nobody knows", async () => {
  for (let i = 0; i < 2000; i++) { readers.spread(pick(i)); readers.forOf(pick(i)); readers.destructure(pick(i)); }
  await round("before", () => 0);
  const spies = [spyOn(Map.prototype, Symbol.iterator), spyOn(Set.prototype, Symbol.iterator), spyOn(Headers.prototype, Symbol.iterator), spyOn(URLSearchParams.prototype, Symbol.iterator)];
  const calls = () => spies[0].mock.calls.length + 10 * spies[1].mock.calls.length + 100 * spies[2].mock.calls.length + 1000 * spies[3].mock.calls.length;
  await round("spied", calls);
  for (let i = 0; i < 4; i++) spies[i].mockImplementation(function () { return [["r", i]].values(); });
  await round("replaced", calls);
  for (let i = 0; i < 4; i++) spies[i].mockRestore();
  await round("restored", calls);
});
`,
  });
});

// These accessors are native code without a function object. A store on the prototype runs the native setter, which refuses a receiver
// that is no instance, so nothing is replaced and the next read goes the fast way.
test("a store through a native accessor of a prototype replaces nothing, and a definition over it does", async () => {
  const files = {
    "one.test.ts": `
      import { test } from "bun:test";
      function attempt(store: () => void): string {
        try { store(); return "stored"; } catch (error) { return (error as Error).name; }
      }
      const url = () => new URL("http://a.example/x?q=1#h");
      test("a store that the setter refuses", () => {
        console.log(attempt(() => { (URL.prototype as any).href = "http://b.example/"; }), url().href);
        console.log(attempt(() => { (URL.prototype as any).hash = "#other"; }), url().hash);
        console.log(attempt(() => { (Request.prototype as any).url = "http://b.example/"; }), new Request("http://a.example/r").url);
        console.log(attempt(() => { (URLSearchParams.prototype as any).size = 9; }), new URLSearchParams("a=1&b=2").size);
      });
      test("a store for another receiver", () => {
        const held = url();
        console.log(Reflect.set(URL.prototype, "search", "?other=2", held), held.search, url().search);
      });
      test("a definition, and back", () => {
        const original = Object.getOwnPropertyDescriptor(URL.prototype, "host")!;
        Object.defineProperty(URL.prototype, "host", { get() { return "replaced"; }, configurable: true });
        console.log(url().host);
        Object.defineProperty(URL.prototype, "host", original);
        console.log(url().host);
      });
      test("a deletion, and back", () => {
        const original = Object.getOwnPropertyDescriptor(URL.prototype, "port")!;
        console.log(delete (URL.prototype as any).port, String(new URL("http://a.example:81/").port));
        Object.defineProperty(URL.prototype, "port", original);
        console.log(new URL("http://a.example:81/").port);
      });`,
  };
  await expectCompiledToRunAsPlain(files);
  await expectCompiledToRunAsPlain(files, "--isolate");
});
