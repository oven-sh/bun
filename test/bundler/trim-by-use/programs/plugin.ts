Bun.plugin({
  name: "shown",
  setup(build: any) {
    console.log(typeof build.onLoad, typeof build.onResolve, typeof build.module);
    build.module("shown:module", () => ({ exports: { value: 1 }, loader: "object" }));
  },
});
console.log(typeof Bun.plugin.clearAll, (await import(["shown", "module"].join(":"))).value);
