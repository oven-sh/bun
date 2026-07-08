# Vendored WPT streams suite

Vendored byte-for-byte from `web-platform-tests/wpt`:

- **Commit:** `1cfa3004f4ac74aa007591529aba9e9246b1f1bf`
- **Fetched:** 2026-07-01
- **Source directories:** `streams/`, plus `common/gc.js`

To re-vendor, pin the same (or a newer, reviewed) commit before copying any files:

```sh
git -c advice.detachedHead=false clone --depth=1 --filter=blob:none --sparse \
    https://github.com/web-platform-tests/wpt /tmp/wpt
git -C /tmp/wpt sparse-checkout set streams common
git -C /tmp/wpt checkout 1cfa3004f4ac74aa007591529aba9e9246b1f1bf
```

## What is vendored

- `streams/**/*.any.js` (68 files) — every `.any.js` test, preserving the
  upstream directory layout (`readable-streams/`, `readable-byte-streams/`,
  `writable-streams/`, `transform-streams/`, `piping/`,
  `queuing-strategies.any.js`, and the `crashtests/*.any.js`).
- `streams/resources/*.js` — the shared helpers the tests include via
  `// META: script=` (`rs-utils.js`, `test-utils.js`, `recording-streams.js`,
  `rs-test-templates.js`).
- `common/gc.js` — provides `garbageCollect()`; included by the
  garbage-collection tests via `// META: script=/common/gc.js`.
- `resources/idlharness.js`, `resources/webidl2/lib/webidl2.js`,
  `interfaces/streams.idl`, `interfaces/dom.idl` — the WebIDL harness, parser, and
  IDL definitions `streams/idlharness.any.js` needs. The runner resolves the
  `// META: script=/resources/WebIDLParser.js` server alias to the webidl2 bundle
  and serves `/interfaces/<spec>.idl` fetches from the vendored files
  (`fetch_spec` in `wpt-streams.test.ts`).

Vendored file contents must never be modified. All adaptation lives in
`../wpt-testharness-shim.ts` / `wpt-streams.test.ts`.

## What is excluded (and why)

| Path | Reason |
| --- | --- |
| `streams/transferable/**` | Requires `postMessage` stream transfer (windows/workers/service workers); Bun does not support transferable streams — out of scope by design |
| `streams/readable-streams/owning-type*.tentative.any.js` (3 files) | `.tentative` — the `type: 'owning'` proposal is not part of the standard; two also need `MessageChannel` transfer / `VideoFrame` |
| `streams/*/*.window.js`, `streams/**/*.html` | Require a browser `Window`/`Document`/dedicated worker (`queuing-strategies-size-function-per-global.window.js`, `read-task-handling.window.js`, `cross-realm-crash.window.js`, `invalid-realm.tentative.window.js`, the html crashtests, `global.html`) |
| `streams/**/WEB_FEATURES.yml`, `META.yml`, `README.md` | WPT metadata, not tests |
