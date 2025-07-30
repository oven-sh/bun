# Issue #3617: Path mapping fails when tsconfig extends from packages

This test directory contains a comprehensive reproduction test case for the bug where TypeScript path mappings don't work when the tsconfig.json extends from an npm package.

## Bug Description

When a `tsconfig.json` file extends from a package (e.g., `"extends": "@company/tsconfig"`), the path mappings defined in that package's tsconfig are not properly resolved by Bun's module resolver. This affects both runtime (`bun run`) and build-time (`Bun.build`) resolution.

## Test Structure

The test file `3617.test.ts` contains multiple test cases that demonstrate:

1. **Baseline test**: Path mapping works when extending from local files ✅
2. **Package extends**: Path mapping fails when extending from packages ❌
3. **Nested extends**: Multiple levels of package extends also fail ❌
4. **Scoped packages**: Issue affects both scoped and unscoped packages ❌
5. **Bundler impact**: Build-time resolution is also affected ❌
6. **Error handling**: Related error scenarios ❌

## Expected vs. Actual Behavior

**Expected**: Path mappings should work identically whether the tsconfig extends from:
- Local file: `"extends": "./tsconfig.base.json"`
- Package: `"extends": "@company/tsconfig"`

**Actual**: Path mappings only work with local extends, not package extends.

## Test Files

- `3617.test.ts` - Main test file with all reproduction cases
- `README.md` - This documentation file

## Running the Tests

```bash
# Run all tests for this issue
bun bd test test/regression/issue/3617-tsconfig-extends-path-mapping/

# Run a specific test case
bun bd test test/regression/issue/3617-tsconfig-extends-path-mapping/3617.test.ts -t "package extends"
```

All tests currently pass because they expect the current broken behavior. Once the bug is fixed, the tests will need to be updated to expect the correct behavior.