<script setup lang="ts">
const route = useRoute();
const host = process.server ? useRequestHeaders().host : window.location.host;
const bunVersion = process.server ? Bun.version : null;

useHead({
  link: [
    // We use route.path since we don't use query parameters
    { rel: "canonical", href: `https://${host}${route.path}` },
  ],
});
</script>

<template>
  <div>
    <header class="header">
      <nav
        class="inner"
        role="navigation"
      >
        <NuxtLink to="/">
          <img
            class="logo"
            src="/logo.svg"
            alt="logo"
          >
        </NuxtLink>
        <NuxtLink
          v-for="(list, key) in feedsInfo"
          :key="key"
          :to="`/${key}`"
          :class="{ active: $route.path.startsWith(`/${key}`) }"
        >
          {{ list.title }}
        </NuxtLink>
        <CounterComponent />
        <code>{{ bunVersion }}</code>
        <span class="github">
          <a
            href="https://github.com/nuxt/hackernews"
            target="_blank"
            rel="noopener banner"
          > Open on GitHub </a>
        </span>
      </nav>
    </header>
    <slot role="main" />
  </div>
</template>

<style lang="postcss">
code {
  color: #fff;
  background-color: #000;
  padding: 0.2em 0.4em;
  border-radius: 0.2em;
  font-size: 0.8em;
  margin-right: 1em;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans",
    "Droid Sans", "Helvetica Neue", sans-serif;
  font-size: 15px;
  background-color: #f4f4f5;
  margin: 0;
  padding: 0;
  color: #18181b;
  overflow-y: scroll;
}

a {
  color: #18181b;
  text-decoration: none;
}
.header {
  background-color: #18181b;
  z-index: 999;
  height: 155px;

  .inner {
    max-width: 800px;
    box-sizing: border-box;
    margin: 0px auto;
    padding: 12px 5px;
    display: flex;
    place-items: center;
  }

  & a {
    color: #fff;
    line-height: 24px;
    transition: color 0.15s ease;
    display: inline-block;
    vertical-align: middle;
    font-weight: 300;
    letter-spacing: 0.075em;
    margin-right: 1.8em;

    &:hover {
      color: #00dc82;
    }

    &.active {
      color: #00dc82;
    }

    &:nth-child(6) {
      margin-right: 0;
    }
  }

  .github {
    color: #fff;
    font-size: 0.9em;
    margin: auto;
    text-align: right;
    flex-grow: 1;
    & a {
      margin-right: 0;
    }
  }
}

.logo {
  width: 30px;
  height: 30px;
  margin-right: 10px;
  display: inline-block;
  vertical-align: middle;
}

.view {
  max-width: 800px;
  margin: 0 auto;
  position: relative;
}

.appear-active {
  transition: opacity 0.4s ease;
}

.appear {
  opacity: 0;
}

@media (max-width: 860px) {
  .header .inner {
    padding: 15px 30px;
  }
}

@media (max-width: 600px) {
  .header {
    .inner {
      padding: 15px;
    }

    & a {
      margin-right: 1em;
    }

    .github {
      display: none;
    }
  }
}
</style>
