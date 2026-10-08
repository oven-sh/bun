async function f() {
  const { data, status } = await request.delete(
    `/account/${accountId}/documents/${type}/${documentNumber}`,
    { validateStatus: () => true }
  );
  return { data, status };
}

const data1 = request.delete(
  '----------------------------------------------',
  { validateStatus: () => true }
);

const data2 = request.delete(
  '----------------------------------------------x',
  { validateStatus: () => true }
);

const data3 = request.delete(
  '----------------------------------------------xx',
  { validateStatus: () => true }
);

const data4 = request.delete(
  '----------------------------------------------xxx',
  { validateStatus: () => true }
);
