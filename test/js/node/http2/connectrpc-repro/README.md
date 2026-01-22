# HTTP/2 Premature Close Bug - Reproduction Case

Minimal reproduction of HTTP/2 "premature close" error affecting Connect RPC streaming.

## Quick Start

```bash
# 1. Install dependencies
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
bun install

# 2. Start server (Terminal 1)
python server.py

# 3. Run client (Terminal 2)
bun test-load.ts 500
# Expected: ✗ Error: [unknown] Premature close (unfixed Bun)
# Expected: ✓ Received 500/500 messages (with fix)
```

## The Bug

**Trigger:** Server streams 500 large messages (10KB each) rapidly, then closes immediately

**Result:** Client throws "Premature close" before receiving all data

**Root Cause:** `streamEnd` handler in `src/js/node/http2.ts` calls `stream.destroy()` synchronously on END_STREAM, even when data is still buffered (`_readableState.ended=true` but `endEmitted=false`)

## Why This Reproduction Works

Timing-sensitive bugs require specific conditions:
- ✅ **Python Connect RPC server** - Creates cross-process timing that triggers bug
- ❌ Node.js Connect RPC server - Different event loop, doesn't trigger
- ❌ In-process HTTP/2 - Same event loop, doesn't trigger

## Files

| File | Purpose |
|------|---------|
| `server.py` | Python Connect RPC server (reproduces bug) |
| `test-load.ts` | Bun client (demonstrates error) |
| `test.proto` | Protocol Buffer definition |
| `test_pb.ts` | Generated TypeScript code |

## Testing the Fix

```bash
# Test with system Bun 1.3.6 (should fail - proves bug exists)
bun test-load.ts 500
# ✗ Error: [unknown] Premature close

# Test with debug build (should pass - proves fix works)
CMAKE_OSX_DEPLOYMENT_TARGET=15.7.3 bun bd test/js/node/http2/connectrpc-repro/test-load.ts 500
# ✓ Received 500/500 messages
```

Note: Run `bun bd` commands from the repository root. The `CMAKE_OSX_DEPLOYMENT_TARGET` may be needed on some systems. Bug confirmed present in Bun 1.3.6.

## Note for Maintainers

This is a reference reproduction case. The actual test suite may use a different approach based on CI/CD requirements.
