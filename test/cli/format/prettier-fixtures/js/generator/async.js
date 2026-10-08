// https://github.com/meriyah/meriyah/commit/f21882c312284572ac6d7e7630c4a677d6caed92

const f = async function * (source, block, opts) {
  for await (const entry of source) {
    yield async function () {
      const cid = await persist(entry.content.serialize(), block, opts)
      return {
        cid,
        path: entry.path,
        unixfs: UnixFS.unmarshal(entry.content.Data),
        node: entry.content
      }
    }
  }
}
