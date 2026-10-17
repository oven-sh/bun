import { Extended, Second, makeSettings, readHostOf, hasHostIn, setHostOf } from "./shapes.ts";

class Heir extends Extended {}
class HeirOfHeir extends Heir {}
class Untouched extends Extended {}

function look(label, o) {
  const before = [o.readHost(), o.readPort(), o.hasHost(), o.hasPort()].join();
  o.fill(7);
  console.log(label, before, "|", [o.readHost(), o.readPort(), o.hasHost(), o.hasPort()].join(), "|", Object.keys(o).join(), "|", JSON.stringify(o));
}

function tagged(make, give) {
  const o = make();
  give(o);
  return o;
}

const givers = {
  none(o) {},
  byName(o) { o.tag = 1; },
  twoByName(o) { o.tag = 1; o.more = 2; },
  byKey(o) { o["key" + 1] = 1; },
};
const makers = {
  Extended: () => new Extended(),
  Heir: () => new Heir(),
  HeirOfHeir: () => new HeirOfHeir(),
  Untouched: () => new Untouched(),
};

function lookAtAll(stage, kept) {
  for (const maker in makers) {
    for (const giver in givers) {
      for (let i = 0; i < 3; i++) look(stage + " fresh " + maker + " " + giver, tagged(makers[maker], givers[giver]));
    }
  }
  for (const [label, o] of kept.splice(0, 16)) look(stage + " kept " + label, o);
}

export function run() {
  const kept = [];
  for (let stage = 0; stage < 4; stage++) {
    for (const maker in makers) {
      for (const giver in givers) kept.push([maker + " " + giver, tagged(makers[maker], givers[giver])]);
    }
  }
  for (let i = 0; i < 50; i++) tagged(makers.Heir, o => { o.dropped = i; }).readHost();
  lookAtAll("as made", kept);

  Heir.prototype.harmless = function () { return 1; };
  lookAtAll("a harmless method", kept);

  Object.defineProperty(Heir.prototype, "host", {
    get() { return "inherited"; },
    set(value) { this.seenHost = value; },
    configurable: true,
  });
  lookAtAll("an accessor named like a field", kept);
  look("a shape that had died", tagged(makers.Heir, o => { o.dropped = 1; }));

  delete Heir.prototype.host;
  Heir.prototype.port = 99;
  lookAtAll("the accessor gone, a value named like a field", kept);

  for (let i = 0; i < 3; i++) {
    const other = Reflect.construct(Second, [], function () {});
    other.tag = i;
    console.log("constructed for another", other.always, Second.prototype.readHost.call(other), Second.prototype.hasHost.call(other));
    Second.prototype.fill.call(other, 1);
    console.log("constructed for another, filled", Object.keys(other).join());
  }

  for (let i = 0; i < 3; i++) {
    const settings = makeSettings(i);
    settings.tag = i;
    console.log("record", readHostOf(settings), hasHostIn(settings));
    Object.setPrototypeOf(settings, { get host() { return "inherited by a record"; }, set host(value) { this.seenHost = value; } });
    console.log("record under another prototype", readHostOf(settings), hasHostIn(settings));
    setHostOf(settings, "stored");
    console.log("record stored to", readHostOf(settings), Object.keys(settings).join());
  }
}
