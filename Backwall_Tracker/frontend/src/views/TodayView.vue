<script setup lang="ts">
import { CirclePlus, Timer } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";

import TaskPlanCard from "@/components/tasks/TaskPlanCard.vue";
import TaskPlanDialog from "@/components/tasks/TaskPlanDialog.vue";
import { useTaskStore } from "@/stores/tasks";
import type { TaskDraft, TaskPlan } from "@/types/task";
import { isOverdue, taskCompletion } from "@/utils/task";

const taskStore = useTaskStore();
const dialogVisible = ref(false);
const editingTask = ref<TaskPlan | null>(null);

const summaryCards = computed(() => {
  const now = Date.now();
  const threeDays = 3 * 24 * 60 * 60 * 1000;
  return [
    {
      label: "任务总数",
      value: taskStore.tasks.length,
      tone: "blue",
    },
    {
      label: "三天内到期",
      value: taskStore.tasks.filter((task) => {
        const remaining = new Date(task.plannedEnd).getTime() - now;
        return remaining >= 0 && remaining <= threeDays && taskCompletion(task) < 100;
      }).length,
      tone: "amber",
    },
    {
      label: "已经逾期",
      value: taskStore.tasks.filter((task) => isOverdue(task)).length,
      tone: "red",
    },
    {
      label: "已经完成",
      value: taskStore.tasks.filter((task) => taskCompletion(task) === 100).length,
      tone: "green",
    },
  ];
});

function openCreateDialog(): void {
  editingTask.value = null;
  dialogVisible.value = true;
}

function openEditDialog(task: TaskPlan): void {
  editingTask.value = task;
  dialogVisible.value = true;
}

function saveTask(draft: TaskDraft): void {
  let persisted: boolean;
  if (editingTask.value) {
    const result = taskStore.updateTask(editingTask.value.id, draft);
    persisted = result?.persisted ?? false;
  } else {
    persisted = taskStore.createTask(draft).persisted;
  }

  if (persisted) {
    ElMessage.success(editingTask.value ? "任务已更新" : "任务创建成功");
  } else {
    ElMessage.warning("任务已保留在当前页面，但浏览器拒绝持久化；刷新后可能丢失");
  }
  editingTask.value = null;
}
</script>

<template>
  <div class="today-page">
    <section class="hero">
      <div>
        <p><el-icon><Timer /></el-icon>每天三十秒，守住硬里程碑</p>
        <h2>今天，把研制进度推进一格。</h2>
        <span>
          创建研制任务、拆分具体工作并持续维护状态。当前数据保存在本浏览器中，刷新页面仍会保留。
        </span>
      </div>
      <el-button type="primary" size="large" :icon="CirclePlus" @click="openCreateDialog">
        创建任务
      </el-button>
    </section>

    <section class="summary-grid" aria-label="任务概览">
      <article
        v-for="card in summaryCards"
        :key="card.label"
        class="summary-card"
        :class="`tone-${card.tone}`"
      >
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </article>
    </section>

    <section class="task-section">
      <div class="section-heading">
        <div>
          <p>按计划完成时间排序</p>
          <h2>我的任务</h2>
        </div>
        <el-button type="primary" plain :icon="CirclePlus" @click="openCreateDialog">
          新建
        </el-button>
      </div>

      <div v-if="taskStore.orderedTasks.length" class="task-grid">
        <TaskPlanCard
          v-for="task in taskStore.orderedTasks"
          :key="task.id"
          :task="task"
          @edit="openEditDialog"
        />
      </div>

      <el-empty
        v-else
        description="还没有任务。先建立第一项研制任务，再逐行拆分具体工作。"
        :image-size="120"
      >
        <el-button type="primary" :icon="CirclePlus" @click="openCreateDialog">
          创建第一项任务
        </el-button>
      </el-empty>
    </section>

    <TaskPlanDialog
      v-model="dialogVisible"
      :task="editingTask"
      @save="saveTask"
    />
  </div>
</template>

<style scoped>
.today-page {
  display: grid;
  gap: 24px;
}

.hero {
  position: relative;
  display: flex;
  overflow: hidden;
  min-height: 210px;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 34px 38px;
  border-radius: 20px;
  background:
    radial-gradient(circle at 88% 18%, rgb(243 146 55 / 33%), transparent 23%),
    linear-gradient(130deg, #10243f 0%, #17395f 73%, #1e496d 100%);
  color: #fff;
  box-shadow: 0 18px 45px rgb(18 42 72 / 18%);
}

.hero::after {
  position: absolute;
  right: -60px;
  bottom: -120px;
  width: 310px;
  height: 310px;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 50%;
  content: "";
}

.hero > * {
  position: relative;
  z-index: 1;
}

.hero p {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 12px;
  color: #ffb66f;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.hero h2 {
  margin: 0;
  font-size: clamp(25px, 3vw, 36px);
  letter-spacing: 0.02em;
}

.hero span {
  display: block;
  max-width: 700px;
  margin-top: 13px;
  color: #c3cfde;
  font-size: 14px;
  line-height: 1.7;
}

.hero .el-button {
  flex: 0 0 auto;
  border-color: #f39237;
  background: #f39237;
  box-shadow: 0 12px 28px rgb(243 146 55 / 25%);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.summary-card {
  display: flex;
  min-height: 94px;
  align-items: center;
  justify-content: space-between;
  padding: 19px 21px;
  border: 1px solid #e4e9f0;
  border-radius: 14px;
  background: #fff;
}

.summary-card span {
  color: #6b7788;
  font-size: 13px;
}

.summary-card strong {
  font-size: 29px;
}

.tone-blue strong {
  color: #2d6ba2;
}

.tone-amber strong {
  color: #cf7b24;
}

.tone-red strong {
  color: #d64c4c;
}

.tone-green strong {
  color: #27885a;
}

.task-section {
  padding: 24px;
  border: 1px solid #e4e9f0;
  border-radius: 18px;
  background: #fdfefe;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.section-heading p,
.section-heading h2 {
  margin: 0;
}

.section-heading p {
  margin-bottom: 4px;
  color: #8a96a6;
  font-size: 11px;
}

.section-heading h2 {
  color: #1b2e46;
  font-size: 20px;
}

.task-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 1100px) {
  .task-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hero {
    min-height: auto;
    align-items: stretch;
    flex-direction: column;
    padding: 26px 22px;
  }

  .hero .el-button {
    width: 100%;
  }

  .summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .task-section {
    padding: 18px 14px;
  }
}
</style>
