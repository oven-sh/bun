(id) =>
  id
    .replace('@', resolve(__dirname, './mods/'))
    .replace('#', resolve(__dirname, '../../'))
