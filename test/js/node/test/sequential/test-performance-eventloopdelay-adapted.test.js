// Adapted from Node.js test-performance-eventloopdelay.js
// Modified to work without internal modules
'use strict';

const assert = require('assert');
const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

// Replace internal/util sleep with a busy wait
function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // Busy loop
  }
}

// Basic test: enable/disable behavior
{
  const histogram = monitorEventLoopDelay();
  assert(histogram);
  assert(histogram.enable());
  assert(!histogram.enable());
  histogram.reset();
  assert(histogram.disable());
  assert(!histogram.disable());
}

// Test invalid arguments
{
  [null, 'a', 1, false, Infinity].forEach((i) => {
    assert.throws(
      () => monitorEventLoopDelay(i),
      {
        name: 'TypeError',
      }
    );
  });

  [null, 'a', false, {}, []].forEach((i) => {
    assert.throws(
      () => monitorEventLoopDelay({ resolution: i }),
      {
        name: 'TypeError',
      }
    );
  });

  [-1, 0, Infinity].forEach((i) => {
    assert.throws(
      () => monitorEventLoopDelay({ resolution: i }),
      {
        name: 'RangeError',
      }
    );
  });
}

// Test actual delay monitoring
{
  const s390x = os.arch() === 's390x';
  const histogram = monitorEventLoopDelay({ resolution: 1 });
  histogram.enable();
  let m = 5;
  if (s390x) {
    m = m * 2;
  }
  
  function spinAWhile() {
    sleep(1000);
    if (--m > 0) {
      setTimeout(spinAWhile, 500);
    } else {
      histogram.disable();
      // The values are non-deterministic, so we just check that a value is
      // present, as opposed to a specific value.
      assert(histogram.min > 0, `min should be > 0, got ${histogram.min}`);
      assert(histogram.max > 0, `max should be > 0, got ${histogram.max}`);
      assert(histogram.stddev > 0, `stddev should be > 0, got ${histogram.stddev}`);
      assert(histogram.mean > 0, `mean should be > 0, got ${histogram.mean}`);
      assert(histogram.percentiles.size > 0, `percentiles.size should be > 0, got ${histogram.percentiles.size}`);
      
      for (let n = 1; n < 100; n = n + 0.1) {
        assert(histogram.percentile(n) >= 0, `percentile(${n}) should be >= 0, got ${histogram.percentile(n)}`);
      }
      
      histogram.reset();
      assert.strictEqual(histogram.min, 9223372036854776000);
      assert.strictEqual(histogram.max, 0);
      assert(Number.isNaN(histogram.stddev));
      assert(Number.isNaN(histogram.mean));
      assert.strictEqual(histogram.percentiles.size, 1);

      // Test invalid percentile arguments
      ['a', false, {}, []].forEach((i) => {
        assert.throws(
          () => histogram.percentile(i),
          {
            name: 'TypeError',
          }
        );
      });
      
      [-1, 0, 101, NaN].forEach((i) => {
        assert.throws(
          () => histogram.percentile(i),
          {
            name: 'RangeError',
          }
        );
      });
      
      console.log('✅ All Node.js compatibility tests passed!');
    }
  }
  
  spinAWhile();
}

// Test garbage collection (if available)
if (global.gc) {
  process.on('exit', global.gc);
}