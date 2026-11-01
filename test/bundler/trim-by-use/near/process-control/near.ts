console.log(
  typeof process.pid,
  typeof process.ppid,
  process.cwd().length > 0,
  typeof process.exitCode,
  typeof process.env.PATH,
  typeof process.arch,
);
process.exitCode = 0;
