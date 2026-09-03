# 翻译应用 v29 架构说明

本文描述 `translate-v29` 的源码目标。生产环境是否已经运行该版本，应以 `/api/status` 返回的 `version` 为准。

## 1. 设计目标与边界

- 一个 Cloudflare Worker 同时提供静态 Web/PWA、翻译、学习、语音识别和语音合成能力。
- 同一套公开 API 保持向后兼容；Web 增强不能改变现有小程序的路径、必填字段或返回字段含义。
- 实时稿追求低延迟，最终稿追求稳定；最终稿可以覆盖同一气泡中的实时稿，但不能追加重复内容。
- 采集来源、内容类型和说话方向是三个独立维度。共享 PC 音频不再自动等同于音乐。
- 浏览器只处理用户主动授权的音频。网页不能绕过系统共享面板，也不能创建 Windows 虚拟麦克风。

## 2. 系统组成

| 层级 | 主要实现 | 职责 |
|:---|:---|:---|
| Web/PWA | 原生 HTML、CSS、JavaScript | 交互、媒体权限、音频分段、实时字幕、历史和学习卡片 |
| 边缘入口 | Cloudflare Workers | API 路由、输入校验、超时、缓存、上游调度和静态资源 |
| 翻译 | Microsoft/Bing、Google、Cloudflare AI | Auto 对冲、显式引擎和失败降级 |
| 实时 ASR | Bing Speech WebSocket | 低延迟临时识别；会议通道使用固定语种减少误判 |
| 最终 ASR | Workers AI `whisper-large-v3-turbo` | 句末定稿、语言方向确认和静音/幻觉过滤 |
| VAD | Silero VAD + 音量门控 | 对话断句、短噪声过滤和无模型降级 |
| TTS | Bing Neural、Microsoft Speech、Google、浏览器语音 | 译文播报、队列和兼容性降级 |
| 本地数据 | `localStorage` + 会话内存 | 用户偏好、文字历史；原始音频不做持久化 |

```text
Web/PWA
  |-- POST /api/translate ------> 翻译调度与缓存
  |-- POST /api/learn ----------> 学习卡片
  |-- POST /api/stt ------------> Whisper 最终识别
  |-- WS   /api/stt/live -------> Workers AI 实时识别降级
  |-- WS   Bing Speech ---------> 实时识别
  `-- GET/POST /api/tts --------> 可路由的音频播报
