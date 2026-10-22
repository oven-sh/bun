# Late subprocess stdio lifetime regression

This Rust fixture emits a small fixed payload and generates a temporary Bun
runner test. Source stays in Rust; the generated file is test input.

Build this standalone crate with Cargo, then run the executable with
--generate ABSOLUTE_NEW_TEST, placing the new file in the Bun checkout's
test/js/bun/spawn/ directory. Run that file with bun bd test ABSOLUTE_NEW_TEST.
The test uses the checkout's GC helper, verifies exact output and actual exit,
and requires all six tracked subprocess objects to be collectable for both
stdout and stderr. Cleanup runs before the lifetime assertion.

Use USE_SYSTEM_BUN=1 bun test ABSOLUTE_NEW_TEST for the unfixed comparison.
The late read intentionally follows actual child exit; each child emits only
a small payload, so the unread output cannot fill its kernel pipe.
No network or real account is involved.

The Windows Buildkite test commands build this fixture and generate
subprocess-late-stdio.generated.test.ts before the existing runner discovers
and shards the suite. The runner executes it against the build artifact for
the current commit; the system Bun is only the unfixed local comparison.
The reserved generated path can be regenerated only when its fixture stamp
is present. Other output paths remain create-new, so CI retries refresh the
emitter path without overwriting an unrelated test.
