Bun.plugin({
  name: "hot-graphql",
  setup(build) {
    // "code" result shape: { contents, loader }.
    build.onLoad({ filter: /\.code\.graphql$/ }, async ({ path }) => {
      return {
        contents: `export default ${JSON.stringify(await Bun.file(path).text())};`,
        loader: "js",
      };
    });
    // "object" result shape: { exports, loader: "object" }.
    build.onLoad({ filter: /\.object\.graphql$/ }, async ({ path }) => {
      return {
        exports: { default: await Bun.file(path).text() },
        loader: "object",
      };
    });
  },
});
