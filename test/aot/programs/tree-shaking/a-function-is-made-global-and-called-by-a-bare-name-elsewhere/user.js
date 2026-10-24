export function useThem() {
  return [byComputedName(), byAssign(), byDefine(), byGetter()].join(", ");
}
