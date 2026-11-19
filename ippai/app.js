// 今夜の一杯：扉 → 席 → 五つの問い → 一杯 → おわり
// 画面の文字はすべて data.json から取る。台詞をここに書かない。
import {pick, isInAppBrowser} from './logic.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STILL = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const CASTS = ['nagi', 'saku'];
let WEBGL = false;
try { WEBGL = !!document.createElement('canvas').getContext('webgl'); } catch (e) {}

let data = null;
// 進行中は true。この一つで入力を止める（連打・二重の進行を防ぐ）
let busy = true;
let current = null;          // 'nagi' | 'saku'
let answering = null;        // 問いの答えを待つ関数
const visited = new Set();   // 迎えの一言を聞いたキャスト
const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const SITE = 'https://liminal-cafe.jp/ippai/';
const LONG_PRESS = '長押しで保存';   // data.json に鍵が無いので、ここに一つだけ持つ

// ── 声 ─────────────────────────────────────────────
// 一つの <audio> を使い回す。扉の一押しで鳴らせる状態にしておく（iOS は最初の操作の中で一度鳴らす必要がある）
const audio = new Audio();
audio.preload = 'auto';
let unlocked = false;
let muted = false;
let playing = null;          // 鳴っている声を止めて待ちを終える関数
const voices = new Map();

function silentWav() {
  const n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  s(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b], {type: 'audio/wav'}));
}
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try {
    audio.src = silentWav();
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}
// 先に読み込んでおく。読めなければ null（黙って文字だけで進む）
function loadVoice(cast, id) {
  const key = cast + '/' + id;
  if (!voices.has(key)) {
    voices.set(key, fetch('voice/' + key + '.m4a')
      .then(r => (r.ok ? r.blob() : null))
      .then(b => (b && b.size ? URL.createObjectURL(b) : null))
      .catch(() => null));
  }
  return voices.get(key);
}
function preloadCast(cast) {
  const c = data.casts[cast];
  [c.greet, c.intro, ...c.questions, c.serve, ...c.drinks, c.close].forEach(x => loadVoice(cast, x.voice));
}
function stopVoice() {
  if (playing) playing();
  try { audio.pause(); } catch (e) {}
}
// 声の用意を少しだけ待つ（文字と同時に出すため）。間に合わなければ声なし
async function readyVoice(cast, id) {
  if (muted || !unlocked) return null;
  return Promise.race([loadVoice(cast, id), sleep(1200).then(() => null)]);
}
// 鳴らして、鳴り終わる（止められる・失敗する）まで待つ
function playVoice(url) {
  stopVoice();
  if (!url || muted) return Promise.resolve();
  return new Promise(res => {
    let done = false;
    const evs = ['ended', 'error', 'pause'];
    const fin = e => {
      // 前の声を止めたときの pause が遅れて届くことがある。いま鳴っていれば無視する
      if (e && e.type === 'pause' && !audio.paused) return;
      if (done) return;
      done = true;
      evs.forEach(n => audio.removeEventListener(n, fin));
      clearTimeout(cap);
      if (playing === fin) playing = null;
      res();
    };
    const cap = setTimeout(fin, 15000);
    playing = fin;
    try {
      audio.src = url;
      evs.forEach(n => audio.addEventListener(n, fin));
      const p = audio.play();
      if (p && p.catch) p.catch(fin);
    } catch (e) { fin(); }
  });
}
function setMuted(on) {
  muted = on;
  const b = document.querySelector('.mute');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? '音を出す' : '音を切る');
  if (on) stopVoice();
}

