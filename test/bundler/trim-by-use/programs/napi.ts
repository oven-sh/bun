const holder: any = { exports: {} };
try {
  process.dlopen(holder, "/nonexistent/addon.node");
} catch (error) {
  if ((error as any).code === "ERR_FEATURE_REMOVED") throw error;
  console.log((error as Error).message.includes("addon.node"));
}
