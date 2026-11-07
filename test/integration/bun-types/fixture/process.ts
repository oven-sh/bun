import { findSourceMap, getSourceMapsSupport, setSourceMapsSupport, type SourceMap } from "node:module";
import { expectType } from "./utilities";

process.memoryUsage();
process.cpuUsage().system;
process.cpuUsage().user;
process.on("SIGINT", () => {
  console.log("Interrupt from keyboard");
});

process.on("beforeExit", code => {
  console.log("Event loop is empty and no work is left to schedule.", code);
});

process.on("exit", code => {
  console.log("Exiting with code:", code);
});
process.kill(123, "SIGTERM");

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
process.setSourceMapsEnabled(true);
expectType(process.sourceMapsEnabled).is<boolean>();
setSourceMapsSupport(true, { nodeModules: true, generatedCode: true });
const sourceMapsSupport = getSourceMapsSupport();
expectType(sourceMapsSupport.enabled).is<boolean>();
expectType(sourceMapsSupport.nodeModules).is<boolean>();
expectType(sourceMapsSupport.generatedCode).is<boolean>();
expectType(findSourceMap("/path/to/module.js")).is<SourceMap | undefined>();
// console.log(process.send);
process.reallyExit();
process.assert(false, "PleAsE don't Use THIs It IS dEpReCATED");

for (const [errno, [name, description]] of process.binding("uv").getErrorMap()) {
  errno.toFixed();
  name.toUpperCase();
  description.toUpperCase();
}
