import { readInputs } from "./fixtures";
import { answer, forget } from "./questions";

declare var self: Worker;

const inputs = readInputs();
let last: string | undefined;
self.onmessage = async ({ data: [section, subjects] }: MessageEvent<[string, string[]]>) => {
  // As many heaps as there are workers, none of which is under any pressure by itself.
  if (last !== undefined && last !== section) {
    forget(await inputs);
    Bun.gc(true);
  }
  last = section;
  postMessage(answer(section, subjects, await inputs));
};
