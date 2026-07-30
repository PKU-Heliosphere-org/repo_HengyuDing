<script setup lang="ts">
import { ArrowDown, Bell, CircleCheckFilled, Connection } from "@element-plus/icons-vue";
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";

import { mainNavigation } from "@/config/navigation";
import { useAppStore } from "@/stores/app";

const route = useRoute();
const appStore = useAppStore();

const pageTitle = computed(() => String(route.meta.title ?? "今日"));
const mobileNavigation = computed(() => mainNavigation.filter((item) => item.mobile));

onMounted(() => {
  void appStore.checkBackend();
});
</script>

<template>
  <div class="app-shell">
    <aside class="desktop-sidebar">
      <router-link class="brand" to="/today" aria-label="返回今日页面">
        <span class="brand-mark">墙</span>
        <span>
          <strong>后墙</strong>
          <small>Backwall Tracker</small>
        </span>
      </router-link>

      <el-menu :default-active="route.path" router class="sidebar-menu">
        <el-menu-item v-for="item in mainNavigation" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>

      <div class="sidebar-foot">
        <p>守住每一面硬里程碑</p>
        <span>原型阶段 · v0.1.0</span>
      </div>
    </aside>

    <section class="workspace">
      <header class="topbar">
        <div>
          <p class="topbar-eyebrow">载荷研制工作台</p>
          <h1>{{ pageTitle }}</h1>
        </div>

        <div class="topbar-actions">
          <el-tooltip
            :content="
              appStore.backendStatus === 'offline'
                ? '任务暂存在当前浏览器，启动 FastAPI 后会显示已连接'
                : `FastAPI ${appStore.backendVersion ?? ''}`
            "
          >
            <span class="service-state" :class="`is-${appStore.backendStatus}`">
              <el-icon>
                <CircleCheckFilled v-if="appStore.backendStatus === 'online'" />
                <Connection v-else />
              </el-icon>
              {{ appStore.backendStatusLabel }}
            </span>
          </el-tooltip>
          <el-button circle :icon="Bell" aria-label="通知" />
          <el-dropdown>
            <button class="user-menu" type="button">
              <span class="user-avatar">研</span>
              <span class="user-name">研制成员</span>
              <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>账户功能待接入</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="page-content">
        <router-view />
      </main>
    </section>

    <nav class="mobile-navigation" aria-label="移动端主导航">
      <router-link
        v-for="item in mobileNavigation"
        :key="item.path"
        :to="item.path"
        :class="{ active: route.path.startsWith(item.path) }"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label === "会议与导入" ? "导入" : item.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.desktop-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 20;
  display: flex;
  width: 238px;
  flex-direction: column;
  padding: 24px 16px 20px;
  background: linear-gradient(180deg, #10233f 0%, #0b172a 100%);
  color: #fff;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 8px 30px;
  color: inherit;
  text-decoration: none;
}

.brand-mark {
  display: grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 13px;
  background: #f39237;
  box-shadow: 0 10px 28px rgb(243 146 55 / 24%);
  font-size: 19px;
  font-weight: 800;
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  font-size: 19px;
  letter-spacing: 0.08em;
}

.brand small {
  margin-top: 2px;
  color: #9fb0c6;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.sidebar-menu {
  flex: 1;
  border-right: 0;
  background: transparent;
}

.sidebar-menu :deep(.el-menu-item) {
  height: 48px;
  margin-bottom: 6px;
  border-radius: 10px;
  color: #bac7d8;
}

.sidebar-menu :deep(.el-menu-item:hover) {
  background: rgb(255 255 255 / 7%);
  color: #fff;
}

.sidebar-menu :deep(.el-menu-item.is-active) {
  background: rgb(243 146 55 / 15%);
  color: #ffb66f;
}

.sidebar-foot {
  margin: 18px 8px 0;
  padding-top: 18px;
  border-top: 1px solid rgb(255 255 255 / 9%);
}

.sidebar-foot p,
.sidebar-foot span {
  margin: 0;
}

.sidebar-foot p {
  color: #c7d2e1;
  font-size: 12px;
}

.sidebar-foot span {
  display: block;
  margin-top: 5px;
  color: #728399;
  font-size: 11px;
}

.workspace {
  min-height: 100vh;
  margin-left: 238px;
}

.topbar {
  position: sticky;
  top: 0;
  z-index: 15;
  display: flex;
  min-height: 80px;
  align-items: center;
  justify-content: space-between;
  padding: 14px 32px;
  border-bottom: 1px solid #e6eaf0;
  background: rgb(248 250 252 / 92%);
  backdrop-filter: blur(16px);
}

.topbar h1,
.topbar-eyebrow {
  margin: 0;
}

.topbar h1 {
  margin-top: 2px;
  color: #15243a;
  font-size: 22px;
}

.topbar-eyebrow {
  color: #8390a2;
  font-size: 11px;
  letter-spacing: 0.12em;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.service-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 999px;
  background: #eef2f7;
  color: #6b7788;
  font-size: 12px;
}

.service-state.is-online {
  background: #e9f7ef;
  color: #268653;
}

.service-state.is-checking {
  color: #9a6a28;
}

.user-menu {
  display: flex;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: #334155;
}

.user-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  background: #dbe5f1;
  color: #173251;
  font-weight: 700;
}

.page-content {
  width: min(1400px, 100%);
  margin: 0 auto;
  padding: 28px 32px 54px;
}

.mobile-navigation {
  display: none;
}

@media (max-width: 900px) {
  .desktop-sidebar {
    display: none;
  }

  .workspace {
    margin-left: 0;
  }

  .topbar {
    min-height: 68px;
    padding: 10px 18px;
  }

  .topbar-eyebrow,
  .service-state,
  .user-name {
    display: none;
  }

  .topbar h1 {
    font-size: 20px;
  }

  .page-content {
    padding: 20px 16px 96px;
  }

  .mobile-navigation {
    position: fixed;
    inset: auto 0 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    padding: 8px max(8px, env(safe-area-inset-right))
      calc(8px + env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
    border-top: 1px solid #e2e8f0;
    background: rgb(255 255 255 / 96%);
    box-shadow: 0 -8px 25px rgb(15 23 42 / 7%);
    backdrop-filter: blur(12px);
  }

  .mobile-navigation a {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    color: #758195;
    font-size: 10px;
    text-decoration: none;
  }

  .mobile-navigation a .el-icon {
    font-size: 20px;
  }

  .mobile-navigation a.active {
    color: #d9771d;
  }
}
</style>

