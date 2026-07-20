# npm pack golden vectors

Each `.tgz` here is the real output of `npm pack` over the matching `src/`
directory. `tar.test.ts` asserts that `buildTarball`'s tar payload is
byte-identical to it (`gunzip(buildTarball(src)) === gunzip(golden)`), so
when `tar.ts` drifts from what npm produces, CI says so here instead of as
an opaque `sha512-` diff in an unrelated lockfile snapshot.

The comparison is on the gunzipped tar payload rather than the `.tgz` bytes
so that a zlib bump cannot churn it.

Generated with `npm` 11.16.0. To regenerate one:

```sh
cd test/npm-registry/goldens/src/<name>
npm pack --pack-destination ../..
```

Shapes covered:

- `golden-plain` — a lone `package.json`.
- `golden-with-bin` — a `bin` target `npm pack` marks 0755.
- `golden-with-gyp` — a root `binding.gyp`.
- `golden-scoped` — `@golden/scoped` (packs as `golden-scoped-1.0.0.tgz`).
- `golden-long-path` — a 117-byte path that crosses ustar's
  `name`/`prefix` split, so `splitName` is checked against node-tar.
