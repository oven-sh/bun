// Prints which promise settles first when util.aborted() and the next() of fs.promises.watch() use one signal.
// It uses only Node APIs, so `node aborted-watch-race-fixture.ts <path>` prints the values that the test expects.
import { watch } from "node:fs/promises";
import { aborted } from "node:util";

const watched = process.argv[2];
const turnOfTheEventLoop = () => new Promise(resolve => setImmediate(resolve));
// aborted() holds its resource weakly, and a resource that is collected leaves the promise pending.
const resource = {};

async function races(recursive: boolean) {
  const result: Record<string, string> = {};
  const viaAborted = (signal: AbortSignal) => aborted(signal, resource).then(() => "aborted() fulfilled");
  const viaWatch = (signal: AbortSignal) =>
    watch(watched, { signal, recursive })
      [Symbol.asyncIterator]()
      .next()
      .then(
        () => "next() fulfilled",
        error => `next() rejected with ${error.name}`,
      );
  for (const first of ["aborted()", "next()"]) {
    for (const timing of ["in the same turn", "later"]) {
      const ac = new AbortController();
      const promises =
        first === "aborted()"
          ? [viaAborted(ac.signal), viaWatch(ac.signal)]
          : [viaWatch(ac.signal), viaAborted(ac.signal)];
      if (timing === "later") await turnOfTheEventLoop();
      ac.abort();
      result[`${first} is called first, abort() comes ${timing}`] = await Promise.race(promises);
      await Promise.all(promises);
    }
    const signal = AbortSignal.abort();
    const promises =
      first === "aborted()" ? [viaAborted(signal), viaWatch(signal)] : [viaWatch(signal), viaAborted(signal)];
    result[`${first} is called first, the signal is already aborted`] = await Promise.race(promises);
    await Promise.all(promises);
  }
  {
    // The use that the documentation of util.aborted() shows: the resource is the object that the signal ends.
    const ac = new AbortController();
    const log: string[] = [];
    const watcher = watch(watched, { signal: ac.signal, recursive });
    const whenAborted = aborted(ac.signal, watcher).then(() => log.push("aborted() fulfilled"));
    const loop = (async () => {
      try {
        for await (const _ of watcher);
      } catch (error) {
        log.push(`for await rejected with ${(error as Error).name}`);
      }
    })();
    await turnOfTheEventLoop();
    ac.abort();
    await Promise.all([whenAborted, loop]);
    result["aborted(signal, watcher), for await, and abort() comes later"] = log.join(", ");
  }
  return result;
}

const result = {
  "races": await races(false),
  "races with recursive: true": await races(true),
};
console.log(JSON.stringify(result, null, 2));
