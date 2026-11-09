console.log(process.kill(process.pid, 0));
try {
  process.kill(process.pid, "SIGNOTHING" as any);
} catch (error: any) {
  console.log(error.code);
}
