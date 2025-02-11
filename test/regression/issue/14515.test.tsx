import { expect, test } from "bun:test";

export function Input(a: InlineInputAttrs, ch: DocumentFragment) {
  const o_model = a.model
  const nullable = (a.type||'').indexOf('null') > -1

  return <input>
      {$on('input', (ev) => {
        var v = ev.currentTarget.value
        if (nullable && v === '') {
          o_model.set(null!)
        } else {
          // @ts-ignore typescript is confused by the type of o_model, rightly so.
          o_model.set(to_obs(v))
        }
      })}

    </input>

}

function _pad(n: number) {
  return (n < 10 ? ('0' + n) : n)
}

function _iso_date(d: Date) {
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`
}

test("runs without crashing", () => { })
