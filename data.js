/* 店舗書類 AI 読み取り（デモ）— 架空のマスタと書類データ
   表示している店舗・人名・数値はすべて架空です。 */
"use strict";

/* ── 乱数（毎回同じデータになるよう種を固定） ───────────────── */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ── 日付 ───────────────────────────────────────────── */
const WD = "日月火水木金土";
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dkey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function md(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function mdw(d) { return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; }
function ymd(d) { return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`; }
function hm(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; }
function atTime(day, minutes) { const x = new Date(day); x.setMinutes(minutes); return x; }
const LATEST = addDays(TODAY, -1);          // 確認する書類が届いた日（昨日）
const HISTORY_DAYS = 14;                     // 検索できる過去の日数

/* ── マスタ ─────────────────────────────────────────── */
const STORE_NAMES = ["中央", "駅前", "北口", "東町", "西町", "南", "港", "本町", "新町", "緑ヶ丘", "川端",
  "桜台", "大橋", "若葉", "高台", "浜手", "松原", "平和台", "旭町", "栄町", "城山", "青葉", "富士見",
  "泉", "宮前", "白浜", "朝日", "柳町", "藤ヶ丘", "梅林", "石橋", "花園", "千代田"];
const GENRES = ["うどん", "うどん", "ラーメン", "そば", "うどん", "定食"];
const STORES = STORE_NAMES.map((n, i) => ({
  code: "S" + String(i + 1).padStart(2, "0"),
  name: n + "店",
  genre: GENRES[i % GENRES.length],
  fax: "0**-***-" + String(1001 + i),
}));
const HQ = { code: "H00", name: "本部", genre: "", fax: "" };
const storeBy = code => code === "H00" ? HQ : STORES.find(s => s.code === code);

const SUPPLIERS = [
  { code: "V01", name: "自社工場（製麺・加工）" },
  { code: "V02", name: "A青果" },
  { code: "V03", name: "B食品" },
  { code: "V04", name: "C資材" },
];
const supBy = code => SUPPLIERS.find(s => s.code === code);

const ITEMS = [
  { code: "F001", name: "冷凍うどん玉", unit: "玉", price: 38, usual: 120, sup: "V01" },
  { code: "F002", name: "生そば", unit: "玉", price: 52, usual: 60, sup: "V01" },
  { code: "F003", name: "中華麺", unit: "玉", price: 45, usual: 80, sup: "V01" },
  { code: "F004", name: "ごぼう天", unit: "枚", price: 42, usual: 8, sup: "V01" },
  { code: "F005", name: "丸天", unit: "枚", price: 35, usual: 30, sup: "V01" },
  { code: "F006", name: "かまぼこ", unit: "本", price: 180, usual: 6, sup: "V01" },
  { code: "F007", name: "だし（業務用）", unit: "本", price: 1450, usual: 4, sup: "V01" },
  { code: "F008", name: "刻みねぎ", unit: "袋", price: 320, usual: 3, sup: "V01" },
  { code: "F009", name: "鶏もも肉", unit: "kg", price: 980, usual: 5, sup: "V03" },
  { code: "F010", name: "豚バラ肉", unit: "kg", price: 1280, usual: 4, sup: "V03" },
  { code: "F011", name: "卵", unit: "パック", price: 290, usual: 6, sup: "V03" },
  { code: "F012", name: "天ぷら粉", unit: "袋", price: 640, usual: 2, sup: "V03" },
  { code: "V101", name: "青ねぎ", unit: "kg", price: 980, usual: 2, sup: "V02" },
  { code: "V102", name: "玉ねぎ", unit: "kg", price: 210, usual: 10, sup: "V02" },
  { code: "V103", name: "しょうが", unit: "kg", price: 1200, usual: 1, sup: "V02" },
  { code: "V104", name: "大根", unit: "本", price: 150, usual: 4, sup: "V02" },
  { code: "S201", name: "割り箸", unit: "箱", price: 2450, usual: 2, sup: "V04" },
  { code: "S202", name: "紙おしぼり", unit: "箱", price: 1980, usual: 3, sup: "V04" },
  { code: "S203", name: "持ち帰り容器（大）", unit: "箱", price: 3600, usual: 2, sup: "V04" },
  { code: "S204", name: "持ち帰り容器（小）", unit: "箱", price: 1250, usual: 6, sup: "V04" },
  { code: "S205", name: "洗剤（業務用）", unit: "本", price: 1580, usual: 3, sup: "V04" },
];
const itemBy = name => ITEMS.find(i => i.name === name);

const JP_NAMES = ["山口 美穂", "田中 健", "佐々木 翔", "中村 優子", "小林 大輔", "加藤 彩", "吉田 直樹",
  "松本 さくら", "井上 拓也", "木村 真由", "林 勇気", "清水 涼", "森 千尋", "池田 航", "橋本 陽菜",
  "石川 蓮", "前田 美咲", "藤田 悠真", "岡田 結衣", "後藤 陸"];
const FOREIGN_NAMES = ["チャン・ミン・ドゥック", "ライ・シータ", "マリア・サントス", "王 芳", "グエン・ティ・ラン"];

const EMPLOYEES = {};
STORES.forEach((s, i) => {
  const r = rng(hashStr("emp" + s.code));
  const n = ri(r, 5, 7);
  const names = shuffle(r, JP_NAMES).slice(0, n - 1);
  names.push(pick(r, FOREIGN_NAMES));
  EMPLOYEES[s.code] = names.map((nm, k) => ({ code: "E" + String(i + 1).padStart(2, "0") + String(k + 1).padStart(2, "0"), name: nm }));
});
EMPLOYEES["S04"] = ["山口 美穂", "グエン・ヴァン・アン", "グエン・ティ・ラン", "田中 健", "李 偉", "佐々木 翔", "中村 優子"]
  .map((nm, k) => ({ code: "E04" + String(k + 1).padStart(2, "0"), name: nm }));
const empBy = (store, name) => (EMPLOYEES[store] || []).find(e => e.name === name);

const STAFF = ["佐藤", "鈴木", "田中"];        // 本部の担当者（架空）
const ME = "田中";

const DOC_TYPES = {
  nikkei: { label: "日計表", system: "sales", daily: true },
  hatchu: { label: "発注書", system: "purchase" },
  nohin: { label: "納品書", system: "purchase" },
  zaiko: { label: "在庫表", system: "purchase" },
  kintai: { label: "勤怠表", system: "attendance" },
  shift: { label: "シフト表", system: "attendance" },
  seikyu: { label: "請求書", system: "accounting" },
};
const TYPE_ORDER = ["nikkei", "hatchu", "nohin", "zaiko", "kintai", "shift", "seikyu"];

/* ── セル（読み取った1項目） ─────────────────────────── */
let CID = 0;
function show(v, fmt) {
  if (v === null || v === undefined || v === "") return "";
  if (fmt === "yen" || fmt === "num") return Number(v).toLocaleString("ja-JP");
  return String(v);
}
/* raw＝用紙に書かれている文字、v＝AI が読み取った値、conf＝読み取りの確からしさ */
function C(label, v, o = {}) {
  const fmt = o.fmt || "text";
  CID++;
  return {
    id: "c" + CID, label, key: o.key || label, fmt,
    v, orig: v, raw: o.raw !== undefined ? o.raw : show(v, fmt),
    conf: o.conf !== undefined ? o.conf : 0.95 + (CID % 5) / 100,
    smudge: !!o.smudge, sflags: o.flags || [], res: {}, info: o.info || null, edited: false,
    master: o.master || null,   // "item" | "emp"
  };
}

/* ── 書類の一覧（届いた日ごと） ───────────────────── */
const FEATURED = { nikkei: ["S01", "S07"], hatchu: ["S02"], nohin: ["S03"], kintai: ["S04"], zaiko: ["S05"], shift: ["S06"], seikyu: ["H00"] };
const MISSING_NIKKEI = ["S12", "S27"];   // 最新日に日計表が未着の店舗

function dayIndex(day) {
  const k = dkey(day);
  const latest = k === dkey(LATEST);
  const r = rng(hashStr("idx" + k));
  const list = [];
  const add = (type, store, minutes) => list.push({
    id: `${k}_${type}_${store}`, type, store, arrivalDay: day,
    arrival: atTime(day, minutes), via: r() < 0.82 ? "FAX" : "スキャン",
  });
  STORES.forEach(s => {
    if (latest && MISSING_NIKKEI.includes(s.code)) return;
    add("nikkei", s.code, ri(r, 6 * 60 + 40, 9 * 60 + 50));
  });
  const choose = (n, must) => {
    let arr = shuffle(r, STORES.map(s => s.code)).slice(0, n);
    if (latest && must) must.forEach(m => { if (!arr.includes(m)) arr[arr.length - 1 - must.indexOf(m)] = m; });
    return arr;
  };
  choose(18, ["S04"]).forEach(c => add("kintai", c, ri(r, 7 * 60, 10 * 60 + 30)));
  choose(14, ["S02"]).forEach(c => add("hatchu", c, ri(r, 8 * 60, 11 * 60 + 30)));
  choose(9, ["S03"]).forEach(c => add("nohin", c, ri(r, 9 * 60, 15 * 60)));
  choose(4, ["S05"]).forEach(c => add("zaiko", c, ri(r, 10 * 60, 16 * 60)));
  choose(1, ["S06"]).forEach(c => add("shift", c, ri(r, 14 * 60, 17 * 60)));
  add("seikyu", "H00", ri(r, 11 * 60, 16 * 60));
  list.sort((a, b) => a.arrival - b.arrival);
  return list;
}

function docDateOf(meta) {
  if (meta.type === "nikkei" || meta.type === "kintai") return addDays(meta.arrivalDay, -1);
  return meta.arrivalDay;
}

/* ── 書類の生成 ──────────────────────────────────── */
function baseDoc(meta) {
  return {
    id: meta.id, type: meta.type, store: meta.store, arrival: meta.arrival, arrivalDay: meta.arrivalDay,
    docDate: docDateOf(meta), via: meta.via, status: "ok", confirmedBy: null, confirmedAt: null,
    head: [], kv: [], cols: null, rows: [], foot: [], meta: {},
    typeConf: 0.97 + (hashStr(meta.id) % 3) / 100,
  };
}
function isFeatured(meta) {
  return dkey(meta.arrivalDay) === dkey(LATEST) && (FEATURED[meta.type] || []).includes(meta.store);
}

function buildDoc(meta) {
  const d = baseDoc(meta);
  const r = rng(hashStr("doc" + meta.id));
  const st = storeBy(meta.store);
  const emps = EMPLOYEES[meta.store] || [];
  const feat = isFeatured(meta);
  const dd = d.docDate;

  if (meta.type === "nikkei") {
    let sales, cash, card, qr, guests, diff = 0, qrO = {}, guestO = {}, writer = pick(r, emps).name;
    if (feat && meta.store === "S01") {
      sales = 128450; cash = 61230; card = 45820; qr = 21490; guests = 137; writer = "山本 和也";
      qrO = { raw: "21,400", smudge: true, conf: 0.58, flags: [{ kind: "low", msg: "「0」と「9」の判別に自信がありません" }] };
    } else if (feat && meta.store === "S07") {
      sales = 77420; cash = 35120; card = 27300; qr = 15000; guests = 36;
      guestO = { raw: "86", smudge: true, conf: 0.61, flags: [{ kind: "low", msg: "「8」と「3」の判別に自信がありません。36人だと客単価が約2,150円になり、いつもの約900円と大きく違います" }] };
    } else {
      sales = ri(r, 6000, 19000) * 10;
      card = Math.round(sales * (0.28 + r() * 0.12) / 10) * 10;
      qr = Math.round(sales * (0.12 + r() * 0.1) / 10) * 10;
      cash = sales - card - qr;
      guests = Math.round(sales / ri(r, 850, 1100));
      diff = r() < 0.15 ? pick(r, [-100, 50, -50, 100]) : 0;
    }
    d.head = [C("店舗名", st.name, { key: "store" }), C("営業日", ymd(dd), { key: "date" }), C("記入者", writer, { key: "writer" })];
    d.kv = [
      C("売上合計（税込）", sales, { key: "sales", fmt: "yen" }),
      C("現金", cash, { key: "cash", fmt: "yen" }),
      C("クレジットカード", card, { key: "card", fmt: "yen" }),
      C("電子マネー・QR", qr, Object.assign({ key: "qr", fmt: "yen" }, qrO)),
      C("客数", guests, Object.assign({ key: "guests", fmt: "num" }, guestO)),
      C("現金過不足", diff, { key: "diff", fmt: "yen" }),
    ];
  }

  if (meta.type === "hatchu") {
    let rows;
    if (feat) {
      rows = [["冷凍うどん玉", 120, "玉"], ["ごぼ天", 40, "枚"], ["かまぼこ", 6, "本"], ["丸天", 30, "枚"], ["だし（業務用）", 4, "本"], ["刻みねぎ", 3, "袋"]];
    } else {
      rows = shuffle(r, ITEMS.filter(i => i.sup === "V01")).slice(0, ri(r, 4, 7))
        .map(i => [i.name, Math.max(1, Math.round(i.usual * (0.7 + r() * 0.6))), i.unit]);
    }
    d.head = [C("店舗名", st.name, { key: "store" }), C("発注日", ymd(dd), { key: "date" }),
      C("納品希望日", ymd(addDays(dd, 1)), { key: "due" }), C("発注先", supBy("V01").name, { key: "sup" })];
    d.cols = [{ key: "item", label: "品目", w: 46 }, { key: "qty", label: "数量", w: 18 }, { key: "unit", label: "単位", w: 14 }];
    d.rows = rows.map(([n, q, u]) => {
      const o = { key: "qty", fmt: "num" };
      if (feat && n === "ごぼ天") o.flags = [{ kind: "anomaly", msg: "いつもの発注量（約8枚）の5倍です" }];
      return { item: C("品目", n, { key: "item", master: "item" }), qty: C("数量", q, o), unit: C("単位", u, { key: "unit" }) };
    });
  }

  if (meta.type === "nohin") {
    let sup = feat ? "V02" : pick(r, ["V02", "V03", "V04"]);
    let lines;
    if (feat) {
      lines = [["青ねぎ", 2, 980, 1960], ["玉ねぎ", 10, 210, 2100], ["しょうが", 1, 1200, 1200], ["大根", 4, 150, 800]];
    } else {
      lines = shuffle(r, ITEMS.filter(i => i.sup === sup)).slice(0, ri(r, 3, 4))
        .map(i => { const q = Math.max(1, Math.round(i.usual * (0.7 + r() * 0.6))); return [i.name, q, i.price, q * i.price]; });
    }
    const total = lines.reduce((s, l) => s + l[3], 0);
    d.head = [C("取引先", supBy(sup).name, { key: "sup" }), C("納品先", st.name, { key: "store" }),
      C("納品日", ymd(dd), { key: "date" }), C("伝票番号", String(10000 + (hashStr(meta.id) % 9000)), { key: "slip" })];
    d.cols = [{ key: "item", label: "品目", w: 34 }, { key: "qty", label: "数量", w: 12 }, { key: "price", label: "単価", w: 16 }, { key: "amount", label: "金額", w: 18 }];
    d.rows = lines.map(([n, q, p, a]) => {
      const qo = { key: "qty", fmt: "num" };
      if (feat && n === "玉ねぎ") qo.flags = [{ kind: "anomaly", msg: "発注書の数量（12kg）と違います（納品 10kg）" }];
      return { item: C("品目", n, { key: "item", master: "item" }), qty: C("数量", q, qo), price: C("単価", p, { key: "price", fmt: "yen" }), amount: C("金額", a, { key: "amount", fmt: "yen" }) };
    });
    d.foot = [C("合計金額", total, { key: "total", fmt: "yen" })];
  }

  if (meta.type === "zaiko") {
    let rows;
    if (feat) {
      rows = [["冷凍うどん玉", 35, "玉", 210], ["生そば", 40, "玉", 44], ["かまぼこ", 17, "本", 12], ["丸天", 45, "枚", 50],
        ["だし（業務用）", 6, "本", 7], ["刻みねぎ", 4, "袋", 5], ["卵", 8, "パック", 9], ["天ぷら粉", 3, "袋", 3]];
    } else {
      rows = shuffle(r, ITEMS.filter(i => i.code.startsWith("F"))).slice(0, 8)
        .map(i => { const q = Math.round(i.usual * (0.8 + r() * 1.2)); return [i.name, q, i.unit, Math.round(q * (0.85 + r() * 0.3))]; });
    }
    d.head = [C("店舗名", st.name, { key: "store" }), C("棚卸し日", ymd(dd), { key: "date" }), C("記入者", pick(r, emps).name, { key: "writer" })];
    d.cols = [{ key: "item", label: "品目", w: 44 }, { key: "qty", label: "在庫数", w: 18 }, { key: "unit", label: "単位", w: 14 }];
    d.rows = rows.map(([n, q, u, prev]) => {
      const o = { key: "qty", fmt: "num" };
      if (feat && n === "冷凍うどん玉") o.flags = [{ kind: "anomaly", msg: "前回の棚卸し（210玉）から大きく減っています（▲83%）" }];
      if (feat && n === "かまぼこ") Object.assign(o, { raw: "12", smudge: true, conf: 0.6, flags: [{ kind: "low", msg: "「2」と「7」の判別に自信がありません（前回は12本）" }] });
      const c = { item: C("品目", n, { key: "item", master: "item" }), qty: C("在庫数", q, o), unit: C("単位", u, { key: "unit" }) };
      c.qty.prev = prev;
      return c;
    });
  }

  if (meta.type === "kintai") {
    let rows;
    if (feat) {
      rows = [
        ["山口 美穂", "10:00", "15:00", "", "", {}],
        ["グエン", "11:00", "20:30", "", "Xin nghỉ ngày 28", { lang: "ベトナム語", tr: "28日はお休みをお願いします" }],
        ["田中 健", "17:00", "23:30", "", "", { outRaw: "22:30" }],
        ["李 偉", "09:00", "14:00", "", "25号请假", { lang: "中国語", tr: "25日はお休みをお願いします" }],
        ["佐々木 翔", "18:00", "23:00", "0:45", "", {}],
      ];
    } else {
      rows = shuffle(r, emps).slice(0, Math.min(emps.length, ri(r, 4, 6))).map(e => {
        const len = pick(r, [4, 5, 5, 6, 8]);                       // 実働時間
        const st0 = len === 8 ? pick(r, [9, 10, 11]) : len === 6 ? pick(r, [9, 10, 11, 17]) : pick(r, [9, 10, 11, 17, 18]);
        const en = st0 + len + (len === 8 ? 1 : 0);                   // 8時間は休憩1時間
        const hh = n => `${String(n).padStart(2, "0")}:00`;
        return [e.name, hh(st0), hh(en), len === 8 ? "1:00" : "", "", {}];
      });
    }
    d.head = [C("店舗名", st.name, { key: "store" }), C("勤務日", ymd(dd), { key: "date" })];
    d.cols = [{ key: "emp", label: "氏名", w: 26 }, { key: "in", label: "出勤", w: 12 }, { key: "out", label: "退勤", w: 12 }, { key: "brk", label: "休憩", w: 11 }, { key: "note", label: "備考", w: 25 }];
    d.rows = rows.map(([n, i, o, b, note, x]) => {
      const emp = C("氏名", n, { key: "emp", master: "emp" });
      if (feat && n === "グエン") emp.hint = "シフト表（今週分）では、この時間帯の勤務はグエン・ヴァン・アンさんです";
      const outO = { key: "out", fmt: "time" };
      if (x.outRaw) Object.assign(outO, { raw: x.outRaw, smudge: true, conf: 0.55, flags: [{ kind: "low", msg: "「2」と「3」の判別に自信がありません" }] });
      const noteO = { key: "note" };
      if (x.lang) noteO.info = { kind: "translate", msg: `${x.lang}の記載を訳しました：「${x.tr}」` };
      return { emp, in: C("出勤", i, { key: "in", fmt: "time" }), out: C("退勤", o, outO), brk: C("休憩", b, { key: "brk", fmt: "dur" }), note: C("備考", note, noteO) };
    });
  }

  if (meta.type === "shift") {
    const ws = addDays(dd, (8 - dd.getDay()) % 7 || 7);   // 翌週の月曜
    d.meta.weekStart = ws;
    const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(ws, i));
    d.head = [C("店舗名", st.name, { key: "store" }), C("対象週", `${md(days[0])}〜${md(days[6])}`, { key: "week" })];
    d.cols = [{ key: "emp", label: "氏名", w: 23 }].concat(days.map((x, i) => ({ key: "d" + i, label: `${x.getDate()}(${WD[x.getDay()]})`, w: 11 })));
    d.rows = emps.slice(0, 6).map((e, k) => {
      const row = { emp: C("氏名", e.name, { key: "emp", master: "emp" }) };
      days.forEach((x, i) => {
        let v = r() < 0.28 ? "休" : pick(r, ["10-15", "11-16", "17-22", "18-23", "9-14"]);
        const o = { key: "d" + i };
        if (feat && k === 2 && i === 3) { v = "10-19"; Object.assign(o, { raw: "10-14", smudge: true, conf: 0.58, flags: [{ kind: "low", msg: "「4」と「9」の判別に自信がありません" }] }); }
        row["d" + i] = C(`${md(x)}`, v, o);
      });
      return row;
    });
  }

  if (meta.type === "seikyu") {
    let lines;
    if (feat) {
      lines = [["割り箸", 2, 2450, 4900, {}], ["紙おしぼり", 3, 1980, 5940, {}],
        ["持ち帰り容器（小）", 10, 1250, 12000, { raw: "12,500", smudge: true, conf: 0.63, flags: [{ kind: "low", msg: "「0」と「5」の判別に自信がありません" }] }],
        ["洗剤（業務用）", 4, 1580, 6320, {}]];
    } else {
      lines = shuffle(r, ITEMS.filter(i => i.sup === "V04")).slice(0, 4)
        .map(i => { const q = ri(r, 2, 8); return [i.name, q, i.price, q * i.price, {}]; });
    }
    const sub = feat ? 29660 : lines.reduce((s, l) => s + l[3], 0);
    const tax = Math.floor(sub * 0.1);
    d.head = [C("請求元", supBy("V04").name, { key: "sup" }), C("請求先", "本部 経理", { key: "to" }),
      C("請求日", ymd(dd), { key: "date" }), C("請求番号", "C-" + (2000 + (hashStr(meta.id) % 800)), { key: "no" })];
    d.cols = [{ key: "item", label: "品目", w: 34 }, { key: "qty", label: "数量", w: 12 }, { key: "price", label: "単価", w: 16 }, { key: "amount", label: "金額", w: 18 }];
    d.rows = lines.map(([n, q, p, a, o]) => ({
      item: C("品目", n, { key: "item", master: "item" }), qty: C("数量", q, { key: "qty", fmt: "num" }),
      price: C("単価", p, { key: "price", fmt: "yen" }), amount: C("金額", a, Object.assign({ key: "amount", fmt: "yen" }, o)),
    }));
    d.foot = [C("小計", sub, { key: "sub", fmt: "yen" }), C("消費税（10%）", tax, { key: "tax", fmt: "yen" }), C("請求金額", sub + tax, { key: "total", fmt: "yen" })];
  }

  return d;
}

/* ── 操作の記録（これまでの分・架空） ───────────────── */
function initialLog() {
  const t = (h, m) => atTime(TODAY, h * 60 + m);
  const y = (h, m) => atTime(LATEST, h * 60 + m);
  return [
    { at: t(8, 52), user: "佐藤", action: "まとめて確定", target: `${md(LATEST)} 着の書類`, detail: "要確認のない書類 39件" },
    { at: t(8, 47), user: "佐藤", action: "修正", target: "勤怠表 若葉店", detail: "退勤「21:30」→「21:00」" },
    { at: t(8, 41), user: "佐藤", action: "候補を採用", target: "発注書 大橋店", detail: "品目「天ぷらこ」→「天ぷら粉」" },
    { at: t(8, 35), user: "佐藤", action: "ログイン", target: "", detail: "二段階認証" },
    { at: y(18, 5), user: "鈴木", action: "書き出し", target: "売上管理システム", detail: `${md(addDays(LATEST, -1))} 着 日計表 33件` },
    { at: y(17, 58), user: "鈴木", action: "照合", target: "売上管理システム", detail: "差のある店舗 0件" },
    { at: y(9, 12), user: "鈴木", action: "修正", target: "日計表 栄町店", detail: "客数「47」→「41」" },
  ];
}
