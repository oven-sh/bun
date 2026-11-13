// One instance for the three files of 32-mock-cannot-come-off-{a,b,c}.mjs in a
// `bun test` process.
const withRun = () => ({
  run() {
    return "real";
  },
});

export const older = withRun();
export const frozen = withRun();
export const newer = withRun();
