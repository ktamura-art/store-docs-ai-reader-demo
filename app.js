/* 店舗書類 AI 読み取り（デモ）— 画面 */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yen = n => Number(n || 0).toLocaleString("ja-JP");

/* ── 状態 ─────────────────────────────────────────── */
const S = {
  tab: "review", filter: "check", cur: null, hintOpen: true,
  docs: [], byId: {}, log: initialLog(), contacted: {},
  sub: "status", statusDay: dkey(LATEST),
  search: { from: dkey(addDays(LATEST, -6)), to: dkey(LATEST), store: "", type: "", q: "" }, results: null,
  exp: { sys: "sales", day: dkey(LATEST) }, recon: null,
};



/* ── 書類の値・判定 ──────────────────────────────── */
function allCells(d) {
  const out = [...d.head, ...d.kv];
  d.rows.forEach(r => Object.values(r).forEach(c => out.push(c)));
  return out.concat(d.foot);
}
function cellBy(d, key) { return [...d.head, ...d.kv, ...d.foot].find(c => c.key === key); }
function val(d, key) { const c = cellBy(d, key); return c ? c.v : ""; }
const docName = d => `${DOC_TYPES[d.type].label} ${storeBy(d.store).name}`;
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const durMin = t => { if (!t) return 0; const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
const fmtDur = m => `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + "分" : ""}`;

function isSubseq(a, b) { let i = 0; for (const ch of b) { if (ch === a[i]) i++; } return i === a.length; }
function suggestFor(d, c) {
  const v = String(c.v || "");
  if (c.master === "item") return ITEMS.filter(i => i.name.includes(v) || isSubseq([...v].join(""), i.name)).slice(0, 3).map(i => i.name);
  return (EMPLOYEES[d.store] || []).filter(e => e.name.startsWith(v) || e.name.includes(v)).slice(0, 3).map(e => e.name);
}

/* 確認が必要な箇所の一覧（読み取り時の判定＋検算・照合のルール） */
function flagsOf(d) {
  const out = [];
  const add = (c, f) => {
    const auto = (f.kind === "low" || f.kind === "anomaly") && c.edited;
    out.push(Object.assign({ cell: c, resolved: !!c.res[f.kind] || auto, auto }, f));
  };
  allCells(d).forEach(c => {
    c.sflags.forEach(f => add(c, f));
    if (c.master && c.v !== "") {
      const ok = c.master === "item" ? !!itemBy(c.v) : !!empBy(d.store, c.v);
      if (!ok) {
        const sug = suggestFor(d, c);
        const msg = c.master === "item" ? `品目マスタに「${c.v}」がありません` : `従業員マスタに「${c.v}」さんがいません。該当しそうな方が${sug.length}名います`;
        add(c, { kind: "master", msg: msg + (c.hint ? `。${c.hint}` : ""), suggest: sug });
      }
    }
    if (c.info) out.push({ cell: c, kind: c.info.kind, msg: c.info.msg, info: true, resolved: false });
  });
  if (d.type === "nikkei") {
    const sum = (+val(d, "cash")) + (+val(d, "card")) + (+val(d, "qr"));
    if (sum !== +val(d, "sales")) add(cellBy(d, "sales"), { kind: "calc", msg: `内訳（現金＋カード＋電子マネー・QR）の合計 ${yen(sum)}円 と、売上合計 ${yen(val(d, "sales"))}円 が合いません` });
  }
  if (d.type === "nohin" || d.type === "seikyu") {
    d.rows.forEach(r => {
      const calc = (+r.qty.v) * (+r.price.v);
      if (calc !== +r.amount.v) add(r.amount, { kind: "calc", msg: `${r.item.v}：数量×単価（${yen(calc)}円）と金額（${yen(r.amount.v)}円）が合いません` });
    });
    const sum = d.rows.reduce((s, r) => s + (+r.amount.v), 0);
    if (d.type === "nohin" && sum !== +val(d, "total")) add(cellBy(d, "total"), { kind: "calc", msg: `明細の合計（${yen(sum)}円）と合計金額（${yen(val(d, "total"))}円）が合いません` });
    if (d.type === "seikyu") {
      if (sum !== +val(d, "sub")) add(cellBy(d, "sub"), { kind: "calc", msg: `明細の合計（${yen(sum)}円）と小計（${yen(val(d, "sub"))}円）が合いません` });
      const tax = Math.floor((+val(d, "sub")) * 0.1);
      if (tax !== +val(d, "tax")) add(cellBy(d, "tax"), { kind: "calc", msg: `小計の10%（${yen(tax)}円）と消費税が合いません` });
      if ((+val(d, "sub")) + (+val(d, "tax")) !== +val(d, "total")) add(cellBy(d, "total"), { kind: "calc", msg: "小計＋消費税と請求金額が合いません" });
    }
  }
  if (d.type === "kintai") {
    d.rows.forEach(r => {
      const a = toMin(r.in.v), b = toMin(r.out.v);
      if (a === null || b === null) return;
      if (b <= a) { add(r.out, { kind: "rule", msg: `${r.emp.v}：退勤が出勤より前になっています` }); return; }
      const brk = durMin(r.brk.v), work = b - a - brk;
      if (work > 480 && brk < 60) add(r.brk, { kind: "rule", msg: `${r.emp.v}：勤務 ${fmtDur(work)}、${brk ? `休憩は${fmtDur(brk)}です` : "休憩の記載がありません"}（8時間を超える場合は1時間以上）` });
      else if (work > 360 && brk < 45) add(r.brk, { kind: "rule", msg: `${r.emp.v}：勤務 ${fmtDur(work)}、${brk ? `休憩は${fmtDur(brk)}です` : "休憩の記載がありません"}（6時間を超える場合は45分以上）` });
    });
  }
  return out;
}
const unresolved = d => flagsOf(d).filter(f => !f.info && !f.resolved).length;
const inFilter = d => { const st = statusOf(d); return S.filter === "all" || st === S.filter || (S.filter === "check" && st === "hold"); };
function statusOf(d) {
  if (d.confirmedBy) return "done";
  if (d.hold) return "hold";
  return unresolved(d) > 0 ? "check" : "ok";
}
const STATUS_LABEL = { check: "要確認", ok: "確認OK", done: "確定済み", hold: "保留" };

function parseVal(text, fmt) {
  let t = String(text).trim().replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/：/g, ":");
  if (fmt === "yen" || fmt === "num") {
    if (t === "") return "";
    const neg = /^[-▲△ー−]/.test(t);
    const n = Number(t.replace(/[^\d]/g, ""));
    return neg ? -n : n;
  }
  if (fmt === "time") {
    const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec(t);
    return m ? `${m[1].padStart(2, "0")}:${m[2] || "00"}` : t;
  }
  if (fmt === "dur") {
    if (t === "") return "";
    if (/^\d+$/.test(t)) { const m = +t; return m >= 10 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : `${m}:00`; }
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    return m ? `${+m[1]}:${m[2]}` : t;
  }
  return t;
}

