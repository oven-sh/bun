import { expectType } from "./utilities";

class Counter extends Bun.DurableObject<{ label: string }> implements Bun.DurableObjectHandlers {
  increment(by = 1) {
    const next = (this.ctx.storage.kv.get<number>("count") ?? 0) + by;
    this.ctx.storage.kv.put("count", next);
    return next;
  }
  async label() {
    return this.env.label;
  }
  get double() {
    return (this.ctx.storage.kv.get<number>("count") ?? 0) * 2;
  }
  fetch(request: Request, server?: Bun.DurableObjectServer) {
    if (server?.upgrade(request, { data: { a: 1 }, tags: ["a"] })) return;
    return new Response(request.url);
  }
  async alarm(info: Bun.DurableObjectAlarmInfo) {
    expectType<number>(info.retryCount);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
  webSocketMessage(ws: Bun.ServerWebSocket<{ a: number }>, message: string | Buffer) {
    for (const peer of this.ctx.getWebSockets("a")) peer.send(message);
    expectType<string[]>(this.ctx.getTags(ws));
  }
  rows() {
    const cursor = this.ctx.storage.sql.exec<{ id: number; body: string }>("SELECT id, body FROM t WHERE id > ?", 1);
    expectType<{ id: number; body: string }[]>(cursor.toArray());
    expectType<number>(cursor.rowsRead);
    for (const row of cursor) expectType<string>(row.body);
    return this.ctx.storage.transactionSync(() => 1);
  }
}

const counters = new Bun.DurableObjectNamespace({
  class: Counter,
  storage: "./data",
  env: { label: "x" },
  idleTimeout: 1000,
  onError(error, id) {
    expectType<Bun.DurableObjectId>(id);
  },
});

const id = counters.idFromName("a");
expectType<string>(id.toString());
expectType<boolean>(id.equals(counters.newUniqueId()));

const stub = counters.get(id);
expectType<Promise<number>>(stub.increment(2));
expectType<Promise<string>>(stub.label());
expectType<Promise<number>>(stub.double);
expectType<Promise<Response | undefined>>(stub.fetch("http://do/"));
expectType<Promise<number>>(counters.getByName("b").rows());
// @ts-expect-error the handlers are the runtime's to call
stub.alarm;

new Bun.DurableObjectNamespace({ module: "./counter.ts", export: "Counter", globals: { a: 1 } });

Bun.serve({
  fetch: (request, server) => counters.getByName("room").fetch(request, server),
  websocket: Bun.DurableObject.websocket,
});

await counters.close();
