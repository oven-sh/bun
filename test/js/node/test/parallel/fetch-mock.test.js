//#FILE: test-fetch-mock.js
//#SHA1: 92268be36b00e63e18a837088b9718344c3bff4f
//-----------------
"use strict";

test("should correctly stub globalThis.fetch", async () => {
  const customFetch = async url => {
    return {
      text: async () => "foo",
    };
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(customFetch);

  const response = await globalThis.fetch("some-url");
  const text = await response.text();

  expect(text).toBe("foo");
  expect(globalThis.fetch).toHaveBeenCalledWith("some-url");

  // Restore the original fetch
  globalThis.fetch = originalFetch;
});

//<#END_FILE: test-fetch-mock.js
