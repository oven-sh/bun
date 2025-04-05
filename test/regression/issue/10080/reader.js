let last_data = 0;
function onData(data) {
  const this_data = Date.now();
  if (last_data && this_data - last_data >= 25) {
    console.log("✓ read at least 25ms apart");
  }
  last_data = this_data;
  console.log("got data", JSON.stringify(data));
}

process.stdin.on("data", data => {
  onData(data);
  setTimeout(() => onData("setTimeout tick"), 30);
});
process.stdin.setEncoding("utf-8");
