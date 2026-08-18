# dsh-restart-confirm

DeepSeek Harness Web 界面**侧边栏一键重启按钮**——并且带**强制二次确认**，点击两次确认后才会真正重启。

| | |
|---|---|
| 按钮 | 紧贴侧边栏折叠按钮的紧凑重启图标（↻）——展开时位于"收起侧边栏"左侧，56px 收起栏中位于"打开侧边栏"上方 |
| 安全 | 必须先**连续确认两次**才会触发重启 |
| 范围 | 重启 `dsh web` 进程——WebUI 与 Harness 后台是**同一个进程**，重启后两者一起恢复 |
| 重新拉起 | 自动以**启动 DSH 时的完全相同的命令**重新运行（`process.execPath + process.argv`）——无硬编码路径，所有参数（`--host`、`--port`、`--trusted-host`、profile）原样保留 |
| 平台 | macOS · Linux · Windows（独立的后台助手进程在进程被杀后继续执行） |
| 状态点 | 每 5 秒轮询 `GET /dsh-health`——绿色在线 / 红色离线或重启中 |

## 功能特性

- **二次确认** —— 点击按钮先弹出第一个对话框（"是否重启？"），再弹出最终警告框（"真的要重启吗？连接将中断约 15–20 秒"）。只有第二次确认才会发送请求，两个对话框都可以取消。
- **自适应位置** —— 通过 DOM 放置把按钮钉在侧边栏折叠按钮旁：展开时位于"收起侧边栏"左侧，56px 收起栏中位于"打开侧边栏"上方。MutationObserver 保证在重渲染和折叠/展开切换后位置始终正确。
- **自动重新拉起** —— 杀掉进程后，插件用相同参数、相同工作目录重新启动 DSH，会话/任务（持久化在磁盘上）自动恢复，页面自动重连。
- **跨平台、零硬编码路径** —— 重启命令直接从当前运行进程自身重建，兼容任何启动方式（命令行、PWA、supervisor 脚本）。
- **优雅杀进程** —— 先发 SIGTERM，进程仍存活才用 SIGKILL。
- **可配置** —— 杀进程前延迟、杀后延迟、自定义重启命令、仅杀不重启（配合外部 supervisor）。
- **防重入** —— 重启进行中再次请求会被拒绝。
- **仅本机回环** —— 重启接口拒绝非回环地址的调用。
- **跟随主题** —— 使用 DSH 自带的 `--dsw-alias-*` 令牌，按钮与弹窗自动适配明/暗主题。

## 安装

### 方式 A —— GitHub（推荐）

```bash
dsh plugin --profile web add github:seanwhy/dsh-restart-confirm
```

然后重启一次 `dsh web` 使 bundle 层生效。

### 方式 B —— DSH 插件市场

本仓库带有 `dsh-plugin` topic，会被 [DSH 插件市场](https://github.com/w2112515/dsh-plugin-marketplace) 收录。打开 **设置 → 插件 → 插件市场**，搜索 **dsh-restart-confirm**，一键安装。

### 方式 C —— 手动

1. 在 `~/.dsh/profiles/web/package.json` 添加依赖：
   ```jsonc
   {
     "dependencies": {
       "dsh-restart-confirm": "github:seanwhy/dsh-restart-confirm"
     }
   }
   ```
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 添加加载行（用 `dsh plugin` 命令安装会自动完成）：
   ```yaml
   - insert:
       - id: dsh-restart-confirm
         name: dsh-restart-confirm
   ```
3. 在 profile 目录执行 `pnpm install`，然后重启 `dsh web`。

## 配置

插件配置（设置 → 插件 → dsh-restart-confirm → 配置，或在 profile manifest 中）：

| 选项 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `delaySeconds` | number | `3` | 响应返回后多久杀掉进程（给浏览器时间显示"重启中"状态） |
| `relaunchDelaySeconds` | number | `2` | 杀掉进程后多久重新拉起 DSH |
| `customRestartCommand` | string | `''` | 自定义用于重新拉起的 shell 命令（替代自动重建的 argv） |
| `killOnly` | boolean | `false` | 只杀进程、不重新拉起（适用于外部 supervisor 自动重启的场景） |

## 工作原理

| 层 | 文件 | 作用 |
| --- | --- | --- |
| Host | `lib/index.js` | 在 webServer 注册 `GET /dsh-health` 与 `POST /restart-dsh`；启动独立后台助手：等待 → SIGTERM →（SIGKILL）→ 用原始 argv 重新拉起 |
| Client | `lib/client.js` | 纯 vanilla（无 React）客户端，通过 DOM 放置把紧凑图标按钮钉在侧边栏折叠按钮旁；二次确认弹窗；轮询 `GET /dsh-health` 显示状态点 |
| Bundle | `cordis.patch.yml` | 挂载两半的加载行 |

处理函数**先回复浏览器**再执行杀进程；所有延迟都由助手脚本承担，因此不需要宿主定时器（webServer 回调在 Cordis fiber 之外，宿主定时器会被丢弃）。

### 为什么需要独立的助手进程？

如果插件在自己的进程内直接杀掉 DSH，就没人能再把它拉起来了。助手进程是脱离的（Unix 用 `nohup sh … &`，Windows 用 `Start-Process -WindowStyle Hidden`），在 Harness 退出后仍存活，并把 DSH 重新带回来。

## 安全说明

- `POST /restart-dsh` 只接受回环地址（`127.0.0.1` / `::1`），且只接受 `POST`。
- 默认 web profile 的 webServer 绑定在回环地址。
- 插件不向任何地方发送数据；`/dsh-health` 只是本地存活探针。

## 开发

客户端 bundle 是手写的、符合 DSH Web shell 线格式（`window.__ModuleLoader__.load({ id, factory })`），无需构建步骤、无任何依赖（不用 React）。通过稳定的 aria-label 和 CSS-module 类后缀定位侧边栏折叠按钮，不硬编码任何 hash 类名：

```bash
node --check lib/index.js
node --check lib/client.js
```

## License

MIT
