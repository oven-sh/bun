console.log(
  typeof process.getuid!(),
  typeof process.getgid!(),
  typeof process.geteuid!(),
  typeof process.getegid!(),
  Array.isArray(process.getgroups!()),
  typeof process.umask(),
  process.kill(process.pid, 0),
  typeof process.title,
);
const before = process.cwd();
process.chdir("/");
console.log(process.cwd(), before.length > 0);
process.title = "renamed";
console.log(process.title);
try {
  process.setuid!(-5 as any);
} catch (error: any) {
  console.log(error.code);
}
try {
  process.kill(process.pid, "SIGNOTHING" as any);
} catch (error: any) {
  console.log(error.code);
}
