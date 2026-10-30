# 本机环境、跨客户端安装与更新

## 使用环境

技能与底层模型解耦。需要本机文件读写、运行 Node.js 20+ 的终端、可启动的 Google Chrome、公司网络，以及使用者自己的平台与飞书授权。

| 使用方式 | 如何接入 |
|---|---|
| Codex 本机聊天 | 安装到 CODEX_HOME/skills 或 ~/.codex/skills；新对话调用技能 |
| Claude Code 本机 | 安装到 ~/.claude/skills；新会话使用 /li-auto-event-tracking 或中文名 |
| 接入 MiMo / DeepSeek 的本机 AI 工具 | 若支持 Agent Skills，安装到该客户端实际支持的技能目录；支持 .agents/skills 的用 agents 目标。否则让助手先读取安装目录中的 SKILL.md，再按其流程执行 |
| 只有网页聊天或云端终端 | 可协助理解材料；先引导到能执行本机命令的客户端，再进行内网平台创建。不要让使用者反复复制终端命令充当代理 |

MiMo、DeepSeek 是模型/服务名，不能据此承诺某个客户端自动识别技能。先查看实际客户端的技能机制。不要修改其模型选择、API Key、全局提示词或其他技能。技能没有模型 API Key、指定模型或 Codex 工具名依赖。

