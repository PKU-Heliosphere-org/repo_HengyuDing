<script setup lang="ts">
import { Document, PictureFilled } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";

function unavailable(): void {
  ElMessage.info("解析接口将在 OCR/大模型适配器接入后开放");
}
</script>

<template>
  <section class="imports-page">
    <div class="intro">
      <p>人工核对优先</p>
      <h2>从会议材料生成可靠的结构化计划</h2>
      <span>所有模型输出先形成候选草稿，经人工核对后才写入会议或闭环任务。</span>
    </div>

    <div class="import-grid">
      <el-card shadow="never">
        <el-icon class="import-icon"><PictureFilled /></el-icon>
        <h3>导入下周会议表图片</h3>
        <p>裁剪纠偏 → OCR → 结构化会议 → 人工核对</p>
        <el-button type="primary" plain @click="unavailable">选择图片</el-button>
      </el-card>
      <el-card shadow="never">
        <el-icon class="import-icon"><Document /></el-icon>
        <h3>导入会议纪要 PDF</h3>
        <p>正文/OCR → 提取行动项 → 补齐人员与日期 → 生成任务</p>
        <el-button type="primary" plain @click="unavailable">选择 PDF</el-button>
      </el-card>
    </div>
  </section>
</template>

<style scoped>
.imports-page {
  display: grid;
  gap: 26px;
}

.intro {
  padding: 28px 30px;
  border-radius: 16px;
  background: #132a48;
  color: #fff;
}

.intro p,
.intro h2,
.intro span {
  margin: 0;
}

.intro p {
  color: #ffb66f;
  font-size: 12px;
  font-weight: 700;
}

.intro h2 {
  margin-top: 8px;
}

.intro span {
  display: block;
  margin-top: 10px;
  color: #bac8d8;
  font-size: 14px;
}

.import-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.import-grid .el-card {
  border-radius: 15px;
}

.import-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 13px;
  background: #fff1e4;
  color: #d9771d;
  font-size: 24px;
}

.import-grid h3 {
  margin: 18px 0 8px;
  color: #24364d;
}

.import-grid p {
  min-height: 42px;
  margin: 0 0 20px;
  color: #748196;
  font-size: 13px;
  line-height: 1.6;
}

@media (max-width: 680px) {
  .import-grid {
    grid-template-columns: 1fr;
  }
}
</style>

