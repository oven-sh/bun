import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

type AlarmInfo = { isRetry: boolean; retryCount: number; scheduledTime: number };
type State = Bun.DurableObjectState;

/** Collects events; `waitFor(n)` resolves once `n` have arrived (or rejects at the deadline). */
function collector<T>() {
  const items: T[] = [];
  let waiters: (() => void)[] = [];
  return {
    items,
    push(item: T) {
      items.push(item);
      const woken = waiters;
      waiters = [];
      for (const wake of woken) wake();
    },
    async waitFor(n: number, ms = 4000): Promise<T[]> {
      const deadline = Date.now() + ms;
      while (items.length < n) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`expected ${n} events within ${ms}ms, got ${items.length}`);
        let timer: Timer | undefined;
        await new Promise<void>(resolve => {
          waiters.push(resolve);
          timer = setTimeout(resolve, left);
        });
        clearTimeout(timer);
      }
      return items;
    },
  };
}

type Fired = {
  name: string | undefined;
  id: string;
  info: AlarmInfo;
  during: number | null;
  graph: unknown;
  at: number;
};

type Env = {
  fired: ReturnType<typeof collector<Fired>>;
  constructed?: (name: string | undefined) => void;
  /** Runs inside alarm(), after the bookkeeping. */
  inAlarm?: (ctx: State, info: AlarmInfo, fired: Fired) => unknown;
};

class AlarmObject extends Bun.DurableObject<Env> {
  constructor(ctx: State, env: Env) {
    super(ctx, env);
    env.constructed?.(ctx.id.name);
  }
  async setAlarm(time: number | Date) {
    await this.ctx.storage.setAlarm(time);
    return await this.ctx.storage.getAlarm();
  }
  async setAlarmIn(ms: number) {
    const time = Date.now() + ms;
    await this.ctx.storage.setAlarm(time);
    return time;
  }
  getAlarm() {
    return this.ctx.storage.getAlarm();
  }
  async deleteAlarm() {
    await this.ctx.storage.deleteAlarm();
    return await this.ctx.storage.getAlarm();
  }
  /** What setAlarm(value) does: "sync throw" | "ok" | the rejection. */
  trySetAlarm(value: unknown) {
    let promise: Promise<void>;
    try {
      promise = this.ctx.storage.setAlarm(value as number);
    } catch (e: any) {
      return { how: "sync throw", name: e?.name, code: e?.code };
    }
    if (!(promise instanceof Promise)) return { how: "not a promise" };
    return promise.then(
      () => ({ how: "ok" }),
      e => ({ how: "rejected", name: e?.name, code: e?.code }),
    );
  }
  graph() {
    return Bun.ModuleGraph.current;
  }
  count() {
    return this.ctx.storage.kv.get<number>("alarms") ?? 0;
  }
  setInThrowingTransaction(time: number) {
    try {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.setAlarm(time);
        this.ctx.storage.kv.put("in-transaction", 1);
        throw new Error("rolled back");
      });
    } catch (e: any) {
      return [e.message, this.ctx.storage.kv.get("in-transaction")];
    }
    return "did not throw";
  }
  setThenAbort(time: number) {
    this.ctx.storage.setAlarm(time);
    this.ctx.abort("aborted after setAlarm");
  }
  async setAwaitThenAbort(time: number) {
    await this.ctx.storage.setAlarm(time);
    this.ctx.abort("aborted after committed setAlarm");
  }
  async deleteAll() {
    await this.ctx.storage.deleteAll();
    return await this.ctx.storage.getAlarm();
  }
  async alarm(info: AlarmInfo) {
    const during = await this.ctx.storage.getAlarm();
    this.ctx.storage.kv.put("alarms", (this.ctx.storage.kv.get<number>("alarms") ?? 0) + 1);
    const fired: Fired = {
      name: this.ctx.id.name,
      id: String(this.ctx.id),
      info,
      during,
      graph: Bun.ModuleGraph.current,
      at: Date.now(),
    };
    this.env.fired.push(fired);
    await this.env.inAlarm?.(this.ctx, info, fired);
  }
}

function open(options: Partial<Bun.DurableObjectNamespaceOptions<AlarmObject>> & { env?: Partial<Env> } = {}) {
  const env: Env = { fired: collector<Fired>(), ...options.env };
  const ns = new Bun.DurableObjectNamespace<AlarmObject>({ class: AlarmObject, ...options, env });
  return { ns, env, fired: env.fired };
}

