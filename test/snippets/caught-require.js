// Since top-level await is Special, we run these checks in the top-level scope as well.
try {
  require("this-package-should-not-exist");
} catch (exception) {}

try {
  await import("this-package-should-not-exist");
} catch (exception) {}

import("this-package-should-not-exist").then(
  () => {},
  () => {},
);

export async function test() {
  // none of these should error
  try {
    require("this-package-should-not-exist");
  } catch (exception) {}

  try {
    await import("this-package-should-not-exist");
  } catch (exception) {}

  import("this-package-should-not-exist").then(
    () => {},
    () => {},
  );

  return testDone(import.meta.url);
}
