class Message {
  url = "/";
  status = 200;
  sent = false;
  next: Message | null = null;
}
class Urgent extends Message {
  level = 1;
}
interface Reply {
  statusCode: number;
  statusMessage: string | undefined;
  size: number | undefined;
}
type Point = { across: number; down: number };
type Spot = { across: number; down: number; label: string };
const makeReply = (statusCode: number): Reply => ({ statusCode, statusMessage: undefined, size: undefined });
const makePoint = (across: number, down: number): Point => ({ across, down });
const makeSpot = (across: number, down: number): Spot => ({ across, down, label: "spot" });

const write = (message: any, url: any, status: any, sent: any, next: any) => {
  message.url = url;
  message.status = status;
  message.sent = sent;
  message.next = next;
};
const read = (message: any) => [message.url, message.status, message.sent, message.next === null].join();
const raise = (message: any) => message.level + message.status;
const finish = (reply: any, size: any) => {
  reply.statusMessage = "OK";
  reply.size = size;
  return reply.statusCode;
};
const sum = (point: any) => point.across + point.down;
const name = (spot: any) => spot.label + spot.across;

const show = (label: string, run: () => unknown) => {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, error instanceof TypeError ? "TypeError" : String(error));
  }
};

const typed = new Message();
const urgent = new Urgent();
const plain = { url: "p", status: 1, sent: true, next: null, level: 5 };
const heir = Object.create(typed);
let asked = 0;
const withAccessors = {
  get url() { asked++; return "g"; },
  set url(value) { asked += 10; },
  status: 2,
  sent: false,
  next: null,
};
const frozen = Object.freeze(new Message());
const bag = new Map<string, any>();
const put = (label: string, value: unknown) => (bag.set(label, value), label);

for (let turn = 0; turn < 3; turn++) {
  for (const label of [put("typed", typed), put("urgent", urgent), put("plain", plain), put("heir", heir), put("accessors", withAccessors), put("frozen", frozen)]) {
    const message = bag.get(label);
    show(label + " read", () => read(message));
    show(label + " write", () => write(message, "/" + turn, 300 + turn, turn % 2 === 0, null));
    show(label + " read again", () => read(message));
    show(label + " raise", () => raise(message));
  }
  show("asked", () => asked);
  show("own keys of the heir", () => Object.keys(heir).join());
  show("a number for the url", () => (write(bag.get("typed"), turn, 1, true, null), read(bag.get("typed"))));
  show("a string for the status", () => (write(bag.get("urgent"), "u", "s" + turn, true, null), read(bag.get("urgent"))));
  show("a plain object for next", () => (write(bag.get("typed"), "n", 1, true, bag.get("plain")), typed.next === (plain as any)));
  show("undefined", () => read(bag.get("nothing")));
  show("null", () => write(bag.get(put("null", null)), 1, 2, 3, 4));
  show("a string", () => read(bag.get(put("text", "text"))));
  show("a number", () => write(bag.get(put("seven", 7)), 1, 2, 3, 4));
  const reply = makeReply(200 + turn);
  show("reply", () => [finish(bag.get(put("reply", reply)), turn), reply.statusMessage, reply.size, Object.keys(reply).join()].join());
  show("plain reply", () => finish(bag.get(put("plain reply", { statusCode: 1 })), turn));
  show("a string for the size", () => [finish(bag.get("reply"), "big"), (reply as any).size].join());
  show("point", () => sum(bag.get(put("point", makePoint(turn, 2)))) + sum(bag.get(put("spot", makeSpot(turn, 3)))) + sum(bag.get(put("plain point", { across: 1, down: 1 }))));
  show("spot", () => name(bag.get("spot")) + name(bag.get(put("plain spot", { label: "l", across: 2 }))));
}
