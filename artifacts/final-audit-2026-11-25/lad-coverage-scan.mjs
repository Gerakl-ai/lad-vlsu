const BASE = "https://germanpolkin.ru/lad-vlsu";
const cov = await fetch(`${BASE}/data/coverage.json`).then((r) => r.json());
const ids = Object.keys(cov.groups || {});
const concurrency = 25;
let ok = 0,
  miss404 = 0,
  other = 0;
const missList = [];
async function head(id) {
  try {
    const r = await fetch(`${BASE}/data/schedule/${id}.json`, { method: "HEAD" });
    if (r.status === 404) {
      miss404++;
      if (missList.length < 30) missList.push(id);
    } else if (r.ok) ok++;
    else other++;
  } catch {
    other++;
  }
}
for (let i = 0; i < ids.length; i += concurrency) {
  await Promise.all(ids.slice(i, i + concurrency).map(head));
  if ((i + concurrency) % 100 < concurrency) process.stderr.write(` ${Math.min(i + concurrency, ids.length)}/${ids.length}`);
}
process.stderr.write("\n");
console.log(JSON.stringify({ total: ids.length, ok, miss404, other, sampleMiss: missList }, null, 2));