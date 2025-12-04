# Test Resolve Extensions

The `--resolve-extensions` flag and `resolveExtensions` bunfig.toml property allow you to customize which file name patterns are recognized as test files.

## Default Behavior

By default, Bun recognizes test files with these suffixes:
- `.test` (e.g., `myfile.test.ts`)
- `_test` (e.g., `myfile_test.ts`)
- `.spec` (e.g., `myfile.spec.ts`)
- `_spec` (e.g., `myfile_spec.ts`)

## Usage

### CLI Flag

```bash
# Use a single custom extension
bun test --resolve-extensions .check

# Use multiple custom extensions
bun test --resolve-extensions .check --resolve-extensions .verify
```

### bunfig.toml

```toml
[test]
# Single extension
resolveExtensions = ".check"

# Multiple extensions
resolveExtensions = [".check", ".verify"]
```

## Examples

### Custom test suffix

If you prefer using `.check.ts` for your test files:

```toml
# bunfig.toml
[test]
resolveExtensions = ".check"
```

Now `myfile.check.ts` will be recognized as a test file, but `myfile.test.ts` will not.

### Multiple custom patterns

You can mix different patterns:

```toml
# bunfig.toml
[test]
resolveExtensions = [".check", ".verify", "_integration"]
```

This will recognize:
- `myfile.check.ts`
- `myfile.verify.ts`
- `myfile_integration.ts`

### Override via CLI

The CLI flag takes precedence over bunfig.toml:

```bash
# Even if bunfig.toml has resolveExtensions = ".check"
# This will only run .verify files
bun test --resolve-extensions .verify
```

## Notes

- The extensions are matched against the filename **before** the file extension (`.ts`, `.js`, etc.)
- All standard JavaScript/TypeScript file extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) are still supported
- When custom extensions are specified, the default patterns (`.test`, `_test`, `.spec`, `_spec`) are **replaced**, not supplemented
