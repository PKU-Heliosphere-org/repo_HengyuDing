<script setup lang="ts">
import FeaturePlaceholder from "@/components/FeaturePlaceholder.vue";
</script>

<template>
  <FeaturePlaceholder
    eyebrow="汇总与归档域"
    title="本周工作与周报导出"
    description="系统将从每日记录、任务状态和会议闭环项自动汇总本周完成、风险、下周计划与待协调事项。"
    :items="[
      '按项目、人员和日期筛选周报内容',
      '保留原始每日记录的追溯链接',
      '预览后导出清晰一致的归档格式',
      '导出任务幂等且包含生成时间',
    ]"
  />
</template>

