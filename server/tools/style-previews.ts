// Genera las vistas previas (demo/preview.mp4 + demo/poster.jpg) de los estilos base a partir de su demo.
// Uso (desde la raíz de la app):  node server/tools/style-previews.ts [id-estilo …]
// Sin argumentos genera todos los estilos base que tengan demo y aún no tengan vista previa (--force: todos).
import { listStyles } from "../styles/store.ts";
import { hasDemo, renderStylePreview } from "../styles/preview.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const ids = args.filter((a) => !a.startsWith("--"));
const base = listStyles().filter((s) => s.origin === "base" && (ids.length ? ids.includes(s.id) : true));
let failed = 0;
for (const s of base) {
  if (!hasDemo(s)) { console.log(`· ${s.id}: sin demo, se omite`); continue; }
  if (!force && !ids.length && s.files.includes("demo/preview.mp4")) { console.log(`· ${s.id}: ya tiene vista previa`); continue; }
  const t0 = Date.now();
  let last = "";
  try {
    await renderStylePreview(s, (m) => { if (m !== last && !/%$/.test(m)) { last = m; console.log(`  ${s.id}: ${m}`); } });
    console.log(`✓ ${s.id} (${Math.round((Date.now() - t0) / 1000)} s)`);
  } catch (e) {
    failed++;
    console.error(`✗ ${s.id}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
