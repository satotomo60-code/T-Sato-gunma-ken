/* ===========================================================
   Webページが表示されるまで｜通信の流れシミュレータ
   情報Ⅰ「Webページ閲覧の仕組み」授業用
   -----------------------------------------------------------
   仮想時間(ms)でタイムラインを組み立て、その1つの時計で
   ①パケットアニメ ②ステップ解説 ③ログ ④ウォーターフォール
   をすべて描画している。
   =========================================================== */

'use strict';

/* ---------- 図の座標（index.html の SVG と一致させる） ---------- */
const NODES = {
  pc:  { x: 130, y: 220 },
  dns: { x: 690, y: 110 },
  web: { x: 690, y: 330 }
};

/* ---------- 各通信にかかる仮想時間(ms) ---------- */
const DUR  = { dns: 600, html: 900, css: 500, img: 800 };
const SEND = 0.30;   // 行き
const WAIT = 0.30;   // サーバが用意する時間
// 残り 0.40 が帰り

const HOST = 'www.example.jp';
const IP   = '198.51.100.7';

/* ---------- 状態 ---------- */
const state = {
  t: 0,            // 仮想時間(ms)
  playing: false,
  speed: 0.6,
  target: null,    // ステップ実行の停止位置
  last: 0,         // 直前フレームの実時刻
  tl: null,        // タイムライン
  logged: 0        // ログ出力済みイベント数
};

/* ---------- 要素 ---------- */
const $ = (id) => document.getElementById(id);
const elPackets = $('packets');
const elLog     = $('log');
const elRows    = $('wf-rows');
const elNeedle  = $('wf-needle');
const elTotal   = $('total-time');

/* ===========================================================
   1. タイムラインを組み立てる
   =========================================================== */
function buildTimeline(imageCount, maxConn){
  const tasks = [];
  let id = 0;
  const add = (o) => { o.id = ++id; o.end = o.start + o.dur; tasks.push(o); return o; };

  // ① 名前解決
  const dns = add({
    kind:'dns', server:'dns', lane:0, name:HOST + ' のIPは？',
    start:0, dur:DUR.dns,
    ask:`ブラウザ → DNSサーバ：${HOST} のIPアドレスを教えてください`,
    ans:`DNSサーバ → ブラウザ：${IP} です`
  });

  // ② HTML
  const html = add({
    kind:'html', server:'web', lane:0, name:'index.html',
    start:dns.end, dur:DUR.html,
    ask:`ブラウザ → Webサーバ(${IP})：index.html をください`,
    ans:'Webサーバ → ブラウザ：index.html を送りました（200 OK）'
  });

  // ③④ HTMLを読み終えて初めて、必要なファイルが分かる
  const slots = new Array(maxConn).fill(html.end);
  const sub = [{ kind:'css', name:'style.css', dur:DUR.css }];
  for (let i = 1; i <= imageCount; i++){
    sub.push({ kind:'img', name:`photo${String(i).padStart(2,'0')}.jpg`, dur:DUR.img });
  }
  const subTasks = sub.map(r => {
    let lane = 0;
    for (let i = 1; i < slots.length; i++) if (slots[i] < slots[lane]) lane = i;
    const start = slots[lane];
    slots[lane] = start + r.dur;
    return add({
      kind:r.kind, server:'web', lane, name:r.name, start, dur:r.dur,
      ask:`ブラウザ → Webサーバ：${r.name} をください`,
      ans:`Webサーバ → ブラウザ：${r.name} を送りました`
    });
  });

  const css   = subTasks[0];
  const imgs  = subTasks.slice(1);
  const lastImg = imgs.reduce((a,b) => (b.end > a.end ? b : a), imgs[0]);
  const total = Math.max(css.end, lastImg.end) + 250;

  const steps = [
    { no:'ステップ 1', key:'dns',  end:dns.end,  title:'名前をIPアドレスに変える',
      desc:`ブラウザはまず「${HOST}」という名前しか知りません。相手のIPアドレスをDNSサーバに聞いて、${IP} だと分かりました。この時点ではページの中身は1文字も届いていません。` },
    { no:'ステップ 2', key:'html', end:html.end, title:'HTMLファイルを受け取る',
      desc:'分かったIPアドレスのWebサーバへ「index.html をください」とお願いし、文字でできた設計図（HTML）が返ってきました。ここに、他にどんなファイルが必要かが書かれています。' },
    { no:'ステップ 3', key:'css',  end:css.end,  title:'CSSファイルを受け取る',
      desc:'HTMLを読んで初めて style.css が必要だと分かり、追加でお願いします。見た目を整える指示がここで届きます。' },
    { no:'ステップ 4', key:'img',  end:Math.max(css.end, lastImg.end), title:'画像をまとめて受け取る',
      desc:`画像も同じように1枚ずつお願いします。同時に開ける接続は ${maxConn} 本なので、それを超えた分は順番待ちになります。ウォーターフォール図で待ち時間を確かめましょう。` },
    { no:'ステップ 5', key:'done', end:total,    title:'画面の完成',
      desc:'すべての部品がそろい、ブラウザが組み立てて表示しました。1枚のページを出すために、これだけの往復が起きています。' }
  ];

  // ログ用イベント（時刻順）
  const events = [];
  tasks.forEach(t => {
    events.push({ t:t.start, kind:t.kind, text:t.ask });
    events.push({ t:t.end,   kind:t.kind, text:t.ans });
  });
  events.push({ t: total, kind:'done', text:`表示が完成しました（合計 ${total} ms・目安）` });
  events.sort((a,b) => a.t - b.t);

  return { tasks, steps, events, total, maxConn, imageCount };
}

