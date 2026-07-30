import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { fetchHealth } from "@/api/system";

export type BackendStatus = "checking" | "online" | "offline";

export const useAppStore = defineStore("app", () => {
  const backendStatus = ref<BackendStatus>("checking");
  const backendVersion = ref<string>();

  const backendStatusLabel = computed(() => {
    const labels: Record<BackendStatus, string> = {
      checking: "服务检查中",
      online: "后端已连接",
      offline: "本地原型模式",
    };
    return labels[backendStatus.value];
  });

  async function checkBackend(): Promise<void> {
    backendStatus.value = "checking";
    try {
      const health = await fetchHealth();
      backendStatus.value = "online";
      backendVersion.value = health.version;
    } catch {
      backendStatus.value = "offline";
      backendVersion.value = undefined;
    }
  }

  return {
    backendStatus,
    backendVersion,
    backendStatusLabel,
    checkBackend,
  };
});

