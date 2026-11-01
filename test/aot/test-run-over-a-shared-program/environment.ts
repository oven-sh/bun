export const atLoad = process.env.NODE_ENV;

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
