<script setup lang="ts">
import FeaturePlaceholder from "@/components/FeaturePlaceholder.vue";
</script>

<template>
  <FeaturePlaceholder
    eyebrow="项目工作区"
    title="项目详情"
    description="项目详情将以总览、研制计划、任务、硬里程碑、会议行动项和动态记录作为二级导航。"
    :items="[
      '项目后墙健康卡与最近硬里程碑',
      '桌面甘特图与移动端简化时间线',
      '任务依赖无环校验',
      '项目范围权限与审计记录',
    ]"
  />
</template>

