addEventListener("message", function fn({ data }) {
  if (data === "initial message") {
    postMessage({ i: 0 });
  } else if (data.i > 50) {
    postMessage({ done: true });
    removeEventListener("message", fn);
  } else {
    postMessage({ i: data.i + 1 });
  }
});
