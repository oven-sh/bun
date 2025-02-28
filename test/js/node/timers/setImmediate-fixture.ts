let i = 0;
setImmediate(function callback() {
  i++;
  console.log("callback");
  if (i < 5000) setImmediate(callback);
});
