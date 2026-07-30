<script setup lang="ts">
import { ArrowDown, ArrowUp, Clock, EditPen, User } from "@element-plus/icons-vue";
import { computed, ref } from "vue";

import type { TaskPlan } from "@/types/task";
import {
  formatDateTime,
  isOverdue,
  taskCompletion,
  taskStatusLabel,
  taskStatusType,
} from "@/utils/task";

const props = defineProps<{
  task: TaskPlan;
}>();

const emit = defineEmits<{
  edit: [task: TaskPlan];
}>();

const expanded = ref(false);
const completion = computed(() => taskCompletion(props.task));
const closedCount = computed(
  () => props.task.items.filter((item) => item.status === "closed").length,
);
const overdue = computed(() => isOverdue(props.task));
const progressStatus = computed<"success" | "exception" | undefined>(() => {
  if (completion.value === 100) {
    return "success";
  }
  return overdue.value ? "exception" : undefined;
});
</script>

<template>
  <article class="task-plan-card">
    <div class="card-heading">
      <div class="task-title">
        <div class="title-line">
          <h3>{{ task.name }}</h3>
          <el-tag v-if="overdue" type="danger" effect="light" round>已逾期</el-tag>
          <el-tag v-else-if="completion === 100" type="success" effect="light" round>
            已完成
          </el-tag>
        </div>
        <div class="task-meta">
          <span><el-icon><User /></el-icon>负责人：{{ task.owner }}</span>
          <span><el-icon><Clock /></el-icon>截止：{{ formatDateTime(task.plannedEnd) }}</span>
        </div>
      </div>

      <el-button :icon="EditPen" @click="emit('edit', task)">维护任务</el-button>
    </div>

    <div v-if="task.collaborators.length" class="collaborators">
      <span>协作人</span>
      <el-tag v-for="person in task.collaborators" :key="person" size="small" effect="plain">
        {{ person }}
      </el-tag>
    </div>

    <div class="progress-row">
      <div>
        <strong>{{ completion }}%</strong>
        <span>已闭环 {{ closedCount }} / 共 {{ task.items.length }} 项</span>
      </div>
      <el-progress
        :percentage="completion"
        :status="progressStatus"
        :stroke-width="10"
        :show-text="false"
      />
    </div>

    <button class="detail-toggle" type="button" @click="expanded = !expanded">
      {{ expanded ? "收起具体任务" : `查看 ${task.items.length} 项具体任务` }}
      <el-icon><ArrowUp v-if="expanded" /><ArrowDown v-else /></el-icon>
    </button>

    <div v-if="expanded" class="work-item-list">
      <div v-for="item in task.items" :key="item.id" class="work-item">
        <div class="work-item-main">
          <strong>{{ item.title }}</strong>
          <span>{{ item.owner }} · {{ formatDateTime(item.plannedEnd) }}</span>
        </div>
        <el-tag :type="taskStatusType(item.status)" effect="light">
          {{ taskStatusLabel(item.status) }}
        </el-tag>
      </div>
    </div>
  </article>
</template>

<style scoped>
.task-plan-card {
  overflow: hidden;
  padding: 22px;
  border: 1px solid #e3e9f0;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 28px rgb(15 35 63 / 5%);
}

.card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.task-title {
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-line h3 {
  overflow-wrap: anywhere;
  margin: 0;
  color: #192b43;
  font-size: 19px;
}

.task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 22px;
  margin-top: 11px;
  color: #64748b;
  font-size: 13px;
}

.task-meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.collaborators {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  margin-top: 17px;
}

.collaborators > span {
  margin-right: 3px;
  color: #8a96a6;
  font-size: 12px;
}

.progress-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  align-items: center;
  gap: 18px;
  margin-top: 22px;
  padding: 16px;
  border-radius: 12px;
  background: #f7f9fc;
}

.progress-row > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.progress-row strong {
  color: #173251;
  font-size: 22px;
}

.progress-row span {
  color: #7b8797;
  font-size: 12px;
}

.detail-toggle {
  display: flex;
  width: 100%;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
  padding: 7px;
  border: 0;
  background: transparent;
  color: #68778b;
  font-size: 12px;
}

.detail-toggle:hover {
  color: #d9771d;
}

.work-item-list {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid #edf0f4;
}

.work-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 13px;
  border-radius: 10px;
  background: #fbfcfe;
}

.work-item-main {
  min-width: 0;
}

.work-item-main strong,
.work-item-main span {
  display: block;
}

.work-item-main strong {
  overflow-wrap: anywhere;
  color: #334155;
  font-size: 14px;
}

.work-item-main span {
  margin-top: 4px;
  color: #8793a3;
  font-size: 12px;
}

@media (max-width: 620px) {
  .task-plan-card {
    padding: 17px;
  }

  .card-heading {
    flex-direction: column;
  }

  .card-heading > .el-button {
    width: 100%;
  }

  .progress-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .work-item {
    align-items: flex-start;
  }
}
</style>

