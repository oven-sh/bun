// Object.assign where the target is a record (an object literal of a declared type), which may have become an ordinary object or have come from outside, and where the source is a literal whose fields are kept otherwise than the target's: small integers, fractions, constant strings, booleans, undefined and null.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}
const own = (object: object) => Reflect.ownKeys(object).map(String).join();

type Settings = { port: number; host: string; secure: boolean; ratio: number; name: string | undefined; limit: number | null };
const defaults = (): Settings => ({ port: 80, host: "localhost", secure: false, ratio: 0.5, name: undefined, limit: null });
class Server {
  port = 80;
  host = "localhost";
  secure = false;
  ratio = 0.5;
  name: string | undefined = undefined;
  limit: number | null = null;
}

function configure(settings: Settings, values: { port: number; host: string }) {
  return Object.assign(settings, values);
}
function show(settings: Settings | Server) {
  return [own(settings), settings.port, settings.host, settings.secure, settings.ratio, settings.name === undefined ? "undefined" : settings.name, settings.limit];
}

for (let turn = 0; turn < 4; turn++) {
  say("a record from a record " + turn, () => show(configure(defaults(), { port: 8000 + turn, host: "h" + turn })));
  say("a record from a literal of constants " + turn, () => show(Object.assign(defaults(), { port: 443, host: "example.com", secure: true, ratio: 2, name: "n", limit: 7 })));
  say("an instance from a literal of constants " + turn, () => show(Object.assign(new Server(), { port: 443, host: "example.com", secure: true, ratio: 2, name: "n", limit: 7 })));
  say("an instance from a literal of values " + turn, () => show(Object.assign(new Server(), { port: turn, host: "host" + turn, secure: turn % 2 === 0, ratio: turn / 4, name: turn ? "n" + turn : undefined, limit: turn ? turn : null })));
  say("fractions and large numbers into a number field " + turn, () => show(Object.assign(new Server(), { port: turn + 0.5, ratio: 2 ** 40 + turn, limit: -(2 ** 31) - turn })));
  say("undefined and null " + turn, () => {
    const server = Object.assign(new Server(), { name: "set", limit: 1 });
    return show(Object.assign(server, { name: undefined, limit: null }));
  });
}
say("a record that came from outside", () => {
  const seen: unknown[] = [];
  for (let turn = 0; turn < 3; turn++) {
    const parsed: Settings = JSON.parse(`{"port":1,"host":"outside","secure":true,"ratio":1,"limit":null,"more":${turn}}`);
    seen.push(show(configure(parsed, { port: 2 + turn, host: "assigned" })));
  }
  return seen;
});
say("a record that lost a property, got an accessor, was frozen", () => {
  const seen: unknown[] = [];
  const lost = defaults();
  delete (lost as any).host;
  seen.push(show(configure(lost, { port: 1, host: "back" })));
  const watched = defaults();
  let log = "";
  Object.defineProperty(watched, "port", { set(value) { log += "port=" + value + ";"; }, get() { return -1; }, enumerable: true, configurable: true });
  seen.push(show(configure(watched, { port: 2, host: "watched" })), log);
  const frozen = Object.freeze(defaults());
  try {
    configure(frozen, { port: 3, host: "frozen" });
  } catch (error) {
    seen.push((error as Error).constructor.name);
  }
  seen.push(show(frozen));
  return seen;
});
say("a record with one property more, as target and as source", () => {
  const wide = Object.assign(defaults(), { extra: "kept" });
  configure(wide, { port: 5, host: "wide" });
  const target = defaults();
  Object.assign(target, wide);
  return [show(wide), show(target), (target as any).extra];
});
say("a record under another prototype", () => {
  const seen: unknown[] = [];
  let log = "";
  const base = { set host(value: string) { log += "host=" + value + ";"; }, get host() { return "from the prototype"; } };
  for (let turn = 0; turn < 2; turn++) {
    const settings = defaults();
    Object.setPrototypeOf(settings, base);
    seen.push(show(configure(settings, { port: turn, host: "own" })));
    delete (settings as any).host;
    seen.push(show(configure(settings, { port: turn, host: "through the setter" })));
  }
  return [seen, log];
});
say("one place, instances and records in turn", () => {
  const seen: unknown[] = [];
  const set = (target: { port: number; host: string }, port: number) => Object.assign(target, { port, host: "p" + port });
  for (let turn = 0; turn < 6; turn++) seen.push(own(set(turn % 3 === 0 ? new Server() : turn % 3 === 1 ? defaults() : { port: 0, host: "" }, turn)) + ":" + turn);
  return seen;
});
say("many objects, so that collections fall between the calls", () => {
  let sum = 0;
  for (let i = 0; i < 30000; i++) {
    const settings = Object.assign(defaults(), { port: i, host: "h" + (i & 7), secure: (i & 1) === 0, ratio: i / 3, name: i & 3 ? "n" + i : undefined, limit: i & 1 ? i : null });
    const server = Object.assign(new Server(), settings);
    sum += server.port + server.host.length + (server.secure ? 1 : 0) + Math.floor(server.ratio) + (server.name ? server.name.length : 0) + (server.limit ?? 0);
  }
  return sum;
});

console.log(lines.join("\n"));
