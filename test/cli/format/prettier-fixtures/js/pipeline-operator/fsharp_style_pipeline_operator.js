promise
  |> await
  |> x => doubleSay(x, ', ')
  |> capitalize
  |> x => x + '!'
  |> x => new User.Message(x)
  |> x => stream.write(x)
  |> await
  |> console.log;

const result = "hello"
  |> doubleSay
  |> capitalize
  |> exclaim;

const newScore = person.score
  |> double
  |> n => add(7, n)
  |> n => boundScore(0, 100, n);

const user = url
  |> api.get
  |> await
  |> r => r.json()
  |> await
  |> j => j.data.user;

const f = (x) => (x |> (y) => y + 1)
  |> (z) => z * y

const _f = (x) => x
  |> (y) => y + 1
  |> (z) => z * y

const g = (x) => x
  |> (y) => (y + 1 |> (z) => z * y)

const _g = (x) => x
  |> (y => (y + 1 |> (z) => z * y))

const __g = (x) => x
  |> (
    y => {
      return (y + 1 |> (z) => z * y);
    }
  )

const f = x + ((f) => (f |> f));
const f = x |> (f) => f |> f;
