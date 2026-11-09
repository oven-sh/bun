console.log(
  typeof process.versions.bun,
  typeof process.versions.node,
  process.release.name,
  typeof process.config.variables,
  typeof process.features.typescript,
  process.allowedNodeEnvironmentFlags.has("--max-old-space-size"),
  typeof (process as any).revision,
  typeof process.mainModule,
  typeof (process as any).finalization.register,
);
console.log(process.hasUncaughtExceptionCaptureCallback(), typeof (process as any).getBuiltinModule("node:path").join);
(process as any).ref({});
(process as any).unref({});
try {
  (process as any).assert(false, "no");
} catch (error: any) {
  console.log(error.code);
}
