// The compiler believes a row of the table of built-ins about what native code does with an operand. Each case here first sees plain Bun do a thing with an operand: keep it, describe it in an
// error, read a member off it. Then it asks the table that the build of this Bun wrote whether the row says so. No program shows these today where a call by name on an
// object of the host goes to code that nobody has seen; a row that says too little is believed as soon as such a call is bound to it.
import { expect } from "bun:test";
import { bunExe } from "harness";
import { readTable, type Overload, type Parameter, type Place } from "./built-ins-alone/table";
import { builtinTableOf } from "./harness/builtin-table";
import { test } from "./supported";

const table = readTable(builtinTableOf(bunExe()));

function rowsOf(path: string, mode: Overload["mode"] = "Call"): Overload[] {
  const entries = table.entries.filter(entry => entry.path === path);
  const rows = entries.flatMap(entry => entry.overloads).filter(row => row.mode === mode && !row.isUndeclared);
  expect(rows, path).not.toBeEmpty();
  return rows;
}

const takesAnObject = ({ accepted }: Parameter) =>
  accepted.isAnything || accepted.hasAnyObject || accepted.parts.length > 0;
const handsEverythingOver = (operand: Parameter) => operand.uses.includes("PassesToUserCode");

class Text extends String {}

test("Bun.cron keeps the schedule that it is handed", () => {
  const schedule = new Text("* * * * *");
  const job = Bun.cron(schedule as unknown as string, () => {});
  const kept = job.cron;
  job.stop();
  expect(kept).toBe(schedule as unknown as string);
  const rows = rowsOf("Bun.cron").filter(row => row.parameters[1].uses.includes("Calls"));
  expect(rows).not.toBeEmpty();
  for (const row of rows) expect(row.parameters[0].uses).toContain("Retains");
});

test("the setter of the name of a Blob keeps the value", () => {
  const name = new Text("a");
  const blob = new Blob(["x"]) as Blob & { name: unknown };
  blob.name = name;
  expect(blob.name).toBe(name);
  for (const row of rowsOf("Blob.prototype.name", "Set")) expect(row.parameters[0].uses).toContain("Retains");
});

test("a topic that is no string is described by the error that refuses it", async () => {
  const methods = ["subscribe", "unsubscribe", "isSubscribed", "publish", "publishText", "publishBinary"] as const;
  let asked = 0;
  class Topic {
    static get name() {
      asked++;
      return "T";
    }
  }
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  using server = Bun.serve({
    port: 0,
    fetch(request, server) {
      server.upgrade(request);
    },
    websocket: {
      message() {},
      open(socket) {
        resolve(
          methods.map(method => {
            try {
              (socket[method] as (topic: unknown, message: string) => unknown)(new Topic(), "m");
            } catch (error) {
              return (error as { code?: unknown }).code;
            }
          }),
        );
      },
    },
  });
  const client = new WebSocket(`ws://localhost:${server.port}`);
  expect(await promise).toEqual(methods.map(() => "ERR_INVALID_ARG_TYPE"));
  client.close();
  expect(asked).toBeGreaterThanOrEqual(methods.length);
  for (const method of methods) {
    const topics = rowsOf(`%ServerWebSocket%.prototype.${method}`).map(row => row.parameters[0]);
    expect(topics.filter(takesAnObject), method).not.toBeEmpty();
    for (const topic of topics.filter(takesAnObject)) expect(topic.namedMembers, method).toContain("constructor");
  }
});

test("an option for S3 that is no string is described by the error that refuses it", () => {
  const described = ["accessKeyId", "secretAccessKey", "region", "endpoint", "bucket", "sessionToken"];
  let asked = 0;
  class Odd {
    static get name() {
      asked++;
      return "Odd";
    }
  }
  for (const name of described) {
    expect(() => Bun.file("s3://bucket/key", { [name]: new Odd() }), name).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  }
  expect(asked).toBeGreaterThanOrEqual(described.length);
  const rows = table.entries.flatMap(entry => entry.overloads).filter(row => !row.isUndeclared);
  const bags = rows.flatMap(row =>
    row.parameters.filter(it => it.namedMembers.includes(described[0])).map(bag => ({ row, bag })),
  );
  expect(bags.map(({ row }) => row.path)).toContain("Bun.file");
  for (const { row, bag } of bags.filter(({ bag }) => !bag.uses.includes("Retains"))) {
    const outOfSight = (row.transfers as { from: Place & { path?: unknown[] }; to: Place }[])
      .filter(
        ({ from, to }) =>
          from.place === "Member" && Bun.deepEquals(from.operand, bag.operand) && to.place === "NativeMemory",
      )
      .map(({ from }) => from.path?.join());
    expect(outOfSight, row.path).toEqual(expect.arrayContaining(described));
  }
});

test("an element that Buffer.concat refuses is described by the error", () => {
  let asked = 0;
  class Odd {
    static get name() {
      asked++;
      return "Odd";
    }
  }
  expect(() => Buffer.concat([new Odd() as unknown as Uint8Array])).toThrow(
    expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
  );
  expect(asked).toBeGreaterThan(0);
  const lists = rowsOf("Buffer.concat").map(row => row.parameters[0]);
  const ofAnyElements = lists.filter(list =>
    list.accepted.parts.some(part => part.class === "Array" && !part.contents?.length),
  );
  expect(ofAnyElements).not.toBeEmpty();
  for (const list of ofAnyElements) expect(list.uses).toContain("RetainsContents");
});

test("what takes a list of promises reads `constructor` off each", async () => {
  for (const method of ["all", "allSettled", "any", "race"] as const) {
    let asked = 0;
    const promise = Promise.resolve(1);
    Object.defineProperty(promise, "constructor", {
      get() {
        asked++;
        return Promise;
      },
    });
    await Promise[method]([promise]);
    expect(asked, method).toBeGreaterThan(0);
    const lists = rowsOf(`Promise.${method}`).map(row => row.parameters[0]);
    const believed = lists.filter(list => !handsEverythingOver(list));
    expect(believed, method).not.toBeEmpty();
    for (const list of believed) expect(list.namedMembers, method).toContain("constructor");
  }
});
