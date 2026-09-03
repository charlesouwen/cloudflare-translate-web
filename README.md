# 同声传译 Pro

基于 Cloudflare Workers 的多引擎翻译 Web/PWA，提供文字、图片 OCR、文档、拍摄翻译、学习卡片和双向同声传译。

当前源码目标版本为 `translate-v29`。线上版本以 [`/api/status`](https://fanyi.411081.xyz/api/status) 返回的 `version` 为准，不能仅依据本文件判断是否已经部署。

## v29 重点能力

- 学习模式通过独立的 `/api/learn` 获取音标、释义、例句和近义词；学习请求失败不会影响基础翻译。
- 同传支持麦克风、浏览器共享音频和会议双通道。共享音频来自浏览器的系统选择面板，每次启动都必须由用户重新选择并授权。
- 会议双通道将对方的标签页/系统音频与我方物理麦克风分开识别，避免依赖混合音轨猜测说话方。
- Fusion 模式使用 Bing 实时稿和 Whisper 最终稿；静音证据、固定字幕幻觉、语种和脚本一致性共同约束最终结果。
- 最终译文可关闭自动播报。会议模式只允许我方译文自动播报，并在播放期间暂停冲突采集，防止译音再次进入识别链路。
- 支持选择麦克风和译音输出设备。兼容浏览器可将服务端 TTS 音频定向到 VB-CABLE、VoiceMeeter 等虚拟播放设备。
- 翻译 Auto 由 Worker 统一调度 Bing/Microsoft、Google 和 Cloudflare AI，客户端每次只发一个翻译请求。

## Teams 能力边界

网页可以捕获用户主动共享的浏览器标签页或 Windows 系统音频，但不能绕过共享面板、不能永久保存屏幕共享权限，也不能直接注册成 Teams 麦克风。窗口音频是否存在由浏览器、操作系统和被选应用共同决定；选择屏幕区域不能只截取该区域对应的声音。

Teams Web 推荐使用耳机和虚拟音频设备：

```text
网页译音输出 -> CABLE Input
Teams 麦克风 -> CABLE Output
Teams 扬声器 -> 物理耳机
Teams 标签页音频 -> 网页的对方通道
物理麦克风 -> 网页的我方通道
```

`CABLE Input` 是 Windows 的播放端，`CABLE Output` 是 Teams 选择的录音端。网页不能代替用户修改 Teams 的设备设置。完整设置、隐私说明和故障排查见 [会议音频指南](docs/MEETING-AUDIO.md)。

## 浏览器要求

- 普通文字翻译支持现代桌面和移动浏览器。
- 麦克风、共享音频和输出设备选择都要求 HTTPS；`localhost` 可用于本地开发。
- Windows 上建议使用最新稳定版 Chrome 或 Edge。它们对标签页音频和整机系统音频支持最完整。
- Firefox、Safari、移动浏览器和企业策略管理的浏览器可能只能使用部分同传能力，界面必须按实际返回的音轨和 API 能力降级。

## 项目结构

```text
cloudflare-translate-web/
  src/                    Cloudflare Worker 后端
  public/                 Web/PWA 静态资源
  tests/                  Worker 与 Web 回归测试
  docs/MEETING-AUDIO.md   Teams 与系统音频设置指南
  ARCHITECTURE.md         前后端架构和接口兼容说明
  DEPLOY.md               测试、部署、验证与回滚
  CHANGELOG.md            版本变更记录
  wrangler.toml
  package.json
```

`node_modules/`、Wrangler 临时目录、小程序源码和比赛材料均不属于此 Web 仓库的发布内容。

## 本地验证

```powershell
npm ci
npm test
npx wrangler deploy --dry-run
```

开发服务器：

```powershell
npm run dev
```

详细模块说明见 [ARCHITECTURE.md](ARCHITECTURE.md)，生产发布和回滚步骤见 [DEPLOY.md](DEPLOY.md)。
