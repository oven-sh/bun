# Webpack Module Federation Remote Fixture

This fixture was generated with Webpack 5.88.0 and webpack-cli 5.1.4:

```sh
npm install webpack@5.88.0 webpack-cli@5.1.4
npx webpack --config webpack.config.cjs
```

The committed `dist/remoteEntry.js` file is intentionally checked in so Bun's
Module Federation interop tests can consume a real Webpack-generated default
expose without installing Webpack during the test run.

The fixture uses `target: "node"`, a `var` library named `webpackRealRemote`,
`publicPath: ""`, and `LimitChunkCountPlugin({ maxChunks: 1 })` because Bun
target hosts load script/global remotes through
`@module-federation/runtime` plus Bun's eval/global compatibility path. A
browser-oriented Webpack remote with `publicPath: "auto"` requires
`document.currentScript` public path inference and JSONP chunk loading; that
boundary is not covered by this fixture and remains a separate interop case.