/* ===========================================================
   2. ウォーターフォール図の枠を作る
   =========================================================== */
const COLOR = { dns:'var(--dns)', html:'var(--html)', css:'var(--css)', img:'var(--img)' };

function buildWaterfall(tl){
  elRows.innerHTML = '';
  tl.tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'wf-row';
    row.innerHTML = `
      <div class="wf-name"><span class="dot" style="background:${COLOR[task.kind]}"></span>${task.name}</div>
      <div class="wf-track">
        <div class="wf-bar" style="left:${task.start / tl.total * 100}%;width:${task.dur / tl.total * 100}%">
          <div class="wf-seg pale"  style="width:${SEND*100}%;background:${COLOR[task.kind]}"></div>
          <div class="wf-seg pale"  style="width:${WAIT*100}%;background:${COLOR[task.kind]}"></div>
          <div class="wf-seg solid" style="width:${(1-SEND-WAIT)*100}%;background:${COLOR[task.kind]}"></div>
          <div class="wf-veil"></div>
        </div>
      </div>
      <div class="wf-time">—</div>`;
    row._task = task;
    row._veil = row.querySelector('.wf-veil');
    row._time = row.querySelector('.wf-time');
    elRows.appendChild(row);
  });

  // 目盛り
  const ruler = $('ruler-track');
  ruler.innerHTML = '';
  const stepMs = tl.total > 6000 ? 2000 : 1000;
  for (let ms = 0; ms <= tl.total; ms += stepMs){
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.style.left = (ms / tl.total * 100) + '%';
    tick.textContent = ms + 'ms';
    ruler.appendChild(tick);
  }
  elNeedle.hidden = false;
}

/* ===========================================================
   3. 描画（毎フレーム）
   =========================================================== */
