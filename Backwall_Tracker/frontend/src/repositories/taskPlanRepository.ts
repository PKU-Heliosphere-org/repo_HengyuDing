import type { TaskPlan, TaskStatus, WorkItem } from "@/types/task";
import { createId } from "@/utils/task";

const STORAGE_KEY = "backwall-tracker.tasks.v1";
const SCHEMA_VERSION = 1;
const VALID_STATUSES = new Set<TaskStatus>([
  "not_started",
  "in_progress",
  "pending_submission",
  "pending_confirmation",
  "closed",
]);

interface StorageEnvelope {
  schemaVersion: number;
  savedAt: string;
  records: TaskPlan[];
}

export interface TaskPlanRepository {
  list(): TaskPlan[];
  save(records: TaskPlan[]): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredDateString(value: unknown): string | undefined {
  const normalized = requiredString(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function normalizeWorkItem(value: unknown): WorkItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const title = requiredString(value.title);
  const owner = requiredString(value.owner);
  const plannedEnd = requiredDateString(value.plannedEnd);
  const status = value.status;
  if (
    !title ||
    !owner ||
    !plannedEnd ||
    typeof status !== "string" ||
    !VALID_STATUSES.has(status as TaskStatus)
  ) {
    return undefined;
  }

  return {
    id: requiredString(value.id) ?? createId(),
    title,
    owner,
    plannedEnd,
    status: status as TaskStatus,
  };
}

function normalizeTaskPlan(value: unknown): TaskPlan | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = requiredString(value.name);
  const owner = requiredString(value.owner);
  const plannedStart = requiredDateString(value.plannedStart);
  const plannedEnd = requiredDateString(value.plannedEnd);
  if (!name || !owner || !plannedStart || !plannedEnd) {
    return undefined;
  }

  const items = Array.isArray(value.items)
    ? value.items
        .map((item) => normalizeWorkItem(item))
        .filter((item): item is WorkItem => item !== undefined)
        .filter((item) => {
          const itemEnd = Date.parse(item.plannedEnd);
          return itemEnd >= Date.parse(plannedStart) && itemEnd <= Date.parse(plannedEnd);
        })
    : [];
  if (items.length === 0) {
    return undefined;
  }

  const seenItemIds = new Set<string>();
  const uniqueItems = items.map((item) => {
    if (seenItemIds.has(item.id)) {
      return { ...item, id: createId() };
    }
    seenItemIds.add(item.id);
    return item;
  });

  const collaborators = Array.isArray(value.collaborators)
    ? value.collaborators
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  const now = new Date().toISOString();
  return {
    id: requiredString(value.id) ?? createId(),
    name,
    owner,
    collaborators,
    plannedStart,
    plannedEnd,
    items: uniqueItems,
    createdAt: requiredString(value.createdAt) ?? now,
    updatedAt: requiredString(value.updatedAt) ?? now,
  };
}

export class LocalTaskPlanRepository implements TaskPlanRepository {
  list(): TaskPlan[] {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed: unknown = JSON.parse(raw);
      const records =
        isRecord(parsed) &&
        parsed.schemaVersion === SCHEMA_VERSION &&
        Array.isArray(parsed.records)
          ? parsed.records
          : Array.isArray(parsed)
            ? parsed
            : [];

      return records
        .map((record) => normalizeTaskPlan(record))
        .filter((record): record is TaskPlan => record !== undefined);
    } catch {
      return [];
    }
  }

  save(records: TaskPlan[]): boolean {
    const envelope: StorageEnvelope = {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      records,
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      return true;
    } catch {
      // Quota and privacy-mode errors must not break the current UI session.
      return false;
    }
  }
}

export const taskPlanRepository = new LocalTaskPlanRepository();
