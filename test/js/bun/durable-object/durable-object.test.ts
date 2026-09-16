// Bun.DurableObject / Bun.DurableObjectNamespace — the API surface: namespace options, ids, stubs,
// RPC, fetch, class mode vs module mode, close(). Storage, alarms, WebSockets, eviction and the
// event queue have test files of their own next to this one.
import * as bunModule from "bun";
import { DurableObject as ImportedDurableObject, DurableObjectNamespace as ImportedDurableObjectNamespace } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createHash, createHmac } from "node:crypto";
import { join } from "path";

type AnyNamespace = Bun.DurableObjectNamespace<any> & { [Symbol.asyncDispose](): Promise<void> };
const Namespace = Bun.DurableObjectNamespace as unknown as {
  new (options?: unknown): AnyNamespace;
  (options?: unknown): never;
  prototype: AnyNamespace;
};

/** `Name [code]: message` of what `fn` throws (or "no throw"), and of a promise's rejection (or "resolved"). */
const described = (e: any) => `${e?.constructor?.name} [${e?.code}]: ${e?.message}`;
function thrown(fn: () => unknown): string {
  try {
    fn();
    return "no throw";
  } catch (e) {
    return described(e);
  }
}
const rejection = (p: Promise<unknown>) => Promise.resolve(p).then(() => "resolved", described);

/** A few turns of the event loop: enough for anything that is going to settle without I/O to have settled. */
async function turns(n = 5) {
  for (let i = 0; i < n; i++) await new Promise<void>(r => setImmediate(r));
}

const HEX64 = /^[0-9a-f]{64}$/;

interface Env {
  tag: string;
  list: unknown[];
}

class Base extends Bun.DurableObject<Env> {
  inherited() {
    return "from Base";
  }
  get inheritedGetter() {
    return "getter from Base";
  }
}

class Counter extends Base {
  static constructed = 0;
  // Own properties: not reachable over RPC.
  secret = 42;
  ownFunction = () => "own";
  count = 0;

  constructor(ctx: Bun.DurableObjectState, env: Env) {
    super(ctx, env);
    Counter.constructed++;
  }

  add(a: number, b: number) {
    return a + b;
  }
  async addAsync(a: number, b: number) {
    await Promise.resolve();
    await new Promise<void>(r => setImmediate(r));
    return a + b;
  }
  increment(by = 1) {
    return (this.count += by);
  }
  echo<T>(value: T) {
    return value;
  }
  args(...args: unknown[]) {
    return args;
  }
  argumentCount() {
    return arguments.length;
  }
  self() {
    return this;
  }
  get label() {
    return `label of ${this.ctx.id.name}`;
  }
  get asyncLabel() {
    return Promise.resolve(`async label of ${this.ctx.id.name}`);
  }
  get throwingGetter(): never {
    throw new RangeError("getter threw");
  }
  boom(error: unknown) {
    throw error;
  }
  async boomAsync(error: unknown) {
    await Promise.resolve();
    throw error;
  }
  whoami() {
    return { id: this.ctx.id, env: this.env, graph: (Bun as any).ModuleGraph.current, ctx: this.ctx };
  }
  // Reserved names: the runtime's to call, never the stub's.
  alarm() {
    return "alarm";
  }
  webSocketOpen() {
    return "webSocketOpen";
  }
  webSocketMessage() {
    return "webSocketMessage";
  }
  webSocketClose() {
    return "webSocketClose";
  }
  webSocketError() {
    return "webSocketError";
  }
  webSocketDrain() {
    return "webSocketDrain";
  }
  toJSON() {
    return "toJSON";
  }
}

function counters(options: Record<string, unknown> = {}) {
  return new Namespace({ class: Counter, ...options });
}

describe("exports", () => {
  test("Bun.DurableObject and Bun.DurableObjectNamespace are classes, and importable from 'bun'", async () => {
    expect(typeof Bun.DurableObject).toBe("function");
    expect(typeof Bun.DurableObjectNamespace).toBe("function");
    expect(Bun.DurableObject.name).toBe("DurableObject");
    expect(Bun.DurableObjectNamespace.name).toBe("DurableObjectNamespace");
    expect(ImportedDurableObject).toBe(Bun.DurableObject);
    expect(ImportedDurableObjectNamespace).toBe(Bun.DurableObjectNamespace);
    expect(bunModule.DurableObject).toBe(Bun.DurableObject);
    expect(bunModule.DurableObjectNamespace).toBe(Bun.DurableObjectNamespace);
    expect(typeof Bun.DurableObject.websocket).toBe("object");
    expect(Object.getPrototypeOf(Counter)).toBe(Base);
    expect(Object.getPrototypeOf(Base)).toBe(Bun.DurableObject);
  });

  test("a DurableObject is only constructed by its namespace", () => {
    const guard = /constructed by its DurableObjectNamespace/;
    expect(() => new (Counter as any)()).toThrow(guard);
    expect(() => new (Counter as any)({}, {})).toThrow(guard);
    expect(() => new (Counter as any)({ id: "x", storage: {} }, { tag: "" })).toThrow(guard);
    expect(() => new (Bun.DurableObject as any)()).toThrow(guard);
    expect(thrown(() => new (Counter as any)())).toStartWith("TypeError [undefined]: A DurableObject is constructed");
    expect(thrown(() => (Bun.DurableObject as any)())).toBe(
      "TypeError [undefined]: Class constructor DurableObject cannot be invoked without 'new'",
    );
    expect(thrown(() => (Counter as any)())).toBe(
      "TypeError [undefined]: Cannot call a class constructor Counter without |new|",
    );
  });
});