function drawPackets(t){
  const tl = state.tl;
  elPackets.innerHTML = '';
  document.querySelectorAll('.node').forEach(n => n.classList.remove('active'));

  const active = tl.tasks.filter(x => t >= x.start && t <= x.end);
  if (active.length) document.querySelector('.node-pc').classList.add('active');

  active.forEach(task => {
    const a = NODES.pc, b = NODES[task.server];
    const p = (t - task.start) / task.dur;

    let ratio, outbound;
    if (p < SEND){ ratio = p / SEND; outbound = true; }
    else if (p < SEND + WAIT){ ratio = 1; outbound = true; }
    else { ratio = 1 - (p - SEND - WAIT) / (1 - SEND - WAIT); outbound = false; }

    // 同じ線を通る通信をずらして重ならないようにする
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const off = (task.kind === 'dns' || task.kind === 'html')
      ? 0
      : (task.lane - (tl.maxConn - 1) / 2) * 13;
    const ox = -dy / len * off, oy = dx / len * off;

    const x = a.x + dx * ratio + ox;
    const y = a.y + dy * ratio + oy;

    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x.toFixed(1));
    c.setAttribute('cy', y.toFixed(1));
    c.setAttribute('r', outbound ? 9 : 10);
    if (outbound){
      c.setAttribute('fill', COLOR[task.kind]);
    } else {
      c.setAttribute('fill', 'none');
      c.setAttribute('stroke', COLOR[task.kind]);
      c.setAttribute('stroke-width', '5');
    }
    elPackets.appendChild(c);

    if (p >= SEND && p < SEND + WAIT){
      document.querySelector('.node-' + task.server).classList.add('active');
    }
  });
}

function drawWaterfall(t){
  const tl = state.tl;
  [...elRows.children].forEach(row => {
    const task = row._task;
    const prog = Math.min(1, Math.max(0, (t - task.start) / task.dur));
    row._veil.style.width = ((1 - prog) * 100) + '%';
    row._time.textContent = prog >= 1 ? task.end + 'ms' : '—';
  });
  elNeedle.style.setProperty('--pos', Math.min(100, t / tl.total * 100) + '%');
}

function drawStep(t){
  const tl = state.tl;
  const step = tl.steps.find(s => t < s.end) || tl.steps[tl.steps.length - 1];
  const done = t >= tl.total;
  const card = document.querySelector('.stepcard');
  card.className = 'stepcard on-' + (done ? 'done' : step.key);
  $('step-no').textContent    = done ? '完了' : step.no;
  $('step-title').textContent = step.title;
  $('step-desc').textContent  = step.desc;
}

function drawLog(t){
  const tl = state.tl;
  if (t <= 0) return;
  while (state.logged < tl.events.length && tl.events[state.logged].t <= t){
    const e = tl.events[state.logged++];
    if (elLog.querySelector('.log-empty')) elLog.innerHTML = '';
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${String(e.t).padStart(4,' ')}ms</span>` +
                   `<span class="k ${e.kind}">${e.kind.toUpperCase()}</span>` +
                   escapeHtml(e.text);
    elLog.appendChild(li);
    elLog.scrollTop = elLog.scrollHeight;
  }
}

function escapeHtml(s){
  return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function render(){
  drawPackets(state.t);
  drawWaterfall(state.t);
  drawStep(state.t);
  drawLog(state.t);
  elTotal.textContent = Math.round(Math.min(state.t, state.tl.total));
  document.getElementById('goal-time').textContent = state.tl.total;
}

/* ===========================================================
   4. 再生の制御
   =========================================================== */
function loop(now){
  if (!state.playing){ return; }
  const dt = Math.min(64, now - state.last);
  state.last = now;
  state.t += dt * state.speed;

  if (state.target !== null && state.t >= state.target){
    state.t = state.target;
    pause();
  }
  if (state.t >= state.tl.total){
    state.t = state.tl.total;
    pause();
  }
  render();
  if (state.playing) requestAnimationFrame(loop);
}

function play(target){
  if (state.t >= state.tl.total) reset();
  state.target = (target === undefined) ? null : target;
  state.playing = true;
  state.last = performance.now();
  $('btn-play').textContent = '一時停止';
  requestAnimationFrame(loop);
}

function pause(){
  state.playing = false;
  $('btn-play').textContent = state.t >= state.tl.total ? 'もう一度再生' : '続きから再生';
}

function reset(){
  state.t = 0;
  state.playing = false;
  state.target = null;
  state.logged = 0;
  elLog.innerHTML = '<li class="log-empty">まだ通信は始まっていません。</li>';
  $('btn-play').textContent = '再生';
  render();
  $('step-no').textContent    = 'これから';
  $('step-title').textContent = `アドレスバーに ${HOST} と入力したところ`;
  $('step-desc').textContent  = '「再生」か「1ステップ進む」を押すと、ブラウザが最初に何をするのかが見えます。';
  document.querySelector('.stepcard').className = 'stepcard';
}

function rebuild(){
  const imgs  = Number($('imgs').value);
  const conns = Number($('conns').value);
  state.tl = buildTimeline(imgs, conns);
  buildWaterfall(state.tl);
  reset();
}

/* ===========================================================
   5. 操作イベント
   =========================================================== */
$('btn-play').addEventListener('click', () => {
  state.playing ? pause() : play();
});

$('btn-step').addEventListener('click', () => {
  const next = state.tl.steps.find(s => s.end > state.t + 1);
  if (!next) { reset(); return; }
  play(next.end);
});

$('btn-reset').addEventListener('click', reset);

$('speed').addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (!b) return;
  document.querySelectorAll('#speed .seg').forEach(s => s.classList.remove('is-on'));
  b.classList.add('is-on');
  state.speed = Number(b.dataset.speed);
});

$('imgs').addEventListener('input', (e) => {
  $('imgs-out').textContent = e.target.value;
  rebuild();
});

$('conns').addEventListener('input', (e) => {
  $('conns-out').textContent = e.target.value;
  rebuild();
});

/* 記録して比べる */
$('btn-record').addEventListener('click', () => {
  const tbody = document.querySelector('#rec-table tbody');
  const empty = tbody.querySelector('.rec-empty');
  if (empty) empty.remove();
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${state.tl.imageCount} 枚</td><td>${state.tl.maxConn} 本</td><td>${state.tl.total} ms</td>`;
  tbody.appendChild(tr);
});

