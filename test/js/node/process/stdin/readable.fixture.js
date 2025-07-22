console.log("%READY%");

const r = () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    console.log("got readable", JSON.stringify(chunk.toString()));
    console.log("%READY%");
  }
};

process.stdin.on("readable", r);
