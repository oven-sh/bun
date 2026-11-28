// One instance for every run of 31-mock-again-before-restore-all-{a,b}.mjs in a
// `bun test` process.
export const service = {
  run() {
    return "real";
  },
};
