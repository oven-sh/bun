// This fixture tests that Jest global variables are injected into the global scope
// even when the file is NOT the entrypoint of the test.
import "./12034.fixture";

test("that an imported file can use Jest globals", () => {
  expect(1).toBeOne();
  expect(2).not.toBeOne();
});
