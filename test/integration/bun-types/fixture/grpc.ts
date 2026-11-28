import { Channel, GrpcError, route, Status, type CallContext, type Route } from "bun:grpc";
import { expectType } from "./utilities";

expectType(Status.NOT_FOUND).is<5>();
expectType(new GrpcError(Status.NOT_FOUND, "gone", { trailers: { a: "b" } }).trailers).is<Headers>();
// @ts-expect-error a call that fails does not end with OK
new GrpcError(Status.OK);

const channel = new Channel("http://localhost", { fetch: new Bun.FetchSession().fetch, timeout: 1 });
expectType(channel.call("/s/m", new Uint8Array())).is<Promise<Uint8Array>>();
expectType(channel.stream("/s/m", { messages: [1], frame: (message: number) => new Uint8Array(message) })).is<
  AsyncGenerator<Uint8Array, void, void>
>();

const frame = (message: number) => new Uint8Array(message);
const unary = route(
  false,
  false,
  async (request, context) => {
    expectType(request).is<Uint8Array>();
    expectType(context).is<CallContext>();
    return request.length;
  },
  frame,
);
expectType(unary).is<Route>();
const bidi = route(
  true,
  true,
  requests => {
    expectType(requests).is<AsyncGenerator<Uint8Array, void, void>>();
    return [1];
  },
  frame,
);
// @ts-expect-error `frame` takes a number
route(false, false, () => "1", frame);

Bun.serve({ http2: true, routes: { "/s/unary": unary, "/s/bidi": bidi } });
