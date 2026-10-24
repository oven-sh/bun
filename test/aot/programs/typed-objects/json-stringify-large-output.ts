// After one large JSON.stringify output, the next large output allocates its buffer once instead of doubling it from 4 KB.
// ENV JSC_aotCountsPath=/dev/null
declare const aotOperationCount: undefined | ((name: string) => number);
const isCounted = typeof aotOperationCount === "function";
const bufferGrowths = () => (typeof aotOperationCount === "function" ? aotOperationCount("operationAOTJSONWriterReserve") : 0);

type Message = { role: string; content: string };
const sentence = "the quick brown fox jumps over the lazy dog. ";
const rounds = 10;

function conversation(messageCount: number, last: Message[]): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < messageCount; i++)
    messages.push({ role: i % 2 ? "assistant" : "user", content: sentence.repeat(100) });
  return messages.concat(last);
}

function checksum(text: string): number {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
}

function send(messages: Message[]): string {
  return JSON.stringify({ model: "m", messages });
}

function log(index: number): number {
  return JSON.stringify({ level: "info", index, text: "a short line" }).length;
}

function measure(name: string, messages: Message[], betweenOutputs: (round: number) => void, expectedGrowths = rounds) {
  let sum = checksum(send(messages));
  const before = bufferGrowths();
  for (let round = 0; round < rounds; round++) {
    betweenOutputs(round);
    sum = (sum + checksum(send(messages))) | 0;
  }
  const growths = bufferGrowths() - before;
  const verdict =
    !isCounted || growths === expectedGrowths ? "as expected" : `${growths} allocations, expected ${expectedGrowths}`;
  console.log(name, messages.length, sum, verdict);
}

const nothing = () => {};
measure("8-bit", conversation(40, []), nothing);
measure("16-bit", conversation(40, [{ role: "user", content: "one dash \u2014 and no escapes" }]), nothing);
measure(
  "16-bit, escaped",
  conversation(40, [{ role: "user", content: 'a dash \u2014,\na "quote", a lone \ud800 surrogate' }]),
  nothing,
);
measure(
  "16-bit, mostly escaped",
  conversation(2, []).concat(
    conversation(40, []).map(({ role }) => ({ role, content: 'a\tdash \u2014\n"quoted"\\ '.repeat(200) })),
  ),
  nothing,
  0,
);

const replaced: Message = { role: "user", content: "short" };
Object.defineProperty(replaced, "toJSON", { value: () => "replaced" });
measure("fallback", conversation(40, [replaced]), nothing);

measure("small outputs in between", conversation(40, [{ role: "user", content: "\u2014" }]), () => {
  for (let i = 0; i < 20; i++) log(i);
});

const growing = conversation(40, [{ role: "user", content: "\u2014" }]);
measure("a growing conversation", growing, round => {
  growing.push({ role: "user", content: sentence.repeat(20) + round });
});

send(conversation(400, []));
measure("smaller than the last large output", conversation(40, []), nothing);