```

## 3. 文件索引

```text
Translate/
├── src/
│   ├── index.js                 # Worker 入口、翻译、学习、STT、TTS 和状态
│   └── bing-live-api.js         # Bing 实时翻译、语音配置、词典和语音服务
├── public/
│   ├── index.html               # 主单页应用
│   ├── sw.js                    # PWA 缓存
│   ├── css/style.css            # 全局和同传界面样式
│   ├── vendor/                  # Silero、ONNX Runtime 和 WASM 固定资源
│   └── js/
│       ├── app.js               # 初始化、文字翻译和学习卡片
│       ├── translator.js        # Web 翻译入口和客户端缓存
│       ├── interpreter.js       # 采集、双通道、ASR、翻译和 TTS 编排
│       ├── interpreter-echo.js  # 可测试的文本回声分类器
│       ├── tts.js               # 普通页面朗读和队列
│       ├── history.js           # 翻译历史与收藏
│       ├── camera.js            # 摄像头翻译
│       ├── ocr.js               # 图片 OCR
│       ├── tabs.js              # 功能页切换和文件导入
│       ├── languages.js         # 语言目录
│       └── i18n.js              # 界面语言
├── tests/                       # Web 与 Worker 回归测试
├── docs/MEETING-AUDIO.md        # Teams 和虚拟音频设备指南
├── README.md
├── DEPLOY.md
├── CHANGELOG.md
└── wrangler.toml
```

主页面脚本加载顺序为：`i18n -> languages -> translator -> tts -> history -> ocr -> ONNX Runtime -> vad-web -> interpreter-echo -> interpreter -> camera -> tabs -> app`。

`public/interpreter/` 是可直接访问的独立工作台。修改同传能力时必须确认它与主页面的功能边界，避免两套入口行为互相矛盾。

## 4. API 与兼容契约

| 路径 | 方法 | 主要输入 | 主要输出 |
|:---|:---|:---|:---|
| `/api/translate` | POST | `{text, sl/from, tl/to, provider?, tone?}` | 译文、检测语种、引擎和可选结果 |
| `/api/translate/cf` | POST | `{text, sl, tl}` | Cloudflare AI 译文 |
| `/api/learn` | POST | `{text, from/sl, to/tl, translation?}` | 音标、词义、例句、近义词和降级标志 |
| `/api/detect` | POST | `{text}` | `{language}` |
| `/api/tts` | GET | `q`、`tl`、`provider?`、`rate?` | `audio/mpeg` |
| `/api/tts` | POST | `{text, lang, voiceName?, rate?}` | TTS 音频 |
| `/api/stt` | POST | 二进制音频和 `X-*` 元数据 | 文本、语种、方向、置信度和处理耗时 |
| `/api/stt/live` | WebSocket | 16-bit PCM | 实时识别事件 |
| `/api/status` | GET | 无 | 版本、绑定和最近的被动健康状态 |
| `/api/health`、`/api/languages`、`/api/voices`、`/api/speech-config` | GET | 查询参数 | Bing 实时能力配置 |
| `/api/dictionary`、`/api/examples`、`/api/correct`、`/api/phrasebook` | POST | JSON | 词典和语言辅助数据 |

### 小程序兼容原则

- 不删除或改名现有路由。
- 不把原有可选字段改为必填字段。
- `sl/tl` 与 `from/to` 等已有别名继续接受。
- 新增 STT 证据只使用可选 Header，例如 `X-Audio-Voiced-Ms` 和 `X-Audio-Peak`；旧客户端不发送时按原流程处理。
- 返回对象只做附加字段扩展，既有字段的类型和含义保持稳定。
- 每次发布必须运行 Worker 合约测试，避免 Web 优化影响小程序。

## 5. 文字翻译与学习模式

Web 的 `translateText()` 将请求发送到 `/api/translate`。Auto 模式在 Worker 内部完成主源、延迟对冲、总截止、结果校验、五分钟缓存和相同在途请求合并，客户端不会同时请求多个平台。

学习模式在基础翻译完成后独立请求 `/api/learn`：

- 仅处理不超过 80 个字符的单词或短语。
- Workers AI 可用时返回结构化学习信息；不可用时至少保留原词和基础译文。
- 学习请求有独立的取消、缓存和错误状态，不会把基础翻译改成失败。
- 用户关闭学习模式后不发送学习请求。

## 6. 同声传译架构

### 6.1 工作模式

| 模式 | 主音频 | 方向 | 自动播报策略 |
|:---|:---|:---|:---|
| 麦克风 | `getUserMedia()` 选择的输入设备 | 自动双向、固定我方或固定对方 | 用户控制 |
| 共享音频 | `getDisplayMedia()` 返回的音轨；无音轨时尝试回采输入 | 用户控制 | 首次切换默认关闭，用户可明确开启 |
| 会议双通道 | 对方共享音频 + 所选我方 `audioinput`（通常为物理麦克风） | 对方通道固定 `theirs`，我方输入固定 `mine` | 只允许我方译文自动播报 |

“内容模式”独立于上述来源：

- `conversation` 用于会议、访谈、课程和影视对白，启用 VAD 与严格静音/字幕幻觉过滤。
- `music` 仅用于歌曲或需要保留连续音频的场景，使用滚动窗口和重叠去重。
- 会议双通道固定使用 `conversation`。

### 6.2 捕获与权限

我方输入通过 `getUserMedia()` 获取，可以是浏览器列出的任意 `audioinput`；推荐选择物理麦克风。语音场景会请求回声消除、降噪、自动增益和单声道，高级约束失败时回退到浏览器默认音频配置。网页无法可靠判断一个输入是物理设备还是虚拟设备。

标签页、窗口和屏幕音频通过 `getDisplayMedia()` 获取：

- 浏览器必须展示自己的选择面板；页面只能给出 `systemAudio`、`windowAudio` 等提示，不能强制选择某个应用。
- 调用必须发生在用户操作中，每次启动都要重新授权，权限不能持久复用。
- 返回流必须实际包含可用音轨。`audio: true` 不保证所选表面有声音。
- 当前增强参数请求 `restrictOwnAudio: true` 与 `suppressLocalAudioPlayback: false`。前者是兼容浏览器的尽力而为限制；后者明确保留被共享原声的本地播放，使用户仍可通过耳机听到对方。两者都不能替代正确的系统音频路由。
- 无共享音轨时会查找 Stereo Mix、VB-CABLE、VoiceMeeter、BlackHole 等被系统暴露为 `audioinput` 的回采设备。为避免把 TTS 出站音频再次当作对方输入，自动回采可能拒绝与当前译音输出同组的设备；没有其他安全输入时应让启动失败并要求用户重新选择来源。

普通网页不能把一个 `audiooutput` 扬声器直接当成输入，也不能注册新的 Windows 麦克风。精确的进程级 WASAPI 回采需要原生程序，不属于 Cloudflare Web 的能力范围。

### 6.3 双通道数据流

```text
对方通道
Teams 标签页/系统共享音轨
  -> 音量/VAD 门控
  -> 固定对方语种的实时稿
  -> Whisper 最终稿
  -> 翻译为我的语言
  -> 屏幕显示，不发送到会议输出

