"use strict";
/* Читалка: библиотека постов. Маршруты в hash: #/ #/s/<раздел> #/p/<пост> #/topics #/t/<тема> #/search #/history */

// ---------- хранилище на устройстве ----------
const store = {
  get(key, def) {
    try { const v = localStorage.getItem("reader." + key); return v === null ? def : JSON.parse(v); }
    catch (e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem("reader." + key, JSON.stringify(val)); } catch (e) { /* приватный режим */ }
  },
};
const state = {
  read: store.get("read", {}),          // id → время открытия
  history: store.get("history", []),    // [{id, at}] последние открытые
  uni: store.get("uni", "men"),
  font: store.get("font", "sans"),
  size: store.get("size", 3),
  queries: store.get("queries", []),
  query: "",
  tab: "library",
};
const SIZES = [15, 16, 17, 18, 20, 22, 24];

let LIB = null;            // данные
const POST = new Map();    // id → пост
const SEC = new Map();     // id раздела → раздел (+ uni)
const TAG = new Map();     // id темы → тема

// ---------- иконки (в духе SF Symbols, одна толщина) ----------
const ICON = {
  book: '<path d="M12 6.5C10.2 5.2 7.6 4.6 4 4.8v13.4c3.6-.2 6.2.4 8 1.7 1.8-1.3 4.4-1.9 8-1.7V4.8c-3.6-.2-6.2.4-8 1.7Z"/><path d="M12 6.5v13.4"/>',
  tag: '<path d="M3.5 12.2V4.8c0-.7.6-1.3 1.3-1.3h7.4c.4 0 .7.1 1 .4l7.4 7.4c.5.5.5 1.3 0 1.8l-7.4 7.4c-.5.5-1.3.5-1.8 0l-7.5-7.4c-.3-.3-.4-.6-.4-1Z"/><circle cx="8.2" cy="8.2" r="1.4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.4 15.4 5.1 5.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
  left: '<path d="M15 4.5 7.5 12l7.5 7.5"/>',
  right: '<path d="M9 4.5 16.5 12 9 19.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  moon: '<path d="M20 14.6A8.2 8.2 0 0 1 9.4 4a8.2 8.2 0 1 0 10.6 10.6Z"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
};
const icon = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const chev = '<svg class="chev" viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2.5 9.5 7 5 11.5"/></svg>';

// ---------- утилиты ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};
const posts = (n) => `${n} ${plural(n, "пост", "поста", "постов")}`;
const preview = (p) => {
  const b = p.b.find((x) => x[0] === "p" || x[0] === "q" || x[0] === "li");
  return b ? b[1].slice(0, 220) : "";
};
const isRead = (id) => Boolean(state.read[id]);
const secPosts = (sec) => sec.posts.concat(...sec.subs.map((s) => s.posts));

function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)»])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

// ---------- тема ----------
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function setTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  store.set("theme", t === "auto" ? null : t);
  syncChrome();
}
function syncChrome() {
  const dark = effectiveTheme() === "dark";
  const reading = document.body.classList.contains("reading");
  $("#theme-color").content = dark ? "#000000" : reading ? "#FFFFFF" : "#F2F2F7";
  const btn = $("#theme-btn");
  if (btn) {
    btn.innerHTML = icon(dark ? "sun" : "moon");
    btn.setAttribute("aria-label", dark ? "Светлая тема" : "Тёмная тема");
  }
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncChrome);

function applyReading() {
  document.documentElement.dataset.font = state.font;
  document.documentElement.style.setProperty("--read-size", SIZES[state.size] + "px");
}

