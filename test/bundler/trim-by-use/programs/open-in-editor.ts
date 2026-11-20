try {
  (Bun.openInEditor as any)();
  console.log("no error");
} catch (error) {
  if ((error as any).code === "ERR_FEATURE_REMOVED") throw error;
  console.log((error as Error).name);
}
