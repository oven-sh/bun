export const port = "8080";
export const host = null;
export const retries = "1,2";
export function timeout() {
  return { valueOf: () => 30 };
}
