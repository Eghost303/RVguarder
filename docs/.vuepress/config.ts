import { viteBundler } from "@vuepress/bundler-vite";
import { defaultTheme } from "@vuepress/theme-default";
import { defineUserConfig } from "vuepress";

export default defineUserConfig({
  lang: "zh-CN",
  title: "RVguarder",
  description: "RVguarder v0.2.1-rc1：OpenClaw / DSH 插件安装、架构、安全能力与运维说明。",
  base: "/",
  pagePatterns: ["**/*.md", "!superpowers/**", "!archive/**", "!research/**", "!dev/project-memory.md"],
  bundler: viteBundler(),
  head: [
    ["meta", { name: "theme-color", content: "#111827" }],
    ["meta", { name: "apple-mobile-web-app-capable", content: "yes" }],
  ],
  theme: defaultTheme({
    logo: "/mark.svg",
    docsDir: "docs",
    navbar: [
      { text: "首页", link: "/" },
      { text: "快速开始", link: "/deployment/local.html" },
      { text: "DSH 插件", link: "/deployment/dsh.html" },
      { text: "架构", link: "/architecture/overview.html" },
      { text: "核心功能", link: "/features/baseline.html" },
      { text: "运行时 Hook", link: "/features/runtime-hook.html" },
      { text: "部署运维", link: "/deployment/local.html" },
      { text: "API", link: "/api/http.html" },
      { text: "FAQ", link: "/ops/faq.html" },
    ],
    sidebar: {
      "/": ["/rvguarder-security-capabilities-and-boundaries.md"],
      "/architecture/": [
        {
          text: "架构设计",
          children: [
            "/architecture/index.md",
            "/architecture/overview.md",
            "/architecture/permission-modeling-diagrams.md",
            "/architecture/permission-kb-runtime-architecture.md",
            "/architecture/rv-permission-automata.md",
            "/architecture/legacy-rule-migration-matrix.md",
            "/architecture/rv-engine-report.md",
            "/architecture/quality-assurance.md",
            "/architecture/dsh-plugin-migration-feasibility-2026-10-19.md",
          ],
        },
      ],
      "/features/": [
        {
          text: "核心能力",
          children: [
            "/features/baseline.md",
            "/features/action-gate.md",
            "/features/runtime-hook.md",
            "/features/audit.md",
          ],
        },
      ],
      "/deployment/": [
        {
          text: "部署说明",
          children: [
            "/deployment/dsh.md",
            "/deployment/local.md",
            "/deployment/docker-k8s.md",
          ],
        },
      ],
      "/api/": [
        {
          text: "接口文档",
          children: ["/api/http.md"],
        },
      ],
      "/ops/": [
        {
          text: "运维与 FAQ",
          children: ["/ops/faq.md", "/ops/roadmap.md"],
        },
      ],
      "/comparison/": [
        {
          text: "对比分析",
          children: [
            "/comparison/rvguard-vs-agent-security-tools.md",
          ],
        },
      ],
      "/semantic/": [
        {
          text: "语义理解",
          children: [
            "/semantic/index.md",
            "/semantic/method.md",
            "/semantic/office-scenario-matrix.md",
            "/semantic/pmkb-network-case-baseline.md",
          ],
        },
      ],
      "/dev/": [
        {
          text: "开发文档",
          children: [
            "/dev/dsh-development.md",
            "/dev/dsh-progress-2026-10-26.md",
            "/dev/dsh-ui-integration-plan-2026-10-26.md",
            "/dev/frontend.md",
          ],
        },
      ],
    },
    editLink: false,
    contributors: false,
    lastUpdated: false,
  }),
});
