# 翻译应用 — 完整架构与功能文档 (AI-Readable)

> **用途**：供 AI 智能体 / 开发者快速理解本项目结构，进行二次开发。

---

## 1. 技术栈

| 层级 | 技术 | 说明 |
|:---|:---|:---|
| 运行时 | Cloudflare Workers | 入口 `src/index.js` |
| 前端 | 原生 HTML/CSS/JS | 无框架，10 个模块化 JS 文件 |
| 翻译调度 | Microsoft/Bing + Google Web RPC/Cloud + CF AI | Auto 单请求进入 Worker；主源超过 300ms 启动 Google，再过 300ms 启动 CF AI，总截止 2.5s |
| 语音采集与分段 | `MediaRecorder` + `@ricky0123/vad-web` | 音轨就绪后立即录音；Silero VAD 后台增强，失败时回退到音量或定时分段 |
| 语音识别 | CF AI `@cf/openai/whisper-large-v3-turbo` | 滚动临时识别 + 句末完整音频定稿 |
| 同传语种检测 | `franc-min` | Whisper 未返回语种时在 Worker 内补齐双向语言判断，无额外网络请求 |
| 语义纠错引擎 | CF AI `@cf/meta/llama-3-8b-instruct` | 仅在用户开启“AI 校正”时处理最终句段，临时结果不调用 |
| 语音合成 | 浏览器 SpeechSynthesis + Google TTS 代理 | 双降级 |
| OCR | Tesseract.js v5 (CDN) | 前端运行，eng+chi_sim 精准按需单例加载 |
| PWA | Service Worker + manifest.json | 静态资源离线缓存 |

---

## 2. 文件索引

```
Translate/
├── src/index.js              # [后端] Worker 入口，6 个 API 路由
├── public/
│   ├── index.html            # [前端] 单页应用主 HTML
│   ├── manifest.json         # PWA 清单
│   ├── sw.js                 # Service Worker 缓存策略
│   ├── css/style.css         # 全局样式（暗色主题 + 移动端适配）
│   ├── vendor/               # 固定版本的 Silero VAD、ONNX 模型与 WASM 运行时
│   └── js/
│       ├── app.js            # 主入口：初始化、翻译事件、双向高亮、设置、历史面板
│       ├── translator.js     # 翻译核心：双引擎调度 + LRU 缓存(200条)
│       ├── interpreter.js    # 同声传译：Silero VAD/增量 STT/句末回改/翻译/TTS
│       ├── camera.js         # 拍摄翻译：摄像头控制 + 帧差运动检测 + 自动截取
│       ├── ocr.js            # 图片 OCR：Tesseract 加载/识别/45%蒙版渲染/中英互译
│       ├── tts.js            # TTS：浏览器优先 + Google 代理降级 + 队列
│       ├── tabs.js           # 标签页切换 + 图片上传 + 文档上传处理
│       ├── history.js        # 翻译历史 CRUD（localStorage, 500条上限）
│       ├── languages.js      # 100+ 语言列表 + 语言选择器 Modal
│       └── i18n.js           # 界面多语言包（zh-CN/zh-TW/en/ja）
├── tests/                    # Web 与 Worker 回归测试
├── OPEN_SOURCE_REVIEW.md     # 相关开源项目评估与采用结论
├── wrangler.toml             # Wrangler 配置（AI binding = "AI"）
├── package.json              # Wrangler、vad-web 与 onnxruntime-web 固定依赖
└── DEPLOY.md                 # 部署指南
```

**JS 加载顺序**（index.html 底部）：
`i18n → languages → translator → tts → history → ocr → ONNX Runtime → vad-web → interpreter → camera → tabs → app`

---

## 3. 后端 API 路由 (`src/index.js`)

| 路由 | 方法 | 功能 | 入参 | 返回 |
|:---|:---|:---|:---|:---|
| `/api/translate` | POST | 文字翻译（服务端稳定调度、缓存与同键请求合并） | `{text, sl, tl, provider?}` | `{translatedText, detectedLanguage, alternatives, engine, provider}` |
| `/api/translate/cf` | POST | 强制 CF AI 翻译 | `{text, sl, tl}` | 同上，`engine:"cloudflare"` |
| `/api/detect` | POST | 语言检测 | `{text}` | `{language}` |
| `/api/tts` | GET | TTS 语音合成代理 | `?q=text&tl=lang` | `audio/mpeg` 二进制 |
| `/api/stt` | POST | 临时/最终语音识别 (Whisper) | Binary audio + `X-Transcript-Mode` 等 Header | `{text, language, word_count, mode, corrected, processing_ms}` |
| `/api/proxy-page` | POST | 网页代理 | `{url}` | `{html, url}` |

---

## 4. 六大功能模块

