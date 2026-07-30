<script setup lang="ts">
import { Delete, Plus } from "@element-plus/icons-vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { computed, nextTick, reactive, ref, watch } from "vue";

import {
  TASK_STATUS_OPTIONS,
  type TaskDraft,
  type TaskPlan,
  type WorkItem,
} from "@/types/task";
import { createId } from "@/utils/task";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    task?: TaskPlan | null;
  }>(),
  {
    task: null,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  save: [draft: TaskDraft];
}>();

const basicForm = ref<FormInstance>();
const currentStep = ref(0);
const saving = ref(false);

function toInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return `${local.toISOString().slice(0, 16)}:00`;
}

function createEmptyDraft(): TaskDraft {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  return {
    name: "",
    owner: "",
    collaborators: [],
    plannedStart: toInputValue(start),
    plannedEnd: toInputValue(end),
    items: [],
  };
}

const draft = reactive<TaskDraft>(createEmptyDraft());

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});

const basicRules: FormRules<TaskDraft> = {
  name: [
    { required: true, whitespace: true, message: "请输入任务名称", trigger: "blur" },
    { max: 100, message: "任务名称不能超过 100 个字符", trigger: "blur" },
  ],
  owner: [
    { required: true, whitespace: true, message: "请输入负责人", trigger: "blur" },
    { max: 50, message: "负责人不能超过 50 个字符", trigger: "blur" },
  ],
  plannedStart: [{ required: true, message: "请选择计划开始时间", trigger: "change" }],
  plannedEnd: [{ required: true, message: "请选择计划完成时间", trigger: "change" }],
};

function replaceDraft(source: TaskDraft): void {
  draft.name = source.name;
  draft.owner = source.owner;
  draft.collaborators = [...source.collaborators];
  draft.plannedStart = source.plannedStart;
  draft.plannedEnd = source.plannedEnd;
  draft.items = source.items.map((item) => ({ ...item }));
}

function hydrateDraft(): void {
  if (props.task) {
    replaceDraft({
      name: props.task.name,
      owner: props.task.owner,
      collaborators: props.task.collaborators,
      plannedStart: props.task.plannedStart,
      plannedEnd: props.task.plannedEnd,
      items: props.task.items,
    });
  } else {
    replaceDraft(createEmptyDraft());
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      return;
    }
    currentStep.value = 0;
    saving.value = false;
    hydrateDraft();
    void nextTick(() => basicForm.value?.clearValidate());
  },
);

function normalizedPeople(values: string[], owner: string): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => value && value !== owner.trim())
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function addWorkItem(): void {
  const item: WorkItem = {
    id: createId(),
    title: "",
    owner: draft.owner.trim(),
    plannedEnd: draft.plannedEnd,
    status: "not_started",
  };
  draft.items.push(item);
}

async function goToItems(): Promise<void> {
  draft.name = draft.name.trim();
  draft.owner = draft.owner.trim();

  try {
    await basicForm.value?.validate();
  } catch {
    return;
  }

  draft.collaborators = normalizedPeople(draft.collaborators, draft.owner);

  const planStart = new Date(draft.plannedStart).getTime();
  const planEnd = new Date(draft.plannedEnd).getTime();
  if (!Number.isFinite(planStart) || !Number.isFinite(planEnd)) {
    ElMessage.warning("请选择有效的计划开始和完成时间");
    return;
  }
  if (planStart > planEnd) {
    ElMessage.warning("计划完成时间不能早于计划开始时间");
    return;
  }

  if (draft.items.length === 0) {
    addWorkItem();
  }
  currentStep.value = 1;
}

function removeWorkItem(index: number): void {
  draft.items.splice(index, 1);
}

