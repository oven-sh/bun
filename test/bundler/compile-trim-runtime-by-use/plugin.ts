Bun.plugin({
  name: "shown",
  setup(build: any) {
    console.log(typeof build.onLoad, typeof build.onResolve, typeof build.module);
  },
});
console.log(typeof Bun.plugin.clearAll);
