import {
  BellFilled,
  Calendar,
  DataAnalysis,
  FolderOpened,
  Setting,
  UploadFilled,
} from "@element-plus/icons-vue";
import type { Component } from "vue";

export interface NavigationItem {
  label: string;
  path: string;
  icon: Component;
  mobile?: boolean;
}

export const mainNavigation: NavigationItem[] = [
  { label: "今日", path: "/today", icon: Calendar, mobile: true },
  { label: "项目", path: "/projects", icon: FolderOpened, mobile: true },
  { label: "会议与导入", path: "/imports", icon: UploadFilled, mobile: true },
  { label: "通知", path: "/notifications", icon: BellFilled, mobile: true },
  { label: "周报", path: "/reports", icon: DataAnalysis, mobile: true },
  { label: "系统管理", path: "/admin", icon: Setting },
];

