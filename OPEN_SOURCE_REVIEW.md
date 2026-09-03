# 开源翻译项目评估

评估日期：2026-08-29。目标是提高当前 Cloudflare Worker 的翻译稳定性、准确性和首字速度，同时保持 Google 无密钥可用。

## 结论

这些项目没有提供一个同时满足“无密钥、官方 SLA、可长期稳定运行”的 Google 文本翻译接口。可复用的是工程模式，不是直接复制旧接口：保持单一连接状态、16 kHz PCM 分片、心跳与有界重连、响应结构校验、分段合并和 provider 隔离。

| 项目 | 主要路径 | 可借鉴点 | 不直接采用的原因 |
| --- | --- | --- | --- |
| [IFA-AP-01/gemini-live-translate-macos](https://github.com/IFA-AP-01/gemini-live-translate-macos) | Gemini Live 音频 WebSocket | PCM 分片、连接保活、串行状态、有界重连 | 需要 Gemini API Key；面向全双工音频，不是无密钥文本翻译源 |
| [kkdai/gemini-live-translate-macos](https://github.com/kkdai/gemini-live-translate-macos) | Gemini Live 音频 WebSocket | 实时会话与音频管线组织 | 同样需要 Key，成本和延迟模型不同 |
| [FaQxD233/gemini-live-translate](https://github.com/FaQxD233/gemini-live-translate) | Gemini Live 实时翻译 | 流式会话、断线恢复 | 不能替代当前无密钥 Google 文本 provider |
| [iSegaro/Translate-It](https://github.com/iSegaro/Translate-It) | Google GTX / 旧 `tk` 网页协议 | provider 隔离、响应校验、文本分段 | 仍依赖 `translate_a/single`；当前出口实测 `429` |
| [ssut/py-googletrans](https://github.com/ssut/py-googletrans) | Google Ajax 非官方接口 | HTTP 会话复用、批量处理 | 项目文档明确提示 IP 封禁与稳定性风险；底层仍是旧 Ajax 路径 |
| [matheuss/google-translate-api](https://github.com/matheuss/google-translate-api) | 旧 token 网页接口 | 简单 provider 封装 | token/endpoint 方案已过时，不适合 Worker 生产链路 |

## 当前采用的组合

1. 主源优先 Microsoft Translator（配置了可选密钥时），否则使用 Bing Edge 免费翻译路径。
2. 主源超过 300ms 时启动 Google：有可选 Google Cloud Key 时使用官方 API，否则使用 `TranslateWebserverUi` 的 `batchexecute` / `MkEWBc` Web RPC。
3. 再过 300ms 启动 Cloudflare AI；任一上游失败会立即推进下一层，Auto 总截止 2.5 秒。
4. Google Web RPC 在 Auto 中最多等待 2 秒；显式 Google 与语言检测最多等待 4 秒；失败后熔断 60 秒。
5. 所有返回值都做空值、HTML 错误页、异常长度和明显原文回声校验；成功译文按 isolate 缓存 5 分钟，相同在途请求合并。

Google Web RPC 属于未公开网页协议，可能随时变更或限流。它在状态页中可显示为可用并参加 Auto，但不能被描述为官方可用性承诺；真正的稳定性由多 provider 组合提供。

