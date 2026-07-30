import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { taskPlanRepository } from "@/repositories/taskPlanRepository";
import type { TaskDraft, TaskPlan } from "@/types/task";
import { createId } from "@/utils/task";

export const useTaskStore = defineStore("tasks", () => {
  const tasks = ref<TaskPlan[]>(taskPlanRepository.list());
  const persistenceAvailable = ref(true);

  const orderedTasks = computed(() =>
    [...tasks.value].sort(
      (left, right) =>
        new Date(left.plannedEnd).getTime() - new Date(right.plannedEnd).getTime(),
    ),
  );

  function persist(): boolean {
    const persisted = taskPlanRepository.save(tasks.value);
    persistenceAvailable.value = persisted;
    return persisted;
  }

  function createTask(draft: TaskDraft): { task: TaskPlan; persisted: boolean } {
    const now = new Date().toISOString();
    const task: TaskPlan = {
      ...draft,
      id: createId(),
      collaborators: [...draft.collaborators],
      items: draft.items.map((item) => ({ ...item })),
      createdAt: now,
      updatedAt: now,
    };
    tasks.value.push(task);
    return { task, persisted: persist() };
  }

  function updateTask(
    taskId: string,
    draft: TaskDraft,
  ): { task: TaskPlan; persisted: boolean } | undefined {
    const index = tasks.value.findIndex((task) => task.id === taskId);
    if (index < 0) {
      return undefined;
    }

    const current = tasks.value[index];
    const updated: TaskPlan = {
      ...current,
      ...draft,
      id: current.id,
      collaborators: [...draft.collaborators],
      items: draft.items.map((item) => ({ ...item })),
      updatedAt: new Date().toISOString(),
    };
    tasks.value[index] = updated;
    return { task: updated, persisted: persist() };
  }

  return {
    tasks,
    orderedTasks,
    persistenceAvailable,
    createTask,
    updateTask,
  };
});
