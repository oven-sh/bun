self.postMessage({
  name: self.name,
  hasName: "name" in self,
  preloadHasName: globalThis.preloadHasName,
  preloadName: globalThis.preloadName,
});