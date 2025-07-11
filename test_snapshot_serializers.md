# Custom Snapshot Serializer Support in Bun Test

This implementation adds support for custom snapshot serializers in bun:test, following Jest's API.

## Configuration

Add snapshot serializers to your `bunfig.toml`:

```toml
[test]
snapshotSerializers = ["./my-serializer.js"]
```

## API

Snapshot serializers should export an object with `test` and `serialize` methods:

```javascript
// my-serializer.js
module.exports = {
  test(val) {
    return val && Object.prototype.hasOwnProperty.call(val, 'foo');
  },
  
  serialize(val, config, indentation, depth, refs, printer) {
    return `Pretty foo: ${printer(val.foo)}`;
  }
};
```

Or using ES modules:

```javascript
// my-serializer.js
export default {
  test(val) {
    return val && Object.prototype.hasOwnProperty.call(val, 'foo');
  },
  
  serialize(val, config, indentation, depth, refs, printer) {
    return `Pretty foo: ${printer(val.foo)}`;
  }
};
```

## Test Example

```javascript
// test.js
import { expect, test } from 'bun:test';

test('snapshot serializer', () => {
  const obj = { foo: 'bar', baz: 123 };
  expect(obj).toMatchSnapshot();
  // Output: Pretty foo: "bar"
});
```

## Implementation Details

1. **Configuration Parsing**: Added `snapshotSerializers` parsing in `bunfig.zig`
2. **Module Loading**: Added `loadSnapshotSerializers()` function in `VirtualMachine.zig`
3. **Pretty Format Integration**: Added `trySnapshotSerializers()` in `pretty_format.zig`
4. **Strong References**: Loaded serializers are stored as `JSC.Strong.Optional` to prevent garbage collection

## Files Modified

- `src/bunfig.zig`: Added configuration parsing
- `src/cli.zig`: Added snapshot_serializers field to context
- `src/bun.js/VirtualMachine.zig`: Added loading and storage of serializers
- `src/bun.js/test/pretty_format.zig`: Added serializer integration
- `src/cli/test_command.zig`: Added serializer assignment
- `src/bun_js.zig`: Added serializer assignment
- `src/bake/production.zig`: Added serializer assignment
- `src/bun.js/web_worker.zig`: Added empty serializer assignment