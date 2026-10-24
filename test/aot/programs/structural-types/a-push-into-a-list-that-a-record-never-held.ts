const lists: Record<string, number[]> = { odd: [1, 3] };

try {
  console.log(lists.missing.push(1));
} catch (error) {
  console.log(error instanceof TypeError ? "TypeError" : "another error");
}
