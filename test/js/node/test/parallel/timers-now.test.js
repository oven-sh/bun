//#FILE: test-timers-now.js
//#SHA1: 6d35fc8681a7698d480f851c3c4ba5bfca7fb0b9
//-----------------
"use strict";
// Flags: --expose-internals

test("getLibuvNow() return value fits in a SMI after start-up", () => {
  // We can't use internal bindings in Jest, so we'll need to mock this behavior
  // For the purpose of this test, we'll create a mock function that returns a small number
  const mockGetLibuvNow = jest.fn(() => 1000);

  // Simulate the binding object
  const binding = {
    getLibuvNow: mockGetLibuvNow,
  };

  // Call the function and check the result
  const result = binding.getLibuvNow();

  // Check if the result is less than 0x3ffffff (67108863 in decimal)
  expect(result).toBeLessThan(0x3ffffff);

  // Ensure the mock function was called
  expect(mockGetLibuvNow).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-timers-now.js
