// Fixture: logs structured data to both stdout and stderr.
// When a stream is piped (not a tty), its output should contain no ANSI escape codes.
console.log(new Map([["x", 1]]));
console.error(new Map([["e", 2]]));
