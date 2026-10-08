const palindrome = str => {
  const s = str.toLowerCase().replace(/[\W_]/g, '');
  return s === s.split('').reverse().join('');
};

const apiCurrencies = api().currencies().all()

expect(cells.at(1).render().text()).toBe('link text1')
expect(cells.at(2).render().text()).toBe('link text2')
expect(cells.at(3).render().text()).toBe('link text3')
expect(cells.at(4).render().text()).toBe('link text4')