// ── 立ち絵 ─────────────────────────────────────────
const chars = {};
for (const el of document.querySelectorAll('.char')) {
  chars[el.dataset.cast] = {el, who: el.parentNode, frame: null, live: false, timer: 0, waited: false, smiles: []};
}
function stillSmile(ch) {
  ch.smiles.forEach(clearTimeout);
  ch.el.classList.add('is-smile', 'is-peak');
  ch.smiles = [
    setTimeout(() => ch.el.classList.remove('is-peak'), 2500),
    setTimeout(() => ch.el.classList.remove('is-smile'), 6000),
  ];
}
function blinkLoop(ch) {
  const blink = () => {
    const c = ch.el.classList;
    c.add('is-half');
    setTimeout(() => { c.remove('is-half'); c.add('is-closed'); }, 100);
    setTimeout(() => { c.remove('is-closed'); c.add('is-half'); }, 200);
    setTimeout(() => { c.remove('is-half'); setTimeout(blink, 5000 + Math.random() * 5000); }, 300);
  };
  setTimeout(blink, 1500 + Math.random() * 3000);
}
function dropFrame(ch) {
  clearTimeout(ch.timer);
  if (ch.frame && ch.frame.parentNode) ch.frame.parentNode.removeChild(ch.frame);
  ch.frame = null;
  // 動く立ち絵をやめたら、止まった絵に戻す（ready:true のあとに ready:false が来ても隠れたままにしない）
  ch.live = false;
  ch.el.classList.remove('is-live');
}
// 扉が開く間に、二人の立ち絵を先に読み込む
function loadFrames() {
  if (STILL || !WEBGL) return;
  for (const cast of CASTS) {
    const ch = chars[cast];
    if (ch.frame) continue;
    const f = document.createElement('iframe');
    f.src = '../cast.html?c=' + cast;
    f.title = data.casts[cast].name;
    f.setAttribute('scrolling', 'no');
    ch.frame = f;
    ch.el.appendChild(f);
  }
}
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || !CASTS.includes(d.liminalCast)) return;
  const ch = chars[d.liminalCast];
  if (!ch.frame || e.source !== ch.frame.contentWindow) return;
  if (d.ready === true) { clearTimeout(ch.timer); ch.live = true; ch.el.classList.add('is-live'); }
  else if (d.ready === false) dropFrame(ch);
});
function send(cast, msg) {
  const ch = chars[cast];
  if (ch.live && ch.frame && ch.frame.contentWindow) ch.frame.contentWindow.postMessage(Object.assign({liminalCast: cast}, msg), '*');
}
function express(cast, kind) {
  if (!kind) return;
  if (chars[cast].live) send(cast, {cmd: 'express', kind});
  else stillSmile(chars[cast]);   // 止まった絵は微笑みだけ持っている
}
function nod(cast) {
  const ch = chars[cast];
  if (ch.live) { send(cast, {cmd: 'nod'}); return; }
  if (STILL) return;
  ch.el.classList.remove('nod');
  void ch.el.offsetWidth;
  ch.el.classList.add('nod');
}
function showCast(cast) {
  for (const k of CASTS) chars[k].who.classList.toggle('here', k === cast);
  const ch = chars[cast];
  // 4 秒たっても動く立ち絵が来なければ、止まった絵のまま進む
  if (!ch.waited) {
    ch.waited = true;
    if (ch.frame && !ch.live) ch.timer = setTimeout(() => { if (!ch.live) dropFrame(ch); }, 4000);
  }
}
function parkCasts() { for (const k of CASTS) chars[k].who.classList.remove('here'); }

