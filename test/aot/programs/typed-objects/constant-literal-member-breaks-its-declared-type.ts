// An object literal of constants has a member that can never match its field's declared type, and the type error is suppressed.
// The field's type is widened at build time, so nothing throws and the output matches plain Bun. Built with --aot-check=verify-each-pass.
function configure(options: { verbose?: boolean; depth?: number }): number {
  return (options.verbose ? 1 : 0) + (options.depth ?? 0)
}

const steps: string[] = []

function run(): number {
  steps.push('before')
  let total = configure({ verbose: true, depth: 2 })
  // @ts-expect-error
  total += configure({ verbose: 1, depth: 3 })
  steps.push('after')
  return total
}

function runNested(): number {
  steps.push('before nested')
  // @ts-expect-error
  const nested: { name: string; options: { verbose?: boolean } } = { name: 'n', options: { verbose: 'yes' } }
  steps.push('after nested')
  return nested.name.length
}

for (const attempt of [run, runNested]) {
  try {
    console.log(attempt())
  } catch (error) {
    console.log(error instanceof TypeError ? 'TypeError' : 'another error')
  }
}
console.log(steps.join(', '))
