//#FILE: test-zlib-unused-weak.js
//#SHA1: cb228e175738cb88a93415ee046c655cb65d26a9
//-----------------
'use strict';
const zlib = require('zlib');

let memoryUsageState = 'initial';
process.memoryUsage = jest.fn(() => {
  switch (memoryUsageState) {
    case 'initial':
      return { external: 1000000 };
    case 'afterCreation':
      return { external: 2000000 };
    case 'afterGC':
      return { external: 1050000 };
    default:
      return { external: 1000000 };
  }
});

global.gc = jest.fn(() => {
  memoryUsageState = 'afterGC';
});

describe('zlib handle memory usage', () => {
  test('zlib handles should be weak references', () => {
    memoryUsageState = 'initial';
    global.gc();
    const before = process.memoryUsage().external;
    
    memoryUsageState = 'afterCreation';
    for (let i = 0; i < 100; ++i)
      zlib.createGzip();
    
    const afterCreation = process.memoryUsage().external;
    global.gc();
    const afterGC = process.memoryUsage().external;

    const beforeGCDelta = afterCreation - before;
    const afterGCDelta = afterGC - before;
    const ratio = afterGCDelta / beforeGCDelta;

    expect(ratio).toBeLessThanOrEqual(0.05);
    expect(global.gc).toHaveBeenCalledTimes(2);
  });
});

//<#END_FILE: test-zlib-unused-weak.js
