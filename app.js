(async () => {
  const n = 8;
  const v = "20260920e";
  let code = "";
  for (let i = 0; i < n; i++) {
    const r = await fetch("app-part-" + i + ".js.txt?v=" + v);
    if (!r.ok) throw new Error("part " + i + " HTTP " + r.status);
    code += await r.text();
  }
  (0, eval)(code);
})().catch((e) => {
  console.error("Failed to load app:", e);
  document.body.insertAdjacentHTML(
    "afterbegin",
    '<pre style="color:#f88;padding:12px;background:#200">Failed to load app parts.\n' + e + "</pre>"
  );
});
