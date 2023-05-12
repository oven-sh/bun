<script>
  import { defineAsyncComponent } from 'vue'

  const AsyncComp = defineAsyncComponent(() => {
    return new Promise((resolve) => {
      // load the component asynchronously
      setTimeout(() => {
        resolve({
          template: '<div>I am async!</div>'
        })
      }, 1000)
    })
  })
  // ... use `AsyncComp` like a normal component

  export default {
    // reactive state
    data() {
      return {
        count: 0
      }
    },

    // functions that mutate state and trigger updates
    methods: {
      increment() {
        this.count++
      }
    },

    // lifecycle hooks
    mounted() {
      console.log(`The initial count is ${this.count}.`)
    }
  }
</script>

<template>
  <button @click="increment">Count is: {{ count }}</button>
  <AsyncComp/>
</template>
