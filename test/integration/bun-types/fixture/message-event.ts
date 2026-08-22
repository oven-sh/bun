// Checked with and without lib.dom.d.ts (bun-types.test.ts also re-checks this file via spawned
// tsc so debug builds cover it). Bun.MessageEvent must be the instance type of whichever global
// MessageEvent is in effect; with lib.dom.d.ts loaded it used to be lib.dom's constructor type.
import { expectType } from "./utilities";

expectType<Bun.MessageEvent>().is<MessageEvent>();
expectType<Bun.MessageEvent<string>>().is<MessageEvent<string>>();

declare const event: MessageEvent<string>;
expectType(event.data).is<string>();
expectType(event.lastEventId).is<string>();
expectType(event.origin).is<string>();
expectType(event.ports).is<readonly MessagePort[]>();
event.initMessageEvent;
// @ts-expect-error only the constructor has a prototype
event.prototype;
// @ts-expect-error an instance is not constructable
new event("message");

declare const bunEvent: Bun.MessageEvent<string>;
expectType(bunEvent.data).is<string>();
// @ts-expect-error only the constructor has a prototype
bunEvent.prototype;

new MessageEvent("message", { data: "hi" }) satisfies MessageEvent;

// Everything in bun-types that is declared in terms of Bun.MessageEvent
expectType<Bun.WebSocketEventMap["message"]>().is<MessageEvent>();
expectType<Bun.WorkerEventMap["message"]>().is<MessageEvent>();
expectType<Bun.WorkerEventMap["messageerror"]>().is<MessageEvent>();
expectType<Bun.EventSourceEventMap["message"]>().is<MessageEvent>();
expectType<Bun.EventMap["message"]>().is<MessageEvent>();
expectType<Bun.EventMap["messageerror"]>().is<MessageEvent>();

declare const ws: Bun.WebSocket;
ws.onmessage = e => expectType(e).is<MessageEvent>();
ws.addEventListener("message", e => expectType(e).is<MessageEvent>());

declare const worker: Bun.Worker;
worker.onmessage = e => expectType(e).is<MessageEvent>();
worker.onmessageerror = e => expectType(e).is<MessageEvent>();
worker.addEventListener("messageerror", e => expectType(e).is<MessageEvent>());

declare const eventSource: Bun.EventSource;
eventSource.onmessage = e => expectType(e).is<MessageEvent>();

// CDP events carry their params as `data` (the example in its JSDoc reads `e.data.response`)
declare const view: Bun.WebView;
view.addEventListener("Network.responseReceived", e => expectType(e).is<MessageEvent<unknown>>());
view.addEventListener<{ response: { status: number } }>("Network.responseReceived", e =>
  expectType(e.data.response.status).is<number>(),
);
