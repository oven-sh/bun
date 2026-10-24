Object.assign(globalThis, {
  appVersion: "1.2",
  appName: ["app"],
  appStart: port => "started on " + port,
  App: { retries: null },
  appOptions: { depth: "deep", extra: 1 },
});