// ── 画面 ───────────────────────────────────────────
function setScreen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
  focusFirst($(id));
}
// 前の画面のボタンが隠れるとフォーカスが body に落ちるので、見えている先頭のボタンへ戻す
function focusFirst(scope) {
  const b = [...scope.querySelectorAll('button, a[href]')]
    .find(el => !el.disabled && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (b) b.focus({preventScroll: true});
}
const readMs = text => Math.min(6000, 1100 + [...text].length * 110);
function setLine(text) {
  const el = $('line');
  el.textContent = text;
  el.classList.remove('in');
  void el.offsetWidth;
  el.classList.add('in');
}
// 一言：声と文字を同時に出し、声の終わりと読む時間の遅いほうまで待つ
async function say(cast, item, show = setLine) {
  const url = await readyVoice(cast, item.voice);
  show(item.text);
  express(cast, item.face);
  await Promise.all([playVoice(url), sleep(readMs(item.text))]);
}
function setChoices(q) {
  const box = $('choices');
  box.querySelectorAll('.choice').forEach((b, i) => {
    b.textContent = q ? q.choices[i].label : '';
    b.classList.remove('chosen');
  });
  box.classList.toggle('wait', !q);
  if (q) focusFirst(box);
}
async function ask(cast, q, i) {
  const url = await readyVoice(cast, q.voice);
  setLine(q.text);
  setChoices(q);
  playVoice(url);
  const n = await new Promise(res => { answering = res; busy = false; });
  stopVoice();
  const c = q.choices[n];
  $('choices').querySelectorAll('.choice')[n].classList.add('chosen');
  $('choices').classList.add('wait');
  $('dots').children[i].classList.add('done');
  await sleep(STILL ? 150 : 350);
  setLine(c.reply);
  if (c.face) express(cast, c.face); else nod(cast);
  await sleep(Math.max(1600, readMs(c.reply)));
  return n;
}

async function sit(cast) {
  busy = true;
  // 途中で思わぬ失敗があっても、入力が止まったままにならないよう必ず戻す
  try {
    current = cast;
    delete document.body.dataset.result;
    const c = data.casts[cast];
    preloadCast(cast);
    $('counter').className = 'screen counter ' + cast;
    $('speaker').textContent = c.name;
    $('line').textContent = '';
    setChoices(null);
    [...$('dots').children].forEach(li => li.classList.remove('done'));
    showCast(cast);
    setScreen('counter');
    await sleep(STILL ? 300 : 1000);
    if (!visited.has(cast)) { visited.add(cast); await say(cast, c.greet); }
    await say(cast, c.intro);
    const answers = [];
    for (let i = 0; i < c.questions.length; i++) answers.push(await ask(cast, c.questions[i], i));
    setChoices(null);
    const drink = pick(c, answers);
    document.body.dataset.result = drink.id;
    prepareResult(cast, drink);
    await say(cast, c.serve);
    await serve(cast, drink);
  } finally {
    answering = null;
    busy = false;
  }
}

function prepareResult(cast, drink) {
  const c = data.casts[cast], ui = data.ui;
  const other = CASTS.find(k => k !== cast);
  $('result').className = 'screen result ' + cast;
  $('r-head').textContent = fmt(ui.result_heading, {cast: c.name});
  const img = $('r-img');
  img.classList.remove('ok');
  img.onload = () => img.classList.add('ok');
  img.onerror = () => img.classList.remove('ok');
  img.alt = drink.name;
  img.src = 'img/drink/' + drink.id + '.jpg';
  $('r-name').textContent = drink.name;
  $('r-line').textContent = drink.line;
  $('r-close').textContent = c.close.text;
  $('other').textContent = fmt(ui.other_seat, {cast: data.casts[other].name});
  for (const el of document.querySelectorAll('#result .rv')) el.classList.remove('on');
  $('result').scrollTop = 0;
  moreWanted = false;
  syncMore();
  prefetchSave(drink.id);
}

// 結びの段が画面の下に隠れているあいだだけ、続きがあるしるしを出す。一度見えたら出さない
const more = $('more');
let moreWanted = false;
let endInView = false;
const syncMore = () => more.classList.toggle('on', moreWanted && !endInView);
const HAS_IO = 'IntersectionObserver' in window;
if (HAS_IO) {
  new IntersectionObserver(es => {
    endInView = es[es.length - 1].isIntersecting;
    if (endInView) moreWanted = false;
    syncMore();
  }, {root: $('result'), threshold: 0.5}).observe($('r-btns'));
}

// ── 結果を見せる ───────────────────────────────────
// 結果の番号（nagi-1 など）から、キャストと一杯を引く
function shown() {
  const id = document.body.dataset.result;
  const cast = id && id.split('-')[0];
  const c = CASTS.includes(cast) ? data.casts[cast] : null;
  const drink = c && c.drinks.find(d => d.id === id);
  return drink ? {c, drink} : null;
}
// X の投稿画面を新しいタブで開く。絵は結果ページの共有カードから X が読む
function shareX() {
  const r = shown();
  if (!r) return;
  const q = new URLSearchParams({
    text: fmt(data.ui.share_text, {drink: r.drink.name, cast: r.c.name}),
    url: SITE + 'r/' + r.drink.id + '.html',
  });
  window.open('https://twitter.com/intent/tweet?' + q.toString(), '_blank', 'noopener');
}
const saveUrl = id => 'img/save/' + id + '.jpg';
const saveName = id => 'liminal-ippai-' + id + '.jpg';
// 共有は押した直後に呼ばないと断られる端末がある。結果が出た時点で保存用の絵を読んでおく
let saveFile = null;
function prefetchSave(id) {
  saveFile = null;
  if (!navigator.canShare || typeof File !== 'function') return;
  fetch(saveUrl(id))
    .then(r => (r.ok ? r.blob() : null))
    .then(b => { if (b && document.body.dataset.result === id) saveFile = new File([b], saveName(id), {type: 'image/jpeg'}); })
    .catch(() => {});
}
// 画像を保存：ファイルの共有 → ダウンロード → 絵を大きく出して長押しの案内
// アプリ内ブラウザは <a download> を黙って無視することがあるので、ダウンロードを飛ばして絵を出す
const IN_APP = isInAppBrowser(navigator.userAgent);
let saving = false;
async function saveImage() {
  const r = shown();
  if (!r || saving) return;
  saving = true;
  try {
    const id = r.drink.id;
    if (navigator.canShare) {
      let file = saveFile && saveFile.name === saveName(id) ? saveFile : null;
      if (!file) {
        try {
          const res = await fetch(saveUrl(id));
          if (res.ok) file = new File([await res.blob()], saveName(id), {type: 'image/jpeg'});
        } catch (e) {}
      }
      if (file && navigator.canShare({files: [file]})) {
        try { await navigator.share({files: [file]}); return; }
        catch (e) {
          if (e && e.name === 'AbortError') return;   // 取り消しは黙って終わる
          // 断られた（押した直後でない等）ときは、ダウンロードも同じく効かないことが多いので絵を出す。ほかの失敗は次の手へ
          if (e && e.name === 'NotAllowedError') { openView(id, r.drink.name); return; }
        }
      }
    }
    if (!IN_APP && 'download' in HTMLAnchorElement.prototype) {
      const a = document.createElement('a');
      a.href = saveUrl(id);
      a.download = saveName(id);
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    openView(id, r.drink.name);
  } finally {
    saving = false;
  }
}
function openView(id, name) {
  const v = $('saveview'), img = $('saveview-img');
  img.src = saveUrl(id);
  img.alt = name;
  $('saveview-hint').textContent = LONG_PRESS;
  if (typeof v.showModal === 'function') { if (!v.open) v.showModal(); }
  else v.setAttribute('open', '');
  v.querySelector('.saveview-close').focus({preventScroll: true});
}
function closeView() {
  const v = $('saveview');
  if (!v.open) return;
  if (typeof v.close === 'function') v.close();          // Esc で閉じたときも close が届く
  else { v.removeAttribute('open'); viewClosed(); }
}
function viewClosed() { $('save').focus({preventScroll: true}); }
$('saveview').addEventListener('close', viewClosed);

// 一杯：絵 → 名前 → 一言（声）→ 二つのボタン → 結び（声）→ おわり
async function serve(cast, drink) {
  const c = data.casts[cast];
  const on = id => $(id).classList.add('on');
  const gap = ms => sleep(STILL ? 0 : ms);
  setScreen('result');
  await gap(700);
  parkCasts();
  on('r-head');
  await gap(500);
  on('r-fig');
  await gap(1100);
  on('r-name');
  await gap(800);
  await say(cast, {text: drink.line, voice: drink.voice, face: null}, () => on('r-line'));
  on('r-shares');
  $('share').focus({preventScroll: true});
  await gap(1400);
  // 結びの段へは自動で送らない（二つのボタンを押す前に一杯の絵が流れてしまうため）。下にしるしを出す
  await say(cast, c.close, () => {
    on('r-close');
    moreWanted = HAS_IO;
    syncMore();
  });
  on('r-end');
  await gap(500);
  on('r-btns');
  on('r-status');
}

async function openDoor() {
  busy = true;
  unlockAudio();
  for (const k of CASTS) loadVoice(k, data.casts[k].greet.voice);
  loadFrames();
  const door = $('door');
  if (!STILL) {
    door.classList.add('s1');
    await sleep(550);
    door.classList.add('s2');
    await sleep(550);
    door.classList.add('s3');
    await sleep(700);
    door.classList.add('zoom');
    await sleep(1300);
  }
  const q = new URLSearchParams(location.search).get('c');
  if (CASTS.includes(q)) { await sit(q); return; }
  setScreen('pick');
  await sleep(STILL ? 0 : 700);
  busy = false;
}

// ── 入力 ───────────────────────────────────────────
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'mute') { setMuted(!muted); return; }
  // 絵そのものを押したときは閉じない（長押しで保存する前に誤って閉じないように）。絵の外と閉じるボタンで閉じる
  if (act === 'unview') { if (!e.target.closest('#saveview-img')) closeView(); return; }
  if (!data) return;
  // 見せる・保存するは、結び（close）の声の途中でも押せる
  if (act === 'share') { shareX(); return; }
  if (act === 'save') { saveImage(); return; }
  if (busy) return;
  if (act === 'open') openDoor();
  else if (act === 'seat') sit(b.dataset.cast);
  else if (act === 'choice') {
    if (!answering) return;
    busy = true;
    const res = answering;
    answering = null;
    res(Number(b.dataset.i));
  }
  else if (act === 'again') sit(current);
  else if (act === 'other') sit(CASTS.find(k => k !== current));
});

