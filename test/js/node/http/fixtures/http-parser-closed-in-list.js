// A closed parser stays in its ConnectionsList. idle() and expired() must
// skip it instead of touching the freed implementation.
const { HTTPParser, ConnectionsList } = process.binding("http_parser");
const list = new ConnectionsList();
const p = new HTTPParser();
p.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
p.close();
if (JSON.stringify(list.idle()) !== "[]") throw new Error("idle");
if (JSON.stringify(list.expired(1, 1)) !== "[]") throw new Error("expired");
if (list.all().length !== 1) throw new Error("all");
console.log("OK");
