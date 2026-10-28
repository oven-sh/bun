// Runs one file through run({ files }) and prints a JSON summary of its
// test:pass/test:fail events plus the run-level counts, for node-test.test.ts.
const { run } = require("node:test");

const events = [];
const stream = run({ files: [process.argv[2]] });
for (const type of ["test:pass", "test:fail"]) {
  stream.on(type, data => {
    events.push({
      type,
      name: data.name,
      nesting: data.nesting,
      kind: data.details.type,
      failureType: data.details.error?.failureType,
      skip: data.skip,
      todo: data.todo,
    });
  });
}
stream.on("test:summary", data => {
  if (data.file !== undefined) return;
  console.log(JSON.stringify({ events, counts: data.counts, success: data.success }));
});
stream.resume();