/* ── 記録 ────────────────────────────────────────── */
function addLog(action, d, detail) {
  S.log.unshift({ at: new Date(), user: ME, action, target: d ? docName(d) : "", detail, docId: d ? d.id : null });
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2600);
}

/* ── 用紙（原本のイメージ） ─────────────────────── */
const PAPER_TITLE = { nikkei: "日 計 表", hatchu: "発 注 書", nohin: "納 品 書", zaiko: "在 庫 表（棚卸し）", kintai: "勤 怠 表", shift: "シ フ ト 表", seikyu: "請 求 書" };
const PRINTED_KEYS = { nohin: ["sup", "slip"], seikyu: ["sup", "to", "no", "date", "sub", "tax", "total", "item", "qty", "price", "amount"] };
function rot(id) { const h = hashStr(id); return ((h % 30) - 15) / 10; }
function ink(d, c) {
  if ((PRINTED_KEYS[d.type] || []).includes(c.key)) return `<span class="pr${c.smudge ? " smudge" : ""}" data-cell="${c.id}">${esc(c.raw)}</span>`;
  return `<span class="hw${c.smudge ? " smudge" : ""}" data-cell="${c.id}" style="transform:rotate(${rot(c.id)}deg)">${esc(c.raw)}</span>`;
}
function paperHTML(d) {
  const st = storeBy(d.store);
  const from = d.store === "H00" ? "0**-***-5521" : (d.type === "nohin" ? "0**-***-7730" : st.fax);
  const top = d.via === "FAX"
    ? `<div class="faxline">${ymd(d.arrival)} ${String(d.arrival.getHours()).padStart(2, "0")}:${String(d.arrival.getMinutes()).padStart(2, "0")}　FROM ${from}　P.01/01</div>`
    : `<div class="faxline">SCAN ${ymd(d.arrival)}　本部複合機</div>`;
  let h = `<div class="paper p-${d.type}">${top}<div class="pt">${PAPER_TITLE[d.type]}</div>`;
  h += `<div class="phead">${d.head.map(c => `<div class="pf"><span class="pl">${esc(c.label)}</span><span class="pv">${ink(d, c)}</span></div>`).join("")}</div>`;
  if (d.kv.length) {
    h += `<table class="pkv">${d.kv.map(c => `<tr><th>${esc(c.label)}</th><td>${ink(d, c)}<span class="u">${c.key === "guests" ? "人" : "円"}</span></td></tr>`).join("")}</table>`;
  }
  if (d.cols) {
    const blank = Math.max(0, (d.type === "shift" ? 8 : 10) - d.rows.length);
    h += `<table class="ptab"><colgroup>${d.cols.map(c => `<col style="width:${c.w}%">`).join("")}</colgroup>`;
    h += `<tr>${d.cols.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
    h += d.rows.map(r => `<tr>${d.cols.map(c => `<td>${ink(d, r[c.key])}</td>`).join("")}</tr>`).join("");
    h += Array.from({ length: blank }, () => `<tr>${d.cols.map(() => "<td>&nbsp;</td>").join("")}</tr>`).join("");
    h += `</table>`;
  }
  if (d.foot.length) h += `<table class="pfoot">${d.foot.map(c => `<tr><th>${esc(c.label)}</th><td>${ink(d, c)}<span class="u">円</span></td></tr>`).join("")}</table>`;
  if (d.type === "nikkei") h += `<div class="pnote">※ 締め作業のあと、本部へ FAX してください。</div>`;
  if (d.type === "kintai") h += `<div class="pnote">※ 休憩は実際に取った時間を記入。連絡事項は備考へ。</div>`;
  return h + `</div>`;
}

/* ── 共通の部品 ─────────────────────────────────── */
const tbadge = t => `<span class="tb t-${t}">${DOC_TYPES[t].label}</span>`;
const schip = st => `<span class="sc s-${st}">${STATUS_LABEL[st]}</span>`;
const KIND = {
  low: { icon: "?", cls: "warn", name: "読み取りに自信なし" },
  calc: { icon: "＝", cls: "err", name: "計算が合わない" },
  master: { icon: "！", cls: "err", name: "マスタに見つからない" },
  anomaly: { icon: "↕", cls: "warn", name: "いつもと違う" },
  rule: { icon: "⏱", cls: "warn", name: "ルールに合わない" },
  translate: { icon: "訳", cls: "info", name: "日本語以外の記載" },
};

/* ── 画面：確認 ─────────────────────────────────── */
function renderReview() {
  const counts = { check: 0, ok: 0, done: 0, hold: 0 };
  S.docs.forEach(d => counts[statusOf(d)]++);
  const total = S.docs.length;
  const filt = S.filter;
  const list = S.docs.filter(inFilter);
  const d = S.byId[S.cur];
  const pct = Math.round(counts.done / total * 100);

  const hint = S.hintOpen ? `<div class="hint"><b>使い方</b>　① 左の一覧から書類を選ぶ　② 右の「確認が必要な箇所」をクリックすると、原本の該当箇所が光ります　③ 値を直すか「このままでOK」を押し、「確定」します<button class="x" data-act="hint">×</button></div>` : "";

  const q = list.map(x => {
    const st = statusOf(x), n = unresolved(x);
    return `<div class="qi${x.id === S.cur ? " sel" : ""}" data-doc="${x.id}">
      <div class="q1">${tbadge(x.type)}<b>${esc(storeBy(x.store).name)}</b><span class="qd">${md(x.docDate)}分</span></div>
      <div class="q2"><span>${x.via} ${hm(x.arrival)} 着</span>${st === "check" ? `<span class="sc s-check">要確認 ${n}</span>` : schip(st)}</div></div>`;
  }).join("") || `<div class="empty">該当する書類はありません</div>`;

  const bulk = filt === "ok" && counts.ok > 0 ? `<button class="btn sm" data-act="bulk">確認OKの ${counts.ok}件をまとめて確定</button>` : "";

  return `${hint}
  <div class="sumbar">
    <div class="sum-t"><b>${mdw(LATEST)}に届いた書類　${total}件</b><span class="muted">AI の読み取り・検算・照合は完了しています（最終 ${hm(atTime(TODAY, 2 * 60 + 14))}）</span></div>
    <div class="prog"><div class="bar"><i style="width:${pct}%"></i></div><span>確定 ${counts.done}/${total}</span></div>
    <div class="miss" data-act="gostatus">日計表の未着 <b>${MISSING_NIKKEI.length}店舗</b> ›</div>
  </div>
  <div class="review">
    <aside class="queue">
      <div class="seg">${[["check", "要確認"], ["ok", "確認OK"], ["done", "確定済み"], ["all", "すべて"]].map(([k, l]) =>
        `<button class="${filt === k ? "on" : ""}" data-filter="${k}">${l}<span>${k === "all" ? total : counts[k] + (k === "check" ? counts.hold : 0)}</span></button>`).join("")}</div>
      ${bulk}
      <div class="qlist">${q}</div>
    </aside>
    <section class="viewer">${d ? viewerHTML(d) : ""}</section>
    <section class="panel">${d ? panelHTML(d) : ""}</section>
  </div>`;
}

function viewerHTML(d) {
  const st = storeBy(d.store);
  const how = d.store === "H00" ? "請求書の発行元から判定" : (d.via === "FAX" ? `発信元 FAX ${st.fax} から判定` : "用紙の店舗名から判定");
  return `<div class="vmeta">
    <span>書類の種類：<b>${DOC_TYPES[d.type].label}</b><small>（AI 判定 ${Math.round(d.typeConf * 100)}%）</small></span>
    <span>店舗：<b>${esc(st.name)}</b><small>（${how}）</small></span>
    <span>${d.via} 受信：${md(d.arrival)} ${hm(d.arrival)}</span></div>
    <div class="paperwrap">${paperHTML(d)}</div>
    <div class="vfoot">原本（${d.via === "FAX" ? "FAX 受信" : "スキャン"}の PDF）のイメージです。原本はデータと一緒に保存し、検索からいつでも開けます。</div>`;
}

function inputHTML(d, c, flags, ro) {
  const fs = flags.filter(f => f.cell === c && !f.info);
  const open = fs.filter(f => !f.resolved);
  let cls = "";
  if (open.some(f => KIND[f.kind].cls === "err")) cls = "f-err";
  else if (open.length) cls = "f-warn";
  else if (c.edited) cls = "f-edit";
  else if (fs.length) cls = "f-done";
  const tip = `読み取りの確からしさ ${Math.round(c.conf * 100)}%` + (c.edited ? `／修正前「${show(c.orig, c.fmt)}」` : "");
  return `<input class="in ${cls} ${c.fmt === "yen" || c.fmt === "num" ? "num" : ""}" data-cell="${c.id}" value="${esc(show(c.v, c.fmt))}" title="${esc(tip)}"${ro ? " disabled" : ""}>`;
}

function flagCard(d, f, ro) {
  const k = KIND[f.kind];
  let acts = "";
  if (!ro && !f.info && !f.resolved) {
    acts += (f.suggest || []).map(s => `<button class="btn xs pri" data-sug="${esc(s)}" data-cell="${f.cell.id}">「${esc(s)}」にする</button>`).join("");
    if (f.kind !== "master") acts += `<button class="btn xs" data-ok="${f.kind}" data-cell="${f.cell.id}">このままでOK</button>`;
  }
  const done = f.resolved ? `<span class="rs">✓ ${f.auto ? "修正済み" : "確認済み"}</span>` : "";
  return `<div class="fc ${k.cls}${f.resolved ? " resolved" : ""}" data-look="${f.cell.id}">
    <div class="fh"><span class="fi">${k.icon}</span><b>${esc(f.cell.label)}</b><span class="fk">${k.name}</span>${done}</div>
    <div class="fm">${esc(f.msg)}</div>${acts ? `<div class="fa">${acts}</div>` : ""}</div>`;
}

function panelHTML(d) {
  const flags = flagsOf(d);
  const st = statusOf(d);
  const ro = st === "done";
  const open = flags.filter(f => !f.info && !f.resolved).length;
  flags.sort((a, b) => (a.info ? 1 : 0) - (b.info ? 1 : 0));
  const fl = flags.length ? flags.map(f => flagCard(d, f, ro)).join("") : `<div class="allok">AI の読み取り・検算・照合で、確認が必要な箇所はありませんでした。</div>`;

  let body = `<div class="grid2">${d.head.map(c => `<label><span>${esc(c.label)}</span>${inputHTML(d, c, flags, ro)}</label>`).join("")}</div>`;
  if (d.kv.length) {
    body += `<table class="ftab kv">${d.kv.map(c => `<tr><th>${esc(c.label)}</th><td>${inputHTML(d, c, flags, ro)}</td></tr>`).join("")}</table>`;
    const sum = (+val(d, "cash")) + (+val(d, "card")) + (+val(d, "qr"));
    const g = +val(d, "guests");
    body += `<div class="derived"><span>内訳の合計 <b>${yen(sum)}円</b>${sum === +val(d, "sales") ? '<i class="okm">✓ 売上合計と一致</i>' : '<i class="ngm">売上合計と不一致</i>'}</span><span>客単価 <b>${g ? yen(Math.round(val(d, "sales") / g)) : "-"}円</b></span></div>`;
  }
  if (d.cols) {
    body += `<div class="tscroll"><table class="ftab"><tr>${d.cols.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr>`;
    body += d.rows.map(r => `<tr>${d.cols.map(c => `<td>${inputHTML(d, r[c.key], flags, ro)}${r[c.key].info ? `<div class="tr">訳：${esc(r[c.key].info.msg.split("：")[1] || "")}</div>` : ""}</td>`).join("")}</tr>`).join("");
    body += `</table></div>`;
  }
  if (d.foot.length) body += `<table class="ftab kv foot">${d.foot.map(c => `<tr><th>${esc(c.label)}</th><td>${inputHTML(d, c, flags, ro)}</td></tr>`).join("")}</table>`;

  const dest = { sales: "売上管理システム", attendance: "勤怠管理システム", purchase: "仕入れ管理システム", accounting: "経理（支払いの管理）" }[DOC_TYPES[d.type].system];
  const foot = ro
    ? `<div class="donebox">確定済み（${esc(d.confirmedBy)}　${md(d.confirmedAt)} ${hm(d.confirmedAt)}）<button class="btn xs" data-act="unconfirm">確定を取り消す</button></div>`
    : `<button class="btn pri big" data-act="confirm"${open ? " disabled" : ""}>確定して次へ</button>
       <button class="btn" data-act="hold">${d.hold ? "保留を解除" : "保留（店舗に確認）"}</button>
       <div class="muted small">${open ? `確認が必要な箇所があと ${open}件あります` : `確定すると、${dest}への書き出しの対象になります`}</div>`;

  return `<div class="ph"><div>${tbadge(d.type)}<b class="pn">${esc(storeBy(d.store).name)}</b><span class="muted">${md(d.docDate)}分</span></div>${st === "check" ? `<span class="sc s-check">要確認 ${open}</span>` : schip(st)}</div>
  <div class="psec"><h3>確認が必要な箇所</h3>${fl}</div>
  <div class="psec"><h3>読み取り結果<small>（クリックで原本の該当箇所を表示・直接修正できます）</small></h3>${body}</div>
  <div class="pact">${foot}</div>`;
}

function highlight(cellId, scroll = true) {
  $$(".paper .hl").forEach(e => e.classList.remove("hl"));
  const el = $(`.paper [data-cell="${cellId}"]`);
  if (!el) return;
  el.classList.add("hl");
  if (scroll) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

function bindReview() {
  $$("[data-filter]").forEach(b => b.onclick = () => { S.filter = b.dataset.filter; render(); });
  $$(".qi").forEach(el => el.onclick = () => { S.cur = el.dataset.doc; render(); $(".paperwrap") && ($(".paperwrap").scrollTop = 0); });
  const d = S.byId[S.cur];
  $$(".panel input.in").forEach(inp => {
    inp.onfocus = () => highlight(inp.dataset.cell);
    inp.onchange = () => {
      const c = allCells(d).find(x => x.id === inp.dataset.cell);
      const nv = parseVal(inp.value, c.fmt);
      if (nv === c.v) return;
      addLog("修正", d, `${c.label}「${show(c.v, c.fmt)}」→「${show(nv, c.fmt)}」`);
      c.v = nv; c.edited = true;
      setTimeout(() => {
        const act = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.cell : null;
        render();
        if (act) { const el = $(`.panel input[data-cell="${act}"]`); if (el) el.focus(); }
        else highlight(c.id, false);
      }, 0);
    };
    inp.onkeydown = e => { if (e.key === "Enter") inp.blur(); };
  });
  $$(".fc").forEach(el => el.onclick = e => {
    if (e.target.closest("button")) return;
    highlight(el.dataset.look);
    const inp = $(`.panel input[data-cell="${el.dataset.look}"]`); if (inp && !inp.disabled) inp.focus({ preventScroll: true });
  });
  $$("[data-sug]").forEach(b => b.onclick = () => {
    const c = allCells(d).find(x => x.id === b.dataset.cell);
    addLog("候補を採用", d, `${c.label}「${show(c.v, c.fmt)}」→「${b.dataset.sug}」`);
    c.v = b.dataset.sug; c.edited = true; render(); highlight(c.id, false);
  });
  $$("[data-ok]").forEach(b => b.onclick = () => {
    const c = allCells(d).find(x => x.id === b.dataset.cell);
    c.res[b.dataset.ok] = true;
    addLog("確認（変更なし）", d, `${c.label}「${show(c.v, c.fmt)}」：${KIND[b.dataset.ok].name}`);
    render(); highlight(c.id, false);
  });
  const act = (name, fn) => { const b = $(`[data-act="${name}"]`); if (b) b.onclick = fn; };
  act("hint", () => { S.hintOpen = false; render(); });
  act("gostatus", () => { S.tab = "search"; S.sub = "status"; S.statusDay = dkey(LATEST); render(); });
  act("confirm", () => {
    const listBefore = S.docs.filter(inFilter);
    const idx = listBefore.findIndex(x => x.id === d.id);
    d.confirmedBy = ME; d.confirmedAt = new Date(); d.hold = false;
    addLog("確定", d, "読み取り結果を確定");
    const listAfter = S.docs.filter(x => inFilter(x) && x.id !== d.id);
    const next = S.filter === "all" ? listBefore[idx + 1] : (listAfter[idx] || listAfter[idx - 1] || listAfter[0]);
    if (next) S.cur = next.id;
    toast(`${docName(d)} を確定しました`);
    render();
  });
  act("hold", () => {
    d.hold = !d.hold;
    addLog(d.hold ? "保留" : "保留を解除", d, d.hold ? "店舗に確認するため保留" : "");
    toast(d.hold ? "保留にしました。店舗への確認後に確定できます" : "保留を解除しました");
    render();
  });
  act("unconfirm", () => {
    addLog("確定の取り消し", d, `確定（${d.confirmedBy}）を取り消し`);
    d.confirmedBy = null; d.confirmedAt = null; render();
  });
  act("bulk", () => {
    const ok = S.docs.filter(x => statusOf(x) === "ok");
    ok.forEach(x => { x.confirmedBy = ME; x.confirmedAt = new Date(); });
    S.log.unshift({ at: new Date(), user: ME, action: "まとめて確定", target: `${md(LATEST)} 着の書類`, detail: `要確認のない書類 ${ok.length}件` });
    toast(`${ok.length}件をまとめて確定しました`);
    render();
  });
}

/* ── 画面：検索・提出状況 ───────────────────────── */
function docsOfDay(day) {
  if (dkey(day) === dkey(LATEST)) return S.docs;
  return dayIndex(day).map(m => {
    const d = buildDoc(m);
    const r = rng(hashStr("cf" + m.id));
    d.confirmedBy = STAFF[hashStr(m.id) % STAFF.length];
    d.confirmedAt = atTime(addDays(day, 1), ri(r, 8 * 60 + 30, 10 * 60 + 40));
    return d;
  });
}
const histDays = () => Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(LATEST, -i));

function renderSearch() {
  const tabs = [["status", "提出状況"], ["find", "書類を探す"], ["log", "操作の記録"]]
    .map(([k, l]) => `<button class="${S.sub === k ? "on" : ""}" data-sub="${k}">${l}</button>`).join("");
  let body = "";
  if (S.sub === "status") body = statusHTML();
  if (S.sub === "find") body = findHTML();
  if (S.sub === "log") body = logHTML();
  return `<div class="page"><div class="subtabs">${tabs}</div>${body}</div>`;
}

function statusHTML() {
  const day = histDays().find(x => dkey(x) === S.statusDay) || LATEST;
  const latest = dkey(day) === dkey(LATEST);
  const docs = docsOfDay(day);
  const map = {};
  docs.forEach(d => { map[d.store + "_" + d.type] = d; });
  const cols = TYPE_ORDER.filter(t => t !== "seikyu");
  const nk = docs.filter(d => d.type === "nikkei").length;
  const rows = STORES.map(s => {
    const missing = latest && MISSING_NIKKEI.includes(s.code);
    const cells = cols.map(t => {
      const d = map[s.code + "_" + t];
      if (!d) return t === "nikkei" && missing ? `<td><span class="sc s-miss">未着</span></td>` : `<td class="none">–</td>`;
      const st = statusOf(d);
      return `<td><button class="cellbtn" data-open="${d.id}" data-day="${dkey(day)}">${st === "done" ? '<span class="sc s-done">✓ 確定</span>' : schip(st)}</button></td>`;
    }).join("");
    const contact = missing ? (S.contacted[s.code]
      ? `<span class="muted small">連絡済み（${S.contacted[s.code]}）</span>`
      : `<button class="btn xs" data-contact="${s.code}">店舗に連絡済みにする</button>`) : "";
    return `<tr class="${missing ? "missrow" : ""}"><th>${esc(s.name)}<small>${s.genre}</small></th>${cells}<td>${contact}</td></tr>`;
  }).join("");
  const opts = histDays().map(x => `<option value="${dkey(x)}"${dkey(x) === dkey(day) ? " selected" : ""}>${mdw(x)}${dkey(x) === dkey(LATEST) ? "（昨日）" : ""}</option>`).join("");
  return `<div class="bar2"><label>届いた日 <select id="stday">${opts}</select></label>
    <div class="kpis"><span>届いた書類 <b>${docs.length}件</b></span><span>日計表 <b>${nk}/${STORES.length}店舗</b></span>${latest ? `<span class="ng">未着 <b>${MISSING_NIKKEI.length}店舗</b></span>` : ""}
    <span>請求書 <b>${docs.filter(d => d.type === "seikyu").length}件</b>（本部宛て）</span></div></div>
    <div class="note">日計表は毎日すべての店舗から届く前提で、届いていない店舗を「未着」と表示します。提出が必要な書類と曜日は、要件定義で店舗ごとに設定します。</div>
    <div class="tscroll"><table class="mtx"><tr><th>店舗</th>${cols.map(t => `<th>${DOC_TYPES[t].label}</th>`).join("")}<th>連絡</th></tr>${rows}</table></div>`;
}

function findHTML() {
  const f = S.search;
  const dayOpts = sel => histDays().map(x => `<option value="${dkey(x)}"${dkey(x) === sel ? " selected" : ""}>${mdw(x)}</option>`).join("");
  const res = S.results;
  let table = `<div class="empty">条件を指定して「検索」を押してください。</div>`;
  if (res) {
    table = res.length ? `<div class="muted small">${res.length}件${res.length >= 200 ? "（先頭の200件を表示）" : ""}</div>
      <div class="tscroll"><table class="rtab"><tr><th>届いた日時</th><th>書類の日付</th><th>店舗</th><th>書類</th><th>主な内容</th><th>状態</th><th>確定した人</th></tr>
      ${res.map(d => `<tr data-open="${d.id}" data-day="${dkey(d.arrivalDay)}"><td>${md(d.arrival)} ${hm(d.arrival)}</td><td>${md(d.docDate)}</td><td>${esc(storeBy(d.store).name)}</td><td>${tbadge(d.type)}</td><td class="sm">${esc(summaryOf(d))}</td><td>${schip(statusOf(d))}</td><td>${esc(d.confirmedBy || "")}</td></tr>`).join("")}</table></div>`
      : `<div class="empty">該当する書類はありません。</div>`;
  }
  return `<div class="filters">
    <label>届いた日 <select id="ffrom">${dayOpts(f.from)}</select></label><span>〜</span><label><select id="fto">${dayOpts(f.to)}</select></label>
    <label>店舗 <select id="fstore"><option value="">すべて</option>${STORES.concat([HQ]).map(s => `<option value="${s.code}"${f.store === s.code ? " selected" : ""}>${s.name}</option>`).join("")}</select></label>
    <label>書類 <select id="ftype"><option value="">すべて</option>${TYPE_ORDER.map(t => `<option value="${t}"${f.type === t ? " selected" : ""}>${DOC_TYPES[t].label}</option>`).join("")}</select></label>
    <label>キーワード <input id="fq" value="${esc(f.q)}" placeholder="品目・氏名・金額など"></label>
    <button class="btn pri" data-act="find">検索</button></div>
    ${table}`;
}

function summaryOf(d) {
  if (d.type === "nikkei") return `売上 ${yen(val(d, "sales"))}円・客数 ${val(d, "guests")}人`;
  if (d.type === "kintai" || d.type === "shift") return d.rows.map(r => r.emp.v).slice(0, 3).join("、") + (d.rows.length > 3 ? ` ほか${d.rows.length - 3}名` : "");
  if (d.type === "nohin") return `${val(d, "sup")}・合計 ${yen(val(d, "total"))}円`;
  if (d.type === "seikyu") return `${val(d, "sup")}・請求 ${yen(val(d, "total"))}円`;
  return d.rows.map(r => r.item.v).slice(0, 3).join("、") + (d.rows.length > 3 ? " ほか" : "");
}

function runFind() {
  const f = S.search;
  let a = new Date(f.from), b = new Date(f.to);
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  if (a > b) [a, b] = [b, a];
  const out = [];
  const q = f.q.trim().replace(/,/g, "");
  histDays().forEach(day => {
    if (day < a || day > b) return;
    docsOfDay(day).forEach(d => {
      if (f.store && d.store !== f.store) return;
      if (f.type && d.type !== f.type) return;
      if (q) {
        const hay = allCells(d).map(c => String(c.v)).join(" ") + storeBy(d.store).name + DOC_TYPES[d.type].label;
        if (!hay.includes(q)) return;
      }
      out.push(d);
    });
  });
  out.sort((x, y) => y.arrival - x.arrival);
  S.results = out.slice(0, 200);
  S.resultMap = {};
  S.results.forEach(d => { S.resultMap[d.id] = d; });
}

function logHTML() {
  return `<div class="note">誰が・いつ・何をしたかを自動で記録します。記録は画面から変更・削除できない作りにします。</div>
  <div class="tscroll"><table class="rtab"><tr><th>日時</th><th>担当者</th><th>操作</th><th>対象</th><th>内容</th></tr>
  ${S.log.map(l => `<tr><td>${md(l.at)} ${hm(l.at)}</td><td>${esc(l.user)}</td><td><span class="la">${esc(l.action)}</span></td><td>${esc(l.target)}</td><td>${esc(l.detail)}</td></tr>`).join("")}</table></div>`;
}

function openModal(id, dayKey) {
  let d = S.byId[id] || (S.resultMap && S.resultMap[id]);
  if (!d) { const day = histDays().find(x => dkey(x) === dayKey); d = docsOfDay(day).find(x => x.id === id); }
  if (!d) return;
  if (dkey(d.arrivalDay) === dkey(LATEST) && S.byId[d.id]) {   // 昨日届いた書類は確認画面で開く
    S.tab = "review"; S.filter = "all"; S.cur = d.id; render(); return;
  }
  const hist = [
    { at: new Date(d.arrival.getTime() + 2 * 60000), user: "システム", action: "AI 読み取り", detail: `書類の種類：${DOC_TYPES[d.type].label}（${Math.round(d.typeConf * 100)}%）・店舗を判定` },
    { at: d.confirmedAt, user: d.confirmedBy, action: "確定", detail: "読み取り結果を確定" },
  ];
  const rowsHTML = (d.cols
    ? `<table class="ftab"><tr>${d.cols.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr>${d.rows.map(r => `<tr>${d.cols.map(c => `<td>${esc(show(r[c.key].v, r[c.key].fmt))}</td>`).join("")}</tr>`).join("")}</table>` : "")
    + `<table class="ftab kv">${[...d.head, ...d.kv, ...d.foot].map(c => `<tr><th>${esc(c.label)}</th><td>${esc(show(c.v, c.fmt))}</td></tr>`).join("")}</table>`;
  $("#modal").innerHTML = `<div class="mbox"><div class="mh">${tbadge(d.type)}<b>${esc(storeBy(d.store).name)}</b><span class="muted">${md(d.docDate)}分・${d.via} ${md(d.arrival)} ${hm(d.arrival)} 着</span>${schip(statusOf(d))}<button class="x" data-act="close">×</button></div>
    <div class="mb"><div class="paperwrap">${paperHTML(d)}</div>
    <div class="mside"><h3>確定したデータ</h3>${rowsHTML}
    <h3>この書類の記録</h3><table class="rtab">${hist.map(h => `<tr><td>${md(h.at)} ${hm(h.at)}</td><td>${esc(h.user)}</td><td>${esc(h.action)}</td><td>${esc(h.detail)}</td></tr>`).join("")}</table></div></div></div>`;
  $("#modal").classList.remove("hidden");
  $('#modal [data-act="close"]').onclick = closeModal;
}
function closeModal() { $("#modal").classList.add("hidden"); $("#modal").innerHTML = ""; }

function bindSearch() {
  $$("[data-sub]").forEach(b => b.onclick = () => { S.sub = b.dataset.sub; render(); });
  const sd = $("#stday"); if (sd) sd.onchange = () => { S.statusDay = sd.value; render(); };
  $$("[data-open]").forEach(el => el.onclick = () => openModal(el.dataset.open, el.dataset.day));
  $$("[data-contact]").forEach(b => b.onclick = () => {
    const s = storeBy(b.dataset.contact);
    S.contacted[s.code] = `${ME} ${hm(new Date())}`;
    S.log.unshift({ at: new Date(), user: ME, action: "未着の連絡", target: `日計表 ${s.name}`, detail: "店舗に連絡済み" });
    render();
  });
  const fb = $('[data-act="find"]');
  if (fb) {
    const read = () => { S.search = { from: $("#ffrom").value, to: $("#fto").value, store: $("#fstore").value, type: $("#ftype").value, q: $("#fq").value }; };
    fb.onclick = () => { read(); runFind(); render(); };
    $("#fq").onkeydown = e => { if (e.key === "Enter") { read(); runFind(); render(); } };
  }
}

/* ── 画面：書き出し ─────────────────────────────── */
const SYSTEMS = {
  sales: { name: "売上管理システム", docs: ["nikkei"], cols: ["店舗コード", "営業日", "売上合計", "現金", "クレジット", "電子マネーQR", "客数", "現金過不足"] },
  attendance: { name: "勤怠管理システム", docs: ["kintai"], cols: ["従業員コード", "氏名", "勤務日", "出勤", "退勤", "休憩（分）", "店舗コード"] },
  purchase: { name: "仕入れ管理システム", docs: ["hatchu", "nohin", "zaiko"], cols: ["区分", "店舗コード", "日付", "取引先コード", "品目コード", "品目", "数量", "単位", "単価", "金額"] },
};
function csvRows(sys, docs) {
  const out = [];
  docs.forEach(d => {
    const sc = d.store, dt = val(d, "date");
    if (sys === "sales") out.push([sc, dt, val(d, "sales"), val(d, "cash"), val(d, "card"), val(d, "qr"), val(d, "guests"), val(d, "diff")]);
    if (sys === "attendance") d.rows.forEach(r => { const e = empBy(sc, r.emp.v); out.push([e ? e.code : "", r.emp.v, dt, r.in.v, r.out.v, durMin(r.brk.v), sc]); });
    if (sys === "purchase") d.rows.forEach(r => {
      const it = itemBy(r.item.v) || {};
      if (d.type === "hatchu") out.push(["発注", sc, dt, "V01", it.code || "", r.item.v, r.qty.v, r.unit.v, it.price || "", it.price ? it.price * r.qty.v : ""]);
      if (d.type === "nohin") out.push(["納品", sc, dt, (SUPPLIERS.find(s => s.name === val(d, "sup")) || {}).code || "", it.code || "", r.item.v, r.qty.v, it.unit || "", r.price.v, r.amount.v]);
      if (d.type === "zaiko") out.push(["在庫", sc, dt, "", it.code || "", r.item.v, r.qty.v, r.unit.v, "", ""]);
    });
  });
  return out;
}
const csvText = (cols, rows) => [cols].concat(rows).map(r => r.map(v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\r\n");

function renderExport() {
  const sys = SYSTEMS[S.exp.sys];
  const day = histDays().find(x => dkey(x) === S.exp.day) || LATEST;
  const all = docsOfDay(day).filter(d => sys.docs.includes(d.type));
  const done = all.filter(d => statusOf(d) === "done");
  const rows = csvRows(S.exp.sys, done);
  const cards = Object.entries(SYSTEMS).map(([k, s]) => `<button class="syscard${S.exp.sys === k ? " on" : ""}" data-sys="${k}"><b>${s.name}</b><span>${s.docs.map(t => DOC_TYPES[t].label).join("・")}</span></button>`).join("");
  const opts = histDays().map(x => `<option value="${dkey(x)}"${dkey(x) === dkey(day) ? " selected" : ""}>${mdw(x)}${dkey(x) === dkey(LATEST) ? "（昨日）" : ""}</option>`).join("");
  const prev = rows.slice(0, 12);
  let recon = "";
  if (S.exp.sys === "sales") {
    let rt = `<button class="btn" data-act="recon">売上管理システムのデータと照合する</button>`;
    if (S.recon === dkey(day)) {
      const diffs = done.map(d => {
        const h = hashStr("pos" + d.id) % 17;
        const pos = d.store === "S09" ? +val(d, "sales") - 3000 : d.store === "S15" ? +val(d, "sales") + 1200 : (h === 0 && dkey(day) !== dkey(LATEST) ? +val(d, "sales") - 500 : +val(d, "sales"));
        return { d, pos, diff: (+val(d, "sales")) - pos };
      }).filter(x => x.diff !== 0);
      rt = `<div class="rc"><b>${done.length}店舗中 ${diffs.length}店舗に差があります</b>
        <table class="rtab"><tr><th>店舗</th><th>日計表の売上</th><th>売上管理システムの売上</th><th>差</th></tr>
        ${diffs.map(x => `<tr><td>${esc(storeBy(x.d.store).name)}</td><td class="r">${yen(val(x.d, "sales"))}円</td><td class="r">${yen(x.pos)}円</td><td class="r ng">${x.diff > 0 ? "+" : ""}${yen(x.diff)}円</td></tr>`).join("")}</table>
        <div class="muted small">差のある店舗は、日計表の原本と店舗への確認で原因を確かめます。</div></div>`;
    }
    recon = `<div class="card"><h3>基幹システムのデータとの照合</h3><div class="muted small">売上管理システムから書き出したデータを読み込み、日計表の売上と突き合わせます（デモではサンプルの値を使っています）。</div>${rt}</div>`;
  }
  const exlog = S.log.filter(l => l.action === "書き出し").slice(0, 6);
  return `<div class="page">
    <div class="exgrid"><div class="syscards">${cards}</div>
    <div class="exmain">
      <div class="bar2"><label>届いた日 <select id="exday">${opts}</select></label>
        <div class="kpis"><span>対象の書類 <b>${all.length}件</b></span><span class="ok">確定済み <b>${done.length}件</b></span>${all.length - done.length ? `<span class="ng">未確定 <b>${all.length - done.length}件</b>（書き出しに含まれません）</span>` : ""}</div>
        <button class="btn pri" data-act="csv"${rows.length ? "" : " disabled"}>CSV を書き出す（${rows.length}行）</button></div>
      <div class="note">列の並び・コード・文字コードは、要件定義で${sys.name}の取り込み形式に合わせて設定します。取り込み機能がないシステムは、入力の自動化（RPA）を検討します。</div>
      <div class="card"><h3>書き出す内容（先頭 ${prev.length}行）</h3>
        ${prev.length ? `<div class="tscroll"><table class="rtab csv"><tr>${sys.cols.map(c => `<th>${c}</th>`).join("")}</tr>${prev.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table></div>${rows.length > prev.length ? `<div class="muted small">ほか ${rows.length - prev.length}行</div>` : ""}` : `<div class="empty">確定済みの書類がありません。「確認」の画面で確定してください。</div>`}
      </div>
      ${recon}
      <div class="card"><h3>書き出しの記録</h3>${exlog.length ? `<table class="rtab">${exlog.map(l => `<tr><td>${md(l.at)} ${hm(l.at)}</td><td>${esc(l.user)}</td><td>${esc(l.target)}</td><td>${esc(l.detail)}</td></tr>`).join("")}</table>` : `<div class="muted small">まだ書き出していません。</div>`}</div>
    </div></div></div>`;
}

function bindExport() {
  $$("[data-sys]").forEach(b => b.onclick = () => { S.exp.sys = b.dataset.sys; render(); });
  const ed = $("#exday"); if (ed) ed.onchange = () => { S.exp.day = ed.value; render(); };
  const rb = $('[data-act="recon"]'); if (rb) rb.onclick = () => {
    S.recon = S.exp.day;
    S.log.unshift({ at: new Date(), user: ME, action: "照合", target: "売上管理システム", detail: `${md(new Date(S.exp.day))} 着 日計表` });
    render();
  };
  const cb = $('[data-act="csv"]'); if (cb) cb.onclick = () => {
    const sys = SYSTEMS[S.exp.sys];
    const day = histDays().find(x => dkey(x) === S.exp.day) || LATEST;
    const done = docsOfDay(day).filter(d => sys.docs.includes(d.type) && statusOf(d) === "done");
    const rows = csvRows(S.exp.sys, done);
    const blob = new Blob(["﻿" + csvText(sys.cols, rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${sys.name}_${dkey(day)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    S.log.unshift({ at: new Date(), user: ME, action: "書き出し", target: sys.name, detail: `${md(day)} 着 ${done.length}件（${rows.length}行）` });
    toast("CSV を書き出しました");
    render();
  };
}

/* ── 全体 ────────────────────────────────────────── */
function render() {
  const app = $("#app");
  const keep = {};
  [".qlist", ".paperwrap", ".panel"].forEach(s => { const e = $(s); if (e) keep[s] = e.scrollTop; });
  $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  if (S.tab === "review") { app.innerHTML = renderReview(); bindReview(); }
  if (S.tab === "search") { app.innerHTML = renderSearch(); bindSearch(); }
  if (S.tab === "export") { app.innerHTML = renderExport(); bindExport(); }
  Object.entries(keep).forEach(([s, v]) => { const e = $(s); if (e) e.scrollTop = v; });
}
(function init() {
  const metas = dayIndex(LATEST);
  S.docs = metas.map(buildDoc);
  S.docs.forEach(d => { S.byId[d.id] = d; });
  // 今朝のうちに佐藤さんが確定した分（要確認のない書類の一部）
  let n = 0;
  S.docs.forEach(d => {
    if (unresolved(d) === 0 && !isFeatured(d) && n < 39) {
      n++; d.confirmedBy = "佐藤"; d.confirmedAt = atTime(TODAY, 8 * 60 + 52);
    }
  });
  S.cur = (S.docs.find(d => statusOf(d) === "check") || S.docs[0]).id;
})();

$$(".tabs button").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; closeModal(); render(); });
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
render();