// ── 起動 ───────────────────────────────────────────
// 店のリンク先。https:// で始まるものだけ使い、それ以外は空（開店準備中の一行のまま）と同じに扱う
const storeUrl = u => (typeof u === 'string' && u.startsWith('https://') ? u : '');

async function boot() {
  // 読めなければ、扉の下に案内の一行を出して止まる（扉のボタンは押せないまま）
  let d = null;
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('data.json ' + res.status);
    d = await res.json();
    if (!d || !d.ui || !d.casts) throw new Error('data.json の形が違う');
  } catch (e) {
    $('door').classList.add('failed');
    $('loadfail').hidden = false;
    return;
  }
  data = d;
  for (const el of document.querySelectorAll('[data-ui]')) {
    const v = data.ui[el.dataset.ui];
    if (typeof v === 'string') el.textContent = v;
  }
  // 開店後：おわりの段の一行だけを店へのリンクにする（扉の一行はリンクにしない。店への入口は最後に一度だけ）
  const store = storeUrl(data.ui.store_url);
  if (store) {
    const span = $('r-status'), a = document.createElement('a');
    a.className = span.className;
    a.id = span.id;
    a.href = store;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = span.textContent;
    span.replaceWith(a);
  }
  for (const el of document.querySelectorAll('[data-name]')) el.textContent = data.casts[el.dataset.name].name;
  for (const k of CASTS) {
    const b = document.querySelector('.seat-btn.' + k);
    if (b) b.setAttribute('aria-label', data.casts[k].name);
    if (!STILL) blinkLoop(chars[k]);
  }
  $('door').querySelector('.cue').disabled = false;
  busy = false;
}
boot();