describe("DurableObjectNamespace options", () => {
  test("requires new and an options object", () => {
    expect(thrown(() => Namespace({ class: Counter }))).toBe(
      "TypeError [undefined]: Class constructor DurableObjectNamespace cannot be invoked without 'new'",
    );
    for (const bad of [undefined, null, "Counter", 1, true]) {
      expect(thrown(() => new Namespace(bad))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options" argument must be of type object.',
      );
    }
  });

  test("needs exactly one of class and module", () => {
    expect(thrown(() => new Namespace({}))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'options' needs a "class" or a "module".`,
    );
    expect(thrown(() => new Namespace({ name: "x", env: {} }))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'options' needs a "class" or a "module".`,
    );
    expect(thrown(() => new Namespace({ class: Counter, module: import.meta.path }))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'options' takes either "class" or "module", not both.`,
    );
  });

  test("class must be a constructor", () => {
    for (const bad of [1, "Counter", {}, null, () => {}, async function f() {}, Symbol("s")]) {
      expect(thrown(() => new Namespace({ class: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.class" property must be of type class.',
      );
    }
  });

  test("export and globals are only for module", () => {
    expect(thrown(() => new Namespace({ class: Counter, export: "Counter" }))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.export' is only used together with "module".`,
    );
    expect(thrown(() => new Namespace({ class: Counter, globals: {} }))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.globals' is only used together with "module".`,
    );
  });

  test("module, export and globals types", () => {
    for (const bad of [1, {}, null, true, ["x"]]) {
      expect(thrown(() => new Namespace({ module: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.module" property must be of type string.',
      );
    }
    for (const bad of [1, {}, null, true]) {
      expect(thrown(() => new Namespace({ module: import.meta.path, export: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.export" property must be of type string.',
      );
    }
    for (const bad of [1, "x", null, true]) {
      expect(thrown(() => new Namespace({ module: import.meta.path, globals: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.globals" property must be of type object.',
      );
    }
  });

  test("a module that does not resolve throws at construction", () => {
    using dir = tempDir("durable-object-missing", {});
    const error = (() => {
      try {
        new Namespace({ module: join(String(dir), "not-here.ts") });
      } catch (e) {
        return e as any;
      }
    })();
    expect(error).toBeDefined();
    expect(error.code).toBe("ERR_MODULE_NOT_FOUND");
    expect(error.message).toContain("not-here.ts");
  });

  test("name must be a non-empty string; defaults to the class's name", async () => {
    for (const bad of [1, {}, null, true]) {
      expect(thrown(() => new Namespace({ class: Counter, name: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.name" property must be of type string.',
      );
    }
    expect(thrown(() => new Namespace({ class: Counter, name: "" }))).toStartWith(
      "TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.name' must be a non-empty string",
    );
    // A class without a name needs one.
    const anonymous = (() => class {})();
    expect(anonymous.name).toBe("");
    expect(thrown(() => new Namespace({ class: anonymous }))).toStartWith(
      "TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.name' must be a non-empty string when the class has no name.",
    );
    await using named = new Namespace({ class: anonymous, name: "Anonymous" });
    await using byDefault = counters();
    await using explicit = counters({ name: "Counter" });
    await using other = counters({ name: "Other" });
    expect(String(byDefault.idFromName("x"))).toBe(String(explicit.idFromName("x")));
    expect(String(byDefault.idFromName("x"))).not.toBe(String(other.idFromName("x")));
    expect(String(named.idFromName("x"))).not.toBe(String(other.idFromName("x")));
  });

  test("storage must be a non-empty string", async () => {
    for (const bad of [1, {}, null, true]) {
      expect(thrown(() => counters({ storage: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.storage" property must be of type string.',
      );
    }
    expect(thrown(() => counters({ storage: "" }))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The property 'options.storage' must be a directory or ":memory:".`,
    );
    await using memory = counters({ storage: ":memory:" });
    expect(await memory.getByName("a").add(1, 2)).toBe(3);
  });

  test("idleTimeout must be a non-negative finite number", async () => {
    for (const bad of ["1", -1, NaN, Infinity, -Infinity, null, {}, 1n]) {
      expect(thrown(() => counters({ idleTimeout: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.idleTimeout" property must be a non-negative number of milliseconds.',
      );
    }
    await using zero = counters({ idleTimeout: 0 });
    expect(await zero.getByName("a").add(1, 2)).toBe(3);
    await using fraction = counters({ idleTimeout: 0.5 });
    expect(await fraction.getByName("a").add(1, 2)).toBe(3);
  });

  test("onError must be a function", async () => {
    for (const bad of [1, "f", {}, null, true]) {
      expect(thrown(() => counters({ onError: bad }))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "options.onError" property must be of type function.',
      );
    }
    await using ok = counters({ onError() {} });
    expect(await ok.getByName("a").add(1, 2)).toBe(3);
  });

  test("an option that is undefined is an option that is not given", async () => {
    await using ns = new Namespace({
      class: Counter,
      module: undefined,
      export: undefined,
      globals: undefined,
      name: undefined,
      storage: undefined,
      env: undefined,
      idleTimeout: undefined,
      onError: undefined,
    });
    expect(await ns.getByName("a").add(1, 2)).toBe(3);
    expect(await ns.getByName("a").echo(undefined)).toBe(undefined);
    expect((await ns.getByName("a").whoami()).env).toBe(undefined);
  });

  test("a getter on options that throws propagates", () => {
    const error = new Error("from getter");
    for (const key of ["class", "module", "export", "globals", "name", "storage", "env", "idleTimeout", "onError"]) {
      const options = { class: Counter };
      Object.defineProperty(options, key, {
        get() {
          throw error;
        },
      });
      expect(() => new Namespace(options)).toThrow(error);
    }
  });

  test("is a class with a prototype, and can be subclassed", async () => {
    expect(Object.prototype.toString.call(Namespace.prototype)).toBe("[object DurableObjectNamespace]");
    for (const method of ["idFromName", "newUniqueId", "idFromString", "get", "getByName", "close"] as const) {
      expect(typeof Namespace.prototype[method]).toBe("function");
    }
    expect(Namespace.prototype[Symbol.asyncDispose]).toBe(Namespace.prototype.close);
    expect(thrown(() => Namespace.prototype.idFromName.call({}, "x"))).toStartWith("TypeError [");
    expect(thrown(() => Namespace.prototype.get.call({}, "x"))).toStartWith("TypeError [");
    class Sub extends (Namespace as any) {
      extra() {
        return "extra";
      }
    }
    await using sub = new Sub({ class: Counter }) as AnyNamespace & { extra(): string };
    expect(sub).toBeInstanceOf(Sub);
    expect(sub).toBeInstanceOf(Bun.DurableObjectNamespace);
    expect(sub.extra()).toBe("extra");
    expect(await sub.getByName("a").add(2, 3)).toBe(5);
  });
});

describe("ids", () => {
  test("idFromName: 64 lowercase hex digits, deterministic, keeps the name", async () => {
    await using ns = counters();
    const a = ns.idFromName("a");
    expect(String(a)).toMatch(HEX64);
    expect(a.toString()).toBe(String(a));
    expect(`${a}`).toBe(String(a));
    expect(a.name).toBe("a");
    expect(Object.prototype.toString.call(a)).toBe("[object DurableObjectId]");
    expect(String(ns.idFromName("a"))).toBe(String(a));
    expect(String(ns.idFromName("b"))).not.toBe(String(a));
    expect(String(ns.idFromName(""))).toMatch(HEX64);
    expect(ns.idFromName("").name).toBe("");
    const unicode = ns.idFromName("名前 🙂");
    expect(String(unicode)).toMatch(HEX64);
    expect(unicode.name).toBe("名前 🙂");
    const long = ns.idFromName(Buffer.alloc(10_000, "x").toString());
    expect(String(long)).toMatch(HEX64);
    expect(long.name).toHaveLength(10_000);
    // Distinct names that a naive concatenation would confuse.
    expect(String(ns.idFromName("a\0b"))).not.toBe(String(ns.idFromName("a")));
  });

  test("idFromName depends on the namespace's name only", async () => {
    await using one = counters({ name: "shared-name" });
    await using two = new Namespace({ class: class Unrelated {}, name: "shared-name" });
    await using three = counters({ name: "another-name" });
    expect(String(one.idFromName("x"))).toBe(String(two.idFromName("x")));
    expect(String(one.idFromName("x"))).not.toBe(String(three.idFromName("x")));
    // Ids name files on disk, so how they are derived must not change between versions of Bun:
    // key = SHA-256("bun:DurableObjectNamespace\0" + namespace name); 24 bytes of HMAC(key, name)
    // with the top bit set, then 8 bytes of HMAC(key, those 24 bytes).
    const expectedId = (namespaceName: string, name: string) => {
      const key = createHash("sha256").update(`bun:DurableObjectNamespace\0${namespaceName}`).digest();
      const payload = createHmac("sha256", key).update(name).digest().subarray(0, 24);
      payload[0] |= 0x80;
      const mac = createHmac("sha256", key).update(payload).digest().subarray(0, 8);
      return Buffer.concat([payload, mac]).toString("hex");
    };
    await using fixed = counters({ name: "C" });
    expect(expectedId("C", "a")).toBe("9f6ac829208dbd29cc8f62b0fd1504b32ab787566ff9a5d12379fe7c53af6c8a");
    expect(String(fixed.idFromName("a"))).toBe(expectedId("C", "a"));
    expect(String(fixed.idFromName("名前 🙂"))).toBe(expectedId("C", "名前 🙂"));
    expect(String(one.idFromName("x"))).toBe(expectedId("shared-name", "x"));
    // The top bit tells ids from names and random ids apart.
    expect(String(fixed.idFromName("a"))).toMatch(/^[89a-f]/);
    for (let i = 0; i < 20; i++) expect(String(fixed.newUniqueId())).toMatch(/^[0-7]/);
  });

  test("idFromName and getByName validate the name", async () => {
    await using ns = counters();
    for (const bad of [undefined, null, 1, {}, Symbol("s")]) {
      expect(thrown(() => (ns as any).idFromName(bad))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "name" argument must be of type string.',
      );
      expect(thrown(() => (ns as any).getByName(bad))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "name" argument must be of type string.',
      );
    }
  });

  test("equals", async () => {
    await using ns = counters();
    await using sameName = counters();
    await using other = counters({ name: "Other" });
    const a = ns.idFromName("a");
    expect(a.equals(a)).toBe(true);
    expect(a.equals(ns.idFromName("a"))).toBe(true);
    expect(a.equals(ns.idFromName("b"))).toBe(false);
    expect(a.equals(ns.idFromString(String(a)))).toBe(true);
    expect(ns.idFromString(String(a)).equals(a)).toBe(true);
    expect(a.equals(other.idFromName("a"))).toBe(false);
    expect(a.equals(ns.newUniqueId())).toBe(false);
    // Same hex from a different namespace object of the same name.
    expect(String(sameName.idFromName("a"))).toBe(String(a));
    for (const notAnId of [undefined, null, String(a), 1, {}, { toString: () => String(a) }]) {
      expect((a as any).equals(notAnId)).toBe(false);
    }
    expect(thrown(() => a.equals.call({}, a))).toStartWith("TypeError [");
    expect(thrown(() => a.toString.call({}))).toStartWith("TypeError [");
  });

  test("JSON.stringify(id) is the hex string", async () => {
    await using ns = counters();
    const a = ns.idFromName("a");
    expect(JSON.stringify(a)).toBe(`"${a}"`);
    expect(JSON.stringify({ id: a, list: [a] })).toBe(`{"id":"${a}","list":["${a}"]}`);
    expect((a as any).toJSON()).toBe(String(a));
    expect(Object.keys(a)).toEqual([]);
    // name is read-only.
    expect(() => {
      "use strict";
      (a as any).name = "changed";
    }).toThrow(TypeError);
    expect(a.name).toBe("a");
  });

  test("newUniqueId: unique, no name, round trips", async () => {
    await using ns = counters();
    const ids = Array.from({ length: 200 }, () => ns.newUniqueId());
    expect(new Set(ids.map(String)).size).toBe(200);
    for (const id of ids.slice(0, 20)) {
      expect(String(id)).toMatch(HEX64);
      expect(id.name).toBe(undefined);
      const back = ns.idFromString(String(id));
      expect(back.equals(id)).toBe(true);
      expect(String(back)).toBe(String(id));
      expect(back.name).toBe(undefined);
    }
    expect(ids[0].equals(ids[1])).toBe(false);
  });

  test("idFromString round trips ids of this namespace and rejects everything else", async () => {
    await using ns = counters();
    await using sameName = counters();
    await using other = counters({ name: "Other" });
    const a = ns.idFromName("a");
    const back = ns.idFromString(String(a));
    expect(String(back)).toBe(String(a));
    expect(back.equals(a)).toBe(true);
    expect(ns.get(back).id).toBe(back);
    // A namespace of the same name is the same namespace, as far as ids go.
    expect(String(sameName.idFromString(String(a)))).toBe(String(a));
    expect(String(sameName.idFromString(String(ns.newUniqueId())))).toMatch(HEX64);

    const hex = String(a);
    const flipped = hex.slice(0, 63) + (hex[63] === "0" ? "1" : "0");
    const garbage = [
      "",
      "zz",
      "a",
      hex.slice(1),
      hex + "0",
      hex.toUpperCase(),
      " " + hex,
      hex + " ",
      hex.slice(0, 63) + "g",
      "0x" + hex.slice(2),
      Buffer.alloc(64, "0").toString(),
      Buffer.alloc(64, "f").toString(),
      flipped,
      hex.slice(0, 63) + "é",
    ];
    for (const bad of garbage) {
      expect(thrown(() => ns.idFromString(bad))).toStartWith(`TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' `);
    }
    expect(thrown(() => ns.idFromString(String(other.idFromName("a"))))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' is not an id of the DurableObjectNamespace "Counter".`,
    );
    expect(thrown(() => ns.idFromString(String(other.newUniqueId())))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' is not an id of the DurableObjectNamespace "Counter".`,
    );
    expect(thrown(() => other.idFromString(hex))).toStartWith(
      `TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' is not an id of the DurableObjectNamespace "Other".`,
    );
    for (const bad of [undefined, null, 1, {}, a]) {
      expect(thrown(() => (ns as any).idFromString(bad))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "id" argument must be of type string.',
      );
    }
  });

  test("get() takes an id of this namespace only", async () => {
    await using ns = counters();
    await using sameName = counters();
    await using other = counters({ name: "Other" });
    const a = ns.idFromName("a");
    for (const bad of [
      undefined,
      null,
      String(a),
      1,
      {},
      { toString: () => String(a), equals: () => true, name: "a" },
    ]) {
      expect(thrown(() => (ns as any).get(bad))).toStartWith(
        'TypeError [ERR_INVALID_ARG_TYPE]: The "id" argument must be of type DurableObjectId.',
      );
    }
    expect(thrown(() => ns.get(other.idFromName("a")))).toStartWith(
      "TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' belongs to a different DurableObjectNamespace.",
    );
    expect(thrown(() => ns.get(other.newUniqueId()))).toStartWith(
      "TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' belongs to a different DurableObjectNamespace.",
    );
    // An id belongs to the namespace object that made it, even when another has the same name.
    expect(thrown(() => ns.get(sameName.idFromName("a")))).toStartWith(
      "TypeError [ERR_INVALID_ARG_VALUE]: The argument 'id' belongs to a different DurableObjectNamespace.",
    );
    expect(ns.get(ns.idFromString(String(sameName.idFromName("a")))).id.equals(a)).toBe(true);
  });
});

describe("stubs", () => {
  test("id and name", async () => {
    await using ns = counters();
    const id = ns.idFromName("a");
    const stub = ns.get(id);
    expect(Object.prototype.toString.call(stub)).toBe("[object DurableObjectStub]");
    expect(stub.id).toBe(id);
    expect(stub.name).toBe("a");
    const byName = ns.getByName("a");
    expect(byName.id.equals(id)).toBe(true);
    expect(byName.id.name).toBe("a");
    expect(byName.name).toBe("a");
    const unique = ns.get(ns.newUniqueId());
    expect(unique.name).toBe(undefined);
    expect(String(unique.id)).toMatch(HEX64);
    const fromString = ns.get(ns.idFromString(String(id)));
    expect(fromString.name).toBe(undefined);
    expect(fromString.id.equals(id)).toBe(true);
    // Making a stub does not start the object.
    const before = Counter.constructed;
    ns.getByName("never called");
    ns.getByName("never called").add;
    expect(Counter.constructed).toBe(before);
    // Read-only.
    expect(() => {
      "use strict";
      (stub as any).id = 1;
    }).toThrow(TypeError);
    expect(stub.id).toBe(id);
  });

  test("calls sync and async methods; always returns a promise", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    expect(typeof stub.add).toBe("function");
    const sync = stub.add(1, 2);
    expect(sync).toBeInstanceOf(Promise);
    expect(await sync).toBe(3);
    const asynchronous = stub.addAsync(3, 4);
    expect(asynchronous).toBeInstanceOf(Promise);
    expect(await asynchronous).toBe(7);
    expect(await stub.inherited()).toBe("from Base");
    expect(await stub.argumentCount()).toBe(0);
    expect(await stub.argumentCount(1, undefined, 3)).toBe(3);
    expect(await stub.echo(undefined)).toBe(undefined);
    // Default parameters see missing arguments as missing.
    expect(await stub.increment()).toBe(1);
    expect(await stub.increment(10)).toBe(11);
    // A method taken off the stub stays bound to it.
    const { add, increment } = stub;
    expect(await add(5, 6)).toBe(11);
    expect(await increment()).toBe(12);
    expect(await stub.add.call(null, 1, 1)).toBe(2);
    expect(await stub.add.apply(undefined, [2, 2])).toBe(4);
    expect(stub.add.name).toBe("add");
  });

  test("the object is constructed once, by the first call", async () => {
    await using ns = counters();
    const before = Counter.constructed;
    const stub = ns.getByName("a");
    expect(Counter.constructed).toBe(before);
    const first = stub.increment();
    // The first event of an idle, unloaded class-mode object starts on the caller's stack.
    expect(Counter.constructed).toBe(before + 1);
    expect(await first).toBe(1);
    expect(await Promise.all([stub.increment(), stub.increment(), ns.getByName("a").increment()])).toEqual([2, 3, 4]);
    expect(Counter.constructed).toBe(before + 1);
    expect(await ns.getByName("b").increment()).toBe(1);
    expect(Counter.constructed).toBe(before + 2);
  });

  test("arguments and results are passed by reference", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    const object = { nested: { list: [1, 2, 3] } };
    expect(await stub.echo(object)).toBe(object);
    const fn = () => 1;
    expect(await stub.echo(fn)).toBe(fn);
    const symbol = Symbol("s");
    expect(await stub.echo(symbol)).toBe(symbol);
    const buffer = new Uint8Array([1, 2, 3]);
    const stream = new ReadableStream();
    const args = await stub.args(object, fn, buffer, stream, 1n, NaN);
    expect(args).toHaveLength(6);
    expect(args[0]).toBe(object);
    expect(args[1]).toBe(fn);
    expect(args[2]).toBe(buffer);
    expect(args[3]).toBe(stream);
    expect(args[4]).toBe(1n);
    expect(args[5]).toBeNaN();
    // The instance itself can be returned; it is the real object.
    const instance = await stub.self();
    expect(instance).toBeInstanceOf(Counter);
    expect(instance.secret).toBe(42);
    expect(await stub.self()).toBe(instance);
    // A promise returned by a method is awaited, not handed over.
    const promise = Promise.resolve("inner");
    expect(await stub.echo(promise)).toBe("inner");
    // A stub of another object can be passed and returned.
    const other = ns.getByName("b");
    expect(await stub.echo(other)).toBe(other);
  });

  test("getters are read with await stub.property", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    expect(await stub.label).toBe("label of a");
    expect(await stub.asyncLabel).toBe("async label of a");
    expect(await stub.inheritedGetter).toBe("getter from Base");
    expect(await rejection(stub.throwingGetter)).toBe("RangeError [undefined]: getter threw");
    // then() of the property is a real then(): both callbacks, chained.
    expect(await stub.label.then((v: string) => v.toUpperCase())).toBe("LABEL OF A");
    expect(await stub.throwingGetter.then(null, (e: Error) => e.message)).toBe("getter threw");
    // Unknown and unreachable properties read as undefined.
    expect(await stub.doesNotExist).toBe(undefined);
    expect(await stub.secret).toBe(undefined);
    expect(await stub.count).toBe(undefined);
    expect(await stub.ownFunction).toBe(undefined);
    expect(await stub.hasOwnProperty).toBe(Object.prototype.hasOwnProperty);
    // The object still works after a throwing getter.
    expect(await stub.add(1, 1)).toBe(2);
  });

  test("a method read like a getter rejects with a TypeError that says to call it", async () => {
    await using ns = counters({ name: "counters of the test" });
    const stub = ns.getByName("a");
    const before = Counter.constructed;
    // Forgetting the parentheses must not look like a value.
    for (const name of ["add", "addAsync", "inherited", "self"]) {
      const expected = `TypeError [undefined]: "${name}" is a method of the Durable Object "counters of the test": call it`;
      expect(await rejection((async () => await stub[name])())).toBe(expected);
      expect(await rejection(stub[name].then((value: unknown) => value))).toBe(expected);
      expect(await rejection(Promise.resolve(stub[name]))).toBe(expected);
      expect(await rejection(Promise.all([stub[name]]))).toBe(expected);
    }
    // The object was started to find out, and is none the worse for it.
    expect(Counter.constructed).toBe(before + 1);
    expect(await stub.add(1, 2)).toBe(3);
    expect(await stub.label).toBe("label of a");
    // A getter that gives a function is a method as far as a stub can tell.
    class HasFunctionGetter extends Bun.DurableObject {
      get handler() {
        return () => "the getter's function";
      }
    }
    await using other = new Namespace({ class: HasFunctionGetter });
    expect(await other.getByName("a").handler()).toBe("the getter's function");
    expect(await rejection((async () => await other.getByName("a").handler)())).toBe(
      'TypeError [undefined]: "handler" is a method of the Durable Object "HasFunctionGetter": call it',
    );
  });

  test("stub.then is undefined, so a stub can be returned from an async function", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    expect(stub.then).toBe(undefined);
    expect("then" in stub).toBe(false);
    const viaAsync = await (async () => stub)();
    expect(viaAsync).toBe(stub);
    expect(await Promise.resolve(stub)).toBe(stub);
    expect(await new Promise(resolve => resolve(stub))).toBe(stub);
    expect(await Promise.all([stub])).toEqual([stub]);
    expect(await viaAsync.add(1, 2)).toBe(3);
  });

  // Every reserved name is something the class has: a handler, what DurableObject's constructor
  // assigned, what every object has, or a method that happens to be called `then`.
  class Reserved extends Bun.DurableObject {
    alarm() {}
    webSocketOpen() {}
    webSocketMessage() {}
    webSocketClose() {}
    webSocketError() {}
    webSocketDrain() {}
    toJSON() {
      return "toJSON";
    }
    then() {
      throw new Error("then() must not be called through a stub");
    }
    has(name: string) {
      return (this as any)[name] !== undefined;
    }
    regular() {
      return "regular";
    }
  }
  for (const name of [
    "alarm",
    "webSocketOpen",
    "webSocketMessage",
    "webSocketClose",
    "webSocketError",
    "webSocketDrain",
    "ctx",
    "env",
    "constructor",
    "toJSON",
    "then",
  ]) {
    test(`reserved name "${name}" is undefined on a stub`, async () => {
      await using ns = new Namespace({ class: Reserved, env: { some: "env" } });
      const stub = ns.getByName("a");
      expect(await stub.has(name)).toBe(true);
      expect(stub[name]).toBe(undefined);
      expect(await stub.regular()).toBe("regular");
    });
  }

  test("JSON.stringify, String, keys and symbols of a stub", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    stub.add;
    await stub.increment();
    expect(JSON.stringify(stub)).toBe("{}");
    expect(String(stub)).toBe("[object DurableObjectStub]");
    expect(Object.keys(stub)).toEqual([]);
    expect(stub[Symbol.iterator]).toBe(undefined);
    expect(stub[Symbol.asyncIterator]).toBe(undefined);
    expect(stub[Symbol.toPrimitive]).toBe(undefined);
    expect(stub[Symbol("unknown")]).toBe(undefined);
    expect(stub[0]).toBe(undefined);
    expect(() => Bun.inspect(stub)).not.toThrow();
    expect(() => Bun.inspect(stub.id)).not.toThrow();
  });

  test("instance own properties, ctx, env and Object.prototype methods are unreachable", async () => {
    await using ns = counters({ env: { tag: "secret env", list: [] } });
    const stub = ns.getByName("a");
    expect(await rejection(stub.secret())).toBe(
      'TypeError [undefined]: The Durable Object "Counter" has no method "secret"',
    );
    expect(await rejection(stub.ownFunction())).toBe(
      'TypeError [undefined]: The Durable Object "Counter" has no method "ownFunction"',
    );
    expect(await rejection(stub.count())).toBe(
      'TypeError [undefined]: The Durable Object "Counter" has no method "count"',
    );
    expect(stub.ctx).toBe(undefined);
    expect(stub.env).toBe(undefined);
    // Object.prototype's methods are the stub's own (local), not calls to the object.
    const before = Counter.constructed;
    const fresh = ns.getByName("fresh");
    expect(fresh.hasOwnProperty).toBe(Object.prototype.hasOwnProperty);
    expect(fresh.toString).toBe(Object.prototype.toString);
    expect(fresh.valueOf).toBe(Object.prototype.valueOf);
    expect(fresh.isPrototypeOf).toBe(Object.prototype.isPrototypeOf);
    expect(fresh.valueOf()).toBe(fresh);
    expect(Counter.constructed).toBe(before);
    // Assigned in the constructor by DurableObject itself.
    const instance = await stub.self();
    expect(Object.hasOwn(instance, "ctx")).toBe(true);
    expect(Object.hasOwn(instance, "env")).toBe(true);
  });

  test("an unknown method rejects with a TypeError that names the class", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    const call = stub.doesNotExist(1, 2);
    expect(call).toBeInstanceOf(Promise);
    const error = await call.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('The Durable Object "Counter" has no method "doesNotExist"');
    // Statics are the class's, not the object's.
    expect(await rejection(stub.constructed())).toBe(
      'TypeError [undefined]: The Durable Object "Counter" has no method "constructed"',
    );
    // An RPC function is not a constructor.
    expect(() => new stub.add(1, 2)).toThrow(TypeError);
    // A getter's value is not a method.
    expect(await rejection(stub.label())).toBe(
      'TypeError [undefined]: The Durable Object "Counter" has no method "label"',
    );
    expect(await rejection(stub[""]())).toBe('TypeError [undefined]: The Durable Object "Counter" has no method ""');
    expect(await stub.add(1, 2)).toBe(3);
  });

  test("a thrown error rejects the call with the same object and the object keeps working", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    const before = Counter.constructed;
    expect(await stub.increment()).toBe(1);
    const error = new Error("sync boom");
    expect(await stub.boom(error).catch((e: unknown) => e)).toBe(error);
    const asyncError = new RangeError("async boom");
    expect(await stub.boomAsync(asyncError).catch((e: unknown) => e)).toBe(asyncError);
    // Not only Errors.
    const thrownObject = { not: "an error" };
    expect(await stub.boom(thrownObject).catch((e: unknown) => e)).toBe(thrownObject);
    expect(await stub.boom("a string").catch((e: unknown) => e)).toBe("a string");
    expect(
      await stub.boom(undefined).then(
        () => "resolved",
        (e: unknown) => ["rejected", e],
      ),
    ).toEqual(["rejected", undefined]);
    expect(
      await stub.boomAsync(null).then(
        () => "resolved",
        (e: unknown) => ["rejected", e],
      ),
    ).toEqual(["rejected", null]);
    // Same instance, same state.
    expect(await stub.increment()).toBe(2);
    expect(Counter.constructed).toBe(before + 1);
    // A rejection in the middle of a batch does not disturb its neighbours.
    const results = await Promise.allSettled([stub.increment(), stub.boom(error), stub.increment()]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[0] as PromiseFulfilledResult<number>).value).toBe(3);
    expect((results[1] as PromiseRejectedResult).reason).toBe(error);
    expect((results[2] as PromiseFulfilledResult<number>).value).toBe(4);
  });

  test("the in operator", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    expect("id" in stub).toBe(true);
    expect("name" in stub).toBe(true);
    expect("fetch" in stub).toBe(true);
    // Any method name may be one of the class's: the stub cannot know without asking the object.
    expect("add" in stub).toBe(true);
    expect("anything" in stub).toBe(true);
    for (const reserved of ["then", "alarm", "webSocketMessage", "ctx", "env", "toJSON"]) {
      expect(reserved in stub).toBe(false);
    }
    expect(Symbol.iterator in stub).toBe(false);
    expect(Reflect.has(stub, "then")).toBe(false);
  });

  test("stubs from get() and getByName() reach the same object", async () => {
    await using ns = counters();
    const before = Counter.constructed;
    const one = ns.getByName("same");
    const two = ns.get(ns.idFromName("same"));
    const three = ns.get(ns.idFromString(String(one.id)));
    expect(await one.increment()).toBe(1);
    expect(await two.increment()).toBe(2);
    expect(await three.increment()).toBe(3);
    expect(await one.self()).toBe(await three.self());
    expect(Counter.constructed).toBe(before + 1);
    const other = ns.getByName("different");
    expect(await other.increment()).toBe(1);
    expect(await other.self()).not.toBe(await one.self());
    // A unique id's object is reachable again through its string.
    const unique = ns.get(ns.newUniqueId());
    expect(await unique.increment()).toBe(1);
    expect(await ns.get(ns.idFromString(String(unique.id))).increment()).toBe(2);
  });

  test("the same id gives the same stub, and the same name the same id, while they are in use", async () => {
    await using ns = counters();
    const stub = ns.getByName("same");
    const id = stub.id;
    expect(ns.getByName("same")).toBe(stub);
    expect(ns.get(id)).toBe(stub);
    expect(ns.idFromName("same")).toBe(id);
    expect(ns.get(ns.idFromName("same"))).toBe(stub);
    expect(ns.getByName("same").id).toBe(id);
    // So is what is read from a stub.
    expect(stub.add).toBe(stub.add);
    expect(stub.id).toBe(stub.id);
    // Another name, another namespace: others.
    expect(ns.getByName("other")).not.toBe(stub);
    expect(ns.idFromName("other")).not.toBe(id);
    await using second = counters();
    expect(second.getByName("same")).not.toBe(stub);
    expect(second.idFromName("same")).not.toBe(id);
    expect(String(second.idFromName("same"))).toBe(String(id));
    // An id that was not made from a name has a stub of its own too.
    const unique = ns.newUniqueId();
    expect(ns.get(unique)).toBe(ns.get(unique));
    expect(ns.get(unique).id).toBe(unique);
    // An id read back from its string is another id object, without the name; it is the same object all the same.
    const fromString = ns.idFromString(String(id));
    expect(fromString).not.toBe(id);
    expect(fromString.equals(id)).toBe(true);
    expect(fromString.name).toBeUndefined();
    expect(await stub.increment()).toBe(1);
    expect(await ns.get(fromString).increment()).toBe(2);
    expect(await ns.getByName("same").increment()).toBe(3);
  });

  test("ctx.id is the id the object was addressed by", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    const { id } = await stub.whoami();
    expect(id.equals(stub.id)).toBe(true);
    expect(String(id)).toBe(String(stub.id));
    expect(id.name).toBe("a");
    const unique = ns.get(ns.newUniqueId());
    const seen = (await unique.whoami()).id;
    expect(seen.equals(unique.id)).toBe(true);
    expect(seen.name).toBe(undefined);
  });

  test("an object can call another object through a stub it is given", async () => {
    class Relay extends Bun.DurableObject<{ peers: () => AnyNamespace }> {
      received: string[] = [];
      async forward(to: string, message: string) {
        const reply = await this.env.peers().getByName(to).receive(`${this.ctx.id.name}: ${message}`);
        return `forwarded, got ${reply}`;
      }
      async forwardVia(stub: any, message: string) {
        return await stub.receive(message);
      }
      receive(message: string) {
        this.received.push(message);
        return this.received.length;
      }
      inbox() {
        return this.received;
      }
    }
    await using ns: AnyNamespace = new Namespace({ class: Relay, env: { peers: () => ns } });
    expect(await ns.getByName("a").forward("b", "hello")).toBe("forwarded, got 1");
    expect(await ns.getByName("a").forwardVia(ns.getByName("b"), "again")).toBe(2);
    expect(await ns.getByName("b").inbox()).toEqual(["a: hello", "again"]);
    expect(await ns.getByName("a").inbox()).toEqual([]);
  });

  test("objects of two namespaces with the same class are different objects", async () => {
    await using one = counters({ name: "one" });
    await using two = counters({ name: "two" });
    expect(await one.getByName("a").increment()).toBe(1);
    expect(await one.getByName("a").increment()).toBe(2);
    expect(await two.getByName("a").increment()).toBe(1);
  });
});

class Fetcher extends Bun.DurableObject {
  lastRequest: Request | undefined;
  async fetch(request: Request, server?: unknown) {
    this.lastRequest = request;
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/string":
        return "not a response" as any;
      case "/object":
        return { status: 200 } as any;
      case "/null":
        return null as any;
      case "/undefined":
        return undefined;
      case "/nothing":
        return;
      case "/upgrade-refused":
        // Not a WebSocket request: the server says no, and nothing was upgraded.
        this.upgrades.push((server as Bun.DurableObjectServer).upgrade(request));
        return;
      case "/throw":
        throw new Error("fetch threw");
      case "/sync-response":
        return new Response("sync");
      default:
        return Response.json({
          isRequest: request instanceof Request,
          method: request.method,
          url: request.url,
          header: request.headers.get("x-test"),
          body: await request.text(),
          server: typeof server,
          argumentCount: arguments.length,
        });
    }
  }
  last() {
    return this.lastRequest;
  }
  upgrades: boolean[] = [];
  upgradeResults() {
    return this.upgrades;
  }
}

describe("fetch", () => {
  test("string, URL and Request inputs, and init", async () => {
    await using ns = new Namespace({ class: Fetcher });
    const stub = ns.getByName("a");
    const pending = stub.fetch("http://do/path?q=1");
    expect(pending).toBeInstanceOf(Promise);
    const fromString = await pending;
    expect(fromString).toBeInstanceOf(Response);
    expect(await fromString.json()).toEqual({
      isRequest: true,
      method: "GET",
      url: "http://do/path?q=1",
      header: null,
      body: "",
      server: "undefined",
      argumentCount: 1,
    });
    const fromURL = await stub.fetch(new URL("http://do/url"), {
      method: "POST",
      headers: { "x-test": "from init" },
      body: "posted",
    });
    expect(await fromURL.json()).toEqual({
      isRequest: true,
      method: "POST",
      url: "http://do/url",
      header: "from init",
      body: "posted",
      server: "undefined",
      argumentCount: 1,
    });
    const request = new Request("http://do/request", {
      method: "PUT",
      headers: { "x-test": "from request" },
      body: "put",
    });
    const fromRequest = await stub.fetch(request);
    expect(await fromRequest.json()).toEqual({
      isRequest: true,
      method: "PUT",
      url: "http://do/request",
      header: "from request",
      body: "put",
      server: "undefined",
      argumentCount: 1,
    });
    // A Request is passed as it is.
    expect(await stub.last()).toBe(request);
    // Request + init makes a new Request from both.
    const overridden = await stub.fetch(new Request("http://do/base", { headers: { "x-test": "base" } }), {
      method: "DELETE",
      headers: { "x-test": "override" },
    });
    expect(await overridden.json()).toMatchObject({ method: "DELETE", url: "http://do/base", header: "override" });
    expect(await (await stub.fetch("http://do/sync-response")).text()).toBe("sync");
  });

  test("bad input rejects, it does not throw", async () => {
    await using ns = new Namespace({ class: Fetcher });
    const stub = ns.getByName("a");
    const bad = stub.fetch("not a url");
    expect(bad).toBeInstanceOf(Promise);
    expect(await rejection(bad)).toContain("Invalid URL");
    const none = (stub as any).fetch();
    expect(none).toBeInstanceOf(Promise);
    expect(await rejection(none)).not.toBe("resolved");
    const notAServer = stub.fetch("http://do/", {}, {});
    expect(notAServer).toBeInstanceOf(Promise);
    expect(await rejection(notAServer)).toStartWith(
      'TypeError [ERR_INVALID_ARG_TYPE]: The "server" argument must be of type Server.',
    );
    expect(await rejection(stub.fetch("http://do/", {}, 5))).toStartWith(
      'TypeError [ERR_INVALID_ARG_TYPE]: The "server" argument must be of type Server.',
    );
    expect(thrown(() => stub.fetch.call({}, "http://do/"))).toStartWith("TypeError [");
    expect((await stub.fetch("http://do/ok")).status).toBe(200);
  });

  test("a fetch() that does not return a Response rejects with a TypeError", async () => {
    await using ns = new Namespace({ class: Fetcher });
    const stub = ns.getByName("a");
    // Nothing is only an answer after server.upgrade(request) said true.
    for (const path of ["/string", "/object", "/null", "/undefined", "/nothing"]) {
      const result = stub.fetch(`http://do${path}`);
      expect(result).toBeInstanceOf(Promise);
      expect({ path, rejection: await rejection(result) }).toEqual({
        path,
        rejection:
          "TypeError [undefined]: A Durable Object's fetch() must return a Response, or nothing after server.upgrade(request)",
      });
    }
    expect(await rejection(stub.fetch("http://do/throw"))).toBe("Error [undefined]: fetch threw");
    expect((await stub.fetch("http://do/ok")).status).toBe(200);
  });

  test("a fetch() that returns nothing after server.upgrade(request) said no rejects as well", async () => {
    await using ns = new Namespace({ class: Fetcher });
    const stub = ns.getByName("a");
    const rejections: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      websocket: Bun.DurableObject.websocket,
      // What the host's handler gets back from the stub, turned into a response the test can read.
      fetch: (request, server) =>
        stub.fetch(request, server).then(
          response => response ?? new Response("upgraded", { status: 200 }),
          error => {
            rejections.push(described(error));
            return new Response(described(error), { status: 502 });
          },
        ),
    });
    // An ordinary GET, not a WebSocket handshake: there is nothing to upgrade.
    const response = await fetch(`http://127.0.0.1:${server.port}/upgrade-refused`);
    expect(await response.text()).toBe(
      "TypeError [undefined]: A Durable Object's fetch() must return a Response, or nothing after server.upgrade(request)",
    );
    expect(response.status).toBe(502);
    expect(await stub.upgradeResults()).toEqual([false]);
    expect(rejections).toHaveLength(1);
    // The object and the server go on.
    expect(await (await fetch(`http://127.0.0.1:${server.port}/sync-response`)).text()).toBe("sync");
  });

  test("a class without fetch() rejects", async () => {
    await using ns = counters();
    const stub = ns.getByName("a");
    const error = await stub.fetch("http://do/").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('The Durable Object "Counter" has no fetch() handler');
    expect(await stub.add(1, 2)).toBe(3);
  });

  test("the server a real Bun.serve passes is accepted in both positions", async () => {
    await using ns = new Namespace({ class: Fetcher });
    const stub = ns.getByName("a");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request, server) {
        const url = new URL(request.url);
        if (url.pathname === "/two") return (await stub.fetch(request, server))!;
        return (await stub.fetch(request.url, { method: request.method, headers: request.headers }, server))!;
      },
    });
    const two = await (await fetch(`http://127.0.0.1:${server.port}/two`, { headers: { "x-test": "2" } })).json();
    expect(two).toMatchObject({ isRequest: true, header: "2", server: "object", argumentCount: 2 });
    const three = await (await fetch(`http://127.0.0.1:${server.port}/three`, { headers: { "x-test": "3" } })).json();
    expect(three).toMatchObject({ isRequest: true, header: "3", server: "object", argumentCount: 2 });
  });
});

const moduleSource = `
import { DurableObject } from "bun";

let moduleCounter = 0;
export const loadedAt = [];

export default class ModuleCounter extends DurableObject {
  bump() {
    return ++moduleCounter;
  }
  which() {
    return "default";
  }
  getEnv() {
    return this.env;
  }
  graph() {
    return Bun.ModuleGraph.current;
  }
  sameBun() {
    return { DurableObject: DurableObject === Bun.DurableObject, extendsIt: this instanceof Bun.DurableObject };
  }
  idName() {
    return this.ctx.id.name;
  }
}

export class Named extends DurableObject {
  bump() {
    return ++moduleCounter;
  }
  which() {
    return "Named";
  }
}

export const notAClass = 42;
export const arrow = () => {};
`;

const globalsSource = `
export default class UsesGlobals extends Bun.DurableObject {
  read() {
    return { injected: INJECTED, shared: SHARED_OBJECT, missing: typeof NOT_INJECTED };
  }
  call() {
    return hostFunction(this.ctx.id.name);
  }
}
`;

const throwingSource = `
globalThis.__durableObjectThrowingLoads = (globalThis.__durableObjectThrowingLoads ?? 0) + 1;
throw new Error("top level of the module threw");
export default class Never extends Bun.DurableObject {
  hello() {
    return "unreachable";
  }
}
`;

