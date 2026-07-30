<script setup lang="ts">
import FeaturePlaceholder from "@/components/FeaturePlaceholder.vue";
</script>

<template>
  <FeaturePlaceholder
    eyebrow="风险与提醒域"
    title="临期、逾期与升级通知"
    description="通知中心将按需处理、未读和全部组织消息，并让每条提醒直接跳转到对应任务。"
    :items="[
      '截止前 7 / 3 / 1 天分层提醒',
      '逾期当天通知责任人、协作人和项目管理员',
      '持续逾期每日去重并按规则升级',
      '先接入站内通知，再通过 Provider 扩展其他渠道',
    ]"
  />
</template>

