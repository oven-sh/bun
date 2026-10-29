// The second request of each connection finds null in socket._readableState from one moment on. What the request emits and what nobody catches is printed.
import { once } from "node:events";
import http, { type ServerResponse } from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";

interface Form {
  request: "GET" | "POST";
  hears: ("error" | "end")[];
  stores:
    | "before end()"
    | "behind end()"
    | "when the response finishes"
    | "when the response closes"
    | "when the request ends";
}

const forms: Form[] = [
  { request: "GET", hears: [], stores: "before end()" },
  { request: "GET", hears: [], stores: "behind end()" },
  { request: "GET", hears: [], stores: "when the response finishes" },
  { request: "GET", hears: [], stores: "when the response closes" },
  { request: "GET", hears: ["error"], stores: "before end()" },
  { request: "GET", hears: ["error"], stores: "behind end()" },
  { request: "GET", hears: ["error"], stores: "when the response finishes" },
  { request: "GET", hears: ["error", "end"], stores: "before end()" },
  { request: "GET", hears: ["error", "end"], stores: "behind end()" },
  { request: "POST", hears: ["error"], stores: "before end()" },
  { request: "POST", hears: ["error"], stores: "when the request ends" },
  { request: "POST", hears: ["error"], stores: "when the response finishes" },
];

let lines: string[] = [];
let form: Form;
let connection!: Socket & { _readableState: unknown };
let readableState: unknown;
let isWarm = false;

process.on("uncaughtException", error => void lines.push(`uncaught ${error.name}`));

function store() {
  connection._readableState = null;
}

function respond(res: ServerResponse) {
  if (form.stores === "before end()") store();
  res.end("ok");
  if (form.stores === "behind end()") store();
}

const server = http.createServer((req, res) => {
  if (!isWarm) return void res.end("ok");
  connection = req.socket as typeof connection;
  readableState = connection._readableState;
  for (const event of form.hears) {
    req.on(
      event,
      (error?: Error) => void lines.push(`the request emits ${event}${error ? " with a " + error.name : ""}`),
    );
  }
  if (form.stores === "when the response finishes") res.on("finish", store);
  if (form.stores === "when the response closes") res.on("close", store);
  if (form.stores === "when the request ends") req.on("end", store);
  if (form.request === "POST") req.on("data", () => {}).on("end", () => respond(res));
  else respond(res);
});

await once(server.listen(0), "listening");
const { port } = server.address() as AddressInfo;

for (form of forms) {
  lines = [];
  isWarm = false;
  const client = net.connect(port);
  for (let i = 0; i < 2; i++) {
    client.write(
      form.request === "POST"
        ? "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\nhi"
        : "GET / HTTP/1.1\r\nHost: a\r\n\r\n",
    );
    const [chunk] = await once(client, "data");
    if (isWarm) lines.push(`answered ${String(chunk).split("\r\n")[0]}`);
    await new Promise(resolve => setImmediate(resolve));
    isWarm = true;
  }
  console.log(`${form.request}, heard: ${form.hears.join(" ") || "nothing"}, null ${form.stores}:`);
  for (const line of lines) console.log("    " + line);
  connection._readableState = readableState;
  client.destroy();
  await once(connection, "close");
}
server.close();
