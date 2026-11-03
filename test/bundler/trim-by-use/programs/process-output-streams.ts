process.stdout.write("to stdout\n");
process.stderr.write("to stderr\n");
console.log(process.stdout.fd, process.stderr.fd, process.stdout.isTTY, process.stderr.isTTY);
