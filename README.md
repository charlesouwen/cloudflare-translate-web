# 同声传译Pro

基于 Cloudflare Workers 的多引擎翻译 Web 应用，包含文字、图片、文档、拍摄翻译和双向同声传译。开发与生产版本均为 `translate-v28`；已于 2026-08-29 发布到 [fanyi.411081.xyz](https://fanyi.411081.xyz/) 和 `fanyi.92haohuo.cn`。

## 项目结构

```text
cloudflare-translate-web/
  src/                    Cloudflare Worker 后端
  public/                 Web/PWA 静态资源
  tests/                  Worker 与 Web 回归测试
  ARCHITECTURE.md         前后端架构说明
  DEPLOY.md               Worker 部署与回归说明
  OPEN_SOURCE_REVIEW.md   Google/Gemini 开源方案评估
  package.json
  package-lock.json
  wrangler.toml
```

## 主要能力

- Web/PWA 支持文字、图片 OCR、文档、摄像头和双向同声传译。
- 同传支持麦克风和标签页/系统音频，并以 Silero VAD、Nova-3 与 Whisper 完成实时稿和句末定稿。
- 最终译文可自动播报，标签页音频模式会关闭自动播报以避免回授。
- Web 客户端每句 Auto 只请求 Worker 一次。Worker 使用 Bing/Microsoft 主源、Google 对冲和 Cloudflare AI 兜底，总截止约 2.5 秒。
- Google 无需 API Key 即可通过现代 Web RPC 参与 Auto；失败后进入 60 秒熔断。该协议没有官方 SLA，稳定性来自多源对冲、超时、校验、缓存和熔断。
- `MICROSOFT_TRANSLATOR_KEY` 与 `GOOGLE_TRANSLATE_API_KEY` 都不是运行必需项，只是可选的官方增强路径。

## 本地验证

```powershell
npm install
npm test
npx wrangler deploy --dry-run
```

完整部署步骤见 [DEPLOY.md](DEPLOY.md)，架构与模块说明见 [ARCHITECTURE.md](ARCHITECTURE.md)。
