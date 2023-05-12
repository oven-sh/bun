<script>
  import { defineAsyncComponent } from 'vue'

  const AsyncComp = defineAsyncComponent(() => {
    return new Promise((resolve, reject) => {
      // ...load component from server
      resolve(/* loaded component */)
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
</template>
