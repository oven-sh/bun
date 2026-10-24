type Runner = { run: () => number };
function asRunner(value: object): Runner { return value as Runner; }
export const made = asRunner({ get run(): number { return 1; } });
