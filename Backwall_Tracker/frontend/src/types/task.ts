export const TASK_STATUS_OPTIONS = [
  { value: "not_started", label: "未开始" },
  { value: "in_progress", label: "进行中" },
  { value: "pending_submission", label: "待提交" },
  { value: "pending_confirmation", label: "待确认" },
  { value: "closed", label: "已闭环" },
] as const;

export type TaskStatus = (typeof TASK_STATUS_OPTIONS)[number]["value"];

export interface WorkItem {
  id: string;
  title: string;
  owner: string;
  plannedEnd: string;
  status: TaskStatus;
}

export interface TaskPlan {
  id: string;
  name: string;
  owner: string;
  collaborators: string[];
  plannedStart: string;
  plannedEnd: string;
  items: WorkItem[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskDraft {
  name: string;
  owner: string;
  collaborators: string[];
  plannedStart: string;
  plannedEnd: string;
  items: WorkItem[];
}

