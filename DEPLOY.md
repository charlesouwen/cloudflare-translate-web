# Cloudflare 部署指南

## 前置条件

1. [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
2. Node.js 18 或更高版本
3. 已将 `fanyi.411081.xyz` 和 `fanyi.92haohuo.cn` 的 DNS 托管到当前 Cloudflare 账号（自定义域名部署时需要）

## Wrangler 部署

在项目根目录执行：

```powershell
npm install
npx wrangler login
npx wrangler deploy --dry-run
npx wrangler deploy
```

`wrangler.toml` 已配置 Worker 名称、`public/` 静态资源、Workers AI binding 和自定义域名。部署后先检查：

```text
https://fanyi.92haohuo.cn/status
https://fanyi.92haohuo.cn/status?format=json
https://fanyi.92haohuo.cn/api/status
```

状态接口是被动的，不会因为打开页面再向三个上游发起翻译。它会显示平台是否已配置、是否进入 Auto，以及当前 Worker isolate 最近一次真实请求的成功、失败和延迟；刚启动且尚无请求时会明确显示“未验证”。

## 可选密钥配置（不是运行前提）

当前无密钥方案即可使用 Bing、Google Web RPC 和 Cloudflare AI，**不要求**配置 `MICROSOFT_TRANSLATOR_KEY` 或 `GOOGLE_TRANSLATE_API_KEY`。如果以后购买官方服务，可用以下 Secret 把相应路径升级为官方 API；密钥不要写入前端、`wrangler.toml` 或 Git：

```powershell
# Azure/Microsoft Speech Neural TTS
npx wrangler secret put MICROSOFT_SPEECH_KEY

# 可选：Azure/Microsoft Translator（配置后成为官方 Auto 主源）
npx wrangler secret put MICROSOFT_TRANSLATOR_KEY

# 可选：Google Cloud Translation v2（配置后替换无密钥 Google Web RPC）
npx wrangler secret put GOOGLE_TRANSLATE_API_KEY
```

Region 和 endpoint 可以在 Cloudflare Dashboard 的 Worker Variables 中设置，或写入本地未提交的 Wrangler 配置：

```text
MICROSOFT_SPEECH_REGION=eastasia
MICROSOFT_SPEECH_ENDPOINT=https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1
MICROSOFT_TRANSLATOR_REGION=<resource-region>
MICROSOFT_TRANSLATOR_ENDPOINT=https://api.cognitive.microsofttranslator.com
```

兼容别名也受支持：`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_ENDPOINT`、`AZURE_TRANSLATOR_KEY`、`AZURE_TRANSLATOR_REGION`、`AZURE_TRANSLATOR_ENDPOINT`。

### Azure Speech 免费额度和申请

Azure Speech 通常提供 F0 免费层（具体区域、价格和政策以 [官方定价页](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/) 为准）：

| 能力 | F0 常见额度 |
|---|---|
| Neural Text to Speech | 每月约 50 万字符 |
| Speech to Text / Real-time Transcription | 每月约 5 小时 |
| Speech Translation | 每月约 5 小时 |

申请流程：Azure Portal → 创建订阅 → 创建 `Speech Services` 资源 → 价格层选择 `F0 (Free)` → 在“密钥和终结点”复制 Key 与 Region → 用上面的 `wrangler secret put` 写入 Worker。Azure 账号可能要求绑定付款方式做身份验证；超出额度或选择 S0 等付费层会产生费用。当前 `/api/tts` 是公开代理，正式放入密钥前应增加鉴权和限流，防止他人消耗额度。

### 翻译 Auto 调度

- Web 客户端的 Auto 只向 Worker 发一个请求，不在客户端并发三个平台。
- Worker 有 `MICROSOFT_TRANSLATOR_KEY` 时以官方 Microsoft Translator 为主源；否则以 Bing Edge 为尽力而为的快速主源。
- 主源 300ms 内未完成时启动 Google：配置了可选 `GOOGLE_TRANSLATE_API_KEY` 时调用官方 Google Cloud，否则调用无密钥 Google Web RPC；再过 300ms 启动 Cloudflare AI。任一上游失败会立即启动下一层，Auto 总截止约 2.5 秒。
- 成功译文在单个 Worker isolate 内缓存 5 分钟；相同文本、语种、语气和路由的并发请求会合并成一次上游调用。
- 旧 `translate_a/single` GTX 因持续 `429` 已移除。无密钥 Google 改用现代 `batchexecute` / `MkEWBc` Web RPC 并进入 Auto；Auto 单次最多等待 2 秒，显式 Google 和 `/api/detect` 最多等待 4 秒，失败后熔断 60 秒。
- Google Web RPC 是未公开网页协议，状态页的“可用”表示最近被动观测正常且可参加 Auto，不代表官方 SLA。生产稳定性依赖 Bing/Google/Cloudflare 多源组合。

### Bing / Microsoft Translator 说明

- `provider=bing` 固定使用按 [plainheart/bing-translate-api](https://github.com/plainheart/bing-translate-api) 移植的 Bing 网页协议，不会因为配置了任何 Azure/Microsoft 密钥而改走官方 API。
- Worker 优先使用 plainheart 当前方案对应的 Edge 免费翻译端点；不可用时才动态请求 `bing.com/translator`，解析短期 `IG`、`IID`、token/key 并调用网页协议。代码不会固化或向前端暴露 token、Cookie。
- 该网页接口属于未公开的反滥用接口，可能返回 401/403/429 或验证码。显式 Bing 在 401/429 时只刷新会话并重试一次；未配置官方 Microsoft 凭据时，Auto 只把无需网页会话的 Bing Edge 端点作为快速主源。
- 配置 `MICROSOFT_TRANSLATOR_KEY` 后，Auto 会优先使用官方 Azure Translator；显式 `provider=bing` 仍固定调用 Bing 网页/Edge 实现，不会被密钥静默改义。
- 上游 npm 包依赖 Node.js `got`，不能原样打包到 Cloudflare Worker；本项目使用原生 `fetch` 重实现其协议逻辑。

### Bing 网页语音说明

`GET /api/tts?provider=bing&q=...&tl=...` 会尝试 Bing Translator 的匿名网页朗读，失败后自动降级到已配置的 Microsoft Speech，再降级到 Google TTS。该网页接口未公开且可能随时限流或变更；Bing 页面中的“非正式”控制翻译措辞，不是音色选择，匿名朗读也不提供可稳定锁定的女声 Voice ID。

## 本地开发

```powershell
npm run dev
```

访问 `http://localhost:8787`。Cloudflare AI、Whisper 和 Nova 仍需要有效的 AI binding/网络。Silero VAD、ONNX Runtime 和前端脚本均在 `public/` 中，会随 Wrangler 一起部署。

## 常见问题

**翻译请求返回 403/429？**

旧 GTX 的 `429` 不再代表当前 Google provider。未配置官方密钥时，Auto 使用 Bing Edge 主源、Google Web RPC 对冲和 Cloudflare AI 兜底；若 Google Web RPC 失败，会立即推进 Cloudflare 并将 Google 熔断 60 秒。密钥不是必需项，但只有购买官方 Microsoft/Google 服务才能获得相应厂商的正式 SLA。

**同声传译没有音频？**

麦克风模式需要浏览器权限；标签页模式必须在共享弹窗勾选“共享音频”。Firefox 对标签页共享音频支持有限，Edge/Chromium 通常更完整。浏览器 VAD 不可用时会回退到 MediaRecorder，但仍需要 Web Audio、MediaRecorder 和 WebAssembly。

**如何更新线上版本？**

修改代码后在根目录重新执行 `npx wrangler deploy`，再刷新 `/status?format=json` 确认版本号。
