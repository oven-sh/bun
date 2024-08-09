<template>
  <div class="spinner" />
</template>

<style scoped>
.spinner,
.spinner:after {
  border-radius: 50%;
  width: 3em;
  height: 3em;
}
.spinner {
  margin: 30px auto;
  font-size: 10px;
  position: relative;
  text-indent: -9999em;
  border-top: 0.2em solid rgba(0, 196, 141, 0.2);
  border-right: 0.2em solid rgba(0, 196, 141, 0.2);
  border-bottom: 0.2em solid rgba(0, 196, 141, 0.2);
  border-left: 0.2em solid #00C48D;
  -webkit-transform: translateZ(0);
  -ms-transform: translateZ(0);
  transform: translateZ(0);
  -webkit-animation: loading 1.1s infinite linear;
  animation: loading 1.1s infinite linear;
}
@-webkit-keyframes loading {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
    transform: rotate(360deg);
  }
}
@keyframes loading {
  0% {
    -webkit-transform: rotate(0deg);
    transform: rotate(0deg);
  }
  100% {
    -webkit-transform: rotate(360deg);
    transform: rotate(360deg);
  }
}
</style>
