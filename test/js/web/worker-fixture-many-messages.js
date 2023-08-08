addEventListener("message", e => {
  const data = e.data;
  console.log("worker", data);

  if (data === "initial message") {
    postMessage({ i: 0 });
  } else if (data.i > 50) {
    postMessage({ done: true });
  } else {
    postMessage({ i: data.i + 1 });
  }
});
