(() => {
  const SIGNAL_TYPE = "MAHJONG_HCI_GAME_END";
  const FER_INTERVAL_MS = 500;

  let modalOpen = false;
  let modelLoadPromise = null;

  const loadModels = () => {
    if (modelLoadPromise) return modelLoadPromise;
    const base = chrome.runtime.getURL("models");
    modelLoadPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceExpressionNet.loadFromUri(base),
    ]);
    return modelLoadPromise;
  };

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== SIGNAL_TYPE) return;
    if (modalOpen) return;
    openModal();
  });

  window.addEventListener("keydown", (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.shiftKey && (ev.key === "M" || ev.key === "m")) {
      ev.preventDefault();
      if (!modalOpen) {
        console.log("[mahjong-hci] debug trigger");
        openModal();
      }
    }
  }, true);

  // Tiltometer FER formula (facial-only variant)
  const formulateTilt = (expr) => {
    let tilt = 0.0;
    tilt += expr.angry;
    tilt += expr.sad * 0.2;
    tilt -= expr.happy;
    const threshold = 0.1;
    if (
      expr.happy - threshold >= expr.angry &&
      expr.happy - threshold >= expr.sad
    ) {
      tilt -= expr.surprised;
    }
    if (
      expr.angry - threshold > expr.happy ||
      expr.sad - threshold > expr.happy
    ) {
      tilt += expr.surprised;
    }
    return tilt;
  };

  const openModal = async () => {
    modalOpen = true;

    const host = document.createElement("div");
    host.id = "mahjong-hci-host";
    const shadow = host.attachShadow({ mode: "open" });

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("src/modal.css");
    shadow.appendChild(link);

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <div class="stage stage-check">
          <h2>今、熱くなっていませんか？</h2>
          <div class="media">
            <video autoplay playsinline muted></video>
          </div>
          <div class="tilt" hidden>
            <div class="tilt-header">
              <span class="tilt-label">Tilt</span>
              <span class="tilt-value">—</span>
            </div>
            <div class="tilt-bar"><div class="tilt-bar-fill"></div><div class="tilt-bar-center"></div></div>
            <div class="tilt-status">モデルを読み込み中…</div>
          </div>
          <p class="error" hidden></p>
          <div class="actions">
            <button class="stop" type="button">もうやめる</button>
            <button class="continue primary" type="button">続ける</button>
          </div>
        </div>

        <div class="stage stage-choice" hidden>
          <h2>おつかれさまでした</h2>
          <p class="subtitle">このあとはどうしますか？</p>
          <div class="actions vertical">
            <button class="quit primary" type="button">今日は終わりにする</button>
            <button class="review" type="button">牌譜を検討する</button>
          </div>
        </div>

        <div class="stage stage-review" hidden>
          <h2>対局は終わりにして、牌譜を検討しましょう</h2>
          <p class="subtitle">今日のプレイをふりかえることで、冷静な視点が戻ってきます。</p>
          <div class="actions">
            <button class="dismiss primary" type="button">閉じる</button>
          </div>
        </div>

        <div class="stage stage-quit" hidden>
          <h2>今日はここまで。おつかれさまでした</h2>
          <p class="subtitle">このタブを閉じて、他の楽しいことをしましょう。散歩・音楽・おいしいもの、なんでも。</p>
          <div class="actions">
            <button class="dismiss-quit primary" type="button">閉じる</button>
          </div>
        </div>
      </div>
    `;
    shadow.appendChild(overlay);
    document.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    const video = $("video");
    const errorEl = $(".error");
    const stageCheck = $(".stage-check");
    const stageChoice = $(".stage-choice");
    const stageReview = $(".stage-review");
    const stageQuit = $(".stage-quit");
    const tiltBox = $(".tilt");
    const tiltValueEl = $(".tilt-value");
    const tiltFillEl = $(".tilt-bar-fill");
    const tiltStatusEl = $(".tilt-status");

    let stream = null;
    let ferTimer = null;
    let smoothedTilt = 0.0;
    let lastFerUpdate = null;

    const stopStream = () => {
      if (ferTimer) {
        clearInterval(ferTimer);
        ferTimer = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    };

    const cleanup = () => {
      stopStream();
      host.remove();
      modalOpen = false;
    };

    const showStage = (el) => {
      [stageCheck, stageChoice, stageReview, stageQuit].forEach((s) => (s.hidden = true));
      el.hidden = false;
    };

    const renderTilt = (value, hasFace) => {
      tiltValueEl.textContent = value.toFixed(2);
      const pct = Math.max(-1, Math.min(1, value));
      if (pct >= 0) {
        tiltFillEl.style.left = "50%";
        tiltFillEl.style.right = `${50 - pct * 50}%`;
        tiltFillEl.style.background = "#e74c3c";
      } else {
        tiltFillEl.style.left = `${50 + pct * 50}%`;
        tiltFillEl.style.right = "50%";
        tiltFillEl.style.background = "#2ecc71";
      }
      tiltStatusEl.textContent = hasFace
        ? value > 0.3
          ? "ネガティブ寄りです。深呼吸してみましょう。"
          : value < -0.2
          ? "リラックスしているようです。"
          : "落ち着いた状態です。"
        : "顔が検出できません。カメラに顔を向けてください。";
    };

    $(".continue").addEventListener("click", cleanup);

    $(".stop").addEventListener("click", () => {
      stopStream();
      showStage(stageChoice);
    });

    $(".quit").addEventListener("click", () => {
      showStage(stageQuit);
    });

    $(".review").addEventListener("click", () => {
      showStage(stageReview);
    });

    $(".dismiss").addEventListener("click", cleanup);
    $(".dismiss-quit").addEventListener("click", cleanup);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      video.srcObject = stream;
    } catch (e) {
      errorEl.textContent = "カメラを利用できませんでした: " + (e?.message ?? e);
      errorEl.hidden = false;
      return;
    }

    tiltBox.hidden = false;

    try {
      await loadModels();
    } catch (e) {
      tiltStatusEl.textContent = "モデルの読み込みに失敗しました: " + (e?.message ?? e);
      return;
    }

    if (!modalOpen) return;
    tiltStatusEl.textContent = "解析中…";

    const detectorOpts = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.5,
    });

    ferTimer = setInterval(async () => {
      if (video.readyState < 2) return;
      try {
        const result = await faceapi
          .detectSingleFace(video, detectorOpts)
          .withFaceExpressions();
        const now = Date.now();
        if (!result) {
          renderTilt(smoothedTilt, false);
          return;
        }
        const raw = formulateTilt(result.expressions);
        const elapsedSec = lastFerUpdate ? (now - lastFerUpdate) / 1000 : FER_INTERVAL_MS / 1000;
        const alpha = Math.min(elapsedSec / 100, 0.5);
        smoothedTilt = alpha * raw + (1 - alpha) * smoothedTilt;
        lastFerUpdate = now;
        renderTilt(smoothedTilt, true);
      } catch (e) {
        console.warn("[mahjong-hci] fer error", e);
      }
    }, FER_INTERVAL_MS);
  };
})();
