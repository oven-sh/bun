import { availableParallelism } from "node:os";
import { readInputs } from "./fixtures";
import { sections } from "./questions";

/**
 * Asks the questions of the sections on worker threads.
 * All of them use one ICU, with its caches and its locks: that they get the answers that one thread gets is part of the test.
 * For those locks, more than a few workers are no faster.
 * @param every ask about one subject in this many
 * @returns by section, its answers by `section/subject`
 */
export function ask(names: string[], every = 1, workers = Math.min(availableParallelism(), 8)) {
  const answers = new Map(names.map(name => [name, Promise.withResolvers<Map<string, string>>()]));
  (async () => {
    const inputs = await readInputs();
    const tasks: [section: string, subjects: string[]][] = [];
    const left = new Map<string, number>();
    const found = new Map(names.map(name => [name, new Map<string, string>()]));
    for (const name of names) {
      const subjects = sections[name].subjects(inputs).filter((_, i) => i % every === 0);
      // Small enough that no worker is left with much to do when the others are done.
      const size = Math.max(1, Math.min(16, Math.ceil(subjects.length / (workers * 6))));
      for (let i = 0; i < subjects.length; i += size) tasks.push([name, subjects.slice(i, i + size)]);
      left.set(name, Math.ceil(subjects.length / size));
      if (!subjects.length) answers.get(name)!.resolve(found.get(name)!);
    }
    let next = 0;
    const fail = (error: unknown) => answers.forEach(answer => answer.reject(error));
    // A worker takes a while to start, in a slow build a long while.
    for (let i = 0; i < Math.min(workers, Math.ceil(tasks.length / 12)); i++) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
      let section: string;
      const more = () => {
        if (next === tasks.length) return worker.terminate();
        section = tasks[next][0];
        worker.postMessage(tasks[next++]);
      };
      worker.onmessage = ({ data }: MessageEvent<[string, string][]>) => {
        for (const [key, hash] of data) found.get(section)!.set(key, hash);
        left.set(section, left.get(section)! - 1);
        if (left.get(section) === 0) answers.get(section)!.resolve(found.get(section)!);
        more();
      };
      worker.onerror = event => fail(new Error(`${section}: ${event.message}`));
      more();
    }
  })().catch(error => answers.forEach(answer => answer.reject(error)));
  return new Map([...answers].map(([name, { promise }]) => [name, promise]));
}
