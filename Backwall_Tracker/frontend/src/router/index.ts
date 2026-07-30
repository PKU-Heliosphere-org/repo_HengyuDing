import { createRouter, createWebHistory } from "vue-router";

import MainLayout from "@/layouts/MainLayout.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/LoginView.vue"),
      meta: { title: "登录" },
    },
    {
      path: "/",
      component: MainLayout,
      redirect: "/today",
      children: [
        {
          path: "today",
          name: "today",
          component: () => import("@/views/TodayView.vue"),
          meta: { title: "今日" },
        },
        {
          path: "projects",
          name: "projects",
          component: () => import("@/views/ProjectsView.vue"),
          meta: { title: "项目" },
        },
        {
          path: "projects/:projectId",
          name: "project-detail",
          component: () => import("@/views/ProjectDetailView.vue"),
          meta: { title: "项目详情" },
        },
        {
          path: "meetings",
          name: "meetings",
          component: () => import("@/views/MeetingsView.vue"),
          meta: { title: "会议" },
        },
        {
          path: "imports",
          name: "imports",
          component: () => import("@/views/ImportsView.vue"),
          meta: { title: "会议与导入" },
        },
        {
          path: "notifications",
          name: "notifications",
          component: () => import("@/views/NotificationsView.vue"),
          meta: { title: "通知" },
        },
        {
          path: "reports",
          name: "reports",
          component: () => import("@/views/ReportsView.vue"),
          meta: { title: "周报" },
        },
        {
          path: "admin",
          name: "admin",
          component: () => import("@/views/AdminView.vue"),
          meta: { title: "系统管理" },
        },
      ],
    },
    {
      path: "/:pathMatch(.*)*",
      name: "not-found",
      component: () => import("@/views/NotFoundView.vue"),
      meta: { title: "页面不存在" },
    },
  ],
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "后墙")} · Backwall Tracker`;
});

export default router;

