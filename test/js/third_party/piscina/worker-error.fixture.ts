export default ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error("Worker error for testing");
  }

  return "success";
};
