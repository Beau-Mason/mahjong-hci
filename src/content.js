(() => {
  const SIGNAL_TYPE = "MAHJONG_HCI_GAME_END";
  const FEEDBACK_MESSAGES = [
    "対局おつかれさまでした。ひと呼吸おいて、自分の表情を眺めてみましょう。",
    "少し肩の力を抜いて。熱くなっていませんか？",
    "勝っても負けても一局は一局。深呼吸してから次を考えてみませんか。",
    "今の表情、普段のあなたと比べてどうですか？",
    "連戦の前に、飲み物を取りにいく時間も大事です。",
  ];

  let modalOpen = false;

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

  const pickMessage = () =>
    FEEDBACK_MESSAGES[Math.floor(Math.random() * FEEDBACK_MESSAGES.length)];

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
        <h2>対局後のふりかえり</h2>
        <p class="subtitle">カメラを有効にし、今の自分の表情を確認してみましょう。</p>
        <div class="media">
          <video autoplay playsinline muted></video>
          <img alt="" hidden />
        </div>
        <p class="feedback" hidden></p>
        <div class="actions">
          <button class="capture" type="button">撮影する</button>
          <button class="save" type="button" hidden>画像を保存</button>
          <button class="close" type="button">閉じる</button>
        </div>
        <p class="error" hidden></p>
      </div>
    `;
    shadow.appendChild(overlay);
    document.documentElement.appendChild(host);

    const $ = (sel) => shadow.querySelector(sel);
    const video = $("video");
    const img = $("img");
    const feedbackEl = $(".feedback");
    const captureBtn = $(".capture");
    const saveBtn = $(".save");
    const closeBtn = $(".close");
    const errorEl = $(".error");

    let stream = null;
    let capturedUrl = null;

    const cleanup = () => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      host.remove();
      modalOpen = false;
    };

    closeBtn.addEventListener("click", cleanup);

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      video.srcObject = stream;
    } catch (e) {
      errorEl.textContent = "カメラを利用できませんでした: " + (e?.message ?? e);
      errorEl.hidden = false;
      captureBtn.disabled = true;
      return;
    }

    captureBtn.addEventListener("click", async () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);

      const blob = await new Promise((r) =>
        canvas.toBlob(r, "image/png")
      );
      if (!blob) return;

      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      capturedUrl = URL.createObjectURL(blob);
      img.src = capturedUrl;
      img.hidden = false;
      video.hidden = true;

      feedbackEl.textContent = pickMessage();
      feedbackEl.hidden = false;

      captureBtn.hidden = true;
      saveBtn.hidden = false;

      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    });

    saveBtn.addEventListener("click", () => {
      if (!capturedUrl) return;
      const a = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = capturedUrl;
      a.download = `mahjong-hci-${ts}.png`;
      a.click();
    });
  };
})();
