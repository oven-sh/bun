a |> b |> c;

a |> (b |> c);

(a |> b) || c;
a |> (b || c);

let result = "hello"
  |> doubleSay
  |> capitalize
  |> exclaim;

let newScore = person.score
  |> double
  |> (_ => add(7, _))
  |> (_ => subtract(2, _))
  |> (_ => boundScore(0, 100, _));

function createPerson (attrs) {
  attrs
    |> bounded('age', 1, 100)
    |> format('name', /^[a-z]$/i)
    |> Person.insertIntoDatabase;
}

foo |> (bar ?? baz);
(foo |> bar) ?? baz;

const result = [1,2,3]
 |> map(a => a * 2)
 |> filter(a => a > 5)
 |> reduce((sum, a) => a+sum, 0)
 |> increment
 |> add(3)

const searchResults$ = fromEvent(document.querySelector('input'), 'input')
  |> map(event => event.target.value)
  |> filter(searchText => searchText.length > 2)
  |> debounce(300)
  |> distinctUntilChanged()
  |> switchMap(searchText => queryApi(searchText) |> retry(3))
  |> share();

const result = [5,10]
  |> (_ => _.map(x => x * 2))
  |> (_ => _.reduce( (a,b) => a + b ))
  |> (sum => sum + 1)

const result2 = [4, 9].map( x => x |> inc |> double )
