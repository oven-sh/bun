declare module "*.number" {
  const value: number;
  export default value;
}

declare module "*.point" {
  const value: { x: number; y: number };
  export default value;
}
