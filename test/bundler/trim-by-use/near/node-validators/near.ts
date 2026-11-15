try {
  new Array(-1);
} catch (error: any) {
  console.log(error.name);
}
try {
  (1).toFixed(200);
} catch (error: any) {
  console.log(error.name);
}
