const { container, optimize } = require("webpack");
const { ModuleFederationPlugin } = container;
const { LimitChunkCountPlugin } = optimize;

module.exports = {
  mode: "production",
  entry: {},
  target: "node",
  output: {
    path: __dirname + "/dist",
    filename: "remoteEntry.js",
    publicPath: "",
    uniqueName: "webpackRealRemote",
    clean: true,
    library: { type: "var", name: "webpackRealRemote" },
  },
  optimization: { minimize: false },
  plugins: [
    new ModuleFederationPlugin({
      name: "webpackRealRemote",
      filename: "remoteEntry.js",
      exposes: {
        "./Button": "./src/Button.js",
      },
      shared: {},
    }),
    new LimitChunkCountPlugin({ maxChunks: 1 }),
  ],
};
