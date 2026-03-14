# Node.js Compatibility Tests

These are official Node.js tests from the Node.js repository.

## Important Notes

- These are Node.js compatibility tests **not written by Bun**, so we cannot modify these tests
- The tests pass by exiting with code 0

## Running Tests

To run these tests with a debug build:

```bash
bun bd <file-path>
```

Note: `bun bd test <file-path>` does **not** work since these tests are meant to be run directly without the Bun test runner.
