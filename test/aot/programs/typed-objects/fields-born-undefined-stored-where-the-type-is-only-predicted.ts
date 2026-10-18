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
let depth = 0;
function finish(reply: any, message: any, size: any, chunked: any, upgrade: any): void {
  if (depth > 0) { depth--; finish(reply, message, size, chunked, upgrade); finish(reply, message, size, chunked, upgrade); }
  reply.statusMessage = message;
  reply.size = size;
  reply.chunked = chunked;
  reply.upgrade = upgrade;
  reply.fourth = "4";
}
const bag = new Map<string, any>();
const held = (value: unknown) => (bag.set("held", value), bag.get("held"));
const describe = (reply: any) => JSON.stringify(reply) + " " + Object.keys(reply).length + " " + [reply.statusMessage, reply.size, reply.chunked, typeof reply.upgrade, reply.fourth, reply.third].map(String).join();
const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};
for (let turn = 0; turn < 3; turn++) {
  const reply = make("/" + turn);
  show("the first stores", () => (finish(reply, "OK", turn, true, reply), [reply.statusMessage, reply.size, reply.chunked, reply.upgrade === reply, reply.fourth, reply.third, Object.keys(reply).length].map(String).join()));
  show("stored again", () => (finish(reply, "Again", turn + 0.5, false, bag), [reply.statusMessage, reply.size, reply.chunked, reply.upgrade === bag, reply.fourth].map(String).join()));
  show("undefined again", () => (finish(reply, undefined, undefined, undefined, undefined), describe(reply)));
  show("large numbers", () => (finish(reply, "n", 2 ** 40, true, undefined), finish(reply, "n", -(2 ** 31), true, undefined), describe(reply)));
  const cut: any = make("/cut");
  delete cut.size;
  delete cut.fourth;
  show("deleted before", () => (finish(held(cut), "OK", 1, true, undefined), describe(cut) + " " + Object.keys(cut).slice(-3).join()));
  const more: any = make("/more");
  more.further = 1;
  show("one key more", () => (finish(held(more), "OK", 1, true, undefined), describe(more)));
  show("a number for the message", () => (finish(held(make("/w")), 1, 1, true, undefined), describe(bag.get("held"))));
  show("a string for the size", () => (finish(held(make("/w")), "OK", "1", true, undefined), describe(bag.get("held"))));
  show("a number for the flag", () => (finish(held(make("/w")), "OK", 1, 1, undefined), describe(bag.get("held"))));
  show("a string for the object", () => (finish(held(make("/w")), "OK", 1, true, "u"), describe(bag.get("held"))));
  show("null for the message", () => (finish(held(make("/w")), null, 1, true, undefined), describe(bag.get("held"))));
  show("frozen", () => (finish(held(Object.freeze(make("/f"))), "OK", 1, true, undefined), describe(bag.get("held"))));
  show("sealed", () => (finish(held(Object.seal(make("/s"))), "OK", 1, true, undefined), describe(bag.get("held"))));
  show("not extensible", () => (finish(held(Object.preventExtensions(make("/p"))), "OK", 1, true, undefined), describe(bag.get("held"))));
  show("a plain object", () => (finish(held({ statusCode: 1 }), "OK", 1, true, undefined), describe(bag.get("held"))));
  const base = make("/base");
  show("an heir", () => (finish(held(Object.create(base)), "OK", 1, true, undefined), describe(bag.get("held")) + " | " + describe(base)));
  show("undefined", () => finish(held(undefined), "OK", 1, true, undefined));
  show("a string", () => finish(held("text"), "OK", 1, true, undefined));
}
