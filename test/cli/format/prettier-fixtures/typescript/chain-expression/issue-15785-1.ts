function someFunctionName(
) {
  return isEqual(a?.map(([t, _]) => t?.id), b?.map(([t, _]) => t?.id));
  return isEqual(a?.map(([t, _]) => t?.id)!, b?.map(([t, _]) => t?.id)!);
  return isEqual(a.map(([t, _]) => t?.id), b.map(([t, _]) => t?.id));
  return isEqual(a.map(([t, _]) => t?.id)!, b.map(([t, _]) => t?.id)!);
}
