// the 2nd line needs ASI protection
const el = ReactDOM.findDOMNode(ref)
;(el satisfies HTMLElement)!.style.cursor = 'pointer'
