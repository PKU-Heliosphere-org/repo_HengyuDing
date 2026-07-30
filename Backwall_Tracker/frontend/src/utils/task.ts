import { TASK_STATUS_OPTIONS, type TaskPlan, type TaskStatus } from "@/types/task";

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

export function taskStatusType(
  status: TaskStatus,
): "info" | "primary" | "warning" | "success" {
  const typeMap: Record<TaskStatus, "info" | "primary" | "warning" | "success"> = {
    not_started: "info",
    in_progress: "primary",
    pending_submission: "warning",
    pending_confirmation: "warning",
    closed: "success",
  };
  return typeMap[status];
}

export function taskCompletion(task: Pick<TaskPlan, "items">): number {
  if (task.items.length === 0) {
    return 0;
  }

  const closedCount = task.items.filter((item) => item.status === "closed").length;
  return Math.round((closedCount / task.items.length) * 100);
}

export function formatDateTime(value: string): string {
  if (!value) {
    return "未设置";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function isOverdue(task: Pick<TaskPlan, "plannedEnd" | "items">): boolean {
  return (
    new Date(task.plannedEnd).getTime() < Date.now() &&
    task.items.some((item) => item.status !== "closed")
  );
}

export function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
