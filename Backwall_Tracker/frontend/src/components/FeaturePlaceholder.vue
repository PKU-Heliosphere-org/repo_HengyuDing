<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow?: string;
    title: string;
    description: string;
    items: string[];
  }>(),
  {
    eyebrow: "功能边界已预留",
  },
);
</script>

<template>
  <section class="placeholder-page">
    <div class="placeholder-copy">
      <p>{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <span>{{ description }}</span>
    </div>

    <el-card shadow="never" class="roadmap-card">
      <template #header>
        <strong>计划接入</strong>
      </template>
      <ul>
        <li v-for="item in items" :key="item">
          <span></span>
          {{ item }}
        </li>
      </ul>
    </el-card>
  </section>
</template>

<style scoped>
.placeholder-page {
  display: grid;
  min-height: 430px;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  align-items: center;
  gap: 42px;
  padding: 32px;
  border: 1px solid #e4e9f0;
  border-radius: 18px;
  background:
    radial-gradient(circle at 8% 15%, rgb(243 146 55 / 9%), transparent 31%),
    #fff;
}

.placeholder-copy p {
  margin: 0 0 10px;
  color: #d9771d;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.placeholder-copy h2 {
  margin: 0 0 16px;
  color: #15243a;
  font-size: clamp(27px, 4vw, 42px);
}

.placeholder-copy span {
  display: block;
  max-width: 590px;
  color: #64748b;
  font-size: 15px;
  line-height: 1.8;
}

.roadmap-card {
  border-color: #e7ebf1;
}

.roadmap-card ul {
  display: grid;
  gap: 15px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.roadmap-card li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #475569;
  line-height: 1.55;
}

.roadmap-card li span {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  margin-top: 7px;
  border-radius: 50%;
  background: #f39237;
}

@media (max-width: 760px) {
  .placeholder-page {
    min-height: auto;
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 24px 20px;
  }
}
</style>

