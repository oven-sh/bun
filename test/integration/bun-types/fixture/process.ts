import { expectType } from "./utilities";

process.memoryUsage();
process.cpuUsage().system;
process.cpuUsage().user;
process.on("SIGINT", () => {
  console.log("Interrupt from keyboard");
});

process.on("beforeExit", code => {
  expectType(code).is<number>();
  console.log("Event loop is empty and no work is left to schedule.", code);
});

process.on("exit", code => {
  expectType(code).is<number>();
  console.log("Exiting with code:", code);
});
process.kill(123, "SIGTERM");

// Node's events must stay typed on every EventEmitter method, including the
// ones @types/node leaves to be inherited: bun-types adds its own process event
// by extending ProcessEventMap, and must not redeclare the methods themselves
// on NodeJS.Process, since that replaces the inherited overloads instead of
// adding to them.
const onSignal = (signal: NodeJS.Signals) => {
  console.log(signal);
};
process.once("SIGTERM", onSignal);
process.off("SIGTERM", onSignal);
process.removeListener("SIGTERM", onSignal);
process.prependListener("uncaughtException", (error, origin) => {
  expectType(error).is<Error>();
  expectType(origin).is<NodeJS.UncaughtExceptionOrigin>();
});
process.prependOnceListener("beforeExit", code => {
  expectType(code).is<number>();
});
process.addListener("exit", code => {
  expectType(code).is<number>();
});
process.emit("beforeExit", 0);

// Bun's own process event.
expectType<process.ProcessEventMap["memoryPressure"]>().is<[level: "warning" | "critical"]>();
const onMemoryPressure = (level: "warning" | "critical") => {
  console.log(level);
};
process.on("memoryPressure", level => {
  expectType(level).is<"warning" | "critical">();
});
process.once("memoryPressure", level => {
  expectType(level).is<"warning" | "critical">();
});
process.addListener("memoryPressure", onMemoryPressure);
process.prependListener("memoryPressure", onMemoryPressure);
process.prependOnceListener("memoryPressure", onMemoryPressure);
process.off("memoryPressure", onMemoryPressure);
process.removeListener("memoryPressure", onMemoryPressure);
process.emit("memoryPressure", "critical");
expectType(process.listeners("memoryPressure")).is<((level: "warning" | "critical") => void)[]>();

process.getegid!();
process.geteuid!();
process.getgid!();
process.getgroups!();
process.getuid!();

process.once("SIGINT", () => {
  console.log("Interrupt from keyboard");
});

// commented methods are not yet implemented
console.log(process.allowedNodeEnvironmentFlags);
// console.log(process.channel);
// console.log(process.connected);
// console.log(process.constrainedMemory);
console.log(process.debugPort);
// console.log(process.disconnect);
// console.log(process.getActiveResourcesInfo);
// console.log(process.setActiveResourcesInfo);
// console.log(process.setuid);
// console.log(process.setgid);
// console.log(process.setegid);
// console.log(process.seteuid);
// console.log(process.setgroups);
// console.log(process.hasUncaughtExceptionCaptureCallback);
// console.log(process.initGroups);
console.log(process.listenerCount("exit"));
console.log(process.memoryUsage());
// console.log(process.report);
// console.log(process.resourceUsage);
// console.log(process.setSourceMapsEnabled());
// console.log(process.send);
process.reallyExit();
process.assert(false, "PleAsE don't Use THIs It IS dEpReCATED");
