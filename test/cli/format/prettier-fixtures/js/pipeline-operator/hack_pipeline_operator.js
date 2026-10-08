a |> await % |> % * 3;

foo
  |> await %
  |> % || throw new Error(`foo ${bar1}`)
  |> bar2(%, ", ")
  |> bar3(%)
  |> % + "!"
  |> new Bar.Foo(%)
  |> await bar.bar(%)
  |> console.log(%);

const result = "hello"
  |> doubleSay(%)
  |> capitalize(%, "foo")
  |> exclaim(%);

function createPerson (attrs) {
  attrs
    |> foo(%)
    |> foo(%)
    |> Person.insertIntoDatabase(%);
}

const result = [1,2,3]
 |> %.map(a => a * 2 )
 |> %.filter(a => a > 5)
 |> %.reduce((sum, a) => a+sum, 0)
 |> increment(%)
 |> add(%, 3)

const searchResults$ = fromEvent(document.querySelector('input'), 'input')
  |> map(%, event => event.target.value)
  |> filter(%, searchText => searchText.length > 2)
  |> debounce(%, 300)
  |> distinctUntilChanged(%)
  |> switchMap(%, searchText => queryApi(searchText) |> retry(%, 3))
  |> share(%);

v |> %.method() |> f(%);

async function * f () {
  return x
    |> (yield %)
    |> (await %)
    |> y(%)
    |> a.b(%)
    |> (a.b(%))
    |> a.b(%)
    |> (a.b?.(%))
    |> a.b?.(%);
}
