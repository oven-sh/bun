function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

say("strict", (function (this: unknown) {
  return this === undefined;
})());

const literal = {
  get size(): number {
    return 5;
  },
};

const writeOnly = {
  got: 0,
  set level(value: number) {
    this.got = value;
  },
};

type Loose = { size: number };

function store(o: Loose): number {
  return (o.size = 6);
}

function add(o: Loose): number {
  return (o.size += 1);
}

function increment(o: Loose): number {
  return o.size++;
}

say("a store", store(literal));
say("afterwards", literal.size);
say("plus equals", add(literal));
say("afterwards", literal.size);
say("increment", increment(literal));
say("afterwards", literal.size);
say("a plain object", store({ size: 1 }) + add({ size: 1 }) + increment({ size: 1 }));
say("write only: read", writeOnly.level);
say("write only: plus equals", (writeOnly.level += 1));
say("write only: got", writeOnly.got);
let sum = 0;
for (let i = 0; i < 2000; i++) sum += store(i % 2 === 0 ? literal : { size: i }) + literal.size;
say("2000 rounds", sum);
