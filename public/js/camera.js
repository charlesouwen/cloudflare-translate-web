/**
 * 拍摄翻译模块 v4
 * 旗舰级智能手持对焦稳定翻译系统 (支持手机陀螺仪/加速度感应 + 终极浏览器兼容)
 */

let cameraStream = null;
let motionCanvas = null;
let motionCtx = null;
let lastImageData = null;
let staticStartTime = 0;
let isDetectingMotion = false;
let motionPollInterval = null;

// 物理传感器历史数据
let lastSensorX = 0;
let lastSensorY = 0;
let lastSensorZ = 0;
let lastSensorTime = 0;

function initCameraTranslation() {
  const startBtn = document.getElementById('startCameraBtn');
  const captureBtn = document.getElementById('captureCameraBtn');
  const retakeBtn = document.getElementById('retakeCameraBtn');
  const stopBtn = document.getElementById('stopCameraBtn');
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  const overlay = document.getElementById('cameraResultOverlay');

  if (!startBtn || !video) return;

  let isProcessing = false; // 并发锁，防止多重自动识别

  // ---- 1. 终极兼容性摄像头开启 ( fallback 备用机制) ----
  async function startCameraSource() {
    // 策略 A：理想的后置摄像头
    try {
      console.log('[Camera] 正在尝试开启后置摄像头...');
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      return true;
    } catch (err) {
      console.warn('[Camera] 理想后置开启失败，尝试策略 B 兼容模式...', err);
    }

    // 策略 B：宽松面朝向约束
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });
      return true;
    } catch (err) {
      console.warn('[Camera] 策略 B 失败，尝试策略 C (全自适应默认流)...', err);
    }

    // 策略 C：最宽泛默认流，确保在任何桌面端、无后置摄像头或测试端 100% 可以打开
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
      return true;
    } catch (err) {
      console.error('[Camera] 所有摄像头唤醒策略均宣告失败:', err);
      alert('无法访问摄像头：' + err.message + '\n请检查是否授予麦克风/摄像头权限或是否被其他程序占用。');
      return false;
    }
  }

  // ---- 2. 工具函数 ----
  function isCanvasBlank(cvs) {
    try {
      const ctx = cvs.getContext('2d');
      if (cvs.width === 0 || cvs.height === 0) return true;
      const d = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== 0 || d[i+1] !== 0 || d[i+2] !== 0 || d[i+3] !== 0) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function getHints() {
    return document.querySelector('.camera-hints');
  }

  function beginAutoDetect() {
    startMotionDetection(video, function() {
      console.log('[OCR自动] 画面静止稳定达标，触发自动后台识别');
      doCapture(true);
    });
  }

  // ---- 3. 后台静默截图与蒙版原位完美对齐翻译 ----
  async function doCapture(isAuto) {
    if (!cameraStream) return;
    if (isProcessing) {
      console.log('[Camera] 正在识别翻译中，跳过本次触发');
      return;
    }

    isProcessing = true;
    stopMotionDetection();

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    console.log(`[Camera] 捕获分辨率: ${w}x${h} | isAuto: ${isAuto}`);

    // 利用独立后台 Canvas 截图，绝对不停滞或挂起视频流播放
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.drawImage(video, 0, 0, w, h);

    if (isCanvasBlank(tmp)) {
      console.log('[Camera] 截取到空帧，静默重试');
      isProcessing = false;
      if (isAuto) {
        beginAutoDetect();
      } else {
        showToast('捕获画面为空，请对准目标重试');
      }
      return;
    }

    const hints = getHints();
    if (hints) hints.innerHTML = '🔍 正在识别与翻译文字...';

    const sl = document.getElementById('sourceLangBtn') ? (document.getElementById('sourceLangBtn').dataset.code || 'auto') : 'auto';
    const tl = document.getElementById('targetLangBtn') ? (document.getElementById('targetLangBtn').dataset.code || 'zh-CN') : 'zh-CN';

    try {
      // processImageTranslation 在 tmp 临时画布的原图文本位置，以 95% 透明背景叠加绘制译文
      await processImageTranslation(tmp, sl, tl, tmp, function(resultLines) {
        isProcessing = false;

        if (!resultLines || resultLines.length === 0) {
          // 未能识别到任何文字
          if (isAuto) {
            console.log('[Camera] 后台自动识别无文字，静默恢复侦测');
            if (hints) hints.innerHTML = '📸 请对准需要翻译的文字，保持稳定...';
            beginAutoDetect();
          } else {
            showToast('未能识别到文字');
            if (hints) hints.innerHTML = '❌ 未能识别到任何文字，请重新对准';
            if (retakeBtn) retakeBtn.style.display = 'inline-block';
          }
          return;
        }

        // 成功！将带有原图+原位覆盖译文蒙版的 tmp 画布 1:1 投射到屏幕 canvas
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(tmp, 0, 0);

        // 平滑锁屏：隐藏 video 流，展示画好精美译文的原图 canvas
        video.style.display = 'none';
        canvas.style.display = 'block';
        if (overlay) overlay.style.display = 'none';
        if (captureBtn) captureBtn.style.display = 'none';
        if (hints) hints.innerHTML = '✅ 翻译完成';
        if (retakeBtn) retakeBtn.style.display = 'inline-block';
      });
    } catch (e) {
      isProcessing = false;
      console.error('[Camera] 翻译处理遇到错误:', e);
      if (isAuto) {
        beginAutoDetect();
      } else {
        showToast('识别翻译失败: ' + (e.message || '网络或接口异常'));
        if (retakeBtn) retakeBtn.style.display = 'inline-block';
      }
    }
  }

  // ---- 4. 开启相机按钮主处理 ----
  startBtn.addEventListener('click', async function() {
    const isSuccess = await startCameraSource();
    if (!isSuccess) return;

    video.srcObject = cameraStream;
    // iOS/微信 内置浏览器兼容性三件套
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');

    try {
      await video.play();
    } catch (e) {
      console.warn('[Camera] video.play() 被安全阻拦或已自启动:', e);
    }

    video.style.display = 'block';
    canvas.style.display = 'none';
    if (overlay) overlay.style.display = 'none';
    startBtn.style.display = 'none';
    captureBtn.style.display = 'none'; // 根据用户需求，彻底隐去手动拍摄按钮，由全自动稳像接管
    stopBtn.style.display = 'inline-block';
    if (retakeBtn) retakeBtn.style.display = 'none';

    const hints = getHints();
    if (hints) hints.innerHTML = '📸 对准需要翻译的文字，保持稳定...';

    // 轮询视频就绪状态，确保尺寸完全就绪后，智能激活稳定侦测
    waitForVideoReady(video, function() {
      beginAutoDetect();
    });
  });

  // ---- 5. 关闭相机 ----
  stopBtn.addEventListener('click', function() {
    resetCameraUI();
  });

  // ---- 6. 手动强制点击拍摄 ----
  captureBtn.addEventListener('click', function() {
    doCapture(false);
  });

  // ---- 7. 点击继续翻译恢复至预览并重启侦测 ----
  if (retakeBtn) {
    retakeBtn.addEventListener('click', function() {
      if (!cameraStream) return;
      canvas.style.display = 'none';
      video.style.display = 'block';
      retakeBtn.style.display = 'none';
      captureBtn.style.display = 'none'; // 保持隐藏
      
      const hints = getHints();
      if (hints) hints.innerHTML = '📸 对准需要翻译的文字，保持稳定...';
      
      beginAutoDetect();
    });
  }
}