const syntaxErrorSource = `export default class { this is not javascript }`;

class SharedState extends Bun.DurableObject {
  static shared = 0;
  bump() {
    return ++SharedState.shared;
  }
  graph() {
    return (Bun as any).ModuleGraph.current;
  }
}

describe("class mode and module mode", () => {
  test("module mode: default export, named export, and the default name", async () => {
    using dir = tempDir("durable-object-module", { "counter.ts": moduleSource });
    const module = join(String(dir), "counter.ts");
    await using byDefault = new Namespace({ module });
    await using explicitDefault = new Namespace({ module, export: "default" });
    await using named = new Namespace({ module, export: "Named" });
    expect(await byDefault.getByName("a").which()).toBe("default");
    expect(await explicitDefault.getByName("a").which()).toBe("default");
    expect(await named.getByName("a").which()).toBe("Named");
    expect(await byDefault.getByName("a").idName()).toBe("a");
    expect(await byDefault.getByName("a").sameBun()).toEqual({ DurableObject: true, extendsIt: true });
    // The namespace's name defaults to the export's name, or to the module's path for the default export.
    await using sameAsNamed = counters({ name: "Named" });
    expect(String(named.idFromName("x"))).toBe(String(sameAsNamed.idFromName("x")));
    await using sameAsDefault = counters({ name: module });
    expect(String(byDefault.idFromName("x"))).toBe(String(sameAsDefault.idFromName("x")));
    expect(String(byDefault.idFromName("x"))).toBe(String(explicitDefault.idFromName("x")));
    expect(String(byDefault.idFromName("x"))).not.toBe(String(named.idFromName("x")));
    expect(await rejection(named.getByName("a").nope())).toBe(
      'TypeError [undefined]: The Durable Object "Named" has no method "nope"',
    );
  });

  test("module mode: a missing export rejects every call with a TypeError that mentions it", async () => {
    using dir = tempDir("durable-object-module", { "counter.ts": moduleSource });
    const module = join(String(dir), "counter.ts");
    for (const exportName of ["DoesNotExist", "notAClass", "arrow"]) {
      await using ns = new Namespace({ module, export: exportName });
      const stub = ns.getByName("a");
      for (let i = 0; i < 2; i++) {
        const error = await stub.which().then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toContain(`"${exportName}"`);
        expect(error.message).toContain(module);
      }
      const viaFetch = await stub.fetch("http://do/").then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(viaFetch).toBeInstanceOf(TypeError);
      expect(viaFetch.message).toContain(`"${exportName}"`);
      const getter = await stub.which.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(getter).toBeInstanceOf(TypeError);
      // Several at once: all of them reject.
      const settled = await Promise.allSettled([stub.which(), stub.bump(), ns.getByName("b").which()]);
      expect(settled.map(r => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    }
  });

  test("module mode: a module that throws at top level rejects every call with what it threw", async () => {
    using dir = tempDir("durable-object-module", { "throws.ts": throwingSource, "syntax.ts": syntaxErrorSource });
    await using ns = new Namespace({ module: join(String(dir), "throws.ts") });
    const stub = ns.getByName("a");
    expect(await rejection(stub.hello())).toBe("Error [undefined]: top level of the module threw");
    expect(await rejection(stub.hello())).toBe("Error [undefined]: top level of the module threw");
    expect(await rejection(ns.getByName("b").hello())).toBe("Error [undefined]: top level of the module threw");
    const settled = await Promise.allSettled([stub.hello(), stub.hello()]);
    expect(settled.map(r => r.status)).toEqual(["rejected", "rejected"]);
    expect((globalThis as any).__durableObjectThrowingLoads).toBeGreaterThanOrEqual(2);
    delete (globalThis as any).__durableObjectThrowingLoads;

    await using broken = new Namespace({ module: join(String(dir), "syntax.ts") });
    expect(await rejection(broken.getByName("a").hello())).not.toBe("resolved");
    expect(await rejection(broken.getByName("a").hello())).not.toBe("resolved");
  });

  test("module state is per object in module mode and shared in class mode", async () => {
    using dir = tempDir("durable-object-module", { "counter.ts": moduleSource });
    const module = join(String(dir), "counter.ts");
    await using modules = new Namespace({ module });
    const a = modules.getByName("a");
    const b = modules.getByName("b");
    expect(await a.bump()).toBe(1);
    expect(await a.bump()).toBe(2);
    expect(await a.bump()).toBe(3);
    expect(await b.bump()).toBe(1);
    expect(await a.bump()).toBe(4);
    expect(await b.bump()).toBe(2);
    // Another namespace on the same module is separate as well, even for the same name.
    await using again = new Namespace({ module });
    expect(await again.getByName("a").bump()).toBe(1);
    // Two exports of one module loaded by one object's graph share that graph's module state,
    // but not with objects of another namespace.
    await using named = new Namespace({ module, export: "Named" });
    expect(await named.getByName("a").bump()).toBe(1);

    SharedState.shared = 0;
    await using classes = new Namespace({ class: SharedState });
    expect(await classes.getByName("a").bump()).toBe(1);
    expect(await classes.getByName("b").bump()).toBe(2);
    expect(await classes.getByName("a").bump()).toBe(3);
    expect(SharedState.shared).toBe(3);
  });

  test("globals are free identifiers of the module", async () => {
    using dir = tempDir("durable-object-module", { "globals.ts": globalsSource });
    const shared = { by: "reference" };
    const calls: string[] = [];
    await using ns = new Namespace({
      module: join(String(dir), "globals.ts"),
      globals: {
        INJECTED: "injected value",
        SHARED_OBJECT: shared,
        hostFunction(name: string) {
          calls.push(name);
          return `host saw ${name}`;
        },
      },
    });
    const seen = await ns.getByName("a").read();
    expect(seen.injected).toBe("injected value");
    expect(seen.shared).toBe(shared);
    expect(seen.missing).toBe("undefined");
    expect(await ns.getByName("a").call()).toBe("host saw a");
    expect(await ns.getByName("b").call()).toBe("host saw b");
    expect(calls).toEqual(["a", "b"]);
    // Not globals of the host.
    expect(typeof (globalThis as any).INJECTED).toBe("undefined");
    expect(typeof (globalThis as any).hostFunction).toBe("undefined");
    // Without them, the identifiers are not defined.
    await using without = new Namespace({ module: join(String(dir), "globals.ts") });
    expect(await rejection(without.getByName("a").read())).toStartWith("ReferenceError [undefined]:");
  });

  test("globals are what they were when the namespace was made", async () => {
    using dir = tempDir("durable-object-module", { "globals.ts": globalsSource });
    const shared = { by: "reference" };
    const calls: string[] = [];
    const globals: Record<string, unknown> = {
      INJECTED: "at construction",
      SHARED_OBJECT: shared,
      hostFunction: (name: string) => (calls.push("first " + name), "first"),
    };
    await using ns = new Namespace({ module: join(String(dir), "globals.ts"), globals });
    // Before any object was loaded: changed, added and removed.
    globals.INJECTED = "changed afterwards";
    globals.NOT_INJECTED = "added afterwards";
    globals.hostFunction = (name: string) => (calls.push("second " + name), "second");
    delete globals.SHARED_OBJECT;
    expect(await ns.getByName("a").read()).toEqual({ injected: "at construction", shared, missing: "undefined" });
    expect((await ns.getByName("a").read()).shared).toBe(shared);
    expect(await ns.getByName("a").call()).toBe("first");
    // And between one object and the next.
    globals.INJECTED = "changed again";
    expect(await ns.getByName("b").read()).toEqual({ injected: "at construction", shared, missing: "undefined" });
    expect(await ns.getByName("b").call()).toBe("first");
    expect(calls).toEqual(["first a", "first b"]);
    // The values are not copies: what the host does to one, the objects see.
    (shared as any).changed = true;
    expect((await ns.getByName("b").read()).shared).toEqual({ by: "reference", changed: true });
    // A getter is read once, at construction.
    let reads = 0;
    await using withGetter = new Namespace({
      module: join(String(dir), "globals.ts"),
      globals: {
        get INJECTED() {
          return "read " + ++reads;
        },
        SHARED_OBJECT: null,
        hostFunction: () => {},
      },
    });
    expect(reads).toBe(1);
    expect((await withGetter.getByName("a").read()).injected).toBe("read 1");
    expect((await withGetter.getByName("b").read()).injected).toBe("read 1");
    expect(reads).toBe(1);
  });

  test("a relative module specifier is resolved from the working directory", async () => {
    using dir = tempDir("durable-object-relative", {
      "objects/greeter.ts": `
        export class Greeter extends Bun.DurableObject {
          hello() {
            return "hello from " + import.meta.path.slice(process.cwd().length);
          }
        }
      `,
      "host/nested/main.ts": `
        const open = module => new Bun.DurableObjectNamespace({ module, export: "Greeter" });
        // "./" is the working directory, wherever the script that says it is.
        for (const specifier of ["./objects/greeter.ts", "./objects/../objects/greeter.ts", "../" + process.argv[2] + "/objects/greeter.ts"]) {
          const ns = open(specifier);
          console.log(await ns.getByName("a").hello());
          await ns.close();
        }
        for (const specifier of ["./greeter.ts", "./host/nested/greeter.ts", "../objects/greeter.ts"]) {
          try {
            open(specifier);
            console.log("opened", specifier);
          } catch (error) {
            console.log(error.code, specifier);
          }
        }
        // Still the working directory after it changed.
        process.chdir("objects");
        const ns = open("./greeter.ts");
        console.log(await ns.getByName("a").hello());
        await ns.close();
      `,
    });
    const cwd = String(dir);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join("host", "nested", "main.ts"), cwd.split(/[\\/]/).at(-1)!],
      cwd,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.replaceAll("\\", "/").split("\n")).toEqual([
      "hello from /objects/greeter.ts",
      "hello from /objects/greeter.ts",
      "hello from /objects/greeter.ts",
      "ERR_MODULE_NOT_FOUND ./greeter.ts",
      "ERR_MODULE_NOT_FOUND ./host/nested/greeter.ts",
      "ERR_MODULE_NOT_FOUND ../objects/greeter.ts",
      "hello from /greeter.ts",
      "",
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("env is passed by reference, in both modes", async () => {
    using dir = tempDir("durable-object-module", { "counter.ts": moduleSource });
    const env = { tag: "the env", list: [] as unknown[] };
    await using modules = new Namespace({ module: join(String(dir), "counter.ts"), env });
    expect(await modules.getByName("a").getEnv()).toBe(env);
    expect(await modules.getByName("b").getEnv()).toBe(env);
    await using classes = counters({ env });
    expect((await classes.getByName("a").whoami()).env).toBe(env);
    expect((await classes.getByName("a").self()).env).toBe(env);
    // Anything can be the env.
    await using primitive = counters({ env: 5 });
    expect((await primitive.getByName("a").whoami()).env).toBe(5);
    await using nothing = counters({ env: null });
    expect((await nothing.getByName("a").whoami()).env).toBe(null);
  });

  test("Bun.ModuleGraph.current is defined inside an object and distinct per object", async () => {
    using dir = tempDir("durable-object-module", { "counter.ts": moduleSource });
    expect((Bun as any).ModuleGraph.current).toBe(undefined);
    await using modules = new Namespace({ module: join(String(dir), "counter.ts") });
    await using classes = new Namespace({ class: SharedState });
    for (const ns of [modules, classes]) {
      const a = await ns.getByName("a").graph();
      const b = await ns.getByName("b").graph();
      expect(Object.prototype.toString.call(a)).toBe("[object ModuleGraph]");
      expect(Object.prototype.toString.call(b)).toBe("[object ModuleGraph]");
      expect(a).not.toBe(b);
      expect(await ns.getByName("a").graph()).toBe(a);
      expect(await ns.get(ns.idFromName("b")).graph()).toBe(b);
    }
    expect(await modules.getByName("a").graph()).not.toBe(await classes.getByName("a").graph());
    expect((Bun as any).ModuleGraph.current).toBe(undefined);
  });
});

describe("a class that does not extend Bun.DurableObject", () => {
  class Plain {
    static constructed = 0;
    calls = 0;
    constructor(
      public ctx: Bun.DurableObjectState,
      public env: unknown,
      ...rest: unknown[]
    ) {
      Plain.constructed++;
      if (rest.length) throw new Error("expected (ctx, env) only");
    }
    hello(greeting: string) {
      this.calls++;
      return `${greeting}, ${this.ctx.id.name} (${this.calls})`;
    }
    get kind() {
      return "plain";
    }
    getEnv() {
      return this.env;
    }
    ctxKind() {
      return Object.prototype.toString.call(this.ctx);
    }
    fetch(request: Request) {
      return new Response(`plain ${new URL(request.url).pathname}`);
    }
  }

  test("is constructed with (ctx, env) and works the same way", async () => {
    const env = { plain: true };
    await using ns = new Namespace({ class: Plain, env });
    const stub = ns.getByName("p");
    const before = Plain.constructed;
    expect(await stub.hello("hi")).toBe("hi, p (1)");
    expect(await stub.hello("hey")).toBe("hey, p (2)");
    expect(Plain.constructed).toBe(before + 1);
    expect(await stub.kind).toBe("plain");
    expect(await stub.getEnv()).toBe(env);
    expect(await stub.ctxKind()).toBe("[object DurableObjectState]");
    expect(await (await stub.fetch("http://do/x")).text()).toBe("plain /x");
    expect(stub.ctx).toBe(undefined);
    expect(stub.env).toBe(undefined);
    expect(await stub.calls).toBe(undefined);
    expect(await rejection(stub.nope())).toBe('TypeError [undefined]: The Durable Object "Plain" has no method "nope"');
    expect(String(ns.idFromName("x"))).toMatch(HEX64);
  });

  test("a function constructor with prototype methods works too", async () => {
    function Legacy(this: any, ctx: Bun.DurableObjectState) {
      this.ctx = ctx;
    }
    Legacy.prototype.hello = function () {
      return `legacy ${this.ctx.id.name}`;
    };
    await using ns = new Namespace({ class: Legacy });
    expect(await ns.getByName("l").hello()).toBe("legacy l");
  });
});

describe("close()", () => {
  class Slow extends Bun.DurableObject {
    finished = 0;
    async wait(gate: Promise<void>, log: string[]) {
      log.push("started");
      await gate;
      this.finished++;
      log.push("finished");
      return "done";
    }
    quick() {
      return "quick";
    }
  }

  test("waits for a running call", async () => {
    const ns = new Namespace({ class: Slow });
    const stub = ns.getByName("a");
    const gate = Promise.withResolvers<void>();
    const log: string[] = [];
    const running = stub.wait(gate.promise, log);
    expect(log).toEqual(["started"]);
    const closing = ns.close();
    expect(closing).toBeInstanceOf(Promise);
    let closed = false;
    closing.then(() => {
      closed = true;
      log.push("closed");
    });
    await turns();
    expect(closed).toBe(false);
    // Calls made from now on fail, while it is still closing.
    const late = stub.quick();
    expect(late).toBeInstanceOf(Promise);
    expect(await rejection(late)).toStartWith("Error [ERR_INVALID_STATE]:");
    expect(closed).toBe(false);
    gate.resolve();
    expect(await closing).toBe(undefined);
    expect(await running).toBe("done");
    expect(log).toEqual(["started", "finished", "closed"]);
  });

  test("later calls reject with ERR_INVALID_STATE, through old and new stubs", async () => {
    const ns = new Namespace({ class: Slow });
    const stub = ns.getByName("a");
    expect(await stub.quick()).toBe("quick");
    const method = stub.quick;
    await ns.close();
    for (const call of [
      () => stub.quick(),
      () => method(),
      () => stub.neverCalledBefore(),
      () => stub.fetch("http://do/"),
      () => stub.quick.then((v: unknown) => v),
      () => ns.getByName("a").quick(),
      () => ns.getByName("b").quick(),
      () => ns.get(ns.idFromName("c")).quick(),
      () => ns.get(ns.newUniqueId()).quick(),
    ]) {
      const result = call();
      expect(result).toBeInstanceOf(Promise);
      const error = await result.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe("ERR_INVALID_STATE");
      expect(error.message).toContain("closed");
    }
    // Ids are still values.
    expect(String(stub.id)).toMatch(HEX64);
    expect(stub.name).toBe("a");
  });

  test("twice returns, also while the first is still waiting", async () => {
    const ns = new Namespace({ class: Slow });
    const gate = Promise.withResolvers<void>();
    const running = ns.getByName("a").wait(gate.promise, []);
    const first = ns.close();
    const second = ns.close();
    expect(second).toBeInstanceOf(Promise);
    let secondClosed = false;
    second.then(() => (secondClosed = true));
    await turns();
    expect(secondClosed).toBe(false);
    gate.resolve();
    expect(await first).toBe(undefined);
    expect(await second).toBe(undefined);
    expect(await running).toBe("done");
    expect(await ns.close()).toBe(undefined);
    expect(await ns.close()).toBe(undefined);

    // A namespace nothing was ever called on.
    const unused = new Namespace({ class: Slow });
    expect(await unused.close()).toBe(undefined);
    expect(await unused.close()).toBe(undefined);
  });

  test("queued calls made before close() still run", async () => {
    const ns = new Namespace({ class: Slow });
    const stub = ns.getByName("a");
    const gate = Promise.withResolvers<void>();
    const log: string[] = [];
    // `wait` is running (parked on the gate, which is not I/O the object started); `quick` was accepted before close().
    const running = stub.wait(gate.promise, log);
    const queued = stub.quick();
    const closing = ns.close();
    gate.resolve();
    await closing;
    expect(await running).toBe("done");
    expect(await queued).toBe("quick");
  });

  test("await using closes the namespace", async () => {
    let escaped: any;
    let escapedNamespace: AnyNamespace;
    {
      await using ns = new Namespace({ class: Slow });
      escapedNamespace = ns;
      escaped = ns.getByName("a");
      expect(await escaped.quick()).toBe("quick");
    }
    expect(await rejection(escaped.quick())).toStartWith("Error [ERR_INVALID_STATE]:");
    expect(await rejection(escapedNamespace.getByName("b").quick())).toStartWith("Error [ERR_INVALID_STATE]:");
    // Symbol.asyncDispose is close.
    const ns = new Namespace({ class: Slow });
    const disposing = ns[Symbol.asyncDispose]();
    expect(disposing).toBeInstanceOf(Promise);
    expect(await disposing).toBe(undefined);
    expect(await rejection(ns.getByName("a").quick())).toStartWith("Error [ERR_INVALID_STATE]:");
  });

  test("the class is constructed again by a new namespace after close", async () => {
    const before = Counter.constructed;
    {
      await using ns = counters();
      expect(await ns.getByName("a").increment()).toBe(1);
      expect(await ns.getByName("a").increment()).toBe(2);
    }
    {
      await using ns = counters();
      // In-memory state belongs to the namespace that is gone.
      expect(await ns.getByName("a").increment()).toBe(1);
    }
    expect(Counter.constructed).toBe(before + 2);
  });
});
