Bun.plugin({
  name: "hot-graphql",
  setup(build) {
    build.onLoad({ filter: /\.graphql$/ }, async ({ path }) => {
      return {
        contents: `export default ${JSON.stringify(await Bun.file(path).text())};`,
        loader: "js",
      };
    });
  },
});
