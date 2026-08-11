const epoch = Bun.startupSnapshot.epoch();
void process.env.APP_MODE; // read before the freeze, but gated: the build report must not nag about it
void process.env.UNGATED_VAR; // read before the freeze and not gated: the report names it
if (epoch > 0) { console.log("[js] restored APP_MODE=" + (process.env.APP_MODE ?? "<unset>")); process.exit(0); }
process.on("restore", () => { console.log("[js] restored APP_MODE=" + (process.env.APP_MODE ?? "<unset>")); process.exit(0); });
if (Bun.startupSnapshot.isBuildingSnapshot()) setTimeout(() => Bun.startupSnapshot.take({ timers: "cancel", envGate: ["APP_MODE", "APP_UNSET_TOO"] }), 30);
else { console.log("[js] plain boot APP_MODE=" + (process.env.APP_MODE ?? "<unset>")); }
