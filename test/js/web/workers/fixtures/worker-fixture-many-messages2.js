onmessage = ({ data }) => {
  // console.log("worker", data);
  if (data === "initial message") {
    postMessage({ i: 0 });
  } else if (data.i > 50) {
    postMessage({ done: true });
    onmessage = null;
  } else {
    postMessage({ i: data.i + 1 });
  }
};