### 4.1 文字翻译
- **核心函数**：`translator.js::translateText()` → 缓存检查 → 引擎调度
- **UI 入口**：`app.js::doTranslate()` → 渲染交互式行 `.trans-interactive-line`
- **双向高亮**：点击译文行 → `highlightTargetLine()` + `selectTextareaLine()` 反选原文行；点击原文光标位置 → 高亮对应译文行
- **Auto 调度**：有可选 Azure Translator 密钥时使用官方 Microsoft 主源，否则使用 Bing Edge；300ms 后启动 Google（有可选 Google Cloud Key 时走官方 API，否则走现代 Web RPC），再过 300ms 启动 Cloudflare AI。任一上游失败会立即推进下一层，总截止 2.5 秒。
- **Google 边界**：不再调用持续 `429` 的旧 `translate_a/single` GTX。无密钥路径使用 `TranslateWebserverUi` 的 `batchexecute` / `MkEWBc` RPC，Auto 超时 2 秒，显式 Google 和语种检测超时 4 秒，失败熔断 60 秒。
- **稳定性边界**：无密钥 Google Web RPC 与 Bing Edge 都没有官方 SLA。项目不要求 `MICROSOFT_TRANSLATOR_KEY` 或 `GOOGLE_TRANSLATE_API_KEY`；可选密钥只会把相应路径升级为官方接口。成功结果缓存 5 分钟，相同在途请求只执行一次。

### 4.2 图片翻译
- **上传入口**：`tabs.js::handleImageFile()` → 拖拽或点击上传
- **处理链**：`ocr.js::processImageTranslation(file, sl, tl, canvas, callback)`
- **OCR**：`ocrImageWithPositions()` 当用户指定源语言（非 auto）时仅加载单一精确语言包（如 `eng`），auto 时才加载 `eng+chi_sim` 混合包，大幅度提高识别精度。
- **低置信度过滤**：丢弃置信度低于 40 的识别行与单字符噪声，彻底消除乱码。
- **渲染**：`renderTranslatedOverlay()` Canvas 绘制 30% 透明度蒙版。通过 CSS 缩放比率（canvas.clientWidth / canvas.width）自适应校正蒙版坐标，确保蒙版覆盖位置绝对贴合无偏差。
- **智能互译**：逐行检测，含中文→英译，非中文→中译

### 4.3 文档翻译
- **入口**：`tabs.js::handleDocumentFile()`
- **支持格式**：.txt / .html / .htm
- **逻辑**：按 `\n` 拆段，逐段调用 `translateText()`，左右栏对照

### 4.4 拍摄翻译
- **入口**：`camera.js::initCameraTranslation()`
- **摄像头**：`getUserMedia({ facingMode: 'environment' })`
- **自动截取**：`startMotionDetection()` 帧差法，静止 1.5s 触发截取
- **继续翻译**：翻译完成后显示 `retakeCameraBtn`，重新进入预览

### 4.5 同声传译
- **入口**：`interpreter.js::initInterpreter()`
- **音频来源**：麦克风或 `getDisplayMedia()` 标签页/系统音频；共享面板声明 `systemAudio` / `windowAudio` 提示并兼容性降级。共享流无音轨时自动查找 Stereo Mix、VB-Cable、BlackHole 等系统回采输入设备。
- **采集主链路**：浏览器返回可用音轨后立即启动 `MediaRecorder`，不等待模型下载、初始化或权限之外的异步任务。
- **断句降级**：Silero VAD v5 在后台增强句末判断；加载失败时使用自适应音量分段，Web Audio 也不可用时使用 4 秒定时分段，录音本身不会被增强组件阻塞。
- **微噪过滤**：麦克风启动时校准底噪；VAD 误触发或累计有效声音不足 150ms 的片段直接丢弃，不进入 Whisper 队列。
- **音频模式**：连续读取 16 kHz PCM，不依赖 Silero 断句；Nova-3 WebSocket 持续返回临时文本，连续约 3 秒无结果时自动启用 Whisper 临时兜底。Whisper 按 12 秒窗口完整定稿并保留 2.5 秒跨段重叠，最终稿结合 Nova 与 Whisper 两份候选做受约束的共识校正。标签页原始音频由浏览器高质量重采样并做立体声居中混合，避免固定滤波器误伤音轨频谱；重叠文本在渲染前去重。
- **实时字幕**：对话讲话超过约 0.8 秒后开始识别；音频模式由 Nova-3 流式返回首屏文本，Whisper 在后台以较长音频上下文持续回改。识别和翻译异步解耦，翻译按 550ms 节流合并更新，临时结果始终原位覆盖，不追加重复气泡。
- **句末回改**：VAD 返回完整句段后重新执行最终 Whisper，覆盖临时原文，并重新翻译整句；连续语音最长 12 秒自动续段。
- **请求控制**：每句最多一个临时识别在途，多余更新合并为最新快照；最终识别最多并发 2 个、队列上限 8 个，所有请求有超时和版本校验。
- **说话方判定**：用户可选自动双向/固定我方/固定对方。自动模式优先使用 Whisper 语种，再按文字脚本和 `franc-min` 补齐检测；我方语言始终译为对方语言，对方语言始终译为我方语言。
- **AI 校正**：默认关闭，只对最终结果可选调用 Llama 3；临时识别不走 LLM，避免额外延迟和改写。
- **ASR 传输**：PCM 通过标准 16-bit WAV 发送；Worker 校验 6 MiB 上限后 Base64 编码给 Workers AI。Whisper 的 `initial_prompt` 仅传真实的上一段转写上下文；音频模式最终稿使用更宽的 beam search，并放宽重复文本过滤阈值。
- **分边**：我方语言=右侧蓝色气泡，对方=左侧白色气泡
- **翻译回改**：统一调用 `translateText()`，旧翻译用 AbortSignal 取消并通过版本号阻止晚到覆盖；不再使用打字机延迟。
- **TTS**：最终译文才允许自动播报，标签页音频模式强制关闭自动播报以避免回授。
- **Web 回声抑制**：麦克风模式会记录已播报译文的文本指纹，并结合播放时间窗抑制扬声器回声；标签页音频模式关闭自动播报以避免回授。
- **导出**：`exportInterpreterMessages()` 生成文本文件