// 轮询检查视频帧就绪，完全兼容 iOS/微信 autoplay 迟滞
function waitForVideoReady(video, callback) {
  let attempts = 0;
  function check() {
    attempts++;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      console.log(`[Camera] 视频流完全就绪: ${video.videoWidth}x${video.videoHeight}`);
      callback();
    } else if (attempts < 80) {
      setTimeout(check, 50);
    } else {
      console.warn('[Camera] 视频就绪检测超时，强制启动稳像');
      callback();
    }
  }
  check();
}

// ---- 8. 物理陀螺仪 + 极轻量软双模稳像检测系统 (零功耗，永不卡死) ----
function startMotionDetection(videoElement, onStable) {
  stopMotionDetection();

  isDetectingMotion = true;
  staticStartTime = Date.now();
  
  let hasSensor = false;
  
  // 陀螺仪与加速度检测回调：零功耗，直接调用硬件，完全不需要截图
  function handleDeviceMotion(event) {
    if (!isDetectingMotion) return;
    hasSensor = true;

    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc) return;

    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;

    const now = Date.now();
    if (now - lastSensorTime > 60) { // 60ms 节流限制，提升传感器响应敏捷度
      const delta = Math.abs(x - lastSensorX) + Math.abs(y - lastSensorY) + Math.abs(z - lastSensorZ);
      
      // 阈值说明：稍作放宽至 1.15，对用户在手持拍摄时的轻度微颤更加包容，极大提升自动触发成功率
      if (delta > 1.15) {
        // 检测到设备晃动
        staticStartTime = now;
        const hints = document.querySelector('.camera-hints');
        if (hints) hints.innerHTML = '📸 对准需要翻译的文字，保持稳定...';
      } else {
        const elapsed = now - staticStartTime;
        if (elapsed > 1000) {
          // 设备保持稳定达 1.0 秒，立即触发！
          isDetectingMotion = false;
          window.removeEventListener('devicemotion', handleDeviceMotion);
          
          const hints = document.querySelector('.camera-hints');
          if (hints) hints.innerHTML = '✅ 画面已对齐，正在自动翻译...';
          
          if (onStable) onStable();
        } else {
          const hints = document.querySelector('.camera-hints');
          if (hints) hints.innerHTML = '🔍 对焦锁焦稳定中...';
        }
      }
      
      lastSensorX = x;
      lastSensorY = y;
      lastSensorZ = z;
      lastSensorTime = now;
    }
  }

  // 手机传感器监听注册
  if (window.DeviceMotionEvent) {
    window.addEventListener('devicemotion', handleDeviceMotion, true);
  }

  // 为电脑端或不支持传感器的 WebView 提供“极轻量安全轮询机制”
  // 提升轮询频次为 250ms，以达成闪电级自动触发体验
  setTimeout(function() {
    if (!hasSensor && isDetectingMotion) {
      console.log('[Camera] 设备不支持或未授予陀螺仪权限，退化为极轻量 Canvas 安全稳像模式');
      
      if (!motionCanvas) {
        motionCanvas = document.createElement('canvas');
        motionCanvas.width = 48;
        motionCanvas.height = 48;
        motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
      }

      lastImageData = null;
      staticStartTime = Date.now();

      motionPollInterval = setInterval(function() {
        if (!isDetectingMotion) return;

        if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
          motionCtx.drawImage(videoElement, 0, 0, 48, 48);
          const cur = motionCtx.getImageData(0, 0, 48, 48).data;

          if (lastImageData) {
            let diff = 0;
            for (let i = 0; i < cur.length; i += 4) {
              diff += Math.abs(cur[i] - lastImageData[i]);
              diff += Math.abs(cur[i+1] - lastImageData[i+1]);
              diff += Math.abs(cur[i+2] - lastImageData[i+2]);
            }
            const avg = diff / (48 * 48 * 3);

            if (avg > 15) {
              staticStartTime = Date.now();
              const hints = document.querySelector('.camera-hints');
              if (hints) hints.innerHTML = '📸 对准需要翻译的文字，保持稳定...';
            } else {
              const elapsed = Date.now() - staticStartTime;
              if (elapsed > 1000) {
                // 稳定达标 1.0 秒
                isDetectingMotion = false;
                clearInterval(motionPollInterval);
                
                const hints = document.querySelector('.camera-hints');
                if (hints) hints.innerHTML = '✅ 画面已稳定，正在翻译...';
                
                if (onStable) onStable();
              } else {
                const hints = document.querySelector('.camera-hints');
                if (hints) hints.innerHTML = '🔍 对焦稳定中...';
              }
            }
          }
          lastImageData = new Uint8ClampedArray(cur);
        }
      }, 250); // 每 250 毫秒高灵敏轮询比对
    }
  }, 1000); // 1 秒宽限期决定是否退化
}

