postMessage("initial message");
onmessage = ({ data }) => {
  postMessage({
    received: data,
  });
};
