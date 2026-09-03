# Cloudflare 部署指南

本文用于发布和验证 `translate-v29` Web/Worker。生产版本以
[`/api/status`](https://fanyi.411081.xyz/api/status) 返回的 `version` 为准。

## 1. 环境与权限

- Node.js 18 或更高版本；建议使用当前 LTS。
- Cloudflare 账号拥有 `translate-app` Worker、Workers AI binding 和两个自定义域名的发布权限。
- `fanyi.411081.xyz` 与 `fanyi.92haohuo.cn` 已托管到同一 Cloudflare 账号。
- Web 同传生产验证使用最新稳定版 Chrome 或 Edge。麦克风、共享音频与输出设备选择要求 HTTPS；`localhost` 仅用于本地开发。
- 浏览器必须允许该站点使用麦克风。共享标签页、窗口或屏幕的权限不能预先授予，每次启动共享音频都要由测试人员在浏览器面板中重新选择。
- 会议双通道验证需要耳机。验证译音进入 Teams 时，还需要 VB-CABLE 或 VoiceMeeter 等虚拟音频设备。

`wrangler.toml` 已定义 Worker 入口、`public/` 静态资源、Workers AI binding 和自定义域名。不要把 Cloudflare、Azure 或 Google 密钥写入 Git。

## 2. 安装与本地验证

首次检出或 `package-lock.json` 更新后，从仓库根目录执行：

```powershell
npm ci
npm test
npx wrangler deploy --dry-run
```

`npm ci` 按锁文件安装依赖；不要提交 `node_modules/`。`npm test` 必须同时通过 Web 同传和 Worker 合约测试，特别是 `/api/translate`、`/api/learn`、`/api/stt` 与 `/api/tts` 的旧调用方式。

需要人工查看页面时启动本地 Worker：

```powershell
npm run dev
```

访问 `http://localhost:8787`。Workers AI、Whisper 和部分上游能力仍取决于有效的 Cloudflare binding 与网络，不应把本地上游不可用误判成前端资源加载故障。

## 3. 发布前测试矩阵

| 范围 | 必测场景 | 通过标准 |
|:---|:---|:---|
| 文字翻译 | Auto、中英互译、显式引擎、空输入和长输入 | 无重复请求；错误可读；旧字段仍兼容 |
| 学习模式 | 开/关、单词、短语、超长文本、Workers AI 失败 | 关闭时不请求；失败不影响基础译文 |
| 麦克风同传 | 允许、拒绝、切换设备、停止后重启 | 方向正确；停止后权限指示与音轨释放 |
| 共享音频 | 标签页含音频、窗口/屏幕无音轨、用户取消共享 | 仅在真实音轨存在时启动；错误可恢复 |
| 会议双通道 | 对方通道和我方通道连续/交替发言 | 双方方向固定正确；消息不串边、不重复 |
| 幻觉过滤 | 静音、低音量、背景噪声、真实包含“点赞/关注”的句子 | 静音模板被丢弃；真实语句不被简单关键词误杀 |
| 自动播报 | 关闭、默认输出、虚拟输出、播放期间继续收音 | 关闭时不播放；会议模式只播我方译文；译音不回灌 |
| 设备生命周期 | 运行中拔出设备、共享被系统停止、切换标签页 | 明确提示并释放旧音轨；可以重新启动 |
| PWA | 强制刷新、Service Worker 更新、离线打开 | 新资源版本一致；离线状态不会伪装成在线成功 |
| 小程序兼容 | 现有请求体、可选字段缺省、既有返回字段 | 路径、必填项、字段类型和语义不变 |

至少在一个 Chrome 和一个 Edge 稳定版上运行音频测试。Teams 的完整路由与会前检查见 [会议音频指南](docs/MEETING-AUDIO.md)。

## 4. 可选密钥配置

无密钥方案可以使用 Bing、Google Web RPC 和 Cloudflare AI，因此以下 Secret 不是启动前提。购买官方服务后可启用相应路径：

```powershell
# Azure/Microsoft Speech Neural TTS
npx wrangler secret put MICROSOFT_SPEECH_KEY

# 可选：Azure/Microsoft Translator
npx wrangler secret put MICROSOFT_TRANSLATOR_KEY

# 可选：Google Cloud Translation v2
npx wrangler secret put GOOGLE_TRANSLATE_API_KEY
```

Region 与 endpoint 可在 Cloudflare Dashboard 的 Worker Variables 中配置：

```text
MICROSOFT_SPEECH_REGION=eastasia
MICROSOFT_SPEECH_ENDPOINT=https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1
MICROSOFT_TRANSLATOR_REGION=<resource-region>
MICROSOFT_TRANSLATOR_ENDPOINT=https://api.cognitive.microsofttranslator.com
```

兼容别名包括 `AZURE_SPEECH_*` 与 `AZURE_TRANSLATOR_*`。无密钥 Bing/Google 路径使用未公开网页协议，可能受限流或协议变化影响，不具备官方 SLA。正式配置付费 TTS 前还应评估鉴权和限流，避免公开 `/api/tts` 消耗额度。

## 5. 生产发布

确认当前分支、提交和工作树后执行：

```powershell
git status --short --branch
git log -1 --oneline
npm ci
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

保留 `wrangler deploy` 输出的 Version ID。不要仅凭命令退出码宣布发布完成，后续必须执行线上验证。

## 6. 发布后验证

先检查两个域名的版本与状态：

```powershell
Invoke-RestMethod https://fanyi.411081.xyz/api/status
Invoke-RestMethod https://fanyi.92haohuo.cn/api/status
npx wrangler deployments list
```

两端均应返回 `translate-v29`，且部署列表顶部的 Version ID 应与本次发布一致。状态页中的上游健康信息是当前 Worker isolate 的被动观测；刚启动且尚无真实请求时显示“未验证”是正常状态。

随后执行最小 API 冒烟测试：

```powershell
$translateBody = @{ text = '部署验证'; sl = 'zh-CN'; tl = 'en'; provider = 'auto' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://fanyi.411081.xyz/api/translate -ContentType 'application/json' -Body $translateBody

$learnBody = @{ text = 'reliable'; from = 'en'; to = 'zh-CN'; translation = '可靠的' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri https://fanyi.411081.xyz/api/learn -ContentType 'application/json' -Body $learnBody
```

再用真实浏览器完成以下人工验证：

1. 打开首页，确认文字翻译、学习卡片、历史记录和设置可用。
2. 允许麦克风，分别说中文与目标语言，确认最终稿方向、翻译和停止后的资源释放。
3. 共享一个正在播放人声的浏览器标签页，并在共享面板中勾选音频；确认没有音轨时页面不会伪装成已启动。
4. 静音 30 秒并播放纯背景噪声，确认不会生成点赞、关注、订阅或固定字幕模板。
5. 按 [会议音频指南](docs/MEETING-AUDIO.md) 建立 Teams Web 双通道路由，验证对方声音只显示给我、我的中文经翻译与 TTS 后进入 Teams 麦克风。
6. 关闭自动播报，确认不产生音频；重新开启后确认只有我方译文被送到会议输出，而且 TTS 不会再次被识别。

测试期间可另开终端查看 Worker 日志：

```powershell
npm run tail
```

## 7. 回滚

先列出可回滚版本，核对时间、Version ID 与提交记录：

```powershell
npx wrangler deployments list
```

确认目标后执行 Cloudflare 版本回滚：

```powershell
npx wrangler rollback <VERSION_ID> --message "rollback: v29 production regression" --yes
```

回滚后重新检查两个域名的 `/api/status`、核心翻译 API 和首页静态资源。Cloudflare 回滚恢复 Worker 版本，但不会自动修改 Git 分支；应另建修复提交保留历史，不要重写已共享的提交。

如果 Wrangler 无法回滚到目标版本，可从已验证的 Git 提交创建临时回滚分支，执行完整测试与 dry-run 后重新部署：

```powershell
git switch -c rollback/<date> <KNOWN_GOOD_COMMIT>
npm ci
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

不要在含未提交修改的工作树中切换提交。需要保留现场时，先使用新的 worktree 或新的干净检出目录。

## 8. 常见发布故障

**共享音频没有声音**

确认使用 Chrome/Edge，且在共享面板选择了支持音频的表面并勾选“共享音频”。`audio: true` 只是请求，不保证浏览器返回音轨。Teams 桌面窗口无音轨时改用整屏系统音频或虚拟回采设备。

**译音进入识别形成循环**

Teams 扬声器必须输出到物理耳机，Teams 麦克风才选择 `CABLE Output`；网页译音选择 `CABLE Input`。不要把会议播放和译音输出都接到同一条 Cable。

**翻译返回 403/429**

显式无密钥 Bing/Google 使用网页协议，可能受反滥用限制。Auto 会按配置对冲和降级；只有购买并配置官方服务才能获得对应厂商 SLA。

**部署后仍看到旧界面**

先检查 `/api/status` 和 `wrangler deployments list`。若 Worker 已更新但页面仍旧，检查 Service Worker/浏览器缓存并强制刷新，同时确认 `public/sw.js` 的缓存版本已随发布调整。
