<script setup lang="ts">
import FeaturePlaceholder from "@/components/FeaturePlaceholder.vue";
</script>

<template>
  <FeaturePlaceholder
    eyebrow="项目计划域"
    title="项目与硬里程碑"
    description="这里将承载项目总览、硬里程碑倒计时、原计划与当前调整计划，以及由任务依赖推导出的后墙风险。"
    :items="[
      '创建项目、维护项目成员与项目管理员',
      '设置硬里程碑并倒排研制计划',
      '计划基线、调整记录与实际进展对比',
      '关键路径、缓冲天数和风险原因解释',
    ]"
  />
</template>

