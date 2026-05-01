// https://github.com/oven-sh/bun/issues/11963
enum Enum {
  安全串行 = "安全串行",
  aaa = "平衡串行",
  aa郭 = "快速串行",
  安全并行 = "安全并行",
  平衡并行 = "平衡并行",
  "快速并行" = "快速并行",
  aaaa快éé = 1,
  Français = 123,
  bbb = Français,
}

console.log(Enum);
