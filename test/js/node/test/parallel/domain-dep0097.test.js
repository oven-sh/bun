//#FILE: test-domain-dep0097.js
//#SHA1: d0eeaeed86d045c8deba99d4ca589d35b368f17d
//-----------------
"use strict";

// Skip this test if inspector is disabled
if (typeof inspector === "undefined") {
  test.skip("Inspector is disabled", () => {});
} else {
  const domain = require("domain");
  const inspector = require("inspector");

  test("DEP0097 warning is emitted", () => {
    const warningHandler = jest.fn(warning => {
      expect(warning.code).toBe("DEP0097");
      expect(warning.message).toMatch(/Triggered by calling emit on process/);
    });

    process.on("warning", warningHandler);

    domain.create().run(() => {
      inspector.open(0);
    });

    expect(warningHandler).toHaveBeenCalledTimes(1);

    // Clean up
    process.removeListener("warning", warningHandler);
  });
}

//<#END_FILE: test-domain-dep0097.js