/* ===========================================================
   6. たしかめ（3問）
   =========================================================== */
const QUIZ = [
  {
    ask:'アドレスを入力したとき、ブラウザが最初にすることは？',
    choices:[
      { t:'Webサーバから画像を受け取る', ok:false, fb:'画像は、HTMLを読んで必要だと分かったあとです。' },
      { t:'DNSサーバに相手のIPアドレスを聞く', ok:true,  fb:'そのとおり。名前だけでは相手に届かないので、まずIPアドレスを調べます。' },
      { t:'CSSを読み込んで見た目を整える', ok:false, fb:'CSSの名前は、届いたHTMLの中に書かれています。' }
    ]
  },
  {
    ask:'HTMLを受け取ったあとに、CSSや画像を取りに行くのはなぜ？',
    choices:[
      { t:'HTMLの中に、必要なファイルの場所が書いてあるから', ok:true,  fb:'そのとおり。HTMLを読むまで、何が必要かブラウザには分かりません。' },
      { t:'CSSや画像は必ずHTMLより重いから', ok:false, fb:'重さの問題ではなく、必要だと分かる順番の問題です。' },
      { t:'サーバがHTMLしか同時に送れないから', ok:false, fb:'サーバは複数同時に送れます。ウォーターフォール図で並んでいる部分を見てみましょう。' }
    ]
  },
  {
    ask:'画像を増やすと表示が遅くなるのはなぜ？',
    choices:[
      { t:'DNSへの問い合わせが画像の数だけ増えるから', ok:false, fb:'DNSに聞くのは最初の1回だけです。ログを見直してみましょう。' },
      { t:'同時につなげる数に限りがあり、順番待ちが起きるから', ok:true,  fb:'そのとおり。同時接続数を1本にすると、待ち時間がさらに伸びます。' },
      { t:'HTMLの受け取りが画像の数だけ遅くなるから', ok:false, fb:'HTMLが届く時刻は画像の枚数を変えても同じです。' }
    ]
  }
];

function buildQuiz(){
  const box = $('quiz');
  QUIZ.forEach((q, qi) => {
    const div = document.createElement('div');
    div.className = 'q';
    div.innerHTML = `<p class="ask">問${qi+1}　${q.ask}</p>`;
    const fb = document.createElement('p');
    fb.className = 'fb';
    q.choices.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.t;
      b.addEventListener('click', () => {
        b.classList.add(c.ok ? 'right' : 'wrong');
        fb.textContent = c.fb;
      });
      div.appendChild(b);
    });
    div.appendChild(fb);
    box.appendChild(div);
  });
}

/* ---------- 起動 ---------- */
buildQuiz();
rebuild();
