<script setup lang="ts">
import FeaturePlaceholder from "@/components/FeaturePlaceholder.vue";
</script>

<template>
  <FeaturePlaceholder
    eyebrow="系统治理域"
    title="用户、权限与内网模型配置"
    description="该区域仅向系统管理员开放，用于用户管理、服务配置、审计和系统运行状态查看。"
    :items="[
      '普通用户、项目管理员和系统管理员权限',
      'OCR / 大模型服务地址与模型选择',
      '禁止未授权的涉密材料外发',
      '上传限制、存储配额和审计日志',
    ]"
  />
</template>