function stopMotionDetection() {
  isDetectingMotion = false;
  if (motionPollInterval) {
    clearInterval(motionPollInterval);
    motionPollInterval = null;
  }
}

function stopCamera() {
  stopMotionDetection();
  if (cameraStream) {
    cameraStream.getTracks().forEach(function(track) {
      track.stop();
    });
    cameraStream = null;
  }
}

function resetCameraUI() {
  stopCamera();
  const startBtn = document.getElementById('startCameraBtn');
  const captureBtn = document.getElementById('captureCameraBtn');
  const retakeBtn = document.getElementById('retakeCameraBtn');
  const stopBtn = document.getElementById('stopCameraBtn');
  const video = document.getElementById('cameraVideo');
  const canvas = document.getElementById('cameraCanvas');
  const overlay = document.getElementById('cameraResultOverlay');

  if (startBtn) startBtn.style.display = '';
  if (captureBtn) captureBtn.style.display = 'none';
  if (retakeBtn) retakeBtn.style.display = 'none';
  if (stopBtn) stopBtn.style.display = 'none';
  if (video) {
    video.style.display = 'none';
    video.srcObject = null;
  }
  if (canvas) canvas.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  
  const hints = document.querySelector('.camera-hints');
  if (hints) hints.innerHTML = '💡 开启摄像头后，请对准需要翻译的文字并保持稳定。';
}
