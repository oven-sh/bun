// Regular expressions of the program are used by sixteen Workers at once: lastIndex, the legacy statics, named groups, sticky and global matching, replace with callbacks, split, matchAll, backtracking. Each thread has its own state.
const word = /\b(\w)(\w*)\b/g;
const date = /(?<year>\d{4})-(?<month>\d\d)-(?<day>\d\d)/;
const sticky = /ab+/y;
const unicode = /\p{Lu}\p{Ll}+/gu;
const back = /^(a|ab|abc)*d$/;
const look = /(?<=\$)\d+(?=\.)/g;
function work(seed: number): string {
  const text = `the quick brown fox ${seed} jumps over 2026-10-${String(10 + (seed % 18))} and $${seed}.50 Über Ärger abbbab`;
  const out: string[] = [];
  for (let round = 0; round < 300; round++) {
    word.lastIndex = 0;
    let count = 0;
    while (word.exec(text)) count++;
    const found = date.exec(text)!;
    sticky.lastIndex = text.length - 6;
    const stuck = sticky.exec(text);
    if (round === 299) {
      out.push(String(count), found.groups!.day, (RegExp as any).$1, (RegExp as any).lastMatch, String(stuck?.[0]), String(sticky.lastIndex));
      out.push(text.replace(word, (_, first: string, rest: string) => first.toUpperCase() + rest).slice(0, 30));
      out.push([...text.matchAll(unicode)].map(match => match[0] + "@" + match.index).join());
      out.push(String(back.test("abcababc".repeat(3) + "d")), String(back.test("abcababc".repeat(3) + "e")));
      out.push((text.match(look) ?? []).join(), text.split(/\s+(?=\w{5}\b)/).length + "", new RegExp("f(o)x " + seed).exec(text)![1]);
    }
  }
  return out.join("|");
}

if (Bun.isMainThread) {
  const workers = Array.from({ length: 16 }, () => new Worker(new URL(import.meta.url)));
  const answers = await Promise.all(workers.map((worker, seed) => new Promise<string>(resolve => {
    worker.onmessage = event => resolve(event.data);
    worker.postMessage(seed);
  })));
  let same = 0;
  answers.forEach((answer, seed) => (answer === work(seed) ? same++ : console.log("ANOTHER", seed, answer, work(seed))));
  console.log("as here:", same, answers[3]);
  for (const worker of workers) worker.terminate();
} else {
  addEventListener("message", (event: MessageEvent<number>) => postMessage(work(event.data)));
}
