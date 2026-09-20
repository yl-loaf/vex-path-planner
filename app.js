(async () => {
  const n = 9;
  const v = "20260920e";
  let b64 = "";
  for (let i = 0; i < n; i++) {
    const r = await fetch("app-chunk-" + i + ".txt?v=" + v);
    if (!r.ok) throw new Error("chunk " + i + " HTTP " + r.status);
    b64 += await r.text();
  }
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const code = new TextDecoder().decode(bytes);
  (0, eval)(code);
})().catch((e) => {
  console.error("Failed to load app:", e);
  document.body.insertAdjacentHTML(
    "afterbegin",
    '<pre style="color:#f88;padding:12px;background:#200">Failed to load app.js chunks. Open local index or check console.\n' + e + "</pre>"
  );
});