// ---------- русский стеммер (Snowball) для поиска по любой форме слова ----------
const RU = {
  perf: /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/,
  refl: /(с[яь])$/,
  adj: /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/,
  part: /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/,
  verb: /((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/,
  noun: /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/,
  deriv: /[^аеиоуыэюя][аеиоуыэюя]+[^аеиоуыэюя]+[аеиоуыэюя].*(?<=о)сть?$/,
  sup: /(ейше|ейш)$/,
};
const stemCache = new Map();
function stem(w) {
  w = w.toLowerCase().replace(/ё/g, "е");
  if (stemCache.has(w)) return stemCache.get(w);
  let out = w;
  const m = /^(.*?[аеиоуыэюя])(.*)$/.exec(w);
  if (m) {
    let rv = m[2];
    let t = rv.replace(RU.perf, "");
    if (t === rv) {
      rv = rv.replace(RU.refl, "");
      t = rv.replace(RU.adj, "");
      if (t !== rv) rv = t.replace(RU.part, "");
      else { t = rv.replace(RU.verb, ""); rv = t === rv ? rv.replace(RU.noun, "") : t; }
    } else rv = t;
    rv = rv.replace(/и$/, "");
    if (RU.deriv.test(rv)) rv = rv.replace(/ость?$/, "");
    t = rv.replace(/ь$/, "");
    rv = t === rv ? rv.replace(RU.sup, "").replace(/нн$/, "н") : t;
    out = m[1] + rv;
  }
  stemCache.set(w, out);
  return out;
}
const WORD = /[0-9a-zа-яё]+/gi;

let INDEX = null;   // основа слова → Map(id поста → вес)
let INDEX_KEYS = [];
function buildIndex() {
  INDEX = new Map();
  const add = (s, id, wgt) => {
    let m = INDEX.get(s);
    if (!m) INDEX.set(s, (m = new Map()));
    m.set(id, (m.get(id) || 0) + wgt);
  };
  for (const p of LIB.posts) {
    for (const w of p.t.match(WORD) || []) add(stem(w), p.id, 6);
    for (const b of p.b) if (b[0] !== "img") for (const w of b[1].match(WORD) || []) add(stem(w), p.id, 1);
  }
  INDEX_KEYS = [...INDEX.keys()];
}

function search(q) {
  const words = (q.toLowerCase().match(WORD) || []).filter((w) => w.length > 1 || /\d/.test(w));
  if (!words.length) return null;
  if (!INDEX) buildIndex();
  const terms = words.map(stem);
  let scores = null;
  for (const term of terms) {
    const hits = new Map();
    // совпадение по началу основы: «бывш» найдёт «бывшая», «бывшей», «бывшую»
    for (const k of INDEX_KEYS) {
      if (!k.startsWith(term)) continue;
      for (const [id, w] of INDEX.get(k)) hits.set(id, (hits.get(id) || 0) + w);
    }
    if (!scores) scores = hits;
    else {
      const next = new Map();
      for (const [id, w] of hits) if (scores.has(id)) next.set(id, scores.get(id) + w);
      scores = next;
    }
  }
  const res = [...scores].sort((a, b) => b[1] - a[1]).map(([id]) => POST.get(id));
  return { terms, res };
}

// подсветка совпадений и фрагмент вокруг первого из них
function matcher(terms) {
  return (word) => terms.some((t) => stem(word).startsWith(t));
}
function highlight(text, isHit) {
  return esc(text).replace(/[0-9a-zа-яё]+/gi, (w) => (isHit(w) ? `<mark>${w}</mark>` : w));
}
function snippet(p, isHit) {
  for (const b of p.b) {
    if (b[0] === "img") continue;
    const re = /[0-9a-zа-яё]+/gi;
    let m;
    while ((m = re.exec(b[1]))) {
      if (!isHit(m[0])) continue;
      let s = Math.max(0, m.index - 60), e = Math.min(b[1].length, m.index + 120);
      if (s > 0) s = b[1].indexOf(" ", s) + 1;
      const cut = b[1].slice(s, e);
      return (s > 0 ? "…" : "") + highlight(cut, isHit) + (e < b[1].length ? "…" : "");
    }
  }
  return esc(preview(p));
}

// ---------- история ----------
function markOpened(id) {
  state.read[id] = Date.now();
  store.set("read", state.read);
  state.history = [{ id, at: Date.now() }].concat(state.history.filter((h) => h.id !== id)).slice(0, 60);
  store.set("history", state.history);
}

// ---------- навигация ----------
let stack = [];
try { stack = JSON.parse(sessionStorage.getItem("reader.stack") || "[]"); } catch (e) { stack = []; }
const scrolls = {};
let current = null;
history.scrollRestoration = "manual";

function parse(hash) {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [a, b] = parts;
  if (!a) return { name: "library", root: "library", depth: 0 };
  if (a === "s" && SEC.has(b)) return { name: "section", id: b, depth: 1 };
  if (a === "p" && POST.has(+b)) return { name: "post", id: +b, depth: 2 };
  if (a === "topics") return { name: "topics", root: "topics", depth: 0 };
  if (a === "t" && TAG.has(b)) return { name: "topic", id: b, depth: 1 };
  if (a === "search") return { name: "search", root: "search", depth: 0 };
  if (a === "history") return { name: "history", root: "history", depth: 0 };
  return { name: "library", root: "library", depth: 0 };
}
const go = (hash) => { location.hash = hash; };

// В стеке экранов «~» помечает экран, которого нет в истории браузера (открыли пост прямой ссылкой):
// назад к нему переходим ссылкой, а не history.back(), иначе выйдем из приложения.
const plain = (h) => h.replace(/^~/, "");

function onRoute() {
  const hash = location.hash || "#/";
  for (const o of document.querySelectorAll(".overlay")) o.remove();   // шторка и картинка закрываются при переходе
  if (current) scrolls[current] = window.scrollY;
  const r = parse(hash);
  let dir = "none";
  if (r.root) {
    stack = [hash];
    state.tab = r.root;
  } else if (stack.length > 1 && plain(stack[stack.length - 2]) === hash) {
    stack.pop();
    stack[stack.length - 1] = hash;
    dir = "pop";
  } else if (plain(stack[stack.length - 1] || "") !== hash) {
    stack.push(hash);
    dir = "push";
  }
  if (!r.root && !/^~?#\/?(topics|search|history)?$/.test(stack[0] || "")) stack.unshift("~#/");
  try { sessionStorage.setItem("reader.stack", JSON.stringify(stack)); } catch (e) {}
  if (!current) dir = "none";   // первый экран при открытии приложения не въезжает
  if (swipeCommitted) { dir = "none"; swipeCommitted = false; }   // свайп уже отыграл переход
  current = hash;
  render(r, dir);
  window.scrollTo(0, dir === "push" ? 0 : scrolls[hash] || 0);
}

function backTarget() {
  return stack.length > 1 ? plain(stack[stack.length - 2]) : "#/";
}
function goBack() {
  if (stack.length > 1 && !stack[stack.length - 2].startsWith("~")) history.back();
  else go(backTarget());
}
function backLabel() {
  const r = parse(backTarget());
  if (r.name === "section") return SEC.get(r.id).title;
  if (r.name === "topic") return TAG.get(r.id).t;
  if (r.name === "post") return "Назад";
  return { library: "Библиотека", topics: "Темы", search: "Поиск", history: "История" }[r.name];
}

// ---------- общие куски разметки ----------
function navbar({ title = "", back = false, right = "" }) {
  return `<header class="nav" id="nav"><div class="nav-in">
    <div class="nav-left">${back ? `<button class="back" id="back">${icon("left")}<span>${esc(backLabel())}</span></button>` : ""}</div>
    <div class="nav-title">${esc(title)}</div>
    <div class="nav-right">${right}</div></div></header>`;
}
const themeBtn = '<button class="icon-btn" id="theme-btn"></button>';

function tabbar() {
  const tabs = [["library", "#/", "book", "Библиотека"], ["topics", "#/topics", "tag", "Темы"],
    ["search", "#/search", "search", "Поиск"], ["history", "#/history", "clock", "История"]];
  return `<nav class="tabbar" aria-label="Разделы приложения"><div class="tabbar-in">${tabs.map(([k, h, ic, label]) =>
    `<a class="tab" href="${h}" ${state.tab === k ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span></a>`).join("")}</div></nav>`;
}

function postRow(p, opts = {}) {
  const sec = SEC.get(p.s);
  const where = opts.where ? `<div class="where">${esc(sec.title)}${p.sub ? " · " + esc(p.sub) : ""}</div>` : "";
  const title = opts.hit ? highlight(p.t, opts.hit) : esc(p.t);
  const body = opts.hit ? `<div class="snip">${snippet(p, opts.hit)}</div>` : `<div class="pv">${esc(preview(p))}</div>`;
  return `<a class="post-row" href="#/p/${p.id}">
    <span class="dot ${isRead(p.id) ? "read" : ""}" ${isRead(p.id) ? 'aria-hidden="true"' : 'role="img" aria-label="Не прочитан"'}></span>
    <div class="head"><span class="t">${title}</span><span class="min">${p.min} мин</span></div>
    ${body}${where}</a>`;
}

// ---------- экраны ----------
function libraryView() {
  const uni = LIB.universes.find((u) => u.id === state.uni) || LIB.universes[0];
  const recent = state.history.slice(0, 10).map((h) => POST.get(h.id)).filter(Boolean);
  const total = LIB.posts.length, done = LIB.posts.filter((p) => isRead(p.id)).length;
  const shelf = recent.length ? `<div class="group-h"><span>Недавние</span><a class="text-btn" href="#/history">Все</a></div>
    <div class="shelf">${recent.map((p) => `<a class="shelf-card" href="#/p/${p.id}"><span class="t">${esc(p.t)}</span>
      <span class="s">${esc(SEC.get(p.s).title)}</span></a>`).join("")}</div>` : "";
  const rows = uni.sections.map((s) => {
    // прогресс словами в подписи: «30 постов · новых 29», когда раздел начат; галочка — когда прочитан весь
    const ids = secPosts(s), unread = ids.filter((id) => !isRead(id)).length;
    const status = unread === 0 ? " · всё прочитано" : unread < ids.length ? ` · новых ${unread}` : "";
    const end = unread === 0 ? `<span class="done" aria-hidden="true">${icon("check")}</span>` : "";
    const subs = s.subs.length ? ` · ${s.subs.length} ${plural(s.subs.length, "подраздел", "подраздела", "подразделов")}` : "";
    return `<a class="row" href="#/s/${s.id}"><div class="main"><div class="t">${esc(s.title)}</div>
      <div class="s">${posts(ids.length)}${subs}${status}</div></div>${end}${chev}</a>`;
  }).join("");
  return {
    title: "Библиотека",
    nav: navbar({ title: "Библиотека", right: themeBtn }), html: `
    <div class="large"><h1>Библиотека</h1></div>
    <div class="seg" role="group" aria-label="Вселенная">${LIB.universes.map((u) =>
      `<button data-uni="${u.id}" aria-pressed="${u.id === uni.id}">${u.id === "men" ? "Мужество" : "Женщины"}</button>`).join("")}</div>
    ${shelf}
    <div class="group-h"><span>${esc(uni.title)}</span></div>
    <div class="group">${rows}</div>
    <div class="group-f">Прочитано ${done} из ${total}</div>`,
  };
}

function sectionView(id) {
  const s = SEC.get(id);
  const ids = secPosts(s);
  let body = "";
  if (s.posts.length) body += `${s.subs.length ? '<div class="sticky-h first">Без подраздела</div>' : ""}<div class="group">${s.posts.map((x) => postRow(POST.get(x))).join("")}</div>`;
  for (const sub of s.subs) {
    body += `<div class="sticky-h">${esc(sub.title)}</div><div class="group">${sub.posts.map((x) => postRow(POST.get(x))).join("")}</div>`;
  }
  const unread = ids.filter((x) => !isRead(x)).length;
  return {
    title: s.title,
    nav: navbar({ title: s.title, back: true }), html: `
    <div class="large"><h1>${esc(s.title)}</h1><div class="sub">${posts(ids.length)}${unread ? ` · не открыто ${unread}` : " · всё прочитано"}</div></div>
    ${body}`,
  };
}

function postView(id, peek = false) {
  const p = POST.get(id);
  const s = SEC.get(p.s);
  if (!peek) markOpened(id);
  const order = secPosts(s);
  const i = order.indexOf(id);
  const prev = order[i - 1], next = order[i + 1];
  let html = "", list = null;
  for (const [type, val] of p.b) {
    if (type !== "li" && list !== null) { html += `<ul>${list}</ul>`; list = null; }
    if (type === "p") html += `<p>${linkify(val)}</p>`;
    else if (type === "h") html += `<h2>${linkify(val)}</h2>`;
    else if (type === "q") html += `<blockquote><p>${linkify(val)}</p></blockquote>`;
    else if (type === "li") list = (list || "") + `<li>${linkify(val)}</li>`;
    else if (type === "img") html += `<figure><button data-img="${esc(imgSrc(val))}" aria-label="Открыть картинку на весь экран"><img src="${esc(imgSrc(val))}" alt="Вставка из поста: скриншот или фото" loading="lazy"></button></figure>`;
  }
  if (list !== null) html += `<ul>${list}</ul>`;
  const tags = p.tags.map((t) => TAG.get(t)).filter(Boolean);
  const rel = p.rel.map((x) => POST.get(x)).filter(Boolean);
  const after = `
    ${tags.length ? `<div class="group-h"><span>Темы</span></div><div class="chips">${tags.map((t) =>
      `<a class="chip" href="#/t/${t.id}">${esc(t.t)}<span class="n">${t.n}</span></a>`).join("")}</div>` : ""}
    ${rel.length ? `<div class="group-h"><span>Похожие</span></div><div class="group">${rel.map((x) => postRow(x, { where: true })).join("")}</div>` : ""}
    ${next ? `<div class="group-h"><span>Дальше в разделе</span></div><a class="next-card" href="#/p/${next}">
      <div class="k">${i + 2} из ${order.length}</div><div class="t">${esc(POST.get(next).t)}</div></a>` : ""}
    <button class="unread-btn" id="unread">Отметить как непрочитанный</button>`;
  return {
    title: p.t,
    reading: true,
    nav: navbar({ title: p.t, back: true, right: '<button class="text-btn aa" id="aa" aria-label="Шрифт и тема">Aa</button>' }), html: `
    <article class="article">
      <h1>${esc(p.t)}</h1>
      <div class="meta"><a href="#/s/${s.id}">${esc(s.title)}</a>${p.sub ? `<span>·</span><span>${esc(p.sub)}</span>` : ""}<span>·</span><span>${p.min} мин</span></div>
      <div class="prose">${html}</div>
    </article>
    <div class="after">${after}</div>`,
    bottom: `<nav class="toolbar" aria-label="Листать посты"><div class="toolbar-in">
      <button class="icon-btn" ${prev ? `data-go="#/p/${prev}"` : "disabled"} aria-label="Предыдущий пост">${icon("left")}</button>
      <span class="pos">${i + 1} из ${order.length}</span>
      <button class="icon-btn" ${next ? `data-go="#/p/${next}"` : "disabled"} aria-label="Следующий пост">${icon("right")}</button>
    </div></nav>`,
  };
}

function topicsView() {
  const rows = LIB.tags.slice().sort((a, b) => a.t.localeCompare(b.t, "ru")).map((t) =>
    `<a class="row" href="#/t/${t.id}"><div class="main"><div class="t">${esc(t.t)}</div></div><span class="end">${t.n}</span>${chev}</a>`).join("");
  return {
    title: "Темы",
    nav: navbar({ title: "Темы", right: themeBtn }), html: `
    <div class="large"><h1>Темы</h1><div class="sub">Посты из всех разделов, собранные по смыслу</div></div>
    <div class="group-h"><span>Все темы</span></div><div class="group">${rows}</div>`,
  };
}

function topicView(id) {
  const t = TAG.get(id);
  // сначала посты, для которых тема главная (теги поста идут от самой выраженной)
  const list = LIB.posts.filter((p) => p.tags.includes(id))
    .map((p, i) => [p.tags.indexOf(id), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
  return {
    title: t.t,
    nav: navbar({ title: t.t, back: true }), html: `
    <div class="large"><h1>${esc(t.t)}</h1><div class="sub">${posts(list.length)} из разных разделов</div></div>
    <div class="group" style="margin-top:12px">${list.map((p) => postRow(p, { where: true })).join("")}</div>`,
  };
}

function searchView() {
  return {
    title: "Поиск",
    nav: navbar({ title: "Поиск", right: themeBtn }), html: `
    <div class="large"><h1>Поиск</h1></div>
    <div class="search-wrap"><label class="search">${icon("search")}
      <input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Слово или фраза из поста" value="${esc(state.query)}" aria-label="Поиск по постам">
      <button class="clear" id="clear" aria-label="Очистить" ${state.query ? "" : "hidden"}>${icon("close")}</button></label></div>
    <div id="results"></div>`,
  };
}

function renderResults() {
  const box = $("#results");
  if (!box) return;
  const q = state.query.trim();
  const found = search(q);
  if (!found) {
    const recent = state.queries.length ? `<div class="group-h"><span>Недавние запросы</span><button class="text-btn" id="clear-q">Очистить</button></div>
      <div class="chips">${state.queries.map((x) => `<button class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join("")}</div>` : "";
    box.innerHTML = recent + `<div class="group-h"><span>Или выбери тему</span></div><div class="chips">${LIB.tags.slice().sort((a, b) => b.n - a.n).slice(0, 14)
      .map((t) => `<a class="chip" href="#/t/${t.id}">${esc(t.t)}<span class="n">${t.n}</span></a>`).join("")}</div>
      <p class="empty">Ищет по названиям и по тексту постов, в любой форме слова: «бывшая» найдёт и «бывшей», и «бывшую».</p>`;
    return;
  }
  if (!found.res.length) {
    box.innerHTML = `<div class="empty"><h2>Ничего не нашлось</h2>По запросу «${esc(q)}» нет постов. Попробуй другое слово или загляни в темы.</div>`;
    return;
  }
  const hit = matcher(found.terms);
  box.innerHTML = `<div class="found">${posts(found.res.length)}</div>
    <div class="group">${found.res.slice(0, 60).map((p) => postRow(p, { hit, where: true })).join("")}</div>
    ${found.res.length > 60 ? `<div class="group-f">Показаны первые 60. Уточни запрос ещё одним словом.</div>` : ""}`;
}

function historyView() {
  const items = state.history.map((h) => ({ ...h, p: POST.get(h.id) })).filter((h) => h.p);
  if (!items.length) {
    return { title: "История", nav: navbar({ title: "История", right: themeBtn }), html: `<div class="large"><h1>История</h1></div>
      <div class="empty"><h2>Пока пусто</h2>Здесь будут посты, которые ты открывал, чтобы быстро вернуться к прочитанному вчера.</div>` };
  }
  const day = (ts) => {
    const d = new Date(ts), now = new Date();
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(now) - start(d)) / 864e5);
    return diff === 0 ? "Сегодня" : diff === 1 ? "Вчера" : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  };
  let html = "", last = null, group = "";
  for (const h of items) {
    const g = day(h.at);
    if (g !== last) {
      if (group) html += `<div class="group">${group}</div>`;
      html += `<div class="group-h"><span>${g}</span></div>`;
      group = ""; last = g;
    }
    group += postRow(h.p, { where: true });
  }
  html += `<div class="group">${group}</div>`;
  return {
    title: "История",
    nav: navbar({ title: "История", right: '<button class="text-btn" id="clear-h">Очистить</button>' }), html: `<div class="large"><h1>История</h1><div class="sub">${posts(items.length)}</div></div>${html}`,
  };
}

// ---------- отрисовка ----------
let titleObserver = null;
function viewFor(r, peek = false) {
  return r.name === "section" ? sectionView(r.id) : r.name === "post" ? postView(r.id, peek)
    : r.name === "topics" ? topicsView() : r.name === "topic" ? topicView(r.id)
    : r.name === "search" ? searchView() : r.name === "history" ? historyView() : libraryView();
}
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Переход как в UINavigationController: при push новый экран въезжает справа, старый уходит на −30%
// и темнеет; при pop — зеркально. Уходящий экран живёт в DOM на время анимации, зафиксированный там,
// где его видел пользователь.
function render(r, dir) {
  const v = viewFor(r);
  document.title = r.name === "library" ? "Читалка" : `${v.title} — Читалка`;
  document.body.classList.toggle("reading", Boolean(v.reading));
  const app = $("#app");
  const old = app.querySelector(".screen:not(.leaving):not(.under)");
  const animate = dir !== "none" && old && !reduceMotion();
  let leaving = null;
  if (animate) {
    leaving = old;
    leaving.classList.remove("enter-push", "enter-pop", "dragging");
    leaving.style.transform = "";
    leaving.style.top = -window.scrollY + "px";
    leaving.classList.add("leaving", dir === "push" ? "leave-push" : "leave-pop");
    for (const el of leaving.querySelectorAll("[id]")) el.removeAttribute("id");   // id только у живого экрана
  }
  for (const n of [...app.children]) if (n !== leaving) n.remove();
  const screen = document.createElement("div");
  screen.className = "screen" + (v.reading ? " is-reading" : "") + (animate ? (dir === "push" ? " enter-push" : " enter-pop") : "");
  screen.innerHTML = v.html;
  app.append(screen);
  app.insertAdjacentHTML("beforeend", v.nav + (v.bottom || tabbar()));
  if (leaving) setTimeout(() => leaving.remove(), 400);
  bind(r);
  syncChrome();
  // большой заголовок уезжает — показываем маленький в навбаре
  if (titleObserver) titleObserver.disconnect();
  const big = screen.querySelector(".large h1, .article h1");
  const nav = $("#nav");
  if (big && nav) {
    const h = nav.offsetHeight;
    titleObserver = new IntersectionObserver(([e]) => nav.classList.toggle("scrolled", !e.isIntersecting && e.boundingClientRect.top < h),
      { rootMargin: `-${h}px 0px 0px 0px` });
    titleObserver.observe(big);
  }
}

function bind(r) {
  const back = $("#back");
  if (back) back.onclick = goBack;
  const tb = $("#theme-btn");
  if (tb) tb.onclick = () => setTheme(effectiveTheme() === "dark" ? "light" : "dark");
  for (const b of document.querySelectorAll("[data-uni]")) {
    b.onclick = () => { state.uni = b.dataset.uni; store.set("uni", state.uni); render(r, "none"); };
  }
  for (const b of document.querySelectorAll("[data-go]")) b.onclick = () => go(b.dataset.go);
  for (const b of document.querySelectorAll("[data-img]")) b.onclick = () => openImage(b.dataset.img);
  const aa = $("#aa");
  if (aa) aa.onclick = openSheet;
  const un = $("#unread");
  if (un) un.onclick = () => {
    delete state.read[r.id];
    store.set("read", state.read);
    un.textContent = "Отмечен как непрочитанный";
    un.disabled = true;
  };
  const ch = $("#clear-h");
  if (ch) ch.onclick = () => { state.history = []; store.set("history", []); render(r, "none"); };
  if (r.name === "search") bindSearch();
}

function bindSearch() {
  const input = $("#q"), clear = $("#clear");
  let timer = 0;
  const run = () => { renderResults(); bindResultChips(); };
  input.oninput = () => {
    state.query = input.value;
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(run, 140);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") { remember(input.value); input.blur(); } };
  clear.onclick = () => { input.value = ""; state.query = ""; clear.hidden = true; run(); input.focus(); };
  // запрос запоминаем, когда по результату перешли в пост
  $("#results").addEventListener("click", (e) => { if (e.target.closest(".post-row")) remember(input.value); });
  run();
  if (!state.query) setTimeout(() => input.focus({ preventScroll: true }), 60);
}
function bindResultChips() {
  for (const b of document.querySelectorAll("[data-q]")) b.onclick = () => {
    state.query = b.dataset.q; $("#q").value = state.query; $("#clear").hidden = false; renderResults(); bindResultChips();
  };
  const cq = $("#clear-q");
  if (cq) cq.onclick = () => { state.queries = []; store.set("queries", []); renderResults(); bindResultChips(); };
}
function remember(q) {
  q = q.trim();
  if (q.length < 2) return;
  state.queries = [q].concat(state.queries.filter((x) => x !== q)).slice(0, 8);
  store.set("queries", state.queries);
}

// ---------- свайп назад от левого края, как в iOS ----------
// Палец ведёт текущий экран вправо, под ним виден предыдущий; отпустил дальше трети ширины
// (или быстро смахнул) — возвращаемся назад, иначе экран встаёт на место.
let swipe = null, peek = null, swipeCommitted = false;

function startPeek() {
  const target = backTarget();
  const v = viewFor(parse(target), true);
  const under = document.createElement("div");
  under.className = "screen under" + (v.reading ? " is-reading" : "");
  under.innerHTML = v.html;
  for (const el of under.querySelectorAll("[id]")) el.removeAttribute("id");
  under.style.top = -(scrolls[target] || 0) + "px";
  const cur = $("#app .screen:not(.under):not(.leaving)");
  $("#app").prepend(under);
  cur.classList.add("dragging");
  $("#nav")?.classList.add("peeking");   // подложка бара остаётся, гаснут только подписи
  peek = { under, cur };
}
function movePeek(dx) {
  const p = Math.min(1, dx / innerWidth);
  peek.cur.style.transform = `translateX(${dx}px)`;
  peek.under.style.transform = `translateX(${-30 * (1 - p)}%)`;
  peek.under.style.filter = `brightness(${0.88 + 0.12 * p})`;
  // подписи навбара гаснут вместе с уходящим экраном, чтобы не налезать на экран под ним
  const bar = $("#nav .nav-in");
  if (bar) bar.style.opacity = String(Math.max(0, 1 - p * 3));
}
function finishPeek(commit) {
  const { under, cur } = peek;
  peek = null;
  const ms = 260;
  for (const el of [under, cur]) el.style.transition = `transform ${ms}ms var(--ease), filter ${ms}ms var(--ease)`;
  requestAnimationFrame(() => {
    cur.style.transform = commit ? "translateX(100%)" : "none";
    under.style.transform = commit ? "none" : "translateX(-30%)";
    under.style.filter = commit ? "none" : "brightness(0.88)";
  });
  setTimeout(() => {
    if (commit) { swipeCommitted = true; goBack(); return; }
    under.remove();
    const bar = $("#nav .nav-in");
    if (bar) bar.style.opacity = "";
    $("#nav")?.classList.remove("peeking");
    cur.classList.remove("dragging");
    cur.style.transform = cur.style.transition = "";
  }, ms + 20);
}
document.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1 || stack.length < 2 || peek || document.querySelector(".overlay")) return;
  const t = e.touches[0];
  if (t.clientX > 24) return;
  swipe = { x: t.clientX, y: t.clientY, dx: 0, t0: e.timeStamp, on: false };
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!swipe) return;
  const t = e.touches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  if (!swipe.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > dx) { swipe = null; return; }
    if (dx < 8) return;
    swipe.on = true;
    startPeek();
  }
  e.preventDefault();
  swipe.dx = Math.max(0, dx);
  movePeek(swipe.dx);
}, { passive: false });
function endSwipe(e, cancelled) {
  if (!swipe) return;
  const s = swipe;
  swipe = null;
  if (!s.on) return;
  const speed = s.dx / Math.max(1, e.timeStamp - s.t0);
  finishPeek(!cancelled && (s.dx > innerWidth * 0.35 || speed > 0.6));
}
document.addEventListener("touchend", (e) => endSwipe(e, false));
document.addEventListener("touchcancel", (e) => endSwipe(e, true));

// ---------- шторка «Aa» и просмотр картинок ----------
function openSheet() {
  const theme = document.documentElement.dataset.theme || "auto";
  const wrap = document.createElement("div");
  wrap.className = "overlay";
  wrap.innerHTML = `<div class="sheet-bg" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Шрифт и тема"><div class="grip"></div>
      <div class="sh-head"><h2>Оформление</h2><button class="text-btn" data-close>Готово</button></div>
      <div class="lbl">Тема</div><div class="seg">${[["auto", "Как в iPhone"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([k, l]) =>
        `<button data-theme-set="${k}" aria-pressed="${theme === k}">${l}</button>`).join("")}</div>
      <div class="lbl">Шрифт</div><div class="seg">${[["sans", "Обычный"], ["serif", "С засечками"]].map(([k, l]) =>
        `<button data-font-set="${k}" aria-pressed="${state.font === k}">${l}</button>`).join("")}</div>
      <div class="lbl">Размер текста</div><div class="sizes">
        <button class="sm" data-size="-1" aria-label="Мельче">A</button><button class="lg" data-size="1" aria-label="Крупнее">A</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  const sync = () => {
    const th = document.documentElement.dataset.theme || "auto";
    for (const b of wrap.querySelectorAll("[data-theme-set]")) b.setAttribute("aria-pressed", b.dataset.themeSet === th);
    for (const b of wrap.querySelectorAll("[data-font-set]")) b.setAttribute("aria-pressed", b.dataset.fontSet === state.font);
    wrap.querySelector('[data-size="-1"]').disabled = state.size === 0;
    wrap.querySelector('[data-size="1"]').disabled = state.size === SIZES.length - 1;
  };
  wrap.addEventListener("click", (e) => {
    const t = e.target.closest("button, [data-close]");
    if (!t) return;
    if (t.hasAttribute("data-close")) return close();
    if (t.dataset.themeSet) setTheme(t.dataset.themeSet);
    if (t.dataset.fontSet) { state.font = t.dataset.fontSet; store.set("font", state.font); }
    if (t.dataset.size) { state.size = Math.max(0, Math.min(SIZES.length - 1, state.size + +t.dataset.size)); store.set("size", state.size); }
    applyReading();
    sync();
  });
  document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
  sync();
  wrap.querySelector(".sheet .text-btn").focus();
}

function openImage(src) {
  const v = document.createElement("div");
  v.className = "viewer overlay";
  v.setAttribute("role", "dialog");
  v.setAttribute("aria-label", "Картинка из поста");
  v.innerHTML = `<button class="close" aria-label="Закрыть">${icon("close")}</button><img src="${src}" alt="Вставка из поста">`;
  v.onclick = (e) => { if (e.target.closest(".close") || e.target === v) v.remove(); };
  document.body.appendChild(v);
  v.querySelector(".close").focus();
}

// ---------- зашифрованная библиотека (публикация) ----------
// data/library.enc = соль(16) | iv(12) | AES-256-GCM(gzip(JSON {lib, img})); ключ — PBKDF2-SHA256 из пароля.
// Пароль спрашиваем один раз и храним на устройстве. Локально (папка app) лежит открытый library.json.
const IMG = {};   // имя вставки → blob-URL
const imgSrc = (name) => IMG[name] || "img/" + name;

async function decrypt(buf, pass) {
  const salt = buf.slice(0, 16), iv = buf.slice(16, 28), ct = buf.slice(28);
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const zipped = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
}

function askPassword(wrong) {
  return new Promise((resolve) => {
    $("#app").innerHTML = `<form class="lock" id="lock">
      <div class="lock-icon">${icon("book")}</div>
      <h1>Читалка</h1>
      <p>Введи пароль. Он запомнится на этом устройстве, больше спрашивать не буду.</p>
      <input id="pass" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false"
        placeholder="Пароль" aria-label="Пароль" required>
      <div class="lock-err" role="alert">${wrong ? "Пароль не подошёл. Проверь и попробуй ещё раз." : ""}</div>
      <button type="submit">Открыть</button>
    </form>`;
    const form = $("#lock");
    form.onsubmit = (e) => {
      e.preventDefault();
      form.querySelector("button").textContent = "Открываю…";
      resolve($("#pass").value.trim());
    };
    setTimeout(() => $("#pass").focus(), 50);
  });
}

async function loadLibrary() {
  const enc = await fetch("data/library.enc", { cache: "no-cache" });
  if (!enc.ok) {
    const res = await fetch("data/library.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }
  const buf = new Uint8Array(await enc.arrayBuffer());
  let pass = store.get("pass", null), wrong = false;
  for (;;) {
    if (!pass) pass = await askPassword(wrong);
    try {
      const data = await decrypt(buf, pass);
      store.set("pass", pass);
      for (const [name, b64] of Object.entries(data.img)) {
        IMG[name] = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
      }
      return data.lib;
    } catch (e) {
      store.set("pass", null);
      pass = null;
      wrong = true;
    }
  }
}

// ---------- запуск ----------
async function boot() {
  applyReading();
  try {
    LIB = await loadLibrary();
  } catch (e) {
    $("#app").innerHTML = `<div class="fail"><div>Не удалось загрузить библиотеку. Проверь интернет.<br><button onclick="location.reload()">Повторить</button></div></div>`;
    return;
  }
  for (const p of LIB.posts) POST.set(p.id, p);
  for (const u of LIB.universes) for (const s of u.sections) SEC.set(s.id, { ...s, uni: u.id });
  for (const t of LIB.tags) TAG.set(t.id, t);
  window.addEventListener("hashchange", onRoute);
  onRoute();
}
boot();