### 4.6 TTS 语音朗读
- **文件**：`tts.js`
- **策略**：浏览器 SpeechSynthesis 优先 → Google TTS `/api/tts` 降级
- **长文本**：按 200 字分段顺序播放
- **队列**：`queueSpeak()` 防止重叠

---

## 5. 数据存储 (localStorage)

| Key | 模块 | 内容 |
|:---|:---|:---|
| `translate_sl` | app.js | 源语言代码 |
| `translate_tl` | app.js | 目标语言代码 |
| `translate_engine` | translator.js | 引擎选择 (auto/google/cloudflare) |
| `translate_history` | history.js | 翻译历史 JSON 数组 (≤500条) |
| `translate_favorites` | history.js | 收藏ID数组 |
| `translate_recent_langs` | languages.js | 最近使用语言 (≤5个) |
| `translate_ui_lang` | i18n.js | 界面语言 |
| `translate_theme` | app.js | 主题 (light/dark/system) |
| `interp_my_lang` / `interp_their_lang` | interpreter.js | 同传双方语言 |
| `interp_audio_source` | interpreter.js | `microphone` / `system` |
| `interp_content_mode` | interpreter.js | `conversation` / `music`（界面显示“对话”/“音频”） |
| `interp_speaker_direction` | interpreter.js | `auto` / `mine` / `theirs` |
| `interp_direction_mode_version` | interpreter.js | 新版“自动双向/固定方向”设置迁移版本 |
| `interp_ai_correction` | interpreter.js | 最终句段是否启用 LLM 校正 |
| `interp_autoplay_enabled` | interpreter.js | 最终译文自动播报 |

---

## 6. 模块通信约定

- 各模块通过 `window` 全局函数通信（如 `window.stopInterpreter`、`window.speakText`、`window.exportInterpreterMessages`）
- 翻译统一经由 `translateText()` 单一入口
- 所有 API 调用通过 Worker 反代，前端不直接请求外部服务

---

## 7. 二次开发指南

| 需求类型 | 修改文件 | 接入方式 |
|:---|:---|:---|
| 新增后端 API | `src/index.js` | 在 `switch(true)` 中新增 `case` |
| 新增翻译模式 Tab | `index.html` + `tabs.js` | 新增 `tab-btn` + `tab-panel`，更新 `TABS` 数组 |
| 新增语言 | `languages.js` + `src/index.js` | `LANGUAGES` 数组 + `LANG_MAP_TO_M2M` 映射 |
| 新增界面语言 | `i18n.js` | `LOCALES` 对象新增语言包 |
| 修改 OCR/图片翻译 | `ocr.js` | `processImageTranslation()` 是完整入口 |
| 修改同传逻辑 | `interpreter.js` | `queueInterimRecognition()` / `finalizeUtterance()` 是两阶段处理入口 |
| 修改样式/主题 | `css/style.css` | CSS 变量在 `:root` 和 `[data-theme="dark"]` |

---

## 8. 部署命令

```bash
npm install          # 安装依赖
npm run dev          # 本地开发 http://localhost:8787
npx wrangler deploy  # 部署到 Cloudflare
npx wrangler tail    # 查看实时日志
```
