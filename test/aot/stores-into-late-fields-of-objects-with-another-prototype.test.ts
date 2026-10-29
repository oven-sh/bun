import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { buildCounted, countScript, testsAddedByTheCompiler } from "./harness/counted-run";
import { built, slot, spawned } from "./run-programs";
import { test } from "./supported";

// `ended`, `bytes` and `note` are stored for the first time behind the constructor, so each store adds a property: it asks the objects above for a
// setter or a read-only property of the name. The heir takes keys that the build cannot read, so any name may be up there.
const reply = `
  class Reply {
    status: number;
    body: string;
    declare ended?: boolean;
    declare bytes?: number;
    declare note?: string;
    constructor() {
      this.status = 200;
      this.body = "";
    }
    finish(size: number) {
      this.ended = true;
      this.bytes = size;
      this.note = "done";
      return this.status + size + this.body.length;
    }
  }
  function makePlainHeir() {
    const heir = Object.create(Reply.prototype);
    const extras: Record<string, unknown> = JSON.parse(process.env.EXTRAS ?? '{"send":1}');
    for (const key of Object.keys(extras)) heir[key] = extras[key];
    return heir;
  }
`;

const files = {
  "rounds.ts": `${reply}
    const heir = makePlainHeir();
    const replies: Reply[] = [];
    function make() {
      const reply = new Reply();
      Object.setPrototypeOf(reply, heir);
      replies.push(reply);
    }
    function round(index: number) {
      make();
      const reply = replies.pop()!;
      return reply.finish(index) + (reply.ended ? 1 : 0) + reply.bytes! + reply.note!.length;
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index & 7);
    console.log(sum > 0 ? "ok" : "no");
  `,
  "made-here.ts": `
    const proto = {
      x: 0,
      y: 0,
      sum(): number {
        return this.x + this.y;
      },
    };
    function round(index: number): number {
      const made = Object.create(proto);
      made.x = index & 7;
      made.y = 2;
      return made.sum();
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index);
    console.log(sum > 0 ? "ok" : "no");
  `,
  "answers.ts": `${reply}
    const log: string[] = [];
    const heirs: Record<string, () => object | null> = {
      "plain": makePlainHeir,
      "setter": () =>
        Object.defineProperty(makePlainHeir(), "bytes", {
          set(value) {
            log.push("set bytes " + value + " on " + Object.keys(this).join());
            (this as Reply).status = 500;
          },
          get: () => -1,
        }),
      "getter alone": () => Object.defineProperty(makePlainHeir(), "bytes", { get: () => -2 }),
      "read-only": () => Object.defineProperty(makePlainHeir(), "note", { value: "fixed", writable: false }),
      "data": () => Object.assign(makePlainHeir(), { ended: "inherited" }),
      "frozen data": () => Object.freeze(Object.assign(makePlainHeir(), { ended: "inherited" })),
      "proxy": () =>
        new Proxy(makePlainHeir(), {
          set(target, key, value, receiver) {
            log.push("proxy set " + String(key));
            return key === "note" ? true : Reflect.set(target, key, value, receiver);
          },
        }),
      "setter that hands the first prototype back": () =>
        Object.defineProperty(makePlainHeir(), "ended", {
          set() {
            Object.setPrototypeOf(this, Reply.prototype);
            log.push("handed back");
          },
        }),
      "setter that freezes": () =>
        Object.defineProperty(makePlainHeir(), "ended", {
          set() {
            Object.freeze(this);
            log.push("froze");
          },
        }),
      "setter that removes a field": () =>
        Object.defineProperty(makePlainHeir(), "ended", {
          set() {
            delete (this as Partial<Reply>).status;
            log.push("removed");
          },
        }),
      "null": () => null,
    };
    const finish = Reply.prototype.finish;
    const show = (reply: Reply) =>
      JSON.stringify(reply) + " keys=" + Object.keys(reply).join() + " ended=" + reply.ended + " bytes=" + reply.bytes + " note=" + reply.note;
    for (let turn = 0; turn < 3; turn++) {
      for (const kind of ["own", ...Object.keys(heirs)]) {
        const reply = new Reply();
        if (kind !== "own") Object.setPrototypeOf(reply, heirs[kind]());
        let result: unknown;
        try {
          result = finish.call(reply, turn);
        } catch (error) {
          result = (error as Error).name + ": " + (error as Error).message;
        }
        console.log(turn, kind, "|", result, "|", show(reply), "|", log.splice(0).join("; "));
      }
    }
  `,
};

test(
  "a store that adds a field to an object with another prototype goes by name, and the function goes on by slot",
  () =>
    slot(async () => {
      using dir = tempDir("aot-late-fields-another-prototype", files);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.ts"), folder, "ok\n");
      const added = work.tests.filter(counted => testsAddedByTheCompiler.has(counted.kind));
      // A renamed test would count nothing.
      expect(
        added
          .filter(counted => counted.kind === "HasLayoutPrototype")
          .reduce((sum, counted) => sum + counted.executed, 0),
      ).toBe(3);
      expect(added.filter(counted => counted.failed).map(counted => `${counted.kind} ${counted.position}`)).toEqual([]);
      // The three stores and the read of \`finish\`, which is looked for on the heir.
      expect(work.accessesByName).toBe(4);
    }),
  300_000,
);

test(
  "the stores into an object that the function itself has made share one test of its prototype",
  () =>
    slot(async () => {
      using dir = tempDir("aot-late-fields-made-here", files);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./made-here.ts"), folder, "ok\n");
      const testsOfPrototype = work.tests.filter(counted => counted.kind === "HasLayoutPrototype");
      expect(testsOfPrototype.reduce((sum, counted) => sum + counted.executed, 0)).toBe(1);
      expect(testsOfPrototype.reduce((sum, counted) => sum + counted.failed, 0)).toBe(0);
      expect(work.accessesByName).toBe(0);
    }),
  300_000,
);

test(
  "whatever stands above the object answers the store as it does in bun run",
  () =>
    slot(async () => {
      using dir = tempDir("aot-late-fields-answers", files);
      const folder = String(dir);
      const executable = join(folder, isWindows ? "answers.exe" : "answers");
      const expected = await spawned([bunExe(), "answers.ts"], folder, bunEnv);
      expect(expected.stdout.split("\n").length).toBe(37);
      expect(expected.stdout).toContain("0 setter | 500 |");
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "answers.ts", "--outfile", executable], folder, bunEnv),
      );
      expect(await spawned([executable], folder, bunEnv)).toEqual(expected);
    }),
  300_000,
);
