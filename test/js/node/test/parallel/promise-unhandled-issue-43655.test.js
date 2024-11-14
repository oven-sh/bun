//#FILE: test-promise-unhandled-issue-43655.js
//#SHA1: d0726f3e05d7aba39fc84013c63399d915956e30
//-----------------
"use strict";

function delay(time) {
  return new Promise(resolve => {
    setTimeout(resolve, time);
  });
}

test("Promise unhandled rejection performance", async () => {
  for (let i = 0; i < 100000; i++) {
    await new Promise((resolve, reject) => {
      reject("value");
    }).then(
      () => {},
      () => {},
    );
  }

  const time0 = Date.now();
  await delay(0);

  const diff = Date.now() - time0;
  expect(diff).toBeLessThan(500);
}, 10000); // Increased timeout to 10 seconds to ensure enough time for the test

//<#END_FILE: test-promise-unhandled-issue-43655.js
