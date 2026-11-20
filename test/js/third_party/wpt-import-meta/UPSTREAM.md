# Vendored WPT import.meta tests

Vendored byte-for-byte from `web-platform-tests/wpt`:

- **Commit:** `c26ee3c4f16ba63f1ee614a8344766cc35899563`
- **Fetched:** 2026-11-11
- **Source directory:** `html/semantics/scripting-1/the-script-element/module/import-meta/`
- **License:** 3-Clause BSD (`LICENSE.md` in the upstream repository)

To re-vendor, copy each file from the pinned commit (or from a newer commit that you reviewed):

```sh
base=https://raw.githubusercontent.com/web-platform-tests/wpt/c26ee3c4f16ba63f1ee614a8344766cc35899563
dir=html/semantics/scripting-1/the-script-element/module/import-meta
for file in import-meta-resolve.any.js import-meta-object.any.js import-meta-root.js import-meta-dependent.js; do
  curl -fsSL "$base/$dir/$file" -o "test/js/third_party/wpt-import-meta/import-meta/$file"
done
```

## What is vendored

- `import-meta-resolve.any.js`: what `import.meta.resolve` is, and what it returns.
- `import-meta-object.any.js`: what `import.meta` is, and the attributes of its properties.
- `import-meta-root.js`, `import-meta-dependent.js`: the two modules that `import-meta-resolve.any.js` imports.

Do not change the contents of a vendored file. All adaptation is in `testharness-host.mjs` and
`wpt-import-meta.test.ts`.

## What is excluded (and why)

| Path                                                                             | Reason                                                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `import-meta-url.any.js`                                                         | It imports `./import-meta-root.js#1`. Bun does not find a specifier that has a URL fragment, so the file does not load.     |
| `import-meta-url.html`, `postmessage-worker.js`                                  | They need an HTML document and a `SharedWorker`.                                                                            |
| `import-meta-resolve-importmap.html`, `import-meta-resolve-multiple-scripts.html` | They need an HTML document (an import map, an `iframe`).                                                                    |
| `WEB_FEATURES.yml`                                                               | WPT metadata, not a test.                                                                                                   |
