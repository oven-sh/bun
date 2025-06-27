const { $ } = require('bun');

async function testShellCancellation() {
  console.log('Testing shell cancellation...\n');

  // Test 1: Cancel a simple long-running command
  {
    console.log('Test 1: Cancelling sleep command');
    const controller = new AbortController();
    const { signal } = controller;
    
    const start = Date.now();
    const promise = $`sleep 5`.signal(signal);
    
    // Cancel after 1 second
    setTimeout(() => {
      console.log('  Sending abort signal...');
      controller.abort();
    }, 1000);
    
    try {
      await promise;
      console.log('  ❌ Expected command to be cancelled');
    } catch (err) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError') {
        console.log(`  ✅ Command cancelled after ${elapsed}ms (AbortError)`);
      } else {
        console.log(`  ❌ Unexpected error: ${err.name} - ${err.message}`);
      }
    }
  }

  // Test 2: Cancel a pipeline
  {
    console.log('\nTest 2: Cancelling pipeline');
    const controller = new AbortController();
    const { signal } = controller;
    
    const start = Date.now();
    const promise = $`yes | head -n 100000`.signal(signal);
    
    // Cancel after 500ms
    setTimeout(() => {
      console.log('  Sending abort signal...');
      controller.abort();
    }, 500);
    
    try {
      await promise;
      console.log('  ❌ Expected pipeline to be cancelled');
    } catch (err) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError') {
        console.log(`  ✅ Pipeline cancelled after ${elapsed}ms (AbortError)`);
      } else {
        console.log(`  ❌ Unexpected error: ${err.name} - ${err.message}`);
      }
    }
  }

  // Test 3: Pre-aborted signal
  {
    console.log('\nTest 3: Pre-aborted signal');
    const controller = new AbortController();
    controller.abort();
    
    const start = Date.now();
    try {
      await $`sleep 5`.signal(controller.signal);
      console.log('  ❌ Expected command to be cancelled immediately');
    } catch (err) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError' && elapsed < 100) {
        console.log(`  ✅ Command cancelled immediately (${elapsed}ms)`);
      } else {
        console.log(`  ❌ Unexpected error or timing: ${err.name} - ${elapsed}ms`);
      }
    }
  }

  // Test 4: Cancel command substitution
  {
    console.log('\nTest 4: Cancelling command substitution');
    const controller = new AbortController();
    const { signal } = controller;
    
    const start = Date.now();
    const promise = $`echo $(sleep 5 && echo "done")`.signal(signal);
    
    // Cancel after 1 second
    setTimeout(() => {
      console.log('  Sending abort signal...');
      controller.abort();
    }, 1000);
    
    try {
      await promise;
      console.log('  ❌ Expected command substitution to be cancelled');
    } catch (err) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError') {
        console.log(`  ✅ Command substitution cancelled after ${elapsed}ms`);
      } else {
        console.log(`  ❌ Unexpected error: ${err.name} - ${err.message}`);
      }
    }
  }

  console.log('\nAll tests completed!');
}

testShellCancellation().catch(console.error);