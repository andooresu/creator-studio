// Markdown liviano y seguro para los mensajes del productor y las tarjetas de aprobación.
// Convierte a elementos de React (nunca innerHTML): párrafos, **negrita**, *cursiva*, `código`, bloques ```,
// títulos #–###, listas con - * o 1. (anidadas por sangría), enlaces [texto](https://…) y saltos de línea.
import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

const SAFE_URL = /^(https?:\/\/|\/media\/|\/styles-files\/|#\/)/i;

/** Formato en línea: código, enlaces, negrita, cursiva. */
function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  // orden de prioridad: `código`, [enlace](url), **negrita**, *cursiva* / _cursiva_
  // la negrita puede contener *cursiva*; la cursiva exige no-espacio justo dentro de los delimitadores ("2 * 3 * 4" no es cursiva).
  // Las alternativas internas empiezan por caracteres disjuntos, así que no hay retroceso catastrófico.
  const re = /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*(?:[^*\n]|\*[^*\n]+\*)+?\*\*|__(?:[^_\n]|_[^_\n]+_)+?__)|(\*(?=\S)[^*\n]+?(?<=\S)\*|(?<![\w])_(?=\S)[^_\n]+?(?<=\S)_(?![\w]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="rounded bg-surface-3 px-1 py-px font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (m[2]) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      const href = lm[2];
      out.push(SAFE_URL.test(href)
        ? <a key={k} href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="text-blue underline-offset-2 hover:underline">{inline(lm[1], k)}</a>
        : <Fragment key={k}>{lm[1]}</Fragment>);
    } else if (m[3]) out.push(<strong key={k} className="font-semibold">{inline(t.slice(2, -2), k)}</strong>);
    else if (m[4]) out.push(<em key={k}>{inline(t.slice(1, -1), k)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Texto con saltos de línea simples dentro de un párrafo. */
function lines(text: string, key: string): ReactNode[] {
  return text.split("\n").flatMap((l, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(l, `${key}-${i}`)] : inline(l, `${key}-${i}`)));
}

interface ListItem { indent: number; ordered: boolean; num: number; text: string }

function renderList(items: ListItem[], key: string): ReactNode {
  // agrupa por sangría: los ítems con más sangría que el primero se anidan en el anterior
  const base = items[0].indent;
  const ordered = items[0].ordered;
  const groups: { item: ListItem; children: ListItem[] }[] = [];
  for (const it of items) {
    if (it.indent > base && groups.length) groups[groups.length - 1].children.push(it);
    else groups.push({ item: it, children: [] });
  }
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag key={key} start={ordered && items[0].num !== 1 ? items[0].num : undefined} className={cn("my-1.5 grid gap-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
      {groups.map((g, i) => (
        <li key={i} className="pl-0.5 marker:text-muted-foreground">
          {inline(g.item.text, `${key}-${i}`)}
          {g.children.length ? renderList(g.children, `${key}-${i}-c`) : null}
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const src = (text || "").replace(/\r\n?/g, "\n");
  const blocks: ReactNode[] = [];
  const rows = src.split("\n");
  let i = 0;
  let para: string[] = [];
  // los títulos del texto cuelgan del título de la sección: el más alto del texto pasa a ser nivel 3
  let topH = 4;
  for (let k = 0, fence = false; k < rows.length; k++) {
    if (/^\s*```/.test(rows[k])) { fence = !fence; continue; }
    const hm = fence ? null : /^(#{1,4})\s/.exec(rows[k]);
    if (hm) topH = Math.min(topH, hm[1].length);
  }
  const flushPara = () => {
    if (para.length) { blocks.push(<p key={`p${blocks.length}`} className="m-0">{lines(para.join("\n"), `p${blocks.length}`)}</p>); para = []; }
  };
  while (i < rows.length) {
    const row = rows[i];
    if (/^\s*```/.test(row)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < rows.length && !/^\s*```/.test(rows[i])) code.push(rows[i++]);
      i++;
      blocks.push(<pre key={`c${blocks.length}`} className="m-0 overflow-x-auto rounded-md bg-surface-3 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre">{code.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(row);
    if (h) {
      flushPara();
      const size = h[1].length <= 1 ? "text-[17px]" : h[1].length === 2 ? "text-[15.5px]" : "text-[14.5px]";
      blocks.push(<div key={`h${blocks.length}`} role="heading" aria-level={Math.min(6, 3 + h[1].length - topH)} className={cn("m-0 font-semibold tracking-[-0.02em]", size)}>{inline(h[2], `h${blocks.length}`)}</div>);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(row)) {
      flushPara();
      const items: ListItem[] = [];
      while (i < rows.length) {
        const lm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(rows[i]);
        if (lm) { items.push({ indent: lm[1].replace(/\t/g, "  ").length, ordered: /\d/.test(lm[2]), num: /\d/.test(lm[2]) ? parseInt(lm[2], 10) : 1, text: lm[3] }); i++; continue; }
        // línea de continuación con sangría: se suma al ítem anterior
        if (items.length && /^\s{2,}\S/.test(rows[i])) { items[items.length - 1].text += " " + rows[i].trim(); i++; continue; }
        // lista "suelta": líneas en blanco seguidas de otro ítem del mismo tipo (o anidado) continúan la misma lista
        if (items.length && !rows[i].trim()) {
          let j = i;
          while (j < rows.length && !rows[j].trim()) j++;
          const nm = j < rows.length ? /^(\s*)([-*+]|\d+[.)])\s+/.exec(rows[j]) : null;
          if (nm) {
            const ind = nm[1].replace(/\t/g, "  ").length;
            if (ind > items[0].indent || /\d/.test(nm[2]) === items[0].ordered) { i = j; continue; }
          }
        }
        break;
      }
      blocks.push(renderList(items, `l${blocks.length}`));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(row)) { flushPara(); blocks.push(<hr key={`r${blocks.length}`} className="my-1 border-border" />); i++; continue; }
    if (!row.trim()) { flushPara(); i++; continue; }
    para.push(row);
    i++;
  }
  flushPara();
  return <div className={cn("grid gap-2 leading-relaxed break-words", className)}>{blocks}</div>;
}
