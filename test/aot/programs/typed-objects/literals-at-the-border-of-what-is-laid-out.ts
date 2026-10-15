interface Key { key: number }
type F<T> = { value: T; more?: number };
interface G<T> { value: T; more?: number }
type Nine = F<F<F<F<F<F<F<F<F<Key>>>>>>>>>;
type Eight = F<F<F<F<F<F<F<F<Key>>>>>>>>;
type Ten = G<G<G<G<G<G<G<G<G<G<Key>>>>>>>>>>;

const eight: Eight = { value: { value: { value: { value: { value: { value: { value: { value: { key: 8 } } } } } } } } };
const nine: Nine = { value: { value: { value: { value: { value: { value: { value: { value: { value: { key: 9 } } } } } } } } } };
const ten: Ten = { value: { value: { value: { value: { value: { value: { value: { value: { value: { value: { key: 10 } } } } } } } } } } };
const around: Nine = { value: eight, more: 1 };

const readEight = () => eight.value.value.value.value.value.value.value.value.key;
const readNine = () => nine.value.value.value.value.value.value.value.value.value.key;
const readTen = () => ten.value.value.value.value.value.value.value.value.value.value.key;
function inner(from: Nine): Eight {
  return from.value;
}

console.log(readEight(), readNine(), readTen(), around.more, around.value === eight);
console.log(inner(nine).value.value.value.value.value.value.value.value.key, inner(around) === eight, nine.more, Object.keys(nine).join());
nine.more = 2;
nine.value = eight;
console.log(nine.more, readNine(), JSON.stringify(ten).length);
