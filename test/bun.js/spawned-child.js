const TARGET = process.argv[2];
const MODE = process.argv[3];

async function main() {
  if (TARGET === "STDIN") {
    let data = "";
    process.stdin.setEncoding("utf8");
    if (MODE === "READABLE") {
      process.stdin.on("readable", () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
          data += chunk;
        }
      });
    } else {
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
    }
    process.stdin.on("end", () => {
      console.log("data:", data);
      process.exit(0);
    });
  } else if (TARGET === "STDOUT") {
    process.stdout.write("stdout_test");
  } else if (TARGET === "TIMER") {
    setTimeout(() => console.log("hello"), 150);
  } else {
    console.log("unknown target! you messed up...");
  }
}

main();
