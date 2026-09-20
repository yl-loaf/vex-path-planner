(async () => {
  const n = 6;
  let b64 = "";
  for (let i = 0; i < n; i++) {
    const r = await fetch("app-chunk-" + i + ".txt?v=20260920c");
    b64 += await r.text();
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const code = new TextDecoder().decode(bytes);
  (0, eval)(code);
})().catch(e => console.error("Failed to load app:", e));
