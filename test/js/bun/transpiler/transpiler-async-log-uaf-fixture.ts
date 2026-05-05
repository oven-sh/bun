const transpiler = new Bun.Transpiler();

const jobs: Promise<unknown>[] = [];
for (let i = 0; i < 64; i++) {
  jobs.push(transpiler.transform("import {a} from 1;\nconst x: = y;\nexport", "ts"));
}
// Give the worker threads time to finish run() and tear down their arenas
// before the JS thread drains the completion tasks.
Bun.sleepSync(100);
Bun.gc(true);

const results = await Promise.allSettled(jobs);
for (const result of results) {
  if (result.status !== "rejected") {
    throw new Error("expected rejection");
  }
  const reason: any = result.reason;
  const messages: string[] = Array.isArray(reason?.errors)
    ? reason.errors.map((e: any) => String(e?.message ?? e))
    : [String(reason?.message ?? reason)];
  if (!messages.some(m => m.includes("Expected string"))) {
    throw new Error("missing expected parse error, got: " + JSON.stringify(messages));
  }
}
console.log("DONE");
