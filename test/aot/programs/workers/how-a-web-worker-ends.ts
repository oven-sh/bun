// The same for the Worker of the web: error events with their message, close events with their code, reportError, onerror that prevents the default.
function deeper(n: number): number {
  return deeper(n + 1) + 1;
}
const ends: Record<string, () => unknown> = {
  "a throw at the top": () => { throw new RangeError("at the top"); },
  "a throw of a text": () => { throw "a text"; },
  "a throw in a timer": () => void setTimeout(() => { throw new Error("in a timer"); }, 1),
  "a throw in onmessage": () => { self.onmessage = () => { throw new TypeError("in onmessage"); }; postMessage("send"); },
  "a rejection nobody handles": () => void Promise.reject(new Error("rejected")),
  "a stack overflow": () => deeper(0),
  "process.exit(3)": () => process.exit(3),
  "reportError": () => { reportError(new Error("reported")); postMessage("went on"); },
  "self.onerror returns true": () => { self.onerror = () => (postMessage("seen there"), true); setTimeout(() => { throw new Error("handled there"); }, 1); setTimeout(() => process.exit(0), 20); },
  "an error listener prevents the default": () => { addEventListener("error", event => (event.preventDefault(), postMessage("prevented: " + (event as ErrorEvent).message.split("\n").find(line => /^\w*(Error|error): /.test(line))))); setTimeout(() => { throw new Error("prevented there"); }, 1); setTimeout(() => process.exit(0), 20); },
  "nothing left to do": () => 0,
  "a listener keeps it alive until it is terminated": () => { addEventListener("message", () => {}); postMessage("terminate me"); },
};
declare var self: Worker & { close(): void; onerror: any };

if (Bun.isMainThread) {
  for (const name of Object.keys(ends)) {
    const events: string[] = [];
    const worker = new Worker(new URL(import.meta.url), { env: { ...process.env, END: name } as any });
    worker.addEventListener("open", () => events.push("open"));
    worker.onmessage = event => {
      if (event.data === "send") return worker.postMessage("go");
      if (event.data === "terminate me") worker.terminate();
      events.push("message " + event.data);
    };
    worker.onerror = event => {
      events.push("error " + event.constructor.name + " " + JSON.stringify(event.message.split("\n").find(line => /^\w*(Error|error): |^a text/.test(line)) ?? event.message.slice(0, 60)) + " " + (event.error === null ? "null" : typeof event.error));
      event.preventDefault();
    };
    const code = await new Promise(resolve => worker.addEventListener("close", event => resolve((event as any).code)));
    console.log(name + ":", events.join(" | "), "| close", code);
  }
  console.log("the main thread lives");
} else {
  ends[process.env.END!]();
}
