export const startItself = () => new Worker(import.meta.url);
if (!Bun.isMainThread) postMessage("started itself: " + import.meta.file);
