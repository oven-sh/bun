// This tests that the dns.lookup function keeps the process alive when it's called
const dns = require("dns");

process.exitCode = 42;

dns.lookup("google.com", (err, address, family) => {
  console.log("Worked");
  process.exit(0);
});