我方通道
所选我方 audioinput（通常为物理麦克风）
  -> 独立底噪校准和断句
  -> 固定我的语种
  -> Whisper 最终稿
  -> 翻译为对方语言
  -> TTS -> 所选音频输出 -> 虚拟音频设备 -> Teams 麦克风
```

两个通道拥有独立音轨和断句状态，但共享有上限的最终识别队列、翻译调度和消息时间线。固定通道方向可以减少双语模型竞争，也避免把会议中的远端语音当成我方回复。

### 6.4 识别、断句与幻觉过滤

- 音轨就绪后立即启动录音；Silero VAD 在后台增强，失败时使用自适应音量门控，再失败则停止或进入有限的定时降级。
- 讲话达到最短时长和峰值后才提交；音乐滚动窗口也必须先通过客户端声音证据检查。
- Bing 提供实时稿；Bing 正常返回时不重复发送高频 Whisper 临时请求。Whisper 在句末处理完整上下文。
- Web 把有效语音毫秒数和峰值作为可选 Header 发送。Worker 还会直接检查 PCM WAV 的 RMS/峰值，纯静音优先于模型文本。
- 固定字幕语料、点赞/关注/订阅模板、无语音概率、低对数概率、重复压缩比和脚本冲突共同决定是否丢弃结果。
- 只有有声学证据的历史最终稿才能进入下一段上下文；被判定为幻觉的文本不得翻译、播报或进入提示词。
- AI 校正只允许在用户开启后处理最终句段，并受到保守相似度约束，不能将原文改写成译文或新内容。

### 6.5 TTS 与回声保护

同传播报优先获取服务端音频并交给持久的 `HTMLAudioElement`。浏览器支持 `setSinkId()` 时，可把该元素定向到用户选择的输出设备。选择非默认输出后，不能回退到无法指定输出设备的 `speechSynthesis`，否则译音可能从错误扬声器播放。

保护链分为四层：

1. 会议模式只把我方译文送到会议输出，对方译文默认只显示。
2. 开始 TTS 时暂停冲突通道的 PCM、VAD 和实时识别，并丢弃正在形成的回声片段。
3. 播放结束后保留短暂恢复窗口；系统回采使用更长的窗口。
4. 最终转写再与近期 TTS 文本指纹比较，删除纯回声或从混合文本中移除播放片段。

该策略为了安全会在播报期间形成短暂半双工窗口。使用耳机和独立虚拟音频设备可以显著降低漏掉同时讲话的概率，但浏览器内的文本回声过滤不能替代正确的设备路由。

## 7. Teams 与输出路由

推荐拓扑详见 [docs/MEETING-AUDIO.md](docs/MEETING-AUDIO.md)。核心约定是：

- 网页 TTS 输出选择 `CABLE Input`。
- Teams 麦克风选择 `CABLE Output`。
- Teams 扬声器选择物理耳机，不能选择同一条 Cable。
- Teams Web 优先共享 Teams 所在标签页并开启标签页音频。
- 一条 VB-CABLE 不能同时承担“网页 TTS 出站到 Teams”和“Teams 远端声音回采到网页”；两个方向需要独立总线。
- Teams 桌面版窗口音频不可靠时，改用整屏系统音频、Stereo Mix，或使用 VoiceMeeter 配置独立的远端回采与 TTS 出站总线。

共享“窗口”不代表浏览器一定只返回该进程的声音；当前实现必须依据实际返回音轨运行，不能仅根据用户在选择框中看到的表面类型判断成功。

## 8. 数据、隐私与生命周期

- 麦克风和共享流只在同传运行期间存在；停止同传、离开面板或音轨结束时应停止所有轨道、录音器、处理节点、WebSocket 和 TTS 队列。
- 原始音频仅在内存中分段并通过 HTTPS/WSS 发送给 Worker、Workers AI 或所选语音服务，本项目不配置 R2/KV/数据库保存录音。
- 浏览器共享整个屏幕音频时，通知和其他应用声音也可能进入识别服务。机密会议必须先得到组织和参会者允许。
- 文字翻译历史和设备偏好保存在当前浏览器的 `localStorage`；清理站点数据会删除这些本地信息。
- Cloudflare、Microsoft/Bing、Google 和 Teams 各自的日志、保留和企业策略不由本仓库控制，生产使用前应单独审查相应条款。

## 9. 本地状态键

| Key | 含义 |
|:---|:---|
| `translate_sl` / `translate_tl` | 文字翻译语言 |
| `translate_engine` | 翻译引擎偏好 |
| `translate_history` / `translate_favorites` | 本地历史和收藏 |
| `translate_learning` | 学习模式开关 |
| `interp_my_lang` / `interp_their_lang` | 同传双方语言 |
| `interp_audio_source` | `microphone` / `system` / `meeting` |
| `interp_content_mode` | `conversation` / `music` |
| `interp_speaker_direction` | `auto` / `mine` / `theirs` |
| `interp_ai_correction` | 最终稿 AI 校正开关 |
| `interp_autoplay_enabled` | 自动播报开关 |
| `interp_input_device` | 用户选择的麦克风设备 ID |
| `interp_output_device` | 用户选择的译音输出设备 ID |
| `interp_voice_name` / `interp_tone` | 语音和翻译语气偏好 |

设备 ID 可能在权限撤销、系统重装或浏览器隐私轮换后失效。启动时必须重新枚举并回退到默认设备。

## 10. 修改与验证入口

| 需求 | 主要文件 | 必测内容 |
|:---|:---|:---|
| 翻译路由 | `src/index.js`、`translator.js` | Auto 对冲、缓存、显式 provider、旧字段兼容 |
| 学习模式 | `src/index.js`、`app.js` | 关闭时零请求、超时降级、结构化输出 |
| 音频采集 | `interpreter.js` | 权限拒绝、无音轨、设备掉线、资源释放 |
| 幻觉过滤 | `src/index.js`、`interpreter.js` | 静音、字幕模板、合法相似句、系统来源 |
| 回声保护 | `interpreter.js`、`interpreter-echo.js` | 纯回声、混合发言、否定句、播放后延迟最终稿 |
| Teams 路由 | `index.html`、`interpreter.js` | 双通道方向、只播我方、`setSinkId()`、Cable 拔插 |
| PWA | `sw.js` | 新旧资源缓存、刷新和离线降级 |

测试、部署、线上验证和回滚流程见 [DEPLOY.md](DEPLOY.md)。
