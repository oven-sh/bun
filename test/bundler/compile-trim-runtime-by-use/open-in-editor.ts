try {
  (Bun.openInEditor as any)();
  console.log("no error");
} catch (error) {
  console.log((error as Error).name);
}
