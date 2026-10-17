const holder: any = { exports: {} };
try {
  process.dlopen(holder, "/nonexistent/addon.node");
} catch (error) {
  console.log((error as Error).message.includes("addon.node"));
}
