// Each request is answered by a response whose _callPendingCallbacks is replaced in one way. What the server calls, and when, is printed.
import { once } from "node:events";
import http, { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

type Response = ServerResponse & { _callPendingCallbacks(): void };

const prototype = ServerResponse.prototype as Response;
const original = prototype._callPendingCallbacks;

let lines: string[] = [];

function replaceOn(holder: Response) {
  holder._callPendingCallbacks = function (this: Response) {
    lines.push(`_callPendingCallbacks(), finished ${this.finished}, headersSent ${this.headersSent}`);
    return original.call(this);
  };
}

const replacements: Record<string, (res: Response) => void> = {
  "nowhere": () => {},
  "on the response": res => replaceOn(res),
  "on ServerResponse.prototype": () => replaceOn(prototype),
  "on an heir of ServerResponse.prototype": res => {
    const heir = Object.create(prototype) as Response;
    replaceOn(heir);
    Object.setPrototypeOf(res, heir);
  },
  "on the response by a listener of prefinish": res => void res.on("prefinish", () => replaceOn(res)),
  "on the response, which has listeners": res => {
    for (const event of ["prefinish", "finish", "close"]) res.on(event, () => lines.push(event));
    replaceOn(res);
  },
};

const bodies: Record<string, (res: Response) => void> = {
  "end(body)": res => void res.end("ok"),
  "write(), end(body)": res => {
    res.write("o");
    res.end("k");
  },
  "a content-length, write(), end()": res => {
    res.setHeader("content-length", 2);
    res.write("ok");
    res.end();
  },
  "write() and end() with callbacks": res => {
    res.write("o", () => lines.push("the callback of write()"));
    res.end("k", () => lines.push("the callback of end()"));
  },
};

let respond: (res: Response) => void;
const server = http.createServer((_req, res) => respond(res as Response));
await once(server.listen(0, "127.0.0.1"), "listening");
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

for (const [where, replace] of Object.entries(replacements)) {
  for (const [how, send] of Object.entries(bodies)) {
    lines = [];
    respond = res => {
      replace(res);
      send(res);
    };
    const response = await fetch(url);
    const text = await response.text();
    for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve));
    prototype._callPendingCallbacks = original;
    console.log(`replaced ${where}, ${how}: ${response.status} ${text}`);
    for (const line of lines) console.log("    " + line);
  }
}
server.close();
server.closeAllConnections();
