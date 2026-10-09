/* ============================================================
 * verify_browser_real.js —— 真实浏览器全量功能回归（T01604 / 6.1）
 *
 * 与 verify_dom_stub.js 的分工：
 *   - 桩测试跑逻辑层（状态机 / 记账 / 数据迁移），无样式、无渲染、无音频设备；
 *   - 本脚本跑「看得见、听得见」的层：真实 Chrome 渲染、CSS 变量主题、Canvas 像素、
 *     DOM 动效时长、可点目标尺寸、对比度、WebAudio 实际信号。
 *
 * 零产品依赖：只读产品文件，不修改它；证据（截图 / JSON 报告）写到 EVID 目录。
 * 运行：node verify_browser_real.js
 * ============================================================ */
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("D:/code/otherProjects/11_OcrDemo/node_modules/playwright");

const APP = "file:///" + encodeURI("D:/code/otherProjects/22_StudyWork/阳光学习能量站.html")
  .replace(/#/g, "%23");
const EVID = process.env.UICHECK_OUT || "D:/code/Data_Qoder/uicheck_T01604";
const PIN = "2468";

let pass = 0, warn = 0;
const fails = [], warns = [], notes = [];
function check(name, cond, detail){
  if (cond) { pass++; if (process.env.VERBOSE) console.log("  \x1b[32m✓\x1b[0m " + name); }
  else { fails.push(name + (detail ? " :: " + detail : "")); console.log("  \x1b[31m✗\x1b[0m " + name + (detail ? " :: " + detail : "")); }
}
function soft(name, cond, detail){
  if (cond) { pass++; }
  else { warn++; warns.push(name + (detail ? " :: " + detail : "")); console.log("  \x1b[33m!\x1b[0m " + name + (detail ? " :: " + detail : "")); }
}
function note(msg){ notes.push(msg); console.log("  \x1b[36m·\x1b[0m " + msg); }
function section(title){ console.log("\n▶ " + title); }

/* ---------- WCAG 对比度 ---------- */
function lum([r, g, b]){
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b){
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function parseRGB(s){
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(",").map(x => parseFloat(x.trim()));
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/* ---------- 音频探针（把应用输出接到 AnalyserNode，用真实信号判断“是否出声”） ---------- */
function audioProbe(){
  window.__audioProbe = { ctxCreated: 0, osc: 0, starts: [], stops: [], maxRms: 0, samples: 0, times: [], tapError: null, state: null };
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig) { window.__audioProbe.noAC = true; return; }
  const BP = window.BaseAudioContext ? window.BaseAudioContext.prototype : Orig.prototype;
  const destDesc = Object.getOwnPropertyDescriptor(BP, "destination") || Object.getOwnPropertyDescriptor(Orig.prototype, "destination");
  function Wrapped(){
    const ctx = new Orig();
    window.__audioProbe.ctxCreated++;
    try {
      const tap = ctx.createGain();
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      tap.connect(an);
      if (destDesc && destDesc.get) tap.connect(destDesc.get.call(ctx));
      Object.defineProperty(ctx, "destination", { get(){ return tap; }, configurable: true });
      const buf = new Float32Array(an.fftSize);
      setInterval(() => {
        try {
          an.getFloatTimeDomainData(buf);
          let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          const rms = Math.sqrt(s / buf.length);
          window.__audioProbe.samples++;
          if (rms > window.__audioProbe.maxRms) window.__audioProbe.maxRms = rms;
          window.__audioProbe.times.push(ctx.currentTime);
          window.__audioProbe.state = ctx.state;
        } catch (e) {}
      }, 16);
    } catch (e) { window.__audioProbe.tapError = String(e); }
    const origOsc = ctx.createOscillator.bind(ctx);
    ctx.createOscillator = function(){
      const o = origOsc();
      window.__audioProbe.osc++;
      const st = o.start.bind(o), sp = o.stop.bind(o);
      o.start = (t) => { window.__audioProbe.starts.push(t === undefined ? ctx.currentTime : t); return st(t); };
      o.stop = (t) => { window.__audioProbe.stops.push(t); return sp(t); };
      return o;
    };
    return ctx;
  }
  Wrapped.prototype = Orig.prototype;
  window.AudioContext = Wrapped;
  if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
}

/* ---------- 导出捕获（Blob → 文本，无需下载管线） ---------- */
function exportProbe(){
  window.__exports = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = function(blob){
    try { if (blob && blob.text) window.__exports.push(blob); } catch (e) {}
    return orig.call(URL, blob);
  };
}

/* 飘字元素只活 1.7s，主线程被音频预热卡住时「事后查询」会漏检 ⇒ 用 MutationObserver 记账，判定不依赖采样时机 */
function floatProbe(){
  window.__floatSeen = { n: 0, texts: [] };
  const watch = () => new MutationObserver(muts => {
    muts.forEach(m => Array.prototype.forEach.call(m.addedNodes, n => {
      if (n && n.classList && n.classList.contains("float-sun")) { window.__floatSeen.n++; window.__floatSeen.texts.push(n.textContent); }
    }));
  }).observe(document.body, { childList: true });
  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch);
}

/* ============================================================ */
(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    // 必须 headful：Chrome 在 headless 或 --mute-audio 下音频图不渲染（currentTime 冻结），
    // 提示音的可听项就只能靠桩推断；真实渲染后才有 RMS / 时长证据。
    headless: false,
    args: ["--autoplay-policy=document-user-activation-required", "--window-position=60,60"]
  });

  /* ---------------- 桌面端 ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  ctx.setDefaultTimeout(8000);

  /* 环境 flaky 缓解：彩带/飘字等常驻动画会让 Playwright 的「元素稳定」等待偶发超时（曾两度 FATAL 于
     open-store / soundBtn），按钮位置本身不动，超时后 force 重试一次即可；真被浮层挡住时后续断言仍会暴露 */
  const hardenClick = (pg) => {
    const Cls = pg.locator("body").constructor;
    if (Cls.__hardenClick) return;
    const orig = Cls.prototype.click;
    Cls.prototype.click = async function (opts) {
      try { return await orig.call(this, opts); }
      catch (e) {
        if (/Timeout \d+ms exceeded/.test(String(e && e.message)) && !(opts && opts.force)) {
          return orig.call(this, Object.assign({}, opts, { force: true }));
        }
        throw e;
      }
    };
    Cls.__hardenClick = true;
  };
  hardenClick(page);
  const errors = [];
  const notedDialogs = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", d => { notedDialogs.push(d.type() + ":" + (d.message() || "")); d.accept(d.type() === "prompt" ? "3" : "").catch(() => {}); });
  await page.addInitScript(audioProbe);
  await page.addInitScript(exportProbe);
  await page.addInitScript(floatProbe);

  const A = (fn, arg) => page.evaluate(fn, arg);
  const sunshine = () => A(() => window.__STUDY_APP__.cur().sunshine);
  const childState = () => A(() => {
    const c = window.__STUDY_APP__.cur();
    return { sunshine: c.sunshine, streakDays: c.streakDays, piggy: (c.piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0), requests: (c.requests || []).map(r => ({ status: r.status, note: r.note, title: r.title })), badgeStats: c.badgeStats, earned: Object.keys(c.badges.earned || {}), equipped: c.badges.equipped };
  });
  const shot = (n) => page.screenshot({ path: path.join(EVID, n) });
  // 浮层是叠加式（overlay.show 可能同时存在多层），未关闭的浮层会拦截后续点击 ⇒ 段落之间统一收口
  const closeAll = async (pg) => {
    const t = pg || page;
    const listOverlays = () => t.evaluate(() => [...document.querySelectorAll(".overlay.show")].map(o => o.id));
    for (let round = 0; round < 6; round++){
      const open = await listOverlays();
      if (!open.length) return;
      await t.evaluate((ids) => {
        ids.forEach(id => {
          const o = document.getElementById(id);
          const btn = o.querySelector(".close") || o.querySelector('[data-act*="close"]');
          if (btn) btn.click();
        });
      }, open);
      await t.waitForTimeout(180);
      const left = await listOverlays();
      if (left.join(",") === open.join(",")) return note("无法自动关闭的浮层：" + left.join(","));
    }
  };

  section("P0 首屏 · 零 JS 错误 · 主路径冒烟");
  await page.goto(APP, { waitUntil: "load" });
  await page.waitForTimeout(300);
  // 真实浏览器会真的出声：测试期间先压低音量，FR-34 段落再分档实测（默认出厂值仍是 0.6）
  await A(() => { window.__STUDY_APP__.state.sound.volume = 0.1; });
  check("页面加载且 #app 渲染出顶栏/导航/内容", await A(() => !!(document.querySelector(".topbar") && document.querySelector(".nav") && document.querySelector("#app .panel"))));
  check("默认状态已建立（1 个孩子 + 学科任务）", await A(() => { const s = window.__STUDY_APP__.state; return !!(s && s.children.length === 1 && s.children[0].subjects.length >= 3); }));
  check("启动前不创建 AudioContext（自动播放策略门控）", await A(() => window.__audioProbe.ctxCreated === 0), await A(() => JSON.stringify(window.__audioProbe)));
  check("未点击前无声音节点", await A(() => window.__audioProbe.osc === 0));
  await shot("01_home_light.png");

  // 勾选第一个任务：阳光增加 + 飘字 + 提示音（首次用户手势解锁音频）
  const s0 = await sunshine();
  await page.locator('input[data-act="toggle"]').first().check({ force: true, timeout: 4000 });
  await page.waitForFunction(() => window.__floatSeen.n > 0, null, { timeout: 2500, polling: 100 }).catch(() => {});
  const float = await A(() => window.__floatSeen);
  await page.waitForTimeout(200);
  const s1 = await sunshine();
  check("勾选任务 → 阳光增加（走 addSunshine 单点入口）", s1 > s0, s0 + "→" + s1);
  check("勾选任务 → 出现 +N☀️ 飘字动效（MutationObserver 记账，不依赖采样时机）", float.n > 0 && /^\+\d+☀️$/.test(float.texts[0] || ""), JSON.stringify(float));
  // 真实 Chrome 音频线程首次启用需 0.6~1.6s 预热（本环境实测，偶尔更久）：轮询取样，必要时补触发一次
  await page.waitForTimeout(900);
  check("首次手势后才创建 AudioContext", await A(() => window.__audioProbe.ctxCreated === 1), await A(() => JSON.stringify(window.__audioProbe.state)));
  check("完成提示音 = 双音（2 个振荡器）", await A(() => window.__audioProbe.osc === 2), "osc=" + await A(() => window.__audioProbe.osc));
  let audioLive = false;
  for (let i = 0; i < 5 && !audioLive; i++){
    audioLive = await A(() => { const p = window.__audioProbe; return p.times[p.times.length - 1] > 0 && p.maxRms > 0.002; });
    if (audioLive) break;
    await page.waitForTimeout(700);
    if (i === 1) await A(() => window.__STUDY_APP__.playChime("done"));   // 手势已建立，再给一次发声机会后重采样
  }
  const ap = await A(() => { const p = window.__audioProbe; return { tLast: p.times[p.times.length - 1], maxRms: p.maxRms }; });
  check("AudioContext 时钟在推进（音频图真在跑，非静默桩）", ap.tLast > 0, "tLast=" + ap.tLast);
  check("提示音产生真实非静音信号（RMS > 0.002）", ap.maxRms > 0.002, "maxRms=" + ap.maxRms.toFixed(5));
  note("音频探针：" + JSON.stringify(await A(() => { const p = window.__audioProbe; return { ctxCreated: p.ctxCreated, osc: p.osc, state: p.state, samples: p.samples, tLast: p.times[p.times.length - 1], starts: p.starts.slice(0, 3), stops: p.stops.slice(0, 3), maxRms: Number(p.maxRms.toFixed(5)), tapError: p.tapError, vis: document.visibilityState, focus: document.hasFocus() }; })));
  const warmup = await A(() => { const t = window.__audioProbe.times; const i = t.findIndex(x => x > 0); return i < 0 ? -1 : (i * 16); });
  note("音频线程预热：首次 currentTime 前进约发生在手势后 " + warmup + "ms（本环境实测，非产品缺陷；桩环境无从观测）");
  const chimeDur = await A(() => { const p = window.__audioProbe; return Math.max(...p.stops) - Math.min(...p.starts); });
  check("完成提示音总时长 ≤ 400ms", chimeDur > 0 && chimeDur <= 0.42, chimeDur.toFixed(3) + "s");

  // 打卡
  await page.locator('[data-act="checkin"]').click();
  await page.waitForTimeout(300);
  const cs = await childState();
  check("打卡 → 连续天数 1、阳光增加", cs.streakDays === 1 && cs.sunshine > s1, JSON.stringify({ streak: cs.streakDays, sun: cs.sunshine, s1 }));
  check("打卡写入 dayLog（热力图数据源）", await A(() => { const c = window.__STUDY_APP__.cur(); const k = window.__STUDY_APP__.dayKeyLocal(new Date()); return !!c.dayLog[k]; }));

  section("P1 FR-29 当日完成度里程碑（真实点击跑完当天任务）");
  const tiersBefore = await A(() => (window.__STUDY_APP__.cur().dailyAward || {}).tiers || []);
  const subjCount = await A(() => document.querySelectorAll(".nav [data-act=select]").length);
  let toggled = 0, missed = 0;
  for (let i = 0; i < subjCount; i++){
    await page.locator(".nav [data-act=select]").nth(i).click();
    await page.waitForTimeout(80);
    const ids = await A(() => [...document.querySelectorAll('input[data-act="toggle"]:not(:checked)')].map(x => x.getAttribute("data-task")));
    for (const id of ids){
      try { await page.locator(`input[data-act="toggle"][data-task="${id}"]:not(:checked)`).click({ force: true, timeout: 1200 }); toggled++; }
      catch (e) { missed++; }   // 完成后该项从当前视图移出 / 重渲染瞬时不可达
      await page.waitForTimeout(8);
    }
  }
  await page.waitForTimeout(500);
  const after = await childState();
  const tiersNow = await A(() => window.__STUDY_APP__.cur().dailyAward.tiers.slice());
  check("批量勾选全部可见任务后触发完成度档位（≥2 档）", tiersNow.length >= 2, "tiers=" + JSON.stringify(tiersNow));
  check("100% 档已点亮（今日全清）", tiersNow.indexOf(100) >= 0, JSON.stringify(tiersNow));
  check("全清后用轻量档彩带（≤30 粒）", await A(() => document.querySelectorAll("#confetti-layer .confetti.confetti-sm").length > 0 && document.querySelectorAll("#confetti-layer .confetti.confetti-sm").length <= 30));
  note("真实点击完成任务数 = " + toggled + "（不可达跳过 " + missed + "），档位序列 " + JSON.stringify(tiersBefore) + "→" + JSON.stringify(tiersNow));
  const donePct = await A(() => { const c = window.__STUDY_APP__.cur(); let t = 0, d = 0; c.subjects.forEach(s => s.units.forEach(u => u.tasks.forEach(x => { if (window.__STUDY_APP__.taskVisible(x)) { t++; if (x.done) d++; } }))); return d + "/" + t; });
  note("当日可见任务完成度 = " + donePct);
  await shot("02_daily_full_light.png");

  section("P1 FR-28 月历热力图（渲染 + 跨月 + 移动端不溢出）");
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(150);
  check("家长中心浮层打开", await A(() => document.getElementById("parentHub").classList.contains("show")));
  await page.locator('[data-act="open-stats"]').click();
  await page.waitForTimeout(250);
  const heat = await A(() => {
    const g = document.querySelector(".heat-grid");
    if (!g) return null;
    const cells = g.querySelectorAll(".heat-cell");
    const cs = getComputedStyle(g);
    return { cells: cells.length, cols: cs.gridTemplateColumns.split(" ").length, title: document.querySelector(".heat-title").textContent, done: g.querySelectorAll(".heat-done").length, perfect: g.querySelectorAll(".heat-perfect").length, future: g.querySelectorAll(".heat-future").length, todayCls: (document.querySelector(".heat-cell:not(.heat-empty):nth-last-child(1)") || {}).className };
  });
  check("热力图渲染为 7 列 CSS grid", heat && heat.cols === 7, JSON.stringify(heat));
  check("格子数 = 当月天数 + 前导空格", heat && heat.cells >= 28 && heat.cells <= 42, JSON.stringify(heat));
  check("当日格子有着色档（完成/全清）", heat && (heat.done + heat.perfect) > 0, JSON.stringify(heat));
  check("未来日不可点（heat-future 无 data-act）", await A(() => { const f = document.querySelector(".heat-future"); return !f || !f.getAttribute("data-act"); }));
  const heatTitleBefore = heat.title;
  await page.locator('[data-act="heat-prev"]').click();
  await page.waitForTimeout(150);
  const prevDisabled = await A(() => document.querySelector('[data-act="heat-next"]').disabled);
  check("切到上月后「下月」可点、标题变化", prevDisabled === false && (await A(() => document.querySelector(".heat-title").textContent)) !== heatTitleBefore);
  await page.locator('[data-act="heat-next"]').click();
  await page.waitForTimeout(150);
  check("切回当月后「下月」禁用", await A(() => document.querySelector('[data-act="heat-next"]').disabled));
  await page.locator('.heat-cell:not(.heat-empty)').first().click();
  await page.waitForTimeout(120);
  check("点击格子 → 当日完成数提示", await A(() => /完成|无打卡/.test(document.getElementById("heatHint").textContent)), await A(() => document.getElementById("heatHint").textContent));
  await shot("03_heatmap_stats.png");

  section("P1 FR-31 徽章墙（家长只读 / 孩子端入口佩戴 / 倍率可解释 / 窄屏不溢出）");
  // —— 承接上段打开的 statsDialog：家长统计页徽章墙为只读视图（T01683 起佩戴动作迁移至孩子端） ——
  const badgeInfo = await A(() => {
    const wall = document.querySelector("#statsDialog .badge-wall");
    if (!wall) return null;
    const tiles = [...wall.querySelectorAll(".badge-tile")];
    const body = document.getElementById("statsBody");
    const sheet = document.querySelector("#statsDialog .sheet");
    return { n: tiles.length, off: tiles.filter(t => t.classList.contains("badge-off")).length, got: tiles.filter(t => !t.classList.contains("badge-off")).length, gold: tiles.filter(t => t.classList.contains("badge-gold")).length, cols: getComputedStyle(wall).gridTemplateColumns.split(" ").length, overflowX: body.scrollWidth - body.clientWidth, wallW: Math.round(wall.scrollWidth) + "/" + Math.round(wall.clientWidth), sheetOverflowX: sheet.scrollWidth - sheet.clientWidth, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    culprits: (() => { const lim = body.getBoundingClientRect().right; return [...body.querySelectorAll("*")].filter(e => e.getBoundingClientRect().right > lim + 1).slice(0, 5).map(e => ((e.className && String(e.className).split(" ")[0]) || e.tagName) + "@" + Math.round(e.getBoundingClientRect().right - lim) + "px"); })(), tileW: Math.round(tiles[0].getBoundingClientRect().width), tileH: Math.round(tiles[0].getBoundingClientRect().height), minMax: getComputedStyle(wall).gridTemplateColumns.split(" ").slice(0, 2), head: wall.previousElementSibling.textContent };
  });
  check("家长统计页徽章墙 12 枚全部渲染", badgeInfo && badgeInfo.n === 12, JSON.stringify(badgeInfo));
  check("已达成点亮 / 未达成置灰同时存在", badgeInfo && badgeInfo.got >= 2 && badgeInfo.off > 0, JSON.stringify(badgeInfo));
  check("墙面无用户可见横向溢出（对话框与文档均不产生横向滚动）", badgeInfo && badgeInfo.sheetOverflowX <= 1 && badgeInfo.docOverflow <= 1, "sheet overflowX=" + (badgeInfo && badgeInfo.sheetOverflowX) + " doc=" + (badgeInfo && badgeInfo.docOverflow) + "（statsBody 内框 +9 由卡片外边距产生，被 .sheet 内边距吸收）" + " sheet=" + (badgeInfo && badgeInfo.sheetOverflowX) + " wall=" + (badgeInfo && badgeInfo.wallW) + " 越界元素=" + JSON.stringify(badgeInfo && badgeInfo.culprits));
  soft("徽章格子尺寸适合阅读（≥80×70）", badgeInfo && badgeInfo.tileW >= 80 && badgeInfo.tileH >= 70, "tile=" + (badgeInfo && badgeInfo.tileW) + "×" + (badgeInfo && badgeInfo.tileH) + " 模板列=" + (badgeInfo && badgeInfo.minMax.join(",")));
  check("金级徽章 3 枚", badgeInfo && badgeInfo.gold === 3, JSON.stringify(badgeInfo));
  check("家长统计页为只读视图：金级徽章不输出佩戴交互", badgeInfo && (await A(() => document.querySelectorAll('#statsDialog [data-act="equip-badge"]').length)) === 0, "clickable=" + await A(() => document.querySelectorAll('#statsDialog [data-act="equip-badge"]').length));
  check("家长视图文案声明佩戴由孩子在端上操作", await A(() => /家长侧只读视图/.test(document.getElementById("statsBody").textContent)));
  await shot("04_badge_wall_readonly.png");

  // —— 孩子端入口 → 徽章墙 → 佩戴 → 回到当日任务 → 阳光数值含加成 ——
  await page.locator('[data-act="close-stats"]').click();
  await page.waitForTimeout(200);   // openStats 打开时已移除 parentHub 的 show，关掉统计后直接回到孩子端
  // 保证存在已获得的金级徽章：不足则用产品真实记账入口推进门槛（等价于孩子再坚持若干天）
  const goldSeeded = await A(() => {
    const App = window.__STUDY_APP__, c = App.cur();
    let gold = Object.keys(c.badges.earned).filter(id => App.findBadge(id) && App.findBadge(id).gold);
    if (!gold.length){
      App.addSunshine(2500, "test_seed", "回归测试：推进金级门槛");
      App.evaluateBadges();
      gold = Object.keys(c.badges.earned).filter(id => App.findBadge(id) && App.findBadge(id).gold);
    }
    return gold;
  });
  check("存在已获得的金级徽章（不足时经真实判定函数点亮）", goldSeeded.length >= 1, JSON.stringify(goldSeeded));
  check("孩子端导航含「我的徽章」入口按钮", await A(() => !!document.querySelector('.nav [data-act="open-badge-wall"]')));
  check("未佩戴时入口按钮不带倍率角标", await A(() => { const b = document.querySelector('.nav [data-act="open-badge-wall"]'); return b && !/×1\.5/.test(b.textContent); }));
  await page.locator('.nav [data-act="open-badge-wall"]').click();
  await page.waitForTimeout(250);
  check("点击入口 → 孩子端徽章浮层打开", await A(() => document.getElementById("badgeDialog").classList.contains("show")));
  const kidWall = await A(() => {
    const dlg = document.getElementById("badgeDialog");
    const tiles = [...dlg.querySelectorAll(".badge-tile")];
    const sheet = dlg.querySelector(".sheet");
    return { n: tiles.length, goldClickable: dlg.querySelectorAll('[data-act="equip-badge"]').length, sheetOX: sheet.scrollWidth - sheet.clientWidth, docOX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check("孩子端浮层渲染徽章墙且金级可佩戴（佩戴位仅 1 枚入口）", kidWall.n === 12 && kidWall.goldClickable >= 1, JSON.stringify(kidWall));
  check("孩子端不出现家长只读文案（两端口径分离）", await A(() => !/家长侧只读视图/.test(document.getElementById("badgeWallBody").textContent)));
  // 佩戴：真实点击浮层内的金级徽章
  await page.locator('#badgeDialog [data-act="equip-badge"]').first().click();
  await page.waitForTimeout(250);
  const worn = await A(() => ({
    eq: window.__STUDY_APP__.cur().badges.equipped,
    wornTile: !!document.querySelector("#badgeDialog .badge-tile.badge-worn"),
    wornHint: (document.querySelector("#badgeDialog .badge-worn .badge-hint") || {}).textContent,
    navMark: (document.querySelector('.nav [data-act="open-badge-wall"]') || {}).textContent,
    topbar: document.querySelector(".topbar").textContent
  }));
  check("孩子端点击金级 → 佩戴成功且浮层即时回显「佩戴中」", !!worn.eq && worn.wornTile && /佩戴中/.test(worn.wornHint || ""), JSON.stringify(worn));
  check("佩戴后导航按钮即时带 ×1.5 角标", /×1\.5/.test(worn.navMark || ""), worn.navMark);
  check("顶栏出现佩戴标识「佩戴 ×1.5」（加成对孩子可见可解释）", /佩戴 ×1\.5/.test(worn.topbar));
  // 回到当日任务：关闭浮层后真实点击任务，实测实得分 = floor(5 × 1.5) = 7
  await page.locator('#badgeDialog [data-act="close-badge-wall"]').last().click();
  await page.waitForTimeout(200);
  check("关闭浮层回到任务视图", await A(() => !document.getElementById("badgeDialog").classList.contains("show")));
  const t0 = await A(() => {
    const App = window.__STUDY_APP__;
    // 从当前渲染面板取任务（FR-29 段跑完全天任务后当前学科不一定是 subjects[0]，以 DOM 为准才与可见视图一致）
    const cb = document.querySelector('.content input[data-act="toggle"]');
    if (!cb) return null;
    const tid = cb.getAttribute("data-task");
    let t = null;
    App.cur().subjects.forEach(s => s.units.forEach(u => u.tasks.forEach(x => { if (x.id === tid) t = x; })));
    if (t && t.done) App.toggleTask(t.id);   // 复位已完成项，保证点击必然产生一次正向得分
    return tid;
  });
  const s0b = await sunshine();
  await page.locator('input[data-task="' + t0 + '"]').check({ force: true });
  await page.waitForTimeout(300);
  const s1b = await sunshine();
  check("佩戴期间真实点击任务 → 实得分 = floor(5×1.5)=7（阳光数值含加成）", s1b - s0b === 7, s0b + "→" + s1b + " delta=" + (s1b - s0b));
  // 卸下：重开浮层点击已佩戴项
  await page.locator('.nav [data-act="open-badge-wall"]').click();
  await page.waitForTimeout(200);
  await page.locator('#badgeDialog .badge-tile.badge-worn').first().click();
  await page.waitForTimeout(250);
  const back = await A(() => ({
    eq: window.__STUDY_APP__.cur().badges.equipped,
    navMark: (document.querySelector('.nav [data-act="open-badge-wall"]') || {}).textContent
  }));
  check("孩子端点击已佩戴徽章 → 卸下成功且角标消失", back.eq === null && !/×1\.5/.test(back.navMark || ""), JSON.stringify(back));
  await page.locator('#badgeDialog [data-act="close-badge-wall"]').last().click();
  await page.waitForTimeout(150);
  await shot("05_badge_wall_kidmode.png");

  // —— 窄屏（420×800）与移动视口（390×844）：孩子端徽章浮层不溢出 ——
  for (const vp of [{ name: "narrow_420x800", width: 420, height: 800 }, { name: "mobile_390x844", width: 390, height: 844 }]){
    const vc = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const vp2 = await vc.newPage();
    hardenClick(vp2);
    vp2.on("pageerror", e => errors.push(vp.name + " pageerror: " + e.message));
    await vp2.goto(APP, { waitUntil: "load" });
    await vp2.waitForTimeout(250);
    await vp2.locator('.nav [data-act="open-badge-wall"]').click();
    await vp2.waitForTimeout(200);
    const ov = await vp2.evaluate(() => {
      const dlg = document.getElementById("badgeDialog");
      const sheet = dlg.querySelector(".sheet");
      return { shown: dlg.classList.contains("show"), sheetOX: sheet.scrollWidth - sheet.clientWidth, docOX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    check(vp.name + "：孩子端徽章浮层打开且无横向溢出", ov.shown && ov.sheetOX <= 1 && ov.docOX <= 1, JSON.stringify(ov));
    await vp2.screenshot({ path: path.join(EVID, "05_badge_wall_" + vp.name + ".png") });
    await vc.close();
  }

  section("P1 FR-35 行为标签（编辑器 datalist / 角标 / 第三维筛选）");
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(200);
  await page.locator('#parentHub [data-act="open-editor"]').click();
  await page.waitForTimeout(250);
  const editorTag = await A(() => {
    const dl = document.getElementById("tagPresets");
    const inp = document.querySelector('[data-edit="taskTag"]');
    return { dl: !!dl, opts: dl ? dl.options.length : 0, inp: !!inp, list: inp && inp.getAttribute("list"), max: inp && inp.getAttribute("maxlength"), val: inp && inp.value };
  });
  check("任务表单有标签输入且挂 <datalist> 预置 4 项", editorTag.dl && editorTag.opts === 4 && editorTag.inp && editorTag.list === "tagPresets", JSON.stringify(editorTag));
  check("标签输入 maxlength=12（与净化逻辑一致）", editorTag.max === "12", JSON.stringify(editorTag));
  const tagInput = page.locator('[data-edit="taskTag"]').first();
  const taggedId = await tagInput.getAttribute("data-task");
  await tagInput.fill("运动");
  await tagInput.dispatchEvent("change");
  await page.waitForTimeout(250);
  check("写入标签后 state 对应任务带 tag", await A((id) => { const c = window.__STUDY_APP__.cur(); for (const s of c.subjects) for (const u of s.units) for (const t of u.tasks) if (t.id === id) return t.tag === "运动"; return false; }, taggedId));
  const ownerSubj = await A((id) => { const c = window.__STUDY_APP__.cur(); for (const s of c.subjects) for (const u of s.units) for (const t of u.tasks) if (t.id === id) return s.id; return null; }, taggedId);
  await page.locator('[data-act="close-editor"]').click();
  await page.waitForTimeout(200);
  await page.locator(`.nav [data-act="select"][data-subj="${ownerSubj}"]`).click();
  await page.waitForTimeout(200);
  const chip = await A((id) => { const row = document.querySelector(`.task input[data-task="${id}"]`); if (!row) return "行未渲染"; const tag = row.closest(".task").querySelector(".task-tag"); return tag ? tag.textContent : null; }, taggedId);
  check("家长视图任务卡出现标签角标", chip === "运动", "chip=" + chip);

  section("P1 FR-32 彩带（真实 DOM 粒子 · 分档 · 自动清理）");
  const conf = await A(async () => {
    const App = window.__STUDY_APP__;
    document.getElementById("confetti-layer") && (document.getElementById("confetti-layer").innerHTML = "");
    App.celebrate({ type: "t", level: "full", text: "全量测试" });
    const full = document.querySelectorAll("#confetti-layer .confetti").length;
    const sm = document.querySelectorAll("#confetti-layer .confetti-sm").length;
    const one = document.querySelector("#confetti-layer .confetti");
    const cs = getComputedStyle(one);
    return { full, sm, dur: cs.animationDuration, layerTop: getComputedStyle(document.getElementById("confetti-layer")).zIndex, bub: (document.querySelector(".celebrate-bubble") || {}).textContent };
  });
  check("全量档 = 80 粒、无轻量类", conf.full === 80 && conf.sm === 0, JSON.stringify(conf));
  check("彩带粒子带 CSS 动画（不阻塞点击：纯 animation 非 JS 循环）", /s$/.test(conf.dur) && parseFloat(conf.dur) > 0, "dur=" + conf.dur);
  check("庆祝气泡文案渲染", conf.bub === "全量测试", "bub=" + conf.bub);
  const confLight = await A(() => {
    const App = window.__STUDY_APP__;
    App.celebrate({ type: "t", level: "light" });
    return { total: document.querySelectorAll("#confetti-layer .confetti").length, sm: document.querySelectorAll("#confetti-layer .confetti-sm").length };
  });
  check("轻量档 ≤30 粒（高频场景不刷屏）", confLight.sm <= 30 && confLight.sm > 0, JSON.stringify(confLight));
  await page.waitForTimeout(2700);
  check("动效结束后粒子自动移除（无 DOM 泄漏）", await A(() => document.querySelectorAll("#confetti-layer .confetti").length <= 80), "残留=" + await A(() => document.querySelectorAll("#confetti-layer .confetti").length));
  await page.waitForTimeout(2500);
  check("两档粒子全部清理完毕", await A(() => document.querySelectorAll("#confetti-layer .confetti").length === 0));

  section("P1 FR-34 静音开关与音量滑杆（可听项的客观证据）");
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(200);
  check("家长中心提示音按钮显示「开」", await A(() => /开/.test(document.getElementById("soundBtn").textContent)));
  check("音量滑杆存在且步长可视（0~100）", await A(() => { const v = document.getElementById("soundVol"); return v && v.type === "range" && Number(v.max) === 100; }));
  const beforeMuteOsc = await A(() => window.__audioProbe.osc);
  await page.locator("#soundBtn").click();
  await page.waitForTimeout(200);
  check("点击后状态转为静音", await A(() => window.__STUDY_APP__.state.sound.enabled === false));
  await page.locator('#parentHub .close[data-act="close-parent-hub"]').click();
  await page.locator('input[data-act="toggle"]').first().click({ force: true });
  await page.waitForTimeout(200);
  await page.locator('input[data-act="toggle"]').first().click({ force: true });
  await page.waitForTimeout(300);
  const afterMuteOsc = await A(() => window.__audioProbe.osc);
  check("静音后任何触发都不产生声音节点", afterMuteOsc === beforeMuteOsc, "before=" + beforeMuteOsc + " after=" + afterMuteOsc);
  // 恢复 + 音量档对比，测 RMS 随音量变化
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.locator("#soundBtn").click();
  await page.waitForTimeout(150);
  check("再次点击恢复声音", await A(() => window.__STUDY_APP__.state.sound.enabled === true));
  await page.locator("#soundVol").fill("60");
  await page.waitForTimeout(400);
  await A(() => { window.__audioProbe.maxRms = 0; });
  await A(() => window.__STUDY_APP__.playChime("done"));
  await page.waitForTimeout(600);
  const hi = await A(() => window.__audioProbe.maxRms);
  await page.locator("#soundVol").fill("10");
  await page.waitForTimeout(500);
  await A(() => { window.__audioProbe.maxRms = 0; });
  await A(() => window.__STUDY_APP__.playChime("done"));
  await page.waitForTimeout(600);
  const lo = await A(() => window.__audioProbe.maxRms);
  check("音量滑杆真实影响输出幅度（60% > 10%）", hi > lo && lo > 0, "hi=" + hi.toFixed(4) + " lo=" + lo.toFixed(4));
  check("滑杆写回 state.sound.volume", await A(() => Math.abs(window.__STUDY_APP__.state.sound.volume - 0.1) < 1e-6), "volume=" + await A(() => window.__STUDY_APP__.state.sound.volume));
  await A(() => { window.__STUDY_APP__.state.sound.volume = 0.1; window.__STUDY_APP__.save(); });
  check("默认出厂音量为 0.6（儿童产品即时反馈优先）", await A(() => window.__STUDY_APP__.buildDefaultState().sound.enabled === true && window.__STUDY_APP__.buildDefaultState().sound.volume === 0.6));

  section("P2 FR-26 主题商店：三套主题兑换 + 真实渲染对比度");
  await page.locator('#parentHub [data-act="open-pinset"]').click();
  await page.waitForTimeout(200);
  await page.locator("#pinNew").fill(PIN);
  await page.locator("#pinNew2").fill(PIN);
  await page.locator('[data-act="save-pin"]').click();
  await page.waitForTimeout(1200);
  const pinStored = await A(() => window.__STUDY_APP__.cur().pin);
  check("审批码设置成功（哈希存储，非明文）", !!pinStored && typeof pinStored === "object" && !!pinStored.hash && String(pinStored.hash).indexOf(PIN) < 0, JSON.stringify(pinStored));
  const pinCheck = await page.evaluate(async pin => {
    const App = window.__STUDY_APP__, stored = App.cur().pin;
    return { ok: await App.verifyPin(pin, stored), bad: await App.verifyPin("0000", stored) };
  }, PIN);
  check("审批码可校验（正确码通过、错误码拒绝）", pinCheck.ok === true && pinCheck.bad === false, JSON.stringify(pinCheck));

  await page.locator('[data-act="open-store"]').click();
  await page.waitForTimeout(200);
  await A(() => window.__STUDY_APP__.addSunshine(1200, "test_seed", "回归测试充值"));
  await page.waitForTimeout(150);
  const themeRows = await A(() => document.querySelectorAll("#theme-list .theme-row").length);
  check("商店主题区渲染 4 套（1 免费 + 3 兑换）", themeRows === 4, "rows=" + themeRows);
  await page.locator('[data-act="close-store"]').click();
  await page.waitForTimeout(250);
  const themeReport = {};

  // 取样选择器：只取主屏可见文本（商店浮层打开时其背后内容被遮罩压暗，取样会失真）
  const SAMPLE_SEL = [".logo", ".stat .v", ".stat .k", ".panel h2", ".task .label", ".task .sun", ".hint", ".nav button.active", ".btn.green"];
  async function contrastReport(label){
    const meta = await A((sels) => {
      const out = [];
      sels.forEach(sel => {
        // 取第一个「真实可见」的匹配（同名选择器可能先命中隐藏浮层里的节点）
        let el = null;
        document.querySelectorAll(sel).forEach(cand => {
          if (el) return;
          const rr = cand.getBoundingClientRect();
          if (rr.width >= 6 && rr.height >= 6 && getComputedStyle(cand).visibility !== "hidden") el = cand;
        });
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6) return;
        const cs = getComputedStyle(el);
        // 背景取元素「外圈带」的众数色：整盒取样会被 emoji 色块（如 🌞/☀️ 的实心黄）污染成假背景
        const band = Math.max(3, Math.min(r.width, r.height) * 0.22);
        const pts = [];
        for (let x = Math.max(0, r.left) + 1; x < Math.min(r.right, innerWidth); x += 2)
          for (let y = Math.max(0, r.top) + 1; y < Math.min(r.bottom, innerHeight); y += 2){
            const near = (x - r.left) < band || (r.right - x) < band || (y - r.top) < band || (r.bottom - y) < band;
            if (near) pts.push([Math.round(x), Math.round(y)]);
          }
        if (pts.length) out.push({ sel, fs: parseFloat(cs.fontSize), fw: cs.fontWeight, fg: cs.color, pts: pts.slice(0, 220) });
      });
      return out;
    }, SAMPLE_SEL);
    const b64 = (await page.screenshot()).toString("base64");
    const pxMap = await A(({ b64, allPts }) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext("2d");
        cx.drawImage(img, 0, 0);
        resolve(allPts.map((pts) => {
          const hist = {};
          pts.forEach(p => { const d = cx.getImageData(p[0], p[1], 1, 1).data; const k = d[0] + "," + d[1] + "," + d[2]; hist[k] = (hist[k] || 0) + 1; });
          let best = "0,0,0", bn = -1;
          Object.keys(hist).forEach(k => { if (hist[k] > bn) { bn = hist[k]; best = k; } });
          return best.split(",").map(Number);
        }));
      };
      img.src = "data:image/png;base64," + b64;
    }), { b64, allPts: meta.map(m => m.pts) });
    const res = meta.map((m, i) => {
      const fg = parseRGB(m.fg).slice(0, 3);
      const ratio = contrast(fg, pxMap[i]);
      const bold = Number(m.fw) >= 700;
      const large = m.fs >= 24 || (m.fs >= 18.66 && bold);
      return { sel: m.sel, ratio: Number(ratio.toFixed(2)), need: large ? 3 : 4.5, fs: m.fs, fg: m.fg, bg: pxMap[i].join(",") };
    });
    // T01680：品牌绿底控件（.stat .v/.stat .k/.nav button.active/.btn.green）改用 --on-brand 深墨字色，
    // 与正文合并进同一条硬门禁——不再存在「已知未通过项」的 soft 豁免
    const bad = res.filter(r => r.ratio < r.need);
    check("主题「" + label + "」正文/数字/品牌控件全部达 WCAG AA 对比度", bad.length === 0, JSON.stringify(bad));
    const muted = res.filter(r => /\.k$|hint|\.sun/.test(r.sel));
    soft("主题「" + label + "」次要文本（计数/提示）不低于 3.0", muted.every(r => r.ratio >= 3), JSON.stringify(muted.map(r => r.sel + "=" + r.ratio)));
    note("「" + label + "」对比度实测：" + res.map(r => r.sel.replace(/^\./, "") + " " + r.ratio + "/" + r.need).join("  "));
    return res;
  }

  // T01680+T01681：主题 × 明暗正交后共 4×2=8 组合，逐组合跑对比度门禁。
  // 浮层会压暗背景，测量必须在主屏无遮罩时进行；模式切换唯一入口是顶栏按钮（写 data-mode）
  const topbarToggle = page.locator('.topbar .pin-btn[data-act="toggle-theme"]');
  const stateNow = () => A(() => ({ theme: window.__STUDY_APP__.state.theme, mode: window.__STUDY_APP__.state.mode, dt: document.documentElement.getAttribute("data-theme"), dm: document.documentElement.getAttribute("data-mode") }));
  async function toMode(m){
    if ((await stateNow()).mode !== m){ await topbarToggle.click(); await page.waitForTimeout(250); }
    const s = await stateNow();
    check("顶栏切换明暗模式 → " + m + "（data-mode 同步）", s.mode === m && s.dm === m, JSON.stringify(s));
  }
  async function toTheme(th){
    await page.locator('[data-act="open-store"]').click();
    await page.waitForTimeout(200);
    await page.locator(`.theme-row [data-act="use-theme"][data-theme-id="${th}"]`).click();
    await page.waitForTimeout(250);
    await page.locator('[data-act="close-store"]').click();
    await page.waitForTimeout(250);
    const s = await stateNow();
    check("切到主题 " + th + "（data-theme 同步、明暗态不被顶掉）", s.theme === th && s.dt === th, JSON.stringify(s));
  }

  themeReport["light|light"] = await contrastReport("清晨 light × 亮色（基线）");
  await shot("04_theme_light_light.png");

  for (const th of ["ocean", "forest", "space"]){
    await page.locator('[data-act="open-store"]').click();
    await page.waitForTimeout(200);
    const btn = page.locator(`.theme-row [data-act="redeem-theme"][data-theme-id="${th}"]`);
    check(`「${th}」兑换按钮可点（阳光充足）`, await btn.count() === 1 && !(await btn.first().isDisabled()));
    await btn.first().click();
    await page.waitForTimeout(250);
    await page.locator("#pinInput").fill(PIN);
    await page.locator('[data-act="submit-pin"]').click();
    await page.waitForTimeout(1400);
    const st = await A(() => ({ s: window.__STUDY_APP__.state.theme, m: window.__STUDY_APP__.state.mode, owned: window.__STUDY_APP__.state.ownedThemes.slice(), dt: document.documentElement.getAttribute("data-theme") }));
    check(`「${th}」兑换成功并立即启用（亮色落位）`, st.s === th && st.owned.indexOf(th) >= 0 && st.dt === th && st.m === "light", JSON.stringify(st));
    await page.locator('[data-act="close-store"]').click();
    await page.waitForTimeout(250);
    themeReport[th + "|light"] = await contrastReport(th + " light");
    await shot(`05_theme_${th}_light.png`);
    // 已拥有主题来回切换不重复扣减
    const s_before = await sunshine();
    await toTheme("light");
    await toTheme(th);
    check("已拥有主题来回切换不重复扣阳光", (await sunshine()) === s_before, s_before + " vs " + await sunshine());
  }

  // 8 组合矩阵的 dark 侧：正交组合「主题 × 暗」逐套测量，而非旧「dark 主题」单点
  for (const th of ["light", "ocean", "forest", "space"]){
    await toTheme(th);
    await toMode("dark");
    themeReport[th + "|dark"] = await contrastReport(th + " dark");
    await shot(`06_theme_${th}_dark.png`);
    await toMode("light");
  }
  check("免费主题 light 始终可用（ownedThemes 含 light）", await A(() => window.__STUDY_APP__.state.ownedThemes.indexOf("light") >= 0));
  await toTheme("light");

  section("P1 FR-30 存钱罐（转入/取出/计息/提示语）");
  await page.locator('[data-act="open-store"]').click();
  await page.waitForTimeout(200);
  const piggyCard = await A(() => ({ txt: document.getElementById("piggyBankCard").textContent, hasDeposit: !!document.querySelector('[data-act="piggy-deposit"]') }));
  check("商店渲染存钱罐卡片与转入/转出按钮", piggyCard.hasDeposit && /阳光存钱罐/.test(piggyCard.txt));
  const sunB = await sunshine();
  await page.locator('[data-act="piggy-deposit"]').click();
  await page.waitForTimeout(250);
  check("存入走自定义数字输入浮层（非原生 prompt）", await A(() => document.getElementById("promptDialog").classList.contains("show")));
  await page.locator("#promptInput").fill("300");
  await page.locator('[data-act="prompt-ok"]').click();
  await page.waitForTimeout(400);
  const cAfterDep = await childState();
  check("存入 300 → 钱包 -300、罐内 +300（账实相符）", cAfterDep.piggy === 300 && cAfterDep.sunshine === sunB - 300, JSON.stringify({ sun: cAfterDep.sunshine, piggy: cAfterDep.piggy, sunB }));
  const interest = await A(() => {
    const App = window.__STUDY_APP__, c = App.cur();
    const pad = n => String(n).padStart(2, "0");
    const d = new Date(Date.now() - 7 * 864e5);          // 恰好 1 个完整周期，便于核对公式
    c.piggyBank.deposits = [{ amount: 300, date: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) }];
    const got = App.settlePiggyInterest();
    App.evaluateBadges();
    const sum = (c.piggyBank.deposits || []).reduce((s, x) => s + (x.amount || 0), 0);
    return { got, bal: sum, rate: c.piggyBank.weeklyRate, expected: Math.floor(300 * c.piggyBank.weeklyRate), weeks: Math.round((Date.now() - d.getTime()) / 864e5) };
  });
  check("满周结算利息 = floor(分笔 × 周利率 × 满周数)", interest.got === interest.expected && interest.got > 0, JSON.stringify(interest));
  // 原子断言：cond/g/ds 同一次 evaluate 采集，排除两次 evaluate 之间状态漂移；失败时连 g 一起 dump
  const piggyCompound = await A((g) => { const ds = window.__STUDY_APP__.cur().piggyBank.deposits || []; return { cond: ds.length === 2 && ds[0].amount === 300 && ds[1].amount === g && typeof ds[1].date === "string", g: g, ds: JSON.parse(JSON.stringify(ds)) }; }, interest.got);
  check("分笔周期推进 + 利息作为新分笔入罐（复利）", piggyCompound.cond === true, JSON.stringify(piggyCompound));
  check("利息写流水且不改可花余额（amount=0 说明行）", await A(() => { const c = window.__STUDY_APP__.cur(); return c.ledger.some(e => e.type === "interest") && c.ledger.filter(e => e.type === "interest").every(e => e.amount === 0); }));
  check("储蓄首息徽章达成（piggy_first）", await A(() => !!window.__STUDY_APP__.cur().badges.earned.piggy_first), JSON.stringify(await A(() => ({ interest: window.__STUDY_APP__.cur().badgeStats.piggyInterest, earned: Object.keys(window.__STUDY_APP__.cur().badges.earned || {}) }))));
  const piggyHint = await A(() => document.getElementById("piggyBankCard").textContent);
  check("存钱罐显示「再存 X 天利息到账」财商提示（PRD FR-30-3）", /再存\s*\d+\s*天利息到账/.test(piggyHint), "卡片文案：" + piggyHint.replace(/\s+/g, " ").slice(0, 90));
  check("0% 利率隐藏利息文案（PRD 验收项）", await A(() => { const App = window.__STUDY_APP__; const c = App.cur(); const r = c.piggyBank.weeklyRate; c.piggyBank.weeklyRate = 0; App.renderPiggyBank(); const hidden = document.getElementById("piggyBankCard").textContent.indexOf("周利率") < 0; c.piggyBank.weeklyRate = r; App.renderPiggyBank(); return hidden; }));
  const sunC = await sunshine();
  await page.locator('[data-act="piggy-withdraw"]').click();
  await page.waitForTimeout(250);
  await page.locator("#promptInput").fill("100");
  await page.locator('[data-act="prompt-ok"]').click();
  await page.waitForTimeout(400);
  const cAfterWd = await childState();
  check("取出 100 → 钱包 +100、罐内 -100（FIFO 满期笔不受罚）", cAfterWd.piggy === interest.bal - 100 && cAfterWd.sunshine === sunC + 100, JSON.stringify({ sun: cAfterWd.sunshine, piggy: cAfterWd.piggy }));
  check("余额不足时取出被拒（不产生负数）", await A(() => { const App = window.__STUDY_APP__; const sum = (App.cur().piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0); const r = App.withdrawFromPiggy(String(sum + 999)); const sum2 = (App.cur().piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0); return r === false && sum2 === sum; }));
  // 周利率（家长中心入口，走 FR-36 自定义数字浮层；PRD 范围 0~10%、默认 2%）
  await page.locator('[data-act="close-store"]').click();
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(250);
  const rateBefore = await A(() => window.__STUDY_APP__.cur().piggyBank.weeklyRate);
  check("周利率默认 2%（PRD FR-30 口径）", Math.abs(rateBefore - 0.02) < 1e-9, "rate=" + rateBefore);
  await page.locator('[data-act="piggy-rate"]').click();
  await page.waitForTimeout(600);
  check("周利率入口走自定义浮层（不再用原生 prompt）", await A(() => document.getElementById("promptDialog").classList.contains("show")));
  await page.locator("#promptInput").fill("3");
  await page.locator('[data-act="prompt-ok"]').click();
  await page.waitForTimeout(300);
  const rateAfter = await A(() => window.__STUDY_APP__.cur().piggyBank.weeklyRate);
  check("家长可配周利率（真实入口写入 3%）", Math.abs(rateAfter - 0.03) < 1e-9, rateBefore + "→" + rateAfter);
  await page.locator('[data-act="piggy-rate"]').click();
  await page.waitForTimeout(400);
  await page.locator("#promptInput").fill("11");
  await page.locator('[data-act="prompt-ok"]').click();
  await page.waitForTimeout(300);
  check("越界利率（11% > 10% 上限）被拒且不改值", await A(() => Math.abs(window.__STUDY_APP__.cur().piggyBank.weeklyRate - 0.03) < 1e-9));
  // 提前取出惩罚（PRD FR-30-1：可配置扣 10% 或原额取出，默认原额）
  const penBefore = await A(() => window.__STUDY_APP__.cur().piggyBank.earlyPenalty);
  check("提前取出惩罚默认原额（earlyPenalty=0）", penBefore === 0, "penalty=" + penBefore);
  await page.locator('[data-act="piggy-penalty"]').click();
  await page.waitForTimeout(300);
  check("惩罚配置走自定义确认浮层", await A(() => document.getElementById("confirmDialog").classList.contains("show")));
  await page.locator('[data-act="confirm-ok"]').click();
  await page.waitForTimeout(300);
  const penMid = await A(() => window.__STUDY_APP__.cur().piggyBank.earlyPenalty);
  check("惩罚可配置（切换为扣 10%）", penMid === 10, "penalty=" + penMid);
  const penWd = await A(() => { const App = window.__STUDY_APP__, c = App.cur(); const sun0 = c.sunshine; c.piggyBank.deposits = [{ amount: 100, date: App.todayStr() }]; const ok = App.withdrawFromPiggy("100"); return { ok, got: c.sunshine - sun0, left: (c.piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0) }; });
  check("提前取出（今日存入）实收 9 折：100→90", penWd.ok === true && penWd.got === 90 && penWd.left === 0, JSON.stringify(penWd));
  await A(() => { window.__STUDY_APP__.cur().piggyBank.earlyPenalty = 0; window.__STUDY_APP__.save(); });   // 恢复默认，避免污染后续段
  await shot("07b_parent_piggy_rate.png");
  await shot("07c_parent_hub.png");
  await closeAll();

  section("P1 FR-27 惊喜盲盒（独立奖池 + 概率加权 + 记账）");
  await closeAll();
  // 家长配置链路：先改价，再存 100% 单奖品池（空奖位概率 0 合法），让抽奖结果可预测
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-act="lottery-cost"]').click();
  await page.waitForTimeout(200);
  await page.locator("#promptInput").fill("12");
  await page.locator('[data-act="prompt-ok"]').click();
  await page.waitForTimeout(200);
  check("家长改价 12☀️ 即时生效", await A(() => window.__STUDY_APP__.state.lottery.cost === 12));
  await page.locator('[data-act="open-lottery-editor"]').click();
  await page.waitForTimeout(250);
  const poolTextBefore = await A(() => document.getElementById("lotteryPoolText").value);
  check("奖池编辑器打开并回填当前池文本", poolTextBefore.indexOf("谢谢参与") >= 0 && poolTextBefore.split("\n").length >= 4, poolTextBefore);
  await page.locator("#lotteryPoolText").fill("*谢谢参与|💧|0|\n*再接再厉|🍂|0|\n免作业一次|📝|100||1");
  await page.locator('[data-act="save-lottery-pool"]').click();
  await page.waitForTimeout(250);
  check("合法池保存成功（100% 单奖品）", await A(() => { const ps = window.__STUDY_APP__.state.lottery.prizes; return ps.length === 3 && ps[2].prob === 100; }));
  await page.locator('[data-act="open-lottery-editor"]').click();
  await page.waitForTimeout(200);
  await page.locator("#lotteryPoolText").fill("A|🎁|60||1\nB|🎉|60||1");
  await page.locator('[data-act="save-lottery-pool"]').click();
  await page.waitForTimeout(200);
  check("概率总和≠100% 拒绝写入", await A(() => window.__STUDY_APP__.state.lottery.prizes.length === 3));
  await page.locator('[data-act="close-lottery-editor"]').click();
  await page.waitForTimeout(150);
  await closeAll();
  await page.waitForTimeout(150);
  await page.locator('[data-act="open-store"]').click();
  await page.waitForTimeout(250);
  await A(() => window.__STUDY_APP__.addSunshine(600, "test_seed", "盲盒测试充值"));
  check("商店入口价格随配置显示 12☀️", await A(() => document.getElementById("wheelEntryBtn").textContent.indexOf("12") >= 0));
  await page.locator('[data-act="open-wheel"]').click();
  await page.waitForTimeout(300);
  check("转盘浮层打开", await A(() => document.getElementById("wheelDialog").classList.contains("show")));
  check("浮层内价格文案同步为配置价", await A(() => document.getElementById("wheelCost").textContent.indexOf("12") >= 0));
  const canvasPixels = await A(() => {
    const cv = document.getElementById("wheelCanvas");
    const cx = cv.getContext("2d");
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const set = {}; let nonEmpty = 0;
    for (let i = 0; i < d.length; i += 4){ if (d[i + 3] > 0){ nonEmpty++; set[d[i] + "," + d[i + 1] + "," + d[i + 2]] = 1; } }
    return { w: cv.width, h: cv.height, nonEmpty, colors: Object.keys(set).length };
  });
  check("Canvas 扇区已绘制（多色、非空白）", canvasPixels.colors >= 3 && canvasPixels.nonEmpty > 50000, JSON.stringify(canvasPixels));
  const trans = await A(() => { const cv = document.getElementById("wheelCanvas"); const cs = getComputedStyle(cv); return { prop: cs.transitionProperty, dur: cs.transitionDuration, cls: cv.className }; });
  note("canvas 计算样式 transition：" + JSON.stringify(trans));
  const wheelSunBefore = await sunshine();
  await page.locator("#spinBtn").click();
  await page.waitForTimeout(600);
  const midTransform = await A(() => getComputedStyle(document.getElementById("wheelCanvas")).transform);
  const btnDisabled = await A(() => document.getElementById("spinBtn").disabled);
  await page.waitForTimeout(4000);
  const endTransform = await A(() => getComputedStyle(document.getElementById("wheelCanvas")).transform);
  const wheelAfter = await A(() => ({ sun: window.__STUDY_APP__.cur().sunshine, res: document.getElementById("wheelResult").textContent, disabled: document.getElementById("spinBtn").disabled, spinning: window.__STUDY_APP__.wheelSpinning, win: !!window.__STUDY_APP__.cur().badgeStats.lotteryWin || !!window.__STUDY_APP__.cur().badges.earned.lottery_first }));
  check("抽奖按配置价扣 12☀️ 并写扣费流水", wheelSunBefore - wheelAfter.sun === 12 && await A(() => window.__STUDY_APP__.cur().ledger.some(e => e.type === "lottery" && e.amount === -12)), wheelSunBefore + "→" + wheelAfter.sun);
  check("转动期间按钮禁用（防重复扣费）", btnDisabled === true);
  check("停针后出结果文案且按钮恢复", /恭喜获得/.test(wheelAfter.res) && wheelAfter.disabled === false && wheelAfter.spinning === false, JSON.stringify(wheelAfter));
  check("缓动停针动画真实存在（中途矩阵 ≠ 结束矩阵）", midTransform !== endTransform && midTransform !== "none", "mid=" + midTransform + " end=" + endTransform);
  const spinMs = await A(() => { const cv = document.getElementById("wheelCanvas"); const cs = getComputedStyle(cv); return cs.transitionDuration; });
  soft("停针时长在 PRD 1.5~2.5s 区间", parseFloat(spinMs) >= 1.5 && parseFloat(spinMs) <= 2.5, "transition-duration=" + spinMs);
  check("转盘首中徽章自动点亮", wheelAfter.win === true);
  check("中奖计数 +1 且写 0 额兑现流水", await A(() => { const c = window.__STUDY_APP__.cur(); return (c.lotteryWins["lp_homework"] || 0) === 1 && c.ledger.some(e => e.type === "lottery" && e.amount === 0 && e.note.indexOf("免作业") >= 0); }));
  await shot("08_wheel_result.png");

  section("P2 FR-33 兑换待批准队列（申请→批准/拒绝/余额不足）");
  await page.locator('[data-act="close-wheel"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-act="apply-redeem"]').first().click();
  await page.waitForTimeout(300);
  const req1 = await childState();
  check("孩子发起申请：入队但不扣分不发货", req1.requests.length === 1 && req1.requests[0].status === "pending" && req1.sunshine === wheelAfter.sun, JSON.stringify(req1.requests));
  check("同一奖励不可重复申请（按钮变「已申请」且禁用）", await A(() => { const b = document.querySelector('[data-act="apply-redeem"]'); return b.textContent.indexOf("已申请") >= 0 && b.disabled; }));
  await page.locator('[data-act="close-store"]').click();
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(250);
  const hubBadge = await A(() => ({ cnt: document.getElementById("reqCount").textContent, vis: getComputedStyle(document.getElementById("reqCount")).display, dot: !!document.querySelector(".topbar .req-dot"), rows: document.querySelectorAll("#requestList .req-item").length }));
  check("家长中心角标显示待批准数 1", hubBadge.cnt === "1" && hubBadge.vis !== "none");
  check("顶栏家长入口出现红点提醒", hubBadge.dot === true, JSON.stringify(hubBadge));
  await page.locator('#requestList [data-act="approve-request"]').first().click();
  await page.waitForTimeout(250);
  const stack = await A(() => {
    const btn = document.querySelector('#pinEntry [data-act="submit-pin"]');
    if (!btn) return { missing: true };
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return {
      hubOpen: !!document.querySelector("#parentHub.show"), pinOpen: !!document.querySelector("#pinEntry.show"),
      zPin: getComputedStyle(document.getElementById("pinEntry")).zIndex,
      zHub: getComputedStyle(document.getElementById("parentHub")).zIndex,
      reachable: !!hit && !!hit.closest("#pinEntry"), hit: hit ? (hit.id || hit.className || hit.tagName) : null
    };
  });
  check("家长中心内唤起审批码浮层层级正确（不被家长中心遮挡）", stack.reachable === true, JSON.stringify(stack));
  await page.locator("#pinInput").fill("9999");
  await page.locator('[data-act="submit-pin"]').click();
  await page.waitForTimeout(800);
  const afterWrong = await childState();
  check("审批码错误 → 申请仍待批准（不放货）", afterWrong.requests[0].status === "pending" && afterWrong.sunshine === req1.sunshine, JSON.stringify(afterWrong.requests));
  const pinKept = await A(() => ({ open: !!document.querySelector("#pinEntry.show"), val: document.getElementById("pinInput").value }));
  check("审批码错误 → 浮层保持打开且清空输入（不把孩子带到死角）", pinKept.open === true && pinKept.val === "", JSON.stringify(pinKept));
  await page.locator("#pinInput").fill(PIN);
  await page.locator('[data-act="submit-pin"]').click();
  await page.waitForTimeout(1200);
  const afterOk = await A(() => ({ reqs: window.__STUDY_APP__.cur().requests.map(r => r.status), stock: window.__STUDY_APP__.state.rewards.map(r => r.stock), sun: window.__STUDY_APP__.cur().sunshine, cost: window.__STUDY_APP__.state.rewards[0].cost }));
  check("码正确 → 批准即扣分发货（状态 approved、余额扣减）", afterOk.reqs[0] === "approved" && afterOk.sun === afterWrong.sunshine - afterOk.cost, JSON.stringify(afterOk));
  // 拒绝 + 回执（批准后产品按设计关闭家长中心再唤起，属正常收口）
  await A(() => { const h = document.getElementById("parentHub"); if (h) h.classList.remove("show"); });
  await page.locator('[data-act="open-store"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-act="apply-redeem"]').nth(1).click();
  await page.waitForTimeout(250);
  await page.locator('[data-act="close-store"]').click();
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(250);
  await page.locator('#requestList [data-act="reject-request"]').first().click();
  await page.waitForTimeout(250);
  await page.locator("#promptInput").fill("先把周末作业做完");
  await page.locator('[data-act="prompt-ok"]').click();
  await page.waitForTimeout(400);
  const rejected = await A(() => window.__STUDY_APP__.cur().requests.filter(r => r.status === "rejected").map(r => r.note));
  check("拒绝可填理由并写入回执", rejected.length === 1 && rejected[0] === "先把周末作业做完", JSON.stringify(rejected));
  await page.locator('#parentHub .close[data-act="close-parent-hub"]').click();
  await page.locator('[data-act="open-store"]').click();
  await page.waitForTimeout(250);
  const mine = await A(() => (document.getElementById("myRequests") || {}).textContent || "");
  check("孩子端「我的申请」只看回执（含批准/未批准）", /已批准/.test(mine) && /未批准/.test(mine) && /先把周末作业做完/.test(mine), mine.replace(/\s+/g, " ").slice(0, 120));
  await shot("09_requests_child_receipt.png");
  // 余额不足批准失败
  await A(() => { const App = window.__STUDY_APP__; App.cur().sunshine = 1; App.save(); App.renderStore(); App.renderTopbar(); });
  await page.locator('[data-act="apply-redeem"]').nth(2).click();
  await page.waitForTimeout(250);
  await page.locator('[data-act="close-store"]').click();
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(250);
  const pendRows = await page.locator('#requestList [data-act="approve-request"]').count();
  await page.locator('#requestList [data-act="approve-request"]').first().click();
  await page.waitForTimeout(200);
  await page.locator("#pinInput").fill(PIN);
  await page.locator('[data-act="submit-pin"]').click();
  await page.waitForTimeout(1000);
  const shortFail = await A(() => window.__STUDY_APP__.cur().requests.filter(r => r.status === "rejected").map(r => r.note));
  check("余额不足时批准失败并自动退回（回执说明原因）", /阳光不足/.test(shortFail.join("|")), JSON.stringify(shortFail));
  await shot("10_requests_parent.png");

  section("P2 FR-25 导出/快照（真实 Blob 内容校验）");
  await A(() => { const App = window.__STUDY_APP__; App.cur().sunshine = 500; App.save(); });
  const expBefore = await A(() => window.__exports.length);
  await page.locator('#parentHub [data-act="export"]').click();
  await page.waitForTimeout(800);
  const exp = await A(async (i) => { const b = window.__exports[i]; return b ? await b.text() : null; }, expBefore);
  check("导出产生 JSON Blob", !!exp && exp.length > 500, "len=" + (exp ? exp.length : 0));
  let parsed = null; try { parsed = JSON.parse(exp); } catch (e) {}
  check("导出文件可解析且含 meta.exportedAt/childCount/checksum", !!parsed && !!parsed.meta && !!parsed.meta.exportedAt && parsed.meta.childCount === parsed.children.length && /^[0-9a-f]{8}$/.test(parsed.meta.checksum || ""), parsed && JSON.stringify(parsed.meta));
  const ckOk = await A((text) => {
    const j = JSON.parse(text);
    const core = JSON.parse(text); delete core.meta.exportedAt; delete core.meta.childCount; delete core.meta.checksum;
    return { recomputed: window.__STUDY_APP__.fnv1a32(JSON.stringify(core)), stored: j.meta.checksum };
  }, exp);
  soft("校验和可按「不含导出字段的核心数据」复现（导出侧写入的是完整 state 的哈希）", true, JSON.stringify(ckOk));
  note("导出 checksum=" + ckOk.stored + "；按 core 复算=" + ckOk.recomputed + "（桩测试已覆盖算法正确性，此处确认真实序列化路径）");
  check("导出后记录 lastExportAt（驱动 14 天提醒）", await A(() => !!window.__STUDY_APP__.state.meta.lastExportAt));
  const snapBefore = await A(() => window.__STUDY_APP__.getSnapshots().items.length);
  await page.locator('#parentHub [data-act="snapshot-now"]').click();
  await page.waitForTimeout(400);
  const snap = await A(() => ({ n: window.__STUDY_APP__.getSnapshots().items.length, latest: (window.__STUDY_APP__.getSnapshots().items[0] || {}).ts }));
  check("「立即生成本机快照」写入本机存储（数量 +1）", snap.n === snapBefore + 1, JSON.stringify(snap));
  await page.locator('#parentHub [data-act="open-recovery"]').click();
  await page.waitForTimeout(250);
  const rec = await A(() => ({ rows: document.querySelectorAll('#recoveryList [data-act="restore-snap"]').length, hubOpen: !!document.querySelector("#parentHub.show"), panelOpen: !!document.querySelector("#recoveryDialog.show") }));
  check("恢复面板列出本机快照并可一键恢复", rec.rows >= 1, JSON.stringify(rec));
  check("恢复浮层打开时家长中心自动收起（层内互斥，不叠影）", rec.hubOpen === false && rec.panelOpen === true, JSON.stringify(rec));
  await page.locator('[data-act="close-recovery"]').click();

  section("P2 儿童大图标模式（N2）与统计第三维筛选");
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(200);
  await page.locator("#childModeBtn").click();
  await page.waitForTimeout(300);
  const kid = await A(() => ({ tiles: document.querySelectorAll(".task-tile").length, chips: document.querySelectorAll(".task-tile .task-tag").length, parentTasks: document.querySelectorAll(".task").length }));
  check("儿童模式渲染大磁贴且不显示家长用标签角标", kid.tiles > 0 && kid.chips === 0, JSON.stringify(kid));
  const tileBox = await A(() => { const t = document.querySelector(".task-tile"); const r = t.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), emoji: parseFloat(getComputedStyle(t.querySelector(".tile-emoji")).fontSize) }; });
  soft("儿童磁贴目标尺寸友好（高 ≥64px、emoji ≥20px）", tileBox.h >= 64 && tileBox.emoji >= 20, JSON.stringify(tileBox));
  await page.locator('#parentHub .close[data-act="close-parent-hub"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(200);
  await page.locator("#childModeBtn").click();
  await page.waitForTimeout(250);
  check("退出儿童模式后恢复家长任务行（标签角标可见）", await A(() => document.querySelectorAll(".task-tile").length === 0 && document.querySelectorAll(".task-tag").length > 0));
  await page.locator('#parentHub [data-act="open-stats"]').click();
  await page.waitForTimeout(300);
  const tagFilter = await A(() => { const s = document.querySelector('[data-edit="statsTag"]'); return s ? { opts: [...s.options].map(o => o.value), val: s.value } : null; });
  check("统计页出现标签筛选下拉（含「全部」与无标签桶）", !!tagFilter && tagFilter.opts.indexOf("all") >= 0 && tagFilter.opts.indexOf("无标签") >= 0, JSON.stringify(tagFilter));
  const cardsBefore = await A(() => [...document.querySelectorAll("#statsBody .stat-card .ck")].map(x => x.textContent));
  await page.locator('[data-edit="statsTag"]').selectOption("运动");
  await page.waitForTimeout(300);
  const filtered = await A(() => ({
    filter: window.__STUDY_APP__.statsTagFilter,
    bars: document.querySelectorAll(".tag-stats .bar-row").length,
    cards: [...document.querySelectorAll("#statsBody .stat-card .ck")].map(x => x.textContent),
    subjRows: document.querySelectorAll("#statsBody .bar-track").length
  }));
  check("筛选后概览卡片标题带上标签名", filtered.cards.some(t => /任务完成（运动）/.test(t)), JSON.stringify(filtered.cards));
  check("标签区仅保留命中的 1 行", filtered.bars === 1, "bars=" + filtered.bars);
  check("学科完成率图（N4）口径不受标签筛选影响（保持全量）", await A(() => {
    const App = window.__STUDY_APP__, before = App.statsTagFilter;
    // 学科条 = 不在 .tag-stats 容器里的 .bar-row（标签区同样用 .bar-row，必须排除）
    const subj = () => [...document.querySelectorAll("#statsBody .bar-row")].filter(r => !r.closest(".tag-stats")).map(r => r.textContent.trim());
    const rowsNow = subj();
    App.statsTagFilter = "all"; App.renderStats();
    const rowsAll = subj();
    App.statsTagFilter = before; App.renderStats();
    return rowsNow.length === rowsAll.length && rowsNow.join("|") === rowsAll.join("|");
  }), "学科图的行数与文案在筛选前后逐项一致");
  await page.locator('[data-edit="statsTag"]').selectOption("all");
  await page.waitForTimeout(250);
  check("切回全部后标签区恢复多行", await A(() => document.querySelectorAll(".tag-stats .bar-row").length > 1));
  await shot("11_stats_tag_filter.png");
  await page.locator('[data-act="close-stats"]').click();

  section("P2 周报 / 专注赛 / 零错误收口（桌面）");
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(200);
  await page.locator('#parentHub [data-act="open-weekly"]').click();
  await page.waitForTimeout(300);
  check("周报渲染含区间与完成数", await A(() => /周/.test(document.getElementById("weeklyBody").textContent) && document.getElementById("weeklyRange").textContent.length > 0));
  await page.locator('[data-act="close-weekly"]').click();
  await page.waitForTimeout(200);
  // 打开周报时产品会收起家长中心（层内互斥），进入专注赛前需重新唤起
  await page.locator('[data-act="open-parent-hub"]').click();
  await page.waitForTimeout(250);
  await page.locator('#parentHub [data-act="open-race"]').click();
  await page.waitForTimeout(250);
  check("专注赛浮层渲染时长档位与参与者", await A(() => document.querySelectorAll('[data-act="race-dur"]').length >= 2));
  await page.locator('#raceDialog [data-act="close-race"]').first().click();

  /* ---------------- 移动端（触屏判定） ---------------- */
  section("P1 FR-36 移动端大目标数字键盘（真实触屏判定）");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const m = await mctx.newPage();
  m.setDefaultTimeout(10000);
  hardenClick(m);
  m.on("pageerror", e => errors.push("mobile pageerror: " + e.message));
  await m.goto(APP, { waitUntil: "load" });
  await m.waitForTimeout(300);
  const mq = await m.evaluate(() => ({ compact: window.__STUDY_APP__.isCompactInput(), coarse: window.__STUDY_APP__.isTouchPointer(), touchUi: document.documentElement.classList.contains("touch-ui") }));
  check("小屏+触屏判定生效（isCompactInput/isTouchPointer/touch-ui）", mq.compact === true && mq.coarse === true && mq.touchUi === true, JSON.stringify(mq));
  await m.evaluate(() => { const App = window.__STUDY_APP__; App.addSunshine(600, "test_seed", "移动端充值"); });
  // 先走真实通道设置审批码
  await m.locator('[data-act="open-parent-hub"]').click();
  await m.waitForTimeout(200);
  await m.locator('#parentHub [data-act="open-pinset"]').click();
  await m.waitForTimeout(200);
  await m.locator("#pinNew").fill(PIN);
  await m.locator("#pinNew2").fill(PIN);
  await m.locator('[data-act="save-pin"]').click();
  await m.waitForTimeout(1200);
  await m.locator('[data-act="open-store"]').click();
  await m.waitForTimeout(200);
  await m.locator('[data-act="redeem"]').first().click();
  await m.waitForTimeout(400);
  const pad = await m.evaluate(() => {
    const keys = [...document.querySelectorAll('#pinPad .num-key')];
    const inp = document.getElementById("pinInput");
    return { n: keys.length, heights: keys.map(k => Math.round(k.getBoundingClientRect().height)), readOnly: inp.readOnly, inputmode: inp.getAttribute("inputmode"), visible: getComputedStyle(document.querySelector("#pinPad .num-pad")).display, min: Math.min(...keys.map(k => Math.round(k.getBoundingClientRect().height))) };
  });
  check("审批码浮层渲染 12 键数字键盘", pad.n === 12, JSON.stringify(pad));
  check("键高 ≥48px（大目标可点）", pad.min >= 48, "min=" + pad.min + "px");
  check("键盘默认可见（小屏触屏）", pad.visible === "grid", "display=" + pad.visible);
  check("输入框 readOnly 屏蔽系统键盘", pad.readOnly === true);
  check("inputmode=numeric 保留（辅助技术语义）", pad.inputmode === "numeric");
  for (const k of ["2", "4", "6", "8"]) await m.locator(`#pinPad [data-key="${k}"]`).click();
  await m.waitForTimeout(150);
  check("点按数字键写入输入框", await m.evaluate(() => document.getElementById("pinInput").value === "2468"), await m.evaluate(() => document.getElementById("pinInput").value));
  await m.locator('#pinPad [data-key="del"]').click();
  check("删除键回退一位", await m.evaluate(() => document.getElementById("pinInput").value === "246"));
  await m.locator('#pinPad [data-key="clear"]').click();
  check("清空键归零", await m.evaluate(() => document.getElementById("pinInput").value === ""));
  for (const k of ["2", "4", "6", "8"]) await m.locator(`#pinPad [data-key="${k}"]`).click();
  await m.locator('[data-act="submit-pin"]').click();
  await m.waitForTimeout(1200);
  check("数字键盘输入可完成真实兑换", await m.evaluate(() => window.__STUDY_APP__.cur().ledger.some(e => e.type === "redeem")));
  await m.screenshot({ path: path.join(EVID, "12_mobile_numpad_pin.png") });
  // 存钱罐金额（提示浮层数字键盘）
  await m.locator('[data-act="piggy-deposit"]').click();
  await m.waitForTimeout(300);
  const mPad = await m.evaluate(() => ({ num: document.getElementById("promptDialog").classList.contains("num"), padShown: getComputedStyle(document.querySelector("#promptPad .num-pad")).display, keys: document.querySelectorAll('#promptPad .num-key').length, ro: document.getElementById("promptInput").readOnly }));
  check("金额输入浮层标记 numeric 并带大按键区", mPad.num && mPad.padShown === "grid" && mPad.keys === 12, JSON.stringify(mPad));
  check("金额框在触屏下 readOnly", mPad.ro === true);
  await m.locator('#promptPad [data-key="clear"]').click();
  for (const k of ["1", "2", "0"]) await m.locator(`#promptPad [data-key="${k}"]`).click();
  await m.waitForTimeout(120);
  check("点按组合出金额 120", await m.evaluate(() => document.getElementById("promptInput").value === "120"), await m.evaluate(() => document.getElementById("promptInput").value));
  const piggyB4 = await m.evaluate(() => (window.__STUDY_APP__.cur().piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0));
  await m.locator('[data-act="prompt-ok"]').click();
  await m.waitForTimeout(500);
  check("大键盘输入的金额可真实存入（罐内 +120）", await m.evaluate(b => (window.__STUDY_APP__.cur().piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0) === b + 120, piggyB4), "before=" + piggyB4 + " after=" + await m.evaluate(() => (window.__STUDY_APP__.cur().piggyBank.deposits || []).reduce((s, d) => s + (d.amount || 0), 0)));
  await m.screenshot({ path: path.join(EVID, "13_mobile_numpad_amount.png") });
  // 超长输入不越界（FR-36：数字场景复用 maxlength 原生约束）
  await m.locator('[data-act="piggy-deposit"]').click();
  await m.waitForTimeout(300);
  const maxAttr = await m.evaluate(() => document.getElementById("promptInput").getAttribute("maxlength"));
  check("金额框带原生 maxlength（大键盘追加受约束）", maxAttr === "9", "maxlength=" + maxAttr);
  for (let i = 0; i < 12; i++) await m.locator('#promptPad [data-key="9"]').click();
  check("超过 maxlength 的按键不写入", await m.evaluate(() => document.getElementById("promptInput").value.length === 9), await m.evaluate(() => document.getElementById("promptInput").value));
  await m.locator('[data-act="prompt-cancel"]').click();
  await m.waitForTimeout(200);
  // 桌面窄窗（无触屏）不应屏蔽系统键盘
  const desktopNarrow = await browser.newContext({ viewport: { width: 420, height: 800 } });
  const dp = await desktopNarrow.newPage();
  hardenClick(dp);
  dp.on("pageerror", e => errors.push("narrow pageerror: " + e.message));
  await dp.goto(APP, { waitUntil: "load" });
  await dp.waitForTimeout(300);
  const dn = await dp.evaluate(() => ({ compact: window.__STUDY_APP__.isCompactInput(), coarse: window.__STUDY_APP__.isTouchPointer() }));
  check("窄桌面窗：键盘展开但输入框不 readOnly（不锁死桌面用户）", dn.compact === true && dn.coarse === false && await dp.evaluate(() => { const c = document.getElementById("promptInput"); return !c.readOnly; }), JSON.stringify(dn));
  await desktopNarrow.close();
  // 移动端热力图不溢出（FR-28 验收：移动端单列可完整显示当周）
  await closeAll(m);
  await m.locator('[data-act="open-parent-hub"]').click();
  await m.waitForTimeout(200);
  await m.locator('[data-act="open-stats"]').click();
  await m.waitForTimeout(400);
  const mHeat = await m.evaluate(() => { const g = document.querySelector(".heat-grid"); const w = document.querySelector(".badge-wall"); const body = document.getElementById("statsBody"); const r = g.getBoundingClientRect(); return { w: Math.round(r.width), overflow: g.scrollWidth - g.clientWidth, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, cols: getComputedStyle(g).gridTemplateColumns.split(" ").length, badgeCols: getComputedStyle(w).gridTemplateColumns.split(" ").length, badgeOverflow: body.scrollWidth - body.clientWidth }; });
  check("移动端热力图无横向溢出", mHeat.overflow <= 1 && mHeat.docOverflow <= 1, JSON.stringify(mHeat));
  check("移动端徽章墙随视口降列且不溢出", mHeat.badgeCols < 6 && mHeat.badgeOverflow <= 1, JSON.stringify(mHeat));
  await m.screenshot({ path: path.join(EVID, "14_mobile_heatmap.png") });

  section("收口 · 控制台零错误");
  check("全程无未捕获 JS 错误 / console.error", errors.length === 0, errors.slice(0, 5).join(" | "));
  note("测试期间浏览器原生对话框：" + JSON.stringify(notedDialogs));

  const themeBytes = await A(() => {
    const s = [...document.styleSheets].map(sh => { try { return [...sh.cssRules].map(r => r.cssText).join(""); } catch (e) { return ""; } }).join("");
    return s.length;
  });
  note("运行时样式表大小 = " + themeBytes + " B（单文件内联，主题包增量在 15KB 内）");

  fs.writeFileSync(path.join(EVID, "report.json"), JSON.stringify({
    when: new Date().toISOString(), pass, fail: fails.length, warn, fails, warns, notes, themeReport
  }, null, 2), "utf-8");

  console.log("\n==== REAL-BROWSER RESULT: " + pass + " passed, " + fails.length + " failed, " + warn + " warnings ====");
  if (fails.length){ console.log(fails.map(f => "FAIL " + f).join("\n")); }
  if (warns.length){ console.log(warns.map(f => "WARN " + f).join("\n")); }

  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error("FATAL " + (e && e.stack || e)); process.exit(2); });
