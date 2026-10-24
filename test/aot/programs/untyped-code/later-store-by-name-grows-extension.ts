// Stores by name to fields born undefined, from the first field to the last and back: a later store needs more room than the first made, and what was stored stays.
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
const count = (globalThis as any).aotOperationCount ?? (() => 0);
const setters: ((reply: any, n: number) => void)[] = [
  (reply, n) => { reply.statusMessage = "s" + n; },
  (reply, n) => { reply.header = "h" + n; },
  (reply, n) => { reply.trailer = "t" + n; },
  (reply, n) => { reply.timeout = n + 0.5; },
  (reply, n) => { reply.encoding = "e" + n; },
  (reply, n) => { reply.chunked = n % 2 === 0; },
  (reply, n) => { reply.size = n; },
  (reply, n) => { reply.upgrade = { n }; },
  (reply, n) => { reply.first = "1" + n; },
  (reply, n) => { reply.second = "2" + n; },
  (reply, n) => { reply.third = "3" + n; },
  (reply, n) => { reply.fourth = "4" + n; },
];
const show = (reply: any) => JSON.stringify(reply);
const holder: any[] = [];
function run(order: number[], turns: number, kept: any[]) {
  for (let n = 0; n < turns; n++) {
    holder[0] = make("/" + n);
    for (const which of order) setters[which]!(holder[0], n);
    if (n % 97 === 0) kept.push(holder[0]);
  }
}
const ascending = setters.map((_, i) => i);
const orders = [ascending, [...ascending].reverse(), [0, 6, 11], [11, 6, 0], [1, 3, 5, 7, 9, 11], [8, 2, 10, 4]];
for (const order of orders) {
  const kept: any[] = [];
  run(order, 300, kept);
  const before = count("operationAOTPutByIdAndCache");
  run(order, 3000, kept);
  (globalThis as any).Bun?.gc?.(true);
  console.log(order.join(" "), kept.length, show(kept[kept.length - 1]), kept.every((reply, i) => i < 4 || reply.url.startsWith("/")), count("operationAOTPutByIdAndCache") - before < 300);
}
const old = make("/old");
for (let i = 0; i < 20000; i++) make("/" + i);
(globalThis as any).Bun?.gc?.(true);
for (const which of ascending) setters[which]!(old, 7);
console.log(show(old));
