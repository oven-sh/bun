// console.log, util.inspect, assert.deepStrictEqual and structuredClone see fields keyed by symbols as plain Bun does.
import { deepStrictEqual, notDeepStrictEqual } from "node:assert";
import { inspect, isDeepStrictEqual } from "node:util";
const kHandle = Symbol("kHandle");
const kLabel = Symbol("kLabel");
class Socket {
  name = "a";
  [kHandle]: number = 7;
  [kLabel]?: string;
}
interface Request {
  url: string;
  [kHandle]: number;
  [kLabel]?: string;
}
const socket = new Socket();
const request: Request = { url: "/x", [kHandle]: 3 };
console.log(socket);
console.log(request);
console.log(inspect(socket), inspect(request, { showHidden: true }));
request[kLabel] = "tag";
console.log(request, [request], { nested: socket });
deepStrictEqual(request, { url: "/x", [kHandle]: 3, [kLabel]: "tag" });
notDeepStrictEqual(request, { url: "/x", [kHandle]: 4, [kLabel]: "tag" });
console.log(isDeepStrictEqual(request, { url: "/x", [kHandle]: 3 }), Bun.deepEquals(request, { url: "/x", [kHandle]: 3, [kLabel]: "tag" }, true));
console.log(structuredClone(request), structuredClone(socket));
