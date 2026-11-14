console.log(typeof postMessage);
try {
  (postMessage as any)({ a: 1 });
  console.log("posted");
} catch (error: any) {
  if (error.code === "ERR_FEATURE_REMOVED") throw error;
  console.log(error.name);
}
