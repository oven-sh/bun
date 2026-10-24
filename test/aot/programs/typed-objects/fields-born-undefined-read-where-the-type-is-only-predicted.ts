interface Reply {
  statusCode: number;
  sent: boolean;
  url: string;
  peer: object | null;
  statusMessage: string | undefined;
  header: string | undefined;
  trailer: string | undefined;
  timeout: number | undefined;
  encoding: string | undefined;
  chunked: boolean | undefined;
  size: number | undefined;
  upgrade: object | undefined;
  first: string | undefined;
  second: string | undefined;
  third: string | undefined;
  fourth: string | undefined;
}
const make = (url: string): Reply => ({
  statusCode: 200,
  sent: false,
  url,
  peer: null,
  statusMessage: undefined,
  header: undefined,
  trailer: undefined,
  timeout: undefined,
  encoding: undefined,
  chunked: undefined,
  size: undefined,
  upgrade: undefined,
  first: undefined,
  second: undefined,
  third: undefined,
  fourth: undefined,
});
class Options {
  declare host?: string;
  declare port?: number;
  always = 1;
}
let depth = 0;
function read(reply: any): string {
  if (depth > 0) { depth--; return read(reply) + read(reply); }
  return [reply.statusCode, reply.statusMessage, reply.timeout, reply.chunked, reply.size, reply.upgrade, reply.fourth].map(String).join();
}
function readOdd(reply: any): string {
  if (depth > 0) { depth--; return readOdd(reply) + readOdd(reply); }
  return [reply.statusCode, reply.statusMessage, reply.timeout, reply.chunked, reply.size, reply.upgrade, reply.fourth].map(String).join();
}
function readOptions(options: any): string {
  if (depth > 0) { depth--; return readOptions(options) + readOptions(options); }
  return [options.host, options.port, options.always].map(String).join();
}
const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
const odd: any[] = JSON.parse("[0,0,0,0]");
odd[0] = { statusCode: 1, size: 2, fourth: "f" };
odd[1] = Object.freeze(make("/"));
odd[2] = undefined;
odd[3] = "text";
for (let turn = 0; turn < 3; turn++) {
  const untouched = make("/");
  show("never stored", () => read(untouched) + " " + Object.keys(untouched).length + " " + ("fourth" in untouched));
  const stored = make("/");
  stored.size = turn;
  show("one stored", () => read(stored));
  stored.fourth = "4";
  stored.statusMessage = "OK";
  stored.chunked = true;
  stored.upgrade = untouched;
  stored.timeout = 1.5;
  show("more stored", () => read(stored));
  stored.size = undefined;
  stored.fourth = undefined;
  show("undefined again", () => read(stored) + " " + Object.keys(stored).length);
  const cut: any = make("/");
  delete cut.fourth;
  delete cut.size;
  show("two deleted", () => readOdd(cut) + " " + Object.keys(cut).length + " " + ("fourth" in cut));
  cut.fourth = "back";
  show("one back", () => readOdd(cut) + " " + Object.keys(cut).join().length);
  const more: any = make("/");
  more.further = 1;
  show("one key more", () => readOdd(more) + " " + Object.keys(more).length);
  const heir: any = Object.create(stored);
  show("an heir", () => readOdd(heir));
  heir.size = 9;
  show("an heir with a property of its own", () => readOdd(heir) + " " + read(stored));
  show("a plain object", () => readOdd(odd[0]));
  show("a frozen one", () => readOdd(odd[1]));
  show("undefined", () => readOdd(odd[2]));
  show("a string", () => readOdd(odd[3]));
  const options = new Options();
  show("optional fields, absent", () => readOptions(options) + " " + Object.keys(options).join());
  options.port = turn;
  show("optional fields, one created", () => readOptions(options) + " " + Object.keys(options).join());
  show("an heir of an instance with absent fields", () => readOptions(Object.create(options)));
}
console.log(read(make("/x")), readOptions(new Options()));
