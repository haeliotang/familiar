# 公开仓库持续检查准备

2026-09-30。目标远端 https://github.com/haeliotang/familiar.git；本地已初始化 main 并设置 origin，目前没有提交或推送。

新增 .github/workflows/ci.yml：Ubuntu 24.04、Node 22、pnpm 10.32.1、PostgreSQL 17；安装 ffmpeg 与 libheif-examples；按现有脚本下载固定 SHA 的 Kokoro/Whisper/Silero 模型；依赖预检、全部测试（最多两个 worker）与构建。仅 contents:read，无供应商账户与远程推理。README 补齐工具、模型与安装步骤。Actions 用法核对官方文档 https://github.com/pnpm/action-setup/tree/v4 与 https://github.com/actions/setup-node/tree/v4 。

本地执行对应门：完整测试 35 文件、188 项通过，未设置 TEST_DATABASE_URL 的数据库文件 36 项跳过，耗时 35.60 秒；随后 PostgreSQL 17 临时容器独立补跑 36 项全部通过，耗时 3.14 秒，容器已停止并自动移除。构建通过；场景分包约 602 KB，仍有大包警告。

GitHub runner 尚未实际运行，Linux 工具/模型原生库组合及公共仓库下载不能用 macOS 本地结果代替。尚未完成 M0–M4 或正式发布，不推送为已完成产品。私有媒体、数据库、模型与环境凭据由 .gitignore 排除；公开 artifacts/docs 仍需发布前逐文件审核，不以忽略规则代替内容审查。

## 录音确认、试听与变速改动后的当前复核

2026-09-30，完整测试 43 文件、236 项：199 项通过，36 项 PostgreSQL 测试未设置连接而跳过，1 项 dev-files 因沙箱禁止监听本地端口（EPERM）未能执行。随后在允许本地监听的环境单独重跑 dev-files，1 项通过；启动仅绑定 127.0.0.1 的 PostgreSQL 17 临时容器，当前 36 项数据库测试全部通过。合计当前 236 项均有通过记录，但不是一次统一环境的运行。临时容器测试后停止并自动移除。

当前构建通过，场景分包 602.23 KB，仍有大包警告。数据库测试范围以 server/postgres.test.ts 当前用例为准，不能据此宣称新增录音确认与试听的全部真实数据库竞态已覆盖；这些接口还有本地数据库/受控竞态测试。节奏迁移尚未接入生成流程，M0–M4 仍未完成。
