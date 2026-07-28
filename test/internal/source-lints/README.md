# test/internal/source-lints/

Tests in this directory are source-tree lints: they grep `src/**` for
anti-patterns and never touch the built `bun` binary.

All of `test/internal/` (including this directory) runs on GitHub Actions via
`.github/workflows/source-lints.yml` against a released bun, and is excluded
from the Buildkite test shards (`.buildkite/ci.mjs`), so it reports in seconds
instead of waiting for `build-bun` on every lane.

To run locally: `bun test test/internal/`.
