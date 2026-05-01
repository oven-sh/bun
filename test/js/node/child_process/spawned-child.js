const TARGET = process.argv[2];
const MODE = process.argv[3];

if (TARGET === "STDIN") {
  let data = "";
  process.stdin.setEncoding("utf8");
  if (MODE === "READABLE") {
    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) != null) {
        data += chunk;
      }
    });
  } else {
    process.stdin.on("data", chunk => {
      data += chunk;
    });
  }
  process.stdin.on("end", () => {
    process.stdout.write(Buffer.concat([Buffer.from("data: "), Buffer.from(data)]));
  });
} else if (TARGET === "STDOUT") {
  process.stdout.write("stdout_test");
} else if (TARGET === "ERROR") {
  console.log("oops");
} else {
  // nothing
}
