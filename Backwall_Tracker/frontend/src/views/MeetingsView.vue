<script setup lang="ts">
import FeaturePlaceholder from "@/components/FeaturePlaceholder.vue";
</script>

<template>
  <FeaturePlaceholder
    eyebrow="会议闭环域"
    title="会议与行动项"
    description="集中浏览会议安排、汇报材料截止时间，以及从会议纪要中生成并等待闭环的行动项。"
    :items="[
      '周会议日历与汇报材料截止提醒',
      '会议参加人员、汇报人与地点',
      '专家意见原文及 PDF 页码追溯',
      '行动项生成任务和确认闭环',
    ]"
  />
</template>

