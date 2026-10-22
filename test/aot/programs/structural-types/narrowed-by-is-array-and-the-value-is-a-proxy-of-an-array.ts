function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

const log: string[] = [];
const target = [10, 20, 30];
const proxy = new Proxy(target, {
  get(t, key, receiver) {
    log.push("get " + String(key));
    if (key === "1") return 21;
    return Reflect.get(t, key, receiver);
  },
  has(t, key) {
    log.push("has " + String(key));
    return Reflect.has(t, key);
  },
  set(t, key, value, receiver) {
    log.push("set " + String(key));
    return Reflect.set(t, key, value, receiver);
  },
});

function total(list: number[] | { size: number }): number {
  if (Array.isArray(list)) {
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i];
    return sum;
  }
  return list.size;
}

say("a real array", total([1, 2, 3]));
say("an object", total({ size: 4 }));
say("a proxy", total(proxy));
say("traps", log.join());
log.length = 0;

const either: number[] | { size: number } = proxy;
if (Array.isArray(either)) {
  say("element 1", either[1]);
  say("length", either.length);
  say("push", either.push(40));
  say("at", either.at(-1));
  let sum = 0;
  for (const n of either) sum += n;
  say("for of", sum);
  const [first, second] = either;
  say("destructured", first + second);
  say("spread", [...either].join());
  say("1 in it", 1 in either);
}
say("traps", log.join());
say("the target", target.join());
