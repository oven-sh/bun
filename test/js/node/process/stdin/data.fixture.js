console.log("%READY%");

const d = data => {
  console.log("got data", JSON.stringify(data.toString()));
  console.log("%READY%");
};

process.stdin.on("data", d);