Codex 选择“本机 / This computer”而非 Cloud；Local 和 Worktree 都在电脑执行。云端任务不会自动继承本机文件、浏览器登录或 VPN。界面文案可能随版本变化，以运行位置和能力为准。[官方环境说明](https://learn.chatgpt.com/docs/environments/modes)。

`start` 的 doctor 只检查依赖，不证明网络或登录可用，也不会仅凭 Linux/Windows/macOS 判定本机/云端。由代理结合宿主环境确认。已明确连通本机的远程控制会话按实际能力处理。

## 浏览器执行权限

启动 Chrome 前确认当前宿主允许本机浏览器进程。已知 Codex/macOS 的受限执行环境（`CODEX_SANDBOX=seatbelt`）会令 Chrome 在应用注册阶段退出并触发系统崩溃报告；脚本检测到时返回 `BROWSER_EXECUTION_PERMISSION_REQUIRED`，在浏览器启动、运行锁和批次状态写入之前停止。

- Codex 提供 `exec_command` 的 `sandbox_permissions` 时，对需要 Chrome 的具体命令使用正式的 `require_escalated` 审批路径，并说明该命令要检查登录、读取表格或执行已授权批次。不要先在已知受限环境试启动一次。既有授权按宿主规则复用；被拒绝时停止相关步骤。
- Claude Code 等其他客户端使用其自身授权机制；不能仅凭客户端名称认定已有权限。未检测出已知限制，也不等于已验证全部启动权限。
- 涉及 Chrome 的入口包括 check-login、login、events-check、run、check-platform、platform-login、pages-check、pages-run；draft-prepare 仅在缺图且需要查询平台时才启动 Chrome。已有 PRD 图片的本地整理可以继续。
- 不清除或伪造环境标记，不关闭安全检查、不修改全局权限，也不隐藏系统崩溃提示。只在正式获准的执行环境重试对应命令。

`start`、`intro`、更新检查、配置保存和依赖检查本身不启动 Chrome。仅查看用法时，不提前申请业务浏览器权限。

## 一条命令安装

macOS/Linux 的终端或本机 AI 助手执行：

```bash
curl -fsSL https://raw.githubusercontent.com/javenvian-del/li-auto-event-tracking/main/install.sh | bash
```

不需要 Git、GitHub 账号或访问令牌。安装器自动寻找 Node.js 20+；缺少时从 Node.js 官方下载适合本机的 Node.js 24，按官方 SHA-256 清单校验后放入技能数据目录，准备 Playwright，再校验和安装完整技能。公司网络和业务账号不属于匿名安装范围，首次业务使用时由本人登录。

默认安装 Codex 和 Claude Code。只装一端可把命令末尾改为 `bash -s -- --target codex`、`--target claude` 或 `--target agents`。其他客户端使用 `--dest '/该客户端实际技能目录/li-auto-event-tracking'`；不猜测不受支持的路径。需要独立运行环境时可用 `bash -s -- --portable-node`，该参数放在最前面。

已有完整技能包时，也可在解压目录运行 `bash install.sh`；不会重复下载技能。Windows 可下载完整包，在已安装 Node.js 20+ 的环境执行 `node scripts/install.mjs --target codex` 或 `--dest`。Windows 提供 run.cmd，尚未进行完整实机验证；上面的一条命令以 macOS/Linux 为范围。

配置、状态、日志与专用运行环境位于 `~/Documents/Codex/li-auto-event-tracking-data`（可用 `LI_AUTO_TRACKING_DATA` 指定）。安装和更新只替换技能文件，原配置与登录状态保留；既有 stateDir 继续使用。多个客户端可共用本人状态，业务操作和更新使用同一锁，不并行执行。运行环境下载失败、校验失败或已有操作运行时，停止并保留已安装版本。

## 每次调用检查、确认后更新

- 默认更新源是独立公开仓库 `javenvian-del/li-auto-event-tracking` 的 main 分支，发布清单为 `release.json`。匿名下载不发送个人 GitHub 令牌。
- `bash run.sh start`：每次业务调用联网检查版本，不使用当天缓存跳过检查，无后台任务，无模型 API 调用。
- 发现新版本，先展示当前→新版本及要点，取得该使用者明确选择，再运行 `bash run.sh update --version X.Y.Z --confirmed`。拒绝、暂缓或尚未答复时保持当前版本。
- 检查记录绑定当前目录、更新源、版本和发布清单摘要。确认后源或清单变化，重新检查并确认；下载逐文件校验，失败不替换当前安装。
- 更新只替换本次调用的技能目录。其他客户端下次调用各自检查；统一安装可显式选择 both。
- 更新先准备完整目录和依赖，再备份旧版并替换。不得删除未知锁或关闭使用者自己的 Chrome。
- 更新完成后重新读取新 SKILL.md，在用户可见回复中原样展示更新结果中的 introduction。旧版更新器没有返回该字段时，运行 `bash run.sh intro` 读取新介绍；宿主缓存了技能列表时，用新会话刷新。
- 离线、超时、404 或权限错误时，明确本次检查未完成，可继续当前版；不能报告已经是最新，也不循环重试。

### 通过客户端网络工具检查

脚本联网失败、但当前 AI 的网络工具可用时：

1. 每次调用重新读取默认源的 release.json，将本次完整响应保存到临时目录的 `release.json`。不能复用旧下载冒充本次联网检查。
2. 执行 `bash run.sh update-check --downloaded-source '/本次下载目录'`，仅检查时无需下载其他文件。
3. 发现新版本后等使用者确认。确认后重读远端清单；若变化重新确认。按清单下载同一提交中的所有文件，保留相对路径。
4. 执行 `bash run.sh update --downloaded-source '/本次下载目录' --version X.Y.Z --confirmed`。脚本校验已确认版本、源、清单和文件摘要；成功后重读技能。

自定义发布源可在本人数据目录配置 `update-source.json`，`baseUrl` 为 HTTPS 目录地址；私有 API 可用 `tokenEnv` 指定本人环境变量名称。私有源须用相应个人授权，不能将令牌发送到公开 raw 地址。显式配置的自定义源保持不变，不擅自切换或共享凭据。

仅查看或修改技能说明不启动业务浏览器。介绍按当前对话展示，不保存全局已读状态；旧 onboarding.json 不再决定是否展示。`start` 返回完整 introduction，`intro` 离线读取同一正文。只有当前对话已经完整介绍且继续具体任务时用 `start --continue`，每次仍检查更新。兼容入口 `guide-seen` 只返回介绍，不写已读状态。

## 维护发布

改动后提升 package.json 版本，运行 `node --test test/*.test.mjs` 和 `node scripts/build-release.mjs`。只向独立技能代码仓库提交清单中的文件及 .gitignore，保持代码与 release.json 同次发布。发布前排除配置、凭据、业务链接、PRD、截图和日志；不从其他仓库复制历史提交。

发布后核对匿名下载内容、清单和版本，并验证隔离目录中的安装与检查更新。没有提升版本号，不替换已发布内容。旧版首次迁移使用上面的一条命令；此后每次调用检查，确认后更新。
