(() => {
  const TARGET_PATTERNS = ["NotifyGameEndResult", "NotifyGameTerminate"];
  const SIGNAL_TYPE = "MAHJONG_HCI_GAME_END";
  const COOLDOWN_MS = 60_000;
  let lastFiredAt = 0;

  const decoder = new TextDecoder("utf-8", { fatal: false });

  const containsTarget = (bytes) => {
    const text = decoder.decode(bytes);
    for (const p of TARGET_PATTERNS) {
      if (text.includes(p)) return p;
    }
    return null;
  };

  const fire = (matched) => {
    const now = Date.now();
    if (now - lastFiredAt < COOLDOWN_MS) return;
    lastFiredAt = now;
    window.postMessage({ source: SIGNAL_TYPE, matched, at: now }, "*");
  };

  const inspect = (data) => {
    try {
      if (data instanceof ArrayBuffer) {
        const matched = containsTarget(new Uint8Array(data));
        if (matched) fire(matched);
      } else if (data instanceof Blob) {
        data.arrayBuffer().then((buf) => {
          const matched = containsTarget(new Uint8Array(buf));
          if (matched) fire(matched);
        }).catch(() => {});
      }
    } catch (_) {}
  };

  const OriginalWebSocket = window.WebSocket;
  const handler = {
    construct(target, args) {
      const ws = new target(...args);
      ws.addEventListener("message", (ev) => inspect(ev.data));
      return ws;
    },
  };
  window.WebSocket = new Proxy(OriginalWebSocket, handler);
})();
