<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <span class="login-mark">墙</span>
      <p>Backwall Tracker</p>
      <h1>守住载荷研制的每一个硬里程碑</h1>
      <el-alert
        title="当前为本地原型，账户鉴权将在服务端用户模块接入后启用。"
        type="info"
        :closable="false"
      />
      <el-button type="primary" size="large" @click="router.push('/today')">
        进入原型
      </el-button>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(circle at 18% 18%, rgb(243 146 55 / 19%), transparent 26%),
    #0e2038;
}

.login-card {
  width: min(520px, 100%);
  padding: 42px;
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 22px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 28px 80px rgb(0 0 0 / 25%);
}

.login-mark {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  border-radius: 15px;
  background: #f39237;
  color: #fff;
  font-size: 21px;
  font-weight: 800;
}

.login-card p {
  margin: 18px 0 8px;
  color: #d9771d;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.login-card h1 {
  margin: 0 0 24px;
  color: #172b45;
  font-size: 29px;
  line-height: 1.35;
}

.login-card .el-button {
  width: 100%;
  margin-top: 24px;
}
</style>

