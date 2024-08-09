# Nuxt Hacker News

Hacker News clone built with [Nuxt](https://nuxt.com).

<p align="center">
  <a href="https://hn.nuxt.space" target="_blank">
    <img width="1090" src="https://hn.nuxt.space/cover.jpg">
    <br>
    Live Demo
  </a>
</p>

## Demo

https://hn.nuxt.space

> Hosted on [Vercel](https://vercel.com/): `npm run build`

To disable server-side render for a page, simply append `?csr` to the URL, example: https://hn.nuxt.space/news/1?csr

## Performance

- Lighthouse [100/100](https://pagespeed.web.dev/report?url=https%3A%2F%2Fhackernews-git-nuxt3-nuxt-js.vercel.app%2Fnews%2F1) (Slow 4G / Mobile Moto G4)
  - Interactive: 1.4s
  - Total Blocking Time: 30ms

## Features

- Server Side Rendering
- Vite-based hot module replacement (HMR) dev environment
- Deploys anywhere with zero config (Vercel, Netlify, Cloudflare, etc.) powered by [Nitro](https://github.com/unjs/nitro)
- Code Splitting
- Prefetch/Preload JS + DNS + Data

## Build Setup

**Requires Node.js 14+**

``` bash
# install dependencies
npm install # or yarn

# serve in dev mode, with hot reload at localhost:3000
npm run dev

# build for production (server-side rendering)
npm run build

# serve in production mode (server-side rendering)
npm start

# validate and fix with ESLint (with Prettier)
npm run lintfix
```

## Links

For the Nuxt 2 version, check out the [`nuxt2` branch](https://github.com/nuxt/hackernews/tree/nuxt2)

## License

MIT

## Credits

This repository is originally ported from [vue-hackernews-2.0](https://github.com/vuejs/vue-hackernews-2.0)
