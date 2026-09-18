import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { getEventListeners, listenerCount } from "node:events";

describe("EventTarget listener removal", () => {
  // A { once: true } listener is removed before it runs. Each removal used to search the listener
  // vector from the start and then shift the tail, so one dispatch to N once listeners was O(N^2)
  // (AbortController.abort() with many once listeners takes the same path).
  //
  // The fixture puts M plain listeners in front of M once listeners. That makes both costs visible:
  // each search passes M plain listeners and each shift moves the once listeners that remain. The
  // first dispatch runs all 2M listeners and removes the M once listeners. The later dispatches run
  // the M plain listeners that remain, which gives the cost of a listener call on this machine.
  test("a dispatch to N { once: true } listeners is O(N)", async () => {
    // Registering the listeners is O(M^2) (the duplicate check), so a debug build gets a smaller M.
    const M = isDebug || isASAN ? 2000 : 8000;
    const fixture = `
      function makeTarget(plainCount, onceCount) {
        const target = new EventTarget();
        let calls = 0;
        for (let i = 0; i < plainCount; i++) target.addEventListener("x", () => void calls++);
        for (let i = 0; i < onceCount; i++) target.addEventListener("x", () => void calls++, { once: true });
        return { target, calls: () => calls };
      }
      function timeDispatch(target) {
        const start = performance.now();
        target.dispatchEvent(new Event("x"));
        return performance.now() - start;
      }

      const warmup = makeTarget(200, 200);
      for (let i = 0; i < 3; i++) timeDispatch(warmup.target);

      const M = ${M};
      const { target, calls } = makeTarget(M, M);
      Bun.gc(true);
      const once = timeDispatch(target);
      const callsAfterFirstDispatch = calls();
      const plain = Array.from({ length: 5 }, () => timeDispatch(target)).sort((a, b) => a - b)[2];
      console.log(JSON.stringify({ once, plain, callsAfterFirstDispatch, calls: calls() }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const stderrLines = stderr.split("\n").filter(line => line && !line.startsWith("WARNING: ASAN interferes"));
    expect(stderrLines).toEqual([]);
    const { once, plain, callsAfterFirstDispatch, calls } = JSON.parse(stdout);
    expect({ callsAfterFirstDispatch, calls }).toEqual({ callsAfterFirstDispatch: 2 * M, calls: 7 * M });

    // The first dispatch calls 2M listeners, a later dispatch calls M. With O(1) removals the first
    // dispatch costs about 1.5x of 2 * plain. With the O(N) removals it cost 13x to 16x on a
    // debug+ASAN build (M = 2000) and over 100x on a release build (M = 8000). The floor keeps a
    // scheduling delay out of the ratio when plain is about a millisecond.
    expect(once).toBeLessThan(Math.max(5 * 2 * plain, 50));
    expect(exitCode).toBe(0);
  });

  test("once listeners fire once, in order", () => {
    const target = new EventTarget();
    const fired: number[] = [];
    for (let i = 0; i < 50; i++) target.addEventListener("x", () => void fired.push(i), { once: true });

    target.dispatchEvent(new Event("x"));
    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(listenerCount(target, "x")).toBe(0);
  });

  test("plain listeners between once listeners keep their order", () => {
    const target = new EventTarget();
    const fired: string[] = [];
    for (let i = 0; i < 20; i++) {
      target.addEventListener("x", () => void fired.push(`plain${i}`));
      target.addEventListener("x", () => void fired.push(`once${i}`), { once: true });
    }
    const plainOnly = Array.from({ length: 20 }, (_, i) => `plain${i}`);

    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual(plainOnly.flatMap((plain, i) => [plain, `once${i}`]));

    fired.length = 0;
    target.addEventListener("x", () => void fired.push("added"));
    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual([...plainOnly, "added"]);
  });

  test("a once listener can add itself again while it runs", () => {
    const target = new EventTarget();
    let calls = 0;
    const listener = () => {
      if (++calls === 1) target.addEventListener("x", listener, { once: true });
    };
    target.addEventListener("x", listener, { once: true });

    for (let i = 0; i < 3; i++) target.dispatchEvent(new Event("x"));
    expect(calls).toBe(2);
  });

  test("stopImmediatePropagation() leaves the once listeners that did not run", () => {
    const target = new EventTarget();
    const fired: string[] = [];
    const stop = (event: Event) => {
      fired.push("stop");
      event.stopImmediatePropagation();
    };
    target.addEventListener("x", stop, { once: true });
    target.addEventListener("x", () => void fired.push("later"), { once: true });

    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual(["stop"]);
    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual(["stop", "later"]);
  });

  test("a listener removed by an earlier listener of the same dispatch does not run", () => {
    const target = new EventTarget();
    const fired: string[] = [];
    const later = () => void fired.push("later");
    const remover = () => {
      fired.push("remover");
      target.removeEventListener("x", later);
    };
    target.addEventListener("x", remover, { once: true });
    target.addEventListener("x", later, { once: true });

    target.dispatchEvent(new Event("x"));
    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual(["remover"]);
  });

  test("a nested dispatch does not run a once listener a second time", () => {
    const target = new EventTarget();
    const fired: string[] = [];
    const nested = () => {
      fired.push("a");
      target.dispatchEvent(new Event("x"));
    };
    target.addEventListener("x", nested, { once: true });
    target.addEventListener("x", () => void fired.push("b"), { once: true });
    target.addEventListener("x", () => void fired.push("c"), { once: true });

    target.dispatchEvent(new Event("x"));
    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual(["a", "b", "c"]);
  });

  test("a once listener is gone from listenerCount() and getEventListeners() while it runs", () => {
    const target = new EventTarget();
    const seen: { count: number; listeners: number }[] = [];
    const record = () =>
      void seen.push({ count: listenerCount(target, "x"), listeners: getEventListeners(target, "x").length });
    target.addEventListener("x", () => {}, { once: true });
    target.addEventListener("x", record, { once: true });
    target.addEventListener("x", () => {});
    target.addEventListener("x", () => record(), { once: true });

    target.dispatchEvent(new Event("x"));
    expect(seen).toEqual([
      { count: 2, listeners: 2 },
      { count: 1, listeners: 1 },
    ]);
  });

  test("AbortController.abort() runs every once listener of the signal", () => {
    const controller = new AbortController();
    let calls = 0;
    for (let i = 0; i < 500; i++) controller.signal.addEventListener("abort", () => void calls++, { once: true });
    controller.abort();
    expect(calls).toBe(500);
    expect(listenerCount(controller.signal, "abort")).toBe(0);
  });

  test("a GC after a removal keeps the listeners that remain", () => {
    const target = new EventTarget();
    const fired: number[] = [];
    const removed = () => void fired.push(-1);
    for (let i = 0; i < 8; i++) {
      target.addEventListener("x", i === 3 ? removed : () => void fired.push(i));
    }
    target.removeEventListener("x", removed);
    Bun.gc(true);

    target.dispatchEvent(new Event("x"));
    expect(fired).toEqual([0, 1, 2, 4, 5, 6, 7]);
  });

  test("transferring a MessagePort after a removal drops the listeners that remain", () => {
    const { port1, port2 } = new MessageChannel();
    const carrier = new MessageChannel();
    const fired: number[] = [];
    const listeners = Array.from({ length: 8 }, (_, i) => () => void fired.push(i));
    for (const listener of listeners) port1.addEventListener("message", listener);
    port1.removeEventListener("message", listeners[3]);

    carrier.port1.postMessage(null, [port1]);
    port1.dispatchEvent(new MessageEvent("message"));
    expect(fired).toEqual([]);

    for (const port of [port2, carrier.port1, carrier.port2]) port.close();
  });

  // Runs the same random program against an EventTarget and against a model of the DOM listener
  // list, then compares what ran. Listeners add, remove and dispatch while they run.
  describe("matches a model of the DOM listener list", () => {
    type Options = { capture: boolean; once: boolean };
    type Listener = () => void;
    interface Target {
      add(type: string, listener: Listener, options: Options): void;
      remove(type: string, listener: Listener, capture: boolean): void;
      dispatch(type: string): void;
      count(type: string): number;
    }

    class RealTarget implements Target {
      #target = new EventTarget();
      add(type: string, listener: Listener, options: Options) {
        this.#target.addEventListener(type, listener, options);
      }
      remove(type: string, listener: Listener, capture: boolean) {
        this.#target.removeEventListener(type, listener, capture);
      }
      dispatch(type: string) {
        this.#target.dispatchEvent(new Event(type));
      }
      count(type: string) {
        return getEventListeners(this.#target, type).length;
      }
    }

    // https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
    class ModelTarget implements Target {
      #lists = new Map<string, { listener: Listener; capture: boolean; once: boolean; removed: boolean }[]>();
      #list(type: string) {
        let list = this.#lists.get(type);
        if (!list) this.#lists.set(type, (list = []));
        return list;
      }
      add(type: string, listener: Listener, { capture, once }: Options) {
        const list = this.#list(type);
        if (list.some(entry => entry.listener === listener && entry.capture === capture)) return;
        list.push({ listener, capture, once, removed: false });
      }
      remove(type: string, listener: Listener, capture: boolean) {
        const list = this.#list(type);
        const index = list.findIndex(entry => entry.listener === listener && entry.capture === capture);
        if (index === -1) return;
        list[index].removed = true;
        list.splice(index, 1);
      }
      dispatch(type: string) {
        for (const capture of [true, false]) {
          for (const entry of [...this.#list(type)]) {
            if (entry.removed || entry.capture !== capture) continue;
            if (entry.once) this.remove(type, entry.listener, entry.capture);
            entry.listener();
          }
        }
      }
      count(type: string) {
        return this.#list(type).length;
      }
    }

    type Program = { seed: number; listeners: number; steps: number; addRate: number; dispatchRate: number };

    function run(target: Target, { seed, listeners: listenerCount, steps, addRate, dispatchRate }: Program) {
      // mulberry32
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const pick = (n: number) => Math.floor(random() * n);
      const pickType = () => (random() < 0.8 ? "x" : "y");

      const log: string[] = [];
      const listeners: Listener[] = [];
      let depth = 0;
      const step = () => {
        const listener = listeners[pick(listeners.length)];
        const roll = random();
        if (roll < addRate) target.add(pickType(), listener, { capture: random() < 0.2, once: random() < 0.5 });
        else if (roll < 0.97) target.remove(pickType(), listener, random() < 0.2);
        else log.push(`count=${target.count(pickType())}`);
      };
      for (let id = 0; id < listenerCount; id++) {
        listeners.push(() => {
          log.push(`run ${id}`);
          const stepCount = pick(3);
          for (let i = 0; i < stepCount; i++) step();
          if (depth < 1 && random() < 0.05) {
            depth++;
            target.dispatch(pickType());
            depth--;
          }
        });
      }

      for (let i = 0; i < steps; i++) {
        if (random() < dispatchRate) {
          const type = pickType();
          log.push(`dispatch ${type}`);
          target.dispatch(type);
        } else step();
      }
      // Everything that is still registered runs, in order.
      for (const type of ["x", "y"]) {
        log.push(`dispatch ${type}`);
        target.dispatch(type);
      }
      return log;
    }

    // Few listeners: the list empties often and the empty slots are closed after most removals.
    // Many listeners with a rare dispatch: empty slots pile up between the reads that close them.
    const programs: Program[] = [
      { seed: 1, listeners: 4, steps: 400, addRate: 0.4, dispatchRate: 0.05 },
      { seed: 2, listeners: 8, steps: 400, addRate: 0.4, dispatchRate: 0.03 },
      { seed: 3, listeners: 16, steps: 400, addRate: 0.45, dispatchRate: 0.03 },
      { seed: 4, listeners: 48, steps: 400, addRate: 0.5, dispatchRate: 0.02 },
      { seed: 5, listeners: 48, steps: 200, addRate: 0.5, dispatchRate: 0.1 },
      { seed: 6, listeners: 128, steps: 500, addRate: 0.55, dispatchRate: 0.01 },
    ];
    test.each(programs)("$listeners listeners, seed $seed", program => {
      const model = run(new ModelTarget(), program);
      expect(model.filter(line => line.startsWith("run")).length).toBeGreaterThan(50);
      expect(run(new RealTarget(), program)).toEqual(model);
    });
  });
});