function validateItems(): boolean {
  if (draft.items.length === 0) {
    ElMessage.warning("请至少添加一项具体任务");
    return false;
  }

  const planStart = new Date(draft.plannedStart).getTime();
  const planEnd = new Date(draft.plannedEnd).getTime();

  for (let index = 0; index < draft.items.length; index += 1) {
    const item = draft.items[index];
    item.title = item.title.trim();
    item.owner = item.owner.trim();

    if (!item.title || !item.owner || !item.plannedEnd) {
      ElMessage.warning(`请完整填写第 ${index + 1} 行具体任务`);
      return false;
    }

    const itemEnd = new Date(item.plannedEnd).getTime();
    if (!Number.isFinite(itemEnd) || itemEnd < planStart || itemEnd > planEnd) {
      ElMessage.warning(`第 ${index + 1} 行完成时间应在任务计划周期内`);
      return false;
    }

    if (!TASK_STATUS_OPTIONS.some((option) => option.value === item.status)) {
      ElMessage.warning(`第 ${index + 1} 行任务状态无效`);
      return false;
    }
  }

  return true;
}

function saveTask(): void {
  if (saving.value || !validateItems()) {
    return;
  }

  saving.value = true;
  const payload: TaskDraft = {
    name: draft.name,
    owner: draft.owner,
    collaborators: [...draft.collaborators],
    plannedStart: draft.plannedStart,
    plannedEnd: draft.plannedEnd,
    items: draft.items.map((item) => ({ ...item })),
  };
  emit("save", payload);
  visible.value = false;
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="task ? '维护任务' : '创建任务'"
    width="min(960px, calc(100vw - 28px))"
    top="5vh"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-steps :active="currentStep" finish-status="success" align-center class="dialog-steps">
      <el-step title="基本信息" description="任务、人员与计划周期" />
      <el-step title="具体任务" description="逐行维护执行项" />
    </el-steps>

    <el-form
      v-show="currentStep === 0"
      ref="basicForm"
      :model="draft"
      :rules="basicRules"
      label-position="top"
      class="basic-form"
    >
      <el-form-item label="任务名称" prop="name">
        <el-input
          v-model="draft.name"
          maxlength="100"
          show-word-limit
          placeholder="例如：XXX 探测载荷初样研制"
        />
      </el-form-item>

      <div class="form-grid">
        <el-form-item label="负责人" prop="owner">
          <el-input v-model="draft.owner" maxlength="50" placeholder="输入负责人姓名" />
        </el-form-item>
        <el-form-item label="协作人">
          <el-select
            v-model="draft.collaborators"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            placeholder="输入姓名后按回车，可添加多人"
          />
        </el-form-item>
      </div>

      <div class="form-grid">
        <el-form-item label="计划开始时间" prop="plannedStart">
          <el-date-picker
            v-model="draft.plannedStart"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            placeholder="选择计划开始时间"
          />
        </el-form-item>
        <el-form-item label="计划完成时间" prop="plannedEnd">
          <el-date-picker
            v-model="draft.plannedEnd"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            placeholder="选择计划完成时间"
          />
        </el-form-item>
      </div>
    </el-form>

    <section v-show="currentStep === 1" class="items-step">
      <div class="items-heading">
        <div>
          <h3>具体任务列表</h3>
          <p>按执行顺序逐行填写，完成度按“已闭环项数 / 总项数”自动计算。</p>
        </div>
        <el-button type="primary" plain :icon="Plus" @click="addWorkItem">添加一行</el-button>
      </div>

      <div class="items-table-wrap">
        <el-table
          class="desktop-items-table"
          :data="draft.items"
          row-key="id"
          empty-text="还没有具体任务"
        >
          <el-table-column type="index" label="#" width="52" />
          <el-table-column label="具体任务" min-width="240">
            <template #default="{ row }">
              <el-input v-model="row.title" maxlength="200" placeholder="输入具体任务" />
            </template>
          </el-table-column>
          <el-table-column label="负责人" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.owner" maxlength="50" placeholder="负责人" />
            </template>
          </el-table-column>
          <el-table-column label="计划完成时间" min-width="205">
            <template #default="{ row }">
              <el-date-picker
                v-model="row.plannedEnd"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss"
                format="YYYY-MM-DD HH:mm"
                placeholder="完成时间"
              />
            </template>
          </el-table-column>
          <el-table-column label="任务状态" min-width="135">
            <template #default="{ row }">
              <el-select v-model="row.status">
                <el-option
                  v-for="option in TASK_STATUS_OPTIONS"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="72" fixed="right">
            <template #default="{ $index }">
              <el-button
                type="danger"
                text
                :icon="Delete"
                aria-label="删除此行"
                @click="removeWorkItem($index)"
              />
            </template>
          </el-table-column>
        </el-table>

        <div class="mobile-items">
          <article v-for="(item, index) in draft.items" :key="item.id" class="mobile-item-card">
            <header>
              <strong>具体任务 {{ index + 1 }}</strong>
              <el-button
                type="danger"
                text
                :icon="Delete"
                aria-label="删除此行"
                @click="removeWorkItem(index)"
              >
                删除
              </el-button>
            </header>
            <label>
              <span>具体任务</span>
              <el-input v-model="item.title" maxlength="200" placeholder="输入具体任务" />
            </label>
            <label>
              <span>负责人</span>
              <el-input v-model="item.owner" maxlength="50" placeholder="负责人" />
            </label>
            <label>
              <span>计划完成时间</span>
              <el-date-picker
                v-model="item.plannedEnd"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm:ss"
                format="YYYY-MM-DD HH:mm"
                placeholder="完成时间"
              />
            </label>
            <label>
              <span>任务状态</span>
              <el-select v-model="item.status">
                <el-option
                  v-for="option in TASK_STATUS_OPTIONS"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </label>
          </article>
        </div>
      </div>
    </section>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <div>
          <el-button v-if="currentStep === 1" @click="currentStep = 0">上一步</el-button>
          <el-button v-if="currentStep === 0" type="primary" @click="goToItems">
            下一步：具体任务
          </el-button>
          <el-button v-else type="primary" :loading="saving" @click="saveTask">
            {{ task ? "保存修改" : "创建任务" }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-steps {
  margin: 4px auto 30px;
  padding: 0 9%;
}

.basic-form {
  max-width: 760px;
  margin: 0 auto;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.basic-form :deep(.el-select),
.basic-form :deep(.el-date-editor) {
  width: 100%;
}

.items-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 15px;
}

.items-heading h3,
.items-heading p {
  margin: 0;
}

.items-heading h3 {
  color: #24364d;
  font-size: 16px;
}

.items-heading p {
  margin-top: 5px;
  color: #7b8797;
  font-size: 12px;
}

.items-table-wrap {
  overflow-x: auto;
  border: 1px solid #e5eaf0;
  border-radius: 10px;
}

.items-table-wrap :deep(.el-table) {
  min-width: 840px;
}

.mobile-items {
  display: none;
}

.items-table-wrap :deep(.el-date-editor),
.items-table-wrap :deep(.el-select) {
  width: 100%;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 620px) {
  .dialog-steps {
    padding: 0;
  }

  .dialog-steps :deep(.el-step__description) {
    display: none;
  }

  .form-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .items-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .items-table-wrap {
    overflow: visible;
    border: 0;
  }

  .desktop-items-table {
    display: none;
  }

  .mobile-items {
    display: grid;
    gap: 12px;
  }

  .mobile-item-card {
    display: grid;
    gap: 13px;
    padding: 14px;
    border: 1px solid #e4e9f0;
    border-radius: 12px;
    background: #fafbfd;
  }

  .mobile-item-card header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .mobile-item-card label,
  .mobile-item-card label > span {
    display: block;
  }

  .mobile-item-card label > span {
    margin-bottom: 6px;
    color: #66758a;
    font-size: 12px;
  }

  .mobile-item-card :deep(.el-date-editor),
  .mobile-item-card :deep(.el-select) {
    width: 100%;
  }

  .dialog-footer {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .dialog-footer > div {
    display: grid;
    gap: 8px;
  }

  .dialog-footer .el-button {
    width: 100%;
    margin-left: 0;
  }
}
</style>
