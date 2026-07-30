<template>
  <main class="not-found">
    <strong>404</strong>
    <h1>这条研制路径不存在</h1>
    <router-link to="/today">返回今日工作台</router-link>
  </main>
</template>

<style scoped>
.not-found {
  display: grid;
  min-height: 100vh;
  place-content: center;
  justify-items: center;
  background: #f6f8fb;
  color: #24364d;
}

.not-found strong {
  color: #f39237;
  font-size: 68px;
}

.not-found h1 {
  margin: 8px 0 20px;
}

.not-found a {
  color: #2d6ba2;
}
</style>

