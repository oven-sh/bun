// Child of "close() over the WebSocket transport" in webview-chrome.test.ts.
// Runs in its own process because the CDP transport is a per-process
// singleton locked to pipe mode by the rest of that file. argv[2] is the
// ws:// browser endpoint of a Chrome the parent spawned; the parent watches
// tab creation on its own connection and checks this process's stdout.
const backend = { type: "chrome", url: process.argv[2] } as const;

// close() before the handshake completes: Target.createTarget is still
// queued inside the transport and must be cancelled, never sent. The
// parent sees that as "no tab created" for this step. Closing the only
// view also drops the connection; the next view reconnects.
const early = new Bun.WebView({ backend, width: 100, height: 100 });
const earlyNav = early.navigate("data:text/html,<body>early</body>");
early.close();
console.log(
  "early:",
  await earlyNav.then(
    () => "resolved",
    (e: Error) => e.message,
  ),
);

const probe = new Bun.WebView({ backend, width: 100, height: 100 });
await probe.navigate("data:text/html,<body>probe</body>");
await probe.cdp("Target.setDiscoverTargets", { discover: true });
const page = Promise.withResolvers<string>();
const destroyed = new Map<string, PromiseWithResolvers<void>>();
const destroyedEntry = (targetId: string) => {
  let entry = destroyed.get(targetId);
  if (!entry) destroyed.set(targetId, (entry = Promise.withResolvers<void>()));
  return entry;
};
probe.addEventListener<{ targetInfo: { targetId: string; type: string } }>("Target.targetCreated", e => {
  if (e.data.targetInfo.type === "page") page.resolve(e.data.targetInfo.targetId);
});
probe.addEventListener<{ targetId: string }>("Target.targetDestroyed", e => destroyedEntry(e.data.targetId).resolve());

// close() after the handshake, while Target.createTarget is in flight: the
// tab gets created and the late reply has to be turned into
// Target.closeTarget.
const late = new Bun.WebView({ backend, width: 100, height: 100 });
const lateNav = late.navigate("data:text/html,<body>late</body>");
late.close();
console.log(
  "late:",
  await lateNav.then(
    () => "resolved",
    (e: Error) => e.message,
  ),
);
const tab = await page.promise;
console.log("late: tab created");
// A leaked tab produces no event at all, so a bounded wait is the only way
// to report it and exit instead of hanging here (and leaving the parent to
// time out with this process and its Chrome still running).
const leakReport = setTimeout(() => {
  console.log("late: tab still open");
  process.exit(1);
}, 2000);
await destroyedEntry(tab).promise;
clearTimeout(leakReport);
console.log("late: tab closed");
probe.close();