/**
 * An alarm on another object, later than the ones under test: when it has fired, the
 * earlier ones have fired too, if they were going to.
 */
async function sentinel(ns: Bun.DurableObjectNamespace<AlarmObject>, fired: Env["fired"], afterMs: number) {
  const name = "sentinel-" + Math.random().toString(36).slice(2);
  await ns.getByName(name).setAlarmIn(afterMs);
  while (!fired.items.some(f => f.name === name)) await fired.waitFor(fired.items.length + 1);
}

describe("Bun.DurableObject alarms", () => {
  test("setAlarm / getAlarm / deleteAlarm with a number and a Date", async () => {
    const { ns } = open();
    await using _ = ns;
    const stub = ns.getByName("basics");
    expect(await stub.getAlarm()).toBeNull();

    const time = Date.now() + 60_000;
    expect(await stub.setAlarm(time)).toBe(time);
    expect(await stub.getAlarm()).toBe(time);

    const date = new Date(time + 5_000);
    expect(await stub.setAlarm(date)).toBe(date.getTime());
    expect(await stub.getAlarm()).toBe(date.getTime());

    // Milliseconds are whole.
    expect(await stub.setAlarm(time + 0.75)).toBe(time);

    expect(await stub.deleteAlarm()).toBeNull();
    expect(await stub.getAlarm()).toBeNull();
    // Deleting when there is none is fine.
    expect(await stub.deleteAlarm()).toBeNull();

    // Another object of the namespace has an alarm of its own.
    expect(await ns.getByName("other").getAlarm()).toBeNull();
    expect(await stub.setAlarm(time)).toBe(time);
    expect(await ns.getByName("other").getAlarm()).toBeNull();
    expect(await stub.deleteAlarm()).toBeNull();
  });

  test("alarm(info) gets isRetry, retryCount, scheduledTime; getAlarm() is null during and after", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("info");
    const before = Date.now();
    const time = await stub.setAlarmIn(40);
    const [event] = await fired.waitFor(1);
    expect(event.info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });
    expect(event.during).toBeNull();
    expect(event.name).toBe("info");
    expect(event.id).toBe(String(ns.idFromName("info")));
    expect(event.at).toBeGreaterThanOrEqual(time);
    expect(event.at - before).toBeLessThan(5000);
    expect(await stub.getAlarm()).toBeNull();
    expect(await stub.count()).toBe(1);
    expect(fired.items).toHaveLength(1);
  });

  test("an alarm set in the past fires promptly", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("past");
    const time = Date.now() - 60_000;
    expect(await stub.setAlarm(time)).toBe(time);
    const [event] = await fired.waitFor(1, 3000);
    expect(event.info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });
    expect(await stub.getAlarm()).toBeNull();

    // And a Date in the past.
    const date = new Date(1);
    await stub.setAlarm(date);
    await fired.waitFor(2, 3000);
    expect(fired.items[1].info.scheduledTime).toBe(1);
    expect(await stub.count()).toBe(2);
  });

  test("setting the alarm again moves it: only the last one fires", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("moved");
    const first = await stub.setAlarmIn(30);
    const second = await stub.setAlarmIn(250);
    expect(second).toBeGreaterThan(first);
    expect(await stub.getAlarm()).toBe(second);

    // Past the first time, nothing has fired for "moved".
    await sentinel(ns, fired, 90);
    expect(fired.items.filter(f => f.name === "moved")).toEqual([]);
    expect(await stub.getAlarm()).toBe(second);

    await fired.waitFor(2);
    const events = fired.items.filter(f => f.name === "moved");
    expect(events).toHaveLength(1);
    expect(events[0].info.scheduledTime).toBe(second);
    expect(events[0].at).toBeGreaterThanOrEqual(second);

    // Moving it earlier works as well.
    const late = await stub.setAlarmIn(60_000);
    const early = await stub.setAlarmIn(20);
    expect(early).toBeLessThan(late);
    await fired.waitFor(3);
    expect(fired.items.filter(f => f.name === "moved").map(f => f.info.scheduledTime)).toEqual([second, early]);
    expect(await stub.getAlarm()).toBeNull();
    expect(await stub.count()).toBe(2);
  });

  test("deleteAlarm cancels", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("cancelled");
    await stub.setAlarmIn(40);
    expect(await stub.deleteAlarm()).toBeNull();
    await sentinel(ns, fired, 100);
    expect(fired.items.filter(f => f.name === "cancelled")).toEqual([]);
    expect(await stub.count()).toBe(0);
    expect(await stub.getAlarm()).toBeNull();
  });

  test("setAlarm on a class without alarm() rejects with a TypeError", async () => {
    class NoAlarm extends Bun.DurableObject {
      set(time: number) {
        return this.ctx.storage.setAlarm(time);
      }
      async get() {
        return [await this.ctx.storage.getAlarm(), await this.ctx.storage.deleteAlarm()];
      }
    }
    await using ns = new Bun.DurableObjectNamespace<NoAlarm>({ class: NoAlarm });
    const stub = ns.getByName("a");
    expect(stub.set(Date.now() + 10)).rejects.toBeInstanceOf(TypeError);
    expect(stub.set(Date.now() + 10)).rejects.toThrow(/alarm\(\)/);
    // Reading and deleting need no handler.
    expect(await stub.get()).toEqual([null, undefined]);
  });

  test("invalid times are rejected", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("invalid");
    for (const value of [NaN, -1, Infinity, -Infinity, 2 ** 60, new Date(NaN)]) {
      expect(await stub.trySetAlarm(value)).toEqual({
        how: "rejected",
        name: "TypeError",
        code: "ERR_INVALID_ARG_VALUE",
      });
    }
    for (const value of ["soon", "1700000000000", undefined, null, {}, [], true, 12n, Symbol.iterator, () => 1]) {
      expect(await stub.trySetAlarm(value)).toEqual({
        how: "rejected",
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
      });
    }
    expect(await stub.getAlarm()).toBeNull();
    expect(await stub.trySetAlarm(Date.now() + 60_000)).toEqual({ how: "ok" });
    expect(await stub.deleteAlarm()).toBeNull();
    expect(fired.items).toEqual([]);
  });

  test("re-setting inside alarm() schedules another run: a chain of three", async () => {
    const times: number[] = [];
    const insideAfterSet: (number | null)[] = [];
    const { ns, fired } = open({
      env: {
        async inAlarm(ctx, info) {
          if (times.length < 3) {
            const next = Date.now() + 25;
            times.push(next);
            await ctx.storage.setAlarm(next);
            insideAfterSet.push(await ctx.storage.getAlarm());
          }
        },
      },
    });
    await using _ = ns;
    const stub = ns.getByName("chain");
    times.push(await stub.setAlarmIn(20));
    // The first and the second run set the next one; the third sets none.
    await fired.waitFor(3);
    expect(times).toHaveLength(3);
    expect(fired.items.map(f => f.info.scheduledTime)).toEqual(times);
    expect(fired.items.map(f => f.during)).toEqual([null, null, null]);
    expect(fired.items.map(f => f.info.isRetry)).toEqual([false, false, false]);
    expect(fired.items.map(f => f.info.retryCount)).toEqual([0, 0, 0]);
    expect(insideAfterSet).toEqual(times.slice(1));
    expect(await stub.getAlarm()).toBeNull();
    await sentinel(ns, fired, 60);
    expect(fired.items.filter(f => f.name === "chain")).toHaveLength(3);
    expect(await stub.count()).toBe(3);
  });

  test("deleteAlarm() inside alarm() of an alarm that was re-set leaves none", async () => {
    const { ns, fired } = open({
      env: {
        async inAlarm(ctx) {
          await ctx.storage.setAlarm(Date.now() + 20);
          await ctx.storage.deleteAlarm();
        },
      },
    });
    await using _ = ns;
    const stub = ns.getByName("reset-deleted");
    await stub.setAlarmIn(10);
    await fired.waitFor(1);
    expect(await stub.getAlarm()).toBeNull();
    await sentinel(ns, fired, 80);
    expect(fired.items.filter(f => f.name === "reset-deleted")).toHaveLength(1);
  });

  test("an alarm wakes an object that was evicted; ctx.id.name is the name it was addressed with", async () => {
    const constructed: (string | undefined)[] = [];
    const { ns, fired } = open({ idleTimeout: 10, env: { constructed: name => constructed.push(name) } });
    await using _ = ns;
    const time = await ns.getByName("sleeper").setAlarmIn(300);
    expect(constructed).toEqual(["sleeper"]);
    const [event] = await fired.waitFor(1);
    // The constructor ran again for the alarm: the object had been evicted in between.
    expect(constructed).toEqual(["sleeper", "sleeper"]);
    expect(event.name).toBe("sleeper");
    expect(event.id).toBe(String(ns.idFromName("sleeper")));
    expect(event.info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });
    expect(event.during).toBeNull();
    expect(await ns.getByName("sleeper").getAlarm()).toBeNull();
    // Storage written by the woken instance is the object's.
    expect(await ns.getByName("sleeper").count()).toBe(1);
  });

  test("alarms of 30 objects at nearly the same time each fire once, each in its own object", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const names = Array.from({ length: 30 }, (_, i) => `object-${i}`);
    const at = Date.now() + 150;
    const graphs = new Map<string, unknown>();
    const times = new Map<string, number>();
    await Promise.all(
      names.map(async (name, i) => {
        const stub = ns.getByName(name);
        times.set(name, (await stub.setAlarm(at + (i % 3)))!);
        graphs.set(name, await stub.graph());
      }),
    );
    expect(new Set(graphs.values()).size).toBe(30);
    await fired.waitFor(30);
    await sentinel(ns, fired, 50);
    const events = fired.items.filter(f => f.name?.startsWith("object-"));
    expect(events).toHaveLength(30);
    expect(events.map(f => f.name).sort()).toEqual([...names].sort());
    for (const event of events) {
      expect(event.graph).toBeDefined();
      expect(event.graph).toBe(graphs.get(event.name!));
      expect(event.id).toBe(String(ns.idFromName(event.name!)));
      expect(event.info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: times.get(event.name!)! });
    }
    expect(new Set(events.map(f => f.graph)).size).toBe(30);
    expect(await Promise.all(names.map(name => ns.getByName(name).count()))).toEqual(names.map(() => 1));
    expect(await Promise.all(names.map(name => ns.getByName(name).getAlarm()))).toEqual(names.map(() => null));
  });

  test("alarm() that throws: onError gets the error and the id, it is retried after about 2s, the alarm stays set meanwhile", async () => {
    const errors: { error: unknown; id: Bun.DurableObjectId }[] = [];
    const boom = new Error("alarm failed");
    const constructed: (string | undefined)[] = [];
    const { ns, fired } = open({
      onError: (error, id) => void errors.push({ error, id }),
      // The object is evicted between the failure and the retry: the count of retries is not the instance's.
      idleTimeout: 100,
      env: {
        constructed: name => constructed.push(name),
        inAlarm(ctx, info) {
          if (info.retryCount === 0) throw boom;
        },
      },
    });
    await using _ = ns;
    const stub = ns.getByName("retried");
    const time = await stub.setAlarmIn(20);
    await fired.waitFor(1);
    const failedAt = fired.items[0].at;
    expect(fired.items[0].info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });

    // A throwing handler does not clear the alarm.
    expect(await stub.getAlarm()).toBe(time);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe(boom);
    expect(String(errors[0].id)).toBe(String(ns.idFromName("retried")));
    expect(errors[0].id.equals(ns.idFromName("retried"))).toBe(true);
    expect(errors[0].id.name).toBe("retried");

    const constructedBeforeRetry = constructed.length;
    await fired.waitFor(2, 6000);
    expect(fired.items[1].info).toEqual({ isRetry: true, retryCount: 1, scheduledTime: time });
    expect(constructed.length).toBeGreaterThan(constructedBeforeRetry);
    expect(fired.items[1].during).toBeNull();
    const delay = fired.items[1].at - failedAt;
    expect(delay).toBeGreaterThanOrEqual(1500);
    expect(delay).toBeLessThan(4000);
    // The write of the failed run was kept (it was committed before the throw), and so was the retry's.
    expect(await stub.count()).toBe(2);
    expect(await stub.getAlarm()).toBeNull();
    expect(errors).toHaveLength(1);
  }, 15_000);

  test("setAlarm inside a transactionSync that throws is rolled back", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("rolled-back");
    expect(await stub.setInThrowingTransaction(Date.now() + 30)).toEqual(["rolled back", undefined]);
    expect(await stub.getAlarm()).toBeNull();
    await sentinel(ns, fired, 100);
    expect(fired.items.filter(f => f.name === "rolled-back")).toEqual([]);
    expect(await stub.count()).toBe(0);

    // The alarm that was set before the transaction is the one left after it.
    const kept = await stub.setAlarmIn(60_000);
    expect(await stub.setInThrowingTransaction(Date.now() + 30)).toEqual(["rolled back", undefined]);
    expect(await stub.getAlarm()).toBe(kept);
    await sentinel(ns, fired, 100);
    expect(fired.items.filter(f => f.name === "rolled-back")).toEqual([]);
    expect(await stub.deleteAlarm()).toBeNull();
  });

  test("setAlarm followed by ctx.abort() in the same synchronous run does not fire", async () => {
    const constructed: (string | undefined)[] = [];
    const { ns, fired } = open({ env: { constructed: name => constructed.push(name) } });
    await using _ = ns;
    const stub = ns.getByName("aborted");
    expect(await stub.getAlarm()).toBeNull();
    const error = await stub.setThenAbort(Date.now() + 30).then(
      () => undefined,
      e => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ERR_DURABLE_OBJECT_RESET");
    expect(await stub.getAlarm()).toBeNull();
    expect(constructed).toHaveLength(2);
    await sentinel(ns, fired, 100);
    expect(fired.items.filter(f => f.name === "aborted")).toEqual([]);
    expect(await stub.count()).toBe(0);
  });

  test("an alarm that was committed before ctx.abort() fires in the next instance", async () => {
    const constructed: (string | undefined)[] = [];
    const { ns, fired } = open({ env: { constructed: name => constructed.push(name) } });
    await using _ = ns;
    const stub = ns.getByName("committed");
    const time = Date.now() + 40;
    const error = await stub.setAwaitThenAbort(time).then(
      () => undefined,
      e => e,
    );
    expect(error.code).toBe("ERR_DURABLE_OBJECT_RESET");
    expect(await stub.getAlarm()).toBe(time);
    await fired.waitFor(1);
    expect(fired.items[0].name).toBe("committed");
    expect(fired.items[0].info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });
    expect(constructed).toHaveLength(2);
    expect(await stub.getAlarm()).toBeNull();
  });

  test("setAlarm() from the constructor", async () => {
    const fired = collector<[string, AlarmInfo]>();
    let constructed = 0;
    class Ticker extends Bun.DurableObject {
      constructor(ctx: State, env: unknown) {
        super(ctx, env);
        constructed++;
        ctx.blockConcurrencyWhile(async () => {
          if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 30);
        });
      }
      touch() {
        return this.ctx.storage.getAlarm();
      }
      alarm(info: AlarmInfo) {
        fired.push([this.ctx.id.name!, info]);
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Ticker>({ class: Ticker });
    const time = await ns.getByName("ticker").touch();
    expect(time).toBeNumber();
    await fired.waitFor(1);
    expect(fired.items).toEqual([["ticker", { isRetry: false, retryCount: 0, scheduledTime: time! }]]);
    expect(constructed).toBe(1);
  });

  test("deleteAll() clears the alarm", async () => {
    const { ns, fired } = open();
    await using _ = ns;
    const stub = ns.getByName("wiped");
    await stub.setAlarmIn(40);
    expect(await stub.deleteAll()).toBeNull();
    expect(await stub.getAlarm()).toBeNull();
    await sentinel(ns, fired, 100);
    expect(fired.items.filter(f => f.name === "wiped")).toEqual([]);
    // An alarm can be set again afterwards.
    const time = await stub.setAlarmIn(10);
    await fired.waitFor(2);
    expect(fired.items.filter(f => f.name === "wiped").map(f => f.info.scheduledTime)).toEqual([time]);
  });

  test("setAlarm through transaction(): committed when it fulfills, dropped on rollback()", async () => {
    const fired = collector<AlarmInfo>();
    class Txn extends Bun.DurableObject {
      async commit(ms: number) {
        const time = Date.now() + ms;
        const inside = await this.ctx.storage.transaction(async txn => {
          await txn.setAlarm(time);
          return await txn.getAlarm();
        });
        return [time, inside, await this.ctx.storage.getAlarm()];
      }
      async rollback(ms: number) {
        const time = Date.now() + ms;
        const inside = await this.ctx.storage.transaction(async txn => {
          await txn.setAlarm(time);
          const inside = await txn.getAlarm();
          txn.rollback();
          return inside;
        });
        return [time, inside, await this.ctx.storage.getAlarm()];
      }
      async reject(ms: number) {
        const time = Date.now() + ms;
        const error = await this.ctx.storage
          .transaction(async txn => {
            await txn.setAlarm(time);
            throw new Error("no");
          })
          .then(
            () => undefined,
            e => e.message,
          );
        return [error, await this.ctx.storage.getAlarm()];
      }
      alarm(info: AlarmInfo) {
        fired.push(info);
      }
    }
    await using ns = new Bun.DurableObjectNamespace<Txn>({ class: Txn });
    const stub = ns.getByName("t");
    {
      const [time, inside, after] = await stub.rollback(30);
      expect(inside).toBe(time);
      expect(after).toBeNull();
    }
    expect(await stub.reject(30)).toEqual(["no", null]);
    {
      const [time, inside, after] = await stub.commit(80);
      expect(inside).toBe(time);
      expect(after).toBe(time);
      await fired.waitFor(1);
      // Only the committed one fired, although the rolled back ones were due earlier.
      expect(fired.items).toEqual([{ isRetry: false, retryCount: 0, scheduledTime: time }]);
    }
  });
});

