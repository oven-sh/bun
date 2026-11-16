process.noDeprecation = true;
const uv = (process as any).binding("uv");
console.log(
  uv.errname(-2),
  typeof uv.UV_EOF,
  typeof (process as any).binding("constants").os,
  Object.keys((process as any).binding("natives")).length > 10,
  typeof (process as any).binding("buffer").kMaxLength,
  typeof (process as any).binding("util").isDate,
);
try {
  (process as any).binding("nothing");
} catch (error: any) {
  console.log(error.message);
}
