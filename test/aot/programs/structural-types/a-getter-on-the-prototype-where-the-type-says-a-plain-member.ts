interface Named {
  name: string;
  rank: number;
}

const log: string[] = [];

class Computed {
  constructor(private seed: number) {}
  get name(): string {
    log.push("name");
    return "computed" + this.seed;
  }
  get rank(): number {
    log.push("rank");
    return this.seed * 2;
  }
}

class Deep extends Computed {
  extra = "extra";
}

class Half {
  name = "half";
  get rank(): number {
    log.push("half rank");
    return 50;
  }
}

const base = {
  get name(): string {
    log.push("base name");
    return "from the base";
  },
  get rank(): number {
    log.push("base rank");
    return 7;
  },
};
const created: Named = Object.create(base);
const twoLevels: Named = Object.create(Object.create(base));

function flush(label: string, value: unknown): void {
  console.log(label + ": " + String(value) + " [" + log.join() + "]");
  log.length = 0;
}

function card(n: Named): string {
  return n.name + "#" + n.rank;
}

function reversed(n: Named): string {
  return n.rank + "#" + n.name;
}

function listing(n: Named): string {
  const walked: string[] = [];
  for (const key in n) walked.push(key);
  return "keys " + Object.keys(n).join() + " for-in " + walked.join() + " json " + JSON.stringify(n) + " spread " + JSON.stringify({ ...n });
}

const table: [string, Named][] = [
  ["plain", { name: "plain", rank: 1 }],
  ["class getters", new Computed(4)],
  ["inherited class getters", new Deep(5)],
  ["one field, one getter", new Half()],
  ["Object.create", created],
  ["two levels of Object.create", twoLevels],
];

for (const [label, n] of table) {
  flush(label + ", name then rank", card(n));
  flush(label + ", rank then name", reversed(n));
  flush(label + ", listing", listing(n));
  flush(label + ", own", Object.hasOwn(n, "name") + " " + Object.hasOwn(n, "rank") + " " + ("name" in n));
}

class Badge {
  constructor(public holder: Named) {}
  print(): string {
    return "[" + this.holder.name + "]";
  }
}

for (const [label, n] of table) flush(label + ", field", new Badge(n).print());

const everyone = table.map(row => row[1]);
flush("sorted by rank", everyone.toSorted((a, b) => a.rank - b.rank).length);
flush("names", everyone.map(n => n.name).join());

let length = 0;
const plain: Named = { name: "plain", rank: 1 };
for (let i = 0; i < 2000; i++) length += card(plain).length;
flush("2000 honest", length);
flush("then class getters", card(new Computed(9)));
flush("then Object.create", card(created));
flush("then plain", card(plain));

const thisSeen: unknown[] = [];
const watcher = {
  get name(): string {
    thisSeen.push(this);
    return "watcher";
  },
  rank: 0,
};
const child: Named = Object.create(watcher);
card(child);
console.log("the getter's this is the object that was read: " + (thisSeen[0] === child) + " " + (thisSeen[0] === watcher));

export {};