describe("Bun.DurableObject alarms with file storage", () => {
  test("an alarm set before ns.close() fires in a namespace reopened on the same directory", async () => {
    using dir = tempDir("do-alarm-reopen", {});
    const first = open({ storage: String(dir), name: "alarms" });
    const id = String(first.ns.idFromName("persisted"));
    const time = await first.ns.getByName("persisted").setAlarmIn(300);
    await first.ns.close();
    expect(first.fired.items).toEqual([]);

    const constructed: (string | undefined)[] = [];
    const second = open({ storage: String(dir), name: "alarms", env: { constructed: name => constructed.push(name) } });
    await using _ = second.ns;
    const [event] = await second.fired.waitFor(1);
    expect(event.id).toBe(id);
    expect(event.info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });
    expect(event.during).toBeNull();
    expect(event.at).toBeGreaterThanOrEqual(time);
    expect(constructed).toHaveLength(1);
    // The closed namespace did not run it.
    expect(first.fired.items).toEqual([]);
    expect(await second.ns.getByName("persisted").getAlarm()).toBeNull();
    expect(await second.ns.getByName("persisted").count()).toBe(1);
  });

  test("an alarm that came due while no namespace was open fires when one is opened", async () => {
    using dir = tempDir("do-alarm-overdue", {});
    const first = open({ storage: String(dir), name: "alarms" });
    const time = await first.ns.getByName("overdue").setAlarmIn(1);
    await first.ns.close();
    const ranBeforeClose = first.fired.items.length;

    const second = open({ storage: String(dir), name: "alarms" });
    await using _ = second.ns;
    if (ranBeforeClose === 0) {
      const [event] = await second.fired.waitFor(1);
      expect(event.info).toEqual({ isRetry: false, retryCount: 0, scheduledTime: time });
    }
    expect(await second.ns.getByName("overdue").getAlarm()).toBeNull();
    expect(await second.ns.getByName("overdue").count()).toBe(1);
  });

  const fixtures = {
    "object.ts": `
      export class Reminder extends Bun.DurableObject {
        async remind(ms) {
          const time = Date.now() + ms;
          await this.ctx.storage.setAlarm(time);
          this.ctx.storage.kv.put("note", "set by " + this.env.who);
          return time;
        }
        getAlarm() { return this.ctx.storage.getAlarm(); }
        async alarm(info) {
          console.log(JSON.stringify({
            alarm: info,
            who: this.env.who,
            note: this.ctx.storage.kv.get("note"),
            id: String(this.ctx.id),
            name: this.ctx.id.name ?? null,
            during: await this.ctx.storage.getAlarm(),
          }));
          this.env.done?.();
        }
      }
    `,
    "open.ts": `
      import { join } from "node:path";
      export const open = (who, done) =>
        new Bun.DurableObjectNamespace({
          module: join(import.meta.dir, "object.ts"),
          export: "Reminder",
          name: "reminders",
          storage: join(import.meta.dir, "data"),
          env: { who, done },
        });
    `,
    // Sets an alarm and leaves without waiting for it.
    "set-and-exit.ts": `
      import { open } from "./open.ts";
      const ns = open("first");
      const time = await ns.getByName("dentist").remind(Number(process.argv[2]));
      console.log(JSON.stringify({ set: time, id: String(ns.idFromName("dentist")) }));
      process.exit(0);
    `,
    // Opens the storage and does nothing but wait for whatever alarm is stored in it.
    "wait-for-alarm.ts": `
      import { open } from "./open.ts";
      const ns = open("second", () => ns.close().then(() => console.log("closed")));
      console.log("opened");
    `,
    // Sets an alarm and does nothing else: the alarm is what keeps the process running.
    "set-and-idle.ts": `
      import { open } from "./open.ts";
      const ns = open("idler");
      const time = await ns.getByName("idle").remind(200);
      console.log(JSON.stringify({ set: time }));
    `,
    // A pending alarm does not outlive close().
    "set-and-close.ts": `
      import { open } from "./open.ts";
      const ns = open("closer");
      const time = await ns.getByName("closed").remind(60_000);
      console.log(JSON.stringify({ set: time, alarm: await ns.getByName("closed").getAlarm() }));
      await ns.close();
      console.log("closed");
    `,
  };

  async function run(dir: string, script: string, ...args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, script), ...args],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.trim().split("\n").filter(Boolean), stderr, exitCode };
  }
  const parse = (line: string | undefined) => {
    try {
      return JSON.parse(line ?? "null");
    } catch {
      return line;
    }
  };

  test("an alarm set by a process that exited fires in the next process that opens the storage", async () => {
    using dir = tempDir("do-alarm-processes", fixtures);
    const first = await run(String(dir), "set-and-exit.ts", "400");
    expect(first.stderr).toBe("");
    expect(first.lines).toHaveLength(1);
    const { set, id } = parse(first.lines[0]);
    expect(set).toBeNumber();
    expect(first.exitCode).toBe(0);

    const second = await run(String(dir), "wait-for-alarm.ts");
    expect(second.stderr).toBe("");
    expect(second.lines.map(parse)).toEqual([
      "opened",
      {
        alarm: { isRetry: false, retryCount: 0, scheduledTime: set },
        who: "second",
        note: "set by first",
        id,
        // This process never addressed the object by name.
        name: null,
        during: null,
      },
      "closed",
    ]);
    expect(second.exitCode).toBe(0);

    // It has run: a third process finds no alarm, so nothing keeps it running.
    const third = await run(String(dir), "wait-for-alarm.ts");
    expect(third.stderr).toBe("");
    expect(third.lines).toEqual(["opened"]);
    expect(third.exitCode).toBe(0);
  }, 30_000);

  test("a pending alarm keeps the process alive until alarm() has run, then the process exits by itself", async () => {
    using dir = tempDir("do-alarm-keepalive", fixtures);
    const started = Date.now();
    const { lines, stderr, exitCode } = await run(String(dir), "set-and-idle.ts");
    expect(stderr).toBe("");
    expect(lines).toHaveLength(2);
    const { set } = parse(lines[0]);
    expect(parse(lines[1])).toEqual({
      alarm: { isRetry: false, retryCount: 0, scheduledTime: set },
      who: "idler",
      note: "set by idler",
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
      name: "idle",
      during: null,
    });
    expect(exitCode).toBe(0);
    // It did not wait for the idle timeout (10s by default) before exiting.
    expect(Date.now() - started).toBeLessThan(8000);
  }, 30_000);

  test("ns.close() with a pending alarm lets the process exit", async () => {
    using dir = tempDir("do-alarm-close-exit", fixtures);
    const { lines, stderr, exitCode } = await run(String(dir), "set-and-close.ts");
    expect(stderr).toBe("");
    expect(lines).toHaveLength(2);
    const { set, alarm } = parse(lines[0]);
    expect(alarm).toBe(set);
    expect(lines[1]).toBe("closed");
    expect(exitCode).toBe(0);
  }, 30_000);
});
