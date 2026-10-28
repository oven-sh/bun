import { readSync } from "node:fs";

export type Answer = string | Uint8Array;

function waitForLine(): void {
  try {
    readSync(0, new Uint8Array(16));
  } catch {}
}

function digest(answer: Answer): string {
  return new Bun.CryptoHasher("sha256").update(answer).digest("hex");
}

function nextTurnOfTheEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export async function run(work: () => Answer | Promise<Answer>, how: { asARequest?: boolean } = {}): Promise<void> {
  const turn = how.asARequest
    ? async () => {
        await nextTurnOfTheEventLoop();
        return work();
      }
    : work;
  const [warmUpMilliseconds, warmUpTurns, windows, windowMilliseconds] = process.argv.slice(-4).map(Number);

  let begin = Bun.nanoseconds();
  const first = await turn();
  const firstTurnMilliseconds = (Bun.nanoseconds() - begin) / 1e6;

  let turnsOfWarmUp = 1;
  begin = Bun.nanoseconds();
  while (turnsOfWarmUp < warmUpTurns || (Bun.nanoseconds() - begin) / 1e6 < warmUpMilliseconds) {
    await turn();
    turnsOfWarmUp++;
  }
  const turnsAWindow = Math.max(1, Math.round((windowMilliseconds * turnsOfWarmUp) / ((Bun.nanoseconds() - begin) / 1e6)));

  console.log(JSON.stringify({ pid: process.pid, turnsAWindow }));
  waitForLine();

  const millisecondsATurn: number[] = [];
  let last: Answer = first;
  for (let window = 0; window < windows; window++) {
    begin = Bun.nanoseconds();
    for (let index = 0; index < turnsAWindow; index++) last = await turn();
    millisecondsATurn.push((Bun.nanoseconds() - begin) / 1e6 / turnsAWindow);
  }

  console.log(
    JSON.stringify({
      answer: digest(first),
      lastAnswer: digest(last),
      bytes: first.length,
      firstTurnMilliseconds,
      turnsOfWarmUp,
      turns: windows * turnsAWindow,
      millisecondsATurn,
    }),
  );
  waitForLine();
}
