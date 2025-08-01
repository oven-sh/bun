Bun.plugin({
  name: "recursive",
  setup(build) {
    build.onResolve({ filter: /recursive$/, namespace: "recursive" }, args => {
      return {
        path: require.resolve("recursive:" + args.path),
        namespace: "recursive",
      };
    });
  },
});
