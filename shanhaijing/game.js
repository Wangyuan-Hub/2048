/**
 * 2048 抖音小游戏
 * 变现方式：仅激励视频广告复活
 * 运行环境：抖音小游戏（tt API + Canvas）
 */
'use strict';

/* ==================== 可配置项 ==================== */
var CONFIG = {
  // 在抖音开放平台创建“激励视频广告位”后，把 adUnitId 填到这里
  AD_UNIT_ID: 'WEB_DEMO_AD',
  MAX_REVIVES: 1,           // 每局最多复活次数
  REVIVE_CLEAR_TILES: 4,    // 复活时清除多少个最低分方块
  MOVE_MS: 110,             // 滑动动画时长
  DEBUG_SIMULATE_AD: false, // 本地调试可设为 true，模拟广告完成
  RANK_ZONE_ID: 'default',  // 排行榜分区：正式环境用 default，测试用 test
  RANK_TYPE: 'all',         // day / week / month / all
  RANK_TITLE: '2048 全服排行榜',
  RANK_SUFFIX: ' 分',
  USE_BEAST_IMAGES: true // 有角色图就显示角色，没有图则回退数字
};

/* ==================== 环境与画布 ==================== */
var sysInfo = tt.getSystemInfoSync();
var SCREEN_W = sysInfo.windowWidth || sysInfo.screenWidth || 375;
var SCREEN_H = sysInfo.windowHeight || sysInfo.screenHeight || 667;
var DPR = sysInfo.pixelRatio || 1;

var gameCanvas = tt.createCanvas();
gameCanvas.width = Math.round(SCREEN_W * DPR);
gameCanvas.height = Math.round(SCREEN_H * DPR);
var ctx = gameCanvas.getContext('2d');
ctx.scale(DPR, DPR);

/* ==================== 布局参数 ==================== */
var MARGIN = 18;
var BOARD_TOP = 128;
var BOARD_SIZE = 320;
var BOARD_X = 18;
var BOARD_Y = 128;
var BOARD_PAD = 9;
var TILE_GAP = 9;
var CELL = 70;

function computeLayout() {
  MARGIN = 18;
  BOARD_TOP = Math.max(128, Math.min(150, Math.round(SCREEN_H * 0.19)));
  BOARD_SIZE = Math.min(SCREEN_W - MARGIN * 2, SCREEN_H - BOARD_TOP - 86, 440);
  BOARD_X = Math.round((SCREEN_W - BOARD_SIZE) / 2);
  BOARD_Y = BOARD_TOP;
  BOARD_PAD = Math.round(BOARD_SIZE * 0.028);
  TILE_GAP = BOARD_PAD;
  CELL = (BOARD_SIZE - BOARD_PAD * 2 - TILE_GAP * 3) / 4;
}
computeLayout();

/* ==================== 游戏状态 ==================== */
var SIZE = 4;
var LEADERBOARD_KEY = 'douyin2048_leaderboard_v1';
var BEST_KEY = 'douyin2048_best_v1';

var grid = emptyGrid();
var score = 0;
var best = Number(storageGet(BEST_KEY, 0)) || 0;
var sequence = 0;
var phase = 'playing';      // playing | gameover | win
var overlay = 'none';       // none | gameover | win | leaderboard
var overlayBeforeLeaderboard = 'none';
var revivesLeft = CONFIG.MAX_REVIVES;
var winShown = false;
var animating = false;
var moveStart = 0;
var mergeAnims = [];
var moveToken = 0;
var submittedThisRun = false;
var buttons = [];
var touchStart = null;
var toast = { text: '', until: 0 };
var loggedIn = false;
var loginCallbacks = [];
var loginPending = false;
var lastSyncedScore = Number(storageGet('douyin2048_synced_v1_' + CONFIG.RANK_ZONE_ID, 0)) || 0;
var nativeRankOpening = false;

var TILE_COLORS = {
  2: '#eee4da',
  4: '#ede0c8',
  8: '#f2b179',
  16: '#f59563',
  32: '#f67c5f',
  64: '#f65e3b',
  128: '#edcf72',
  256: '#edcc61',
  512: '#edc850',
  1024: '#edc53f',
  2048: '#edc22e'
};

var BEAST_ASSETS = {
  2: 'assets/beasts/0002-shanjing.png',
  4: 'assets/beasts/0004-ershu.png',
  8: 'assets/beasts/0008-huan.png',
  16: 'assets/beasts/0016-jiuweihu.png',
  32: 'assets/beasts/0032-bifang.png',
  64: 'assets/beasts/0064-yingzhao.png',
  128: 'assets/beasts/0128-luwu.png',
  256: 'assets/beasts/0256-taotie.png',
  512: 'assets/beasts/0512-qiongqi.png',
  1024: 'assets/beasts/1024-yinglong.png',
  2048: 'assets/beasts/2048-zhulong.png'
};
var beastImages = {};
var beastImagesReady = 0;
var beastImagesTotal = 0;

function preloadBeastImages() {
  if (!CONFIG.USE_BEAST_IMAGES || !tt.createImage) return;
  for (var key in BEAST_ASSETS) {
    if (!Object.prototype.hasOwnProperty.call(BEAST_ASSETS, key)) continue;
    (function (value, path) {
      beastImagesTotal++;
      var image = tt.createImage();
      image.onload = function () {
        beastImages[value] = image;
        beastImagesReady++;
      };
      image.onerror = function () {};
      image.src = path;
    })(parseInt(key, 10), BEAST_ASSETS[key]);
  }
}

/* ==================== 基础工具 ==================== */
function emptyGrid() {
  var g = [];
  for (var r = 0; r < SIZE; r++) {
    g.push([null, null, null, null]);
  }
  return g;
}

function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t) {
  var c1 = 1.70158;
  var c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function storageGet(key, fallback) {
  var value;
  try {
    value = tt.getStorageSync(key);
  } catch (e) {
    try {
      var result = tt.getStorageSync({ key: key });
      value = result && result.data;
    } catch (e2) {
      return fallback;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, 'data') && typeof value.errMsg === 'string') {
    value = value.data;
  }
  if (value === '' || value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (e3) { return value; }
  }
  return value;
}

function storageSet(key, value) {
  try {
    tt.setStorageSync(key, value);
    return;
  } catch (e) {}
  try {
    tt.setStorageSync({ key: key, data: value });
  } catch (e2) {}
}

function showToast(text) {
  toast.text = text;
  toast.until = Date.now() + 2200;
}

function formatDate(timestamp) {
  var d = new Date(timestamp || Date.now());
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* ==================== 游戏逻辑 ==================== */
function newTile(r, c, value) {
  return {
    id: ++sequence,
    value: value,
    r: r,
    c: c,
    bornAt: Date.now(),
    pending: false,
    moveStart: 0,
    fromR: null,
    fromC: null
  };
}

function spawnTile() {
  var empty = [];
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (!grid[r][c]) empty.push({ r: r, c: c });
    }
  }
  if (!empty.length) return null;
  var p = empty[Math.floor(Math.random() * empty.length)];
  var tile = newTile(p.r, p.c, Math.random() < 0.9 ? 2 : 4);
  grid[p.r][p.c] = tile;
  return tile;
}

function buildLines(direction) {
  var lines = [];
  for (var i = 0; i < SIZE; i++) {
    var line = [];
    for (var j = 0; j < SIZE; j++) {
      if (direction === 0) {
        line.push({ r: j, c: i });
      } else if (direction === 2) {
        line.push({ r: SIZE - 1 - j, c: i });
      } else if (direction === 3) {
        line.push({ r: i, c: j });
      } else {
        line.push({ r: i, c: SIZE - 1 - j });
      }
    }
    lines.push(line);
  }
  return lines;
}

function tryMove(direction) {
  if (phase !== 'playing' || overlay !== 'none' || animating) return;

  var lines = buildLines(direction);
  var next = emptyGrid();
  var merges = [];
  var moved = false;
  var now = Date.now();

  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    var tiles = [];
    for (var k = 0; k < line.length; k++) {
      var g = grid[line[k].r][line[k].c];
      if (g) tiles.push(g);
    }

    var slot = 0;
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      var pos = line[slot];

      if (i + 1 < tiles.length && tiles[i + 1].value === tile.value) {
        var other = tiles[i + 1];
        var mergedTile = {
          id: ++sequence,
          value: tile.value * 2,
          r: pos.r,
          c: pos.c,
          bornAt: 0,
          pending: true,
          moveStart: 0,
          fromR: null,
          fromC: null
        };
        next[pos.r][pos.c] = mergedTile;
        merges.push({
          a: { value: tile.value, fromR: tile.r, fromC: tile.c },
          b: { value: other.value, fromR: other.r, fromC: other.c },
          toR: pos.r,
          toC: pos.c,
          nt: mergedTile
        });
        score += mergedTile.value;
        moved = true;
        i++;
      } else {
        next[pos.r][pos.c] = tile;
        if (tile.r !== pos.r || tile.c !== pos.c) {
          tile.fromR = tile.r;
          tile.fromC = tile.c;
          tile.moveStart = now;
          tile.r = pos.r;
          tile.c = pos.c;
          moved = true;
        }
      }
      slot++;
    }
  }

  if (!moved) return;

  grid = next;
  if (score > best) {
    best = score;
    storageSet(BEST_KEY, best);
  }

  animating = true;
  moveStart = now;
  mergeAnims = merges;

  var token = ++moveToken;
  setTimeout(function () {
    if (token !== moveToken) return;
    finishMove();
  }, CONFIG.MOVE_MS);
}

function finishMove() {
  animating = false;

  for (var i = 0; i < mergeAnims.length; i++) {
    mergeAnims[i].nt.pending = false;
    mergeAnims[i].nt.bornAt = Date.now();
  }
  mergeAnims = [];

  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var tile = grid[r][c];
      if (tile) {
        tile.moveStart = 0;
        tile.fromR = null;
        tile.fromC = null;
      }
    }
  }

  spawnTile();

  if (hasTileValue(2048) && !winShown) {
    winShown = true;
    phase = 'win';
    overlay = 'win';
    syncBestToCloud();
    return;
  }

  if (!hasMoves()) {
    phase = 'gameover';
    overlay = 'gameover';
    syncBestToCloud();
    if (revivesLeft <= 0) submitScoreIfNeeded();
  }
}

function hasTileValue(value) {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (grid[r][c] && grid[r][c].value === value) return true;
    }
  }
  return false;
}

function hasMoves() {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var tile = grid[r][c];
      if (!tile) return true;
      if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].value === tile.value) return true;
      if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].value === tile.value) return true;
    }
  }
  return false;
}

function doRevive() {
  if (phase !== 'gameover' || revivesLeft <= 0) return;

  var cells = [];
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (grid[r][c]) cells.push({ r: r, c: c, value: grid[r][c].value });
    }
  }
  cells.sort(function (a, b) { return a.value - b.value; });

  var clearCount = Math.min(CONFIG.REVIVE_CLEAR_TILES, cells.length);
  for (var i = 0; i < clearCount; i++) {
    grid[cells[i].r][cells[i].c] = null;
  }

  revivesLeft--;
  phase = 'playing';
  overlay = 'none';
  showToast('复活成功！继续挑战');
}

function resetGame() {
  moveToken++;
  grid = emptyGrid();
  score = 0;
  revivesLeft = CONFIG.MAX_REVIVES;
  phase = 'playing';
  overlay = 'none';
  overlayBeforeLeaderboard = 'none';
  winShown = false;
  animating = false;
  mergeAnims = [];
  submittedThisRun = false;
  sequence = 0;
  spawnTile();
  spawnTile();
}

/* ==================== 排行榜（本机） ==================== */
function getLeaderboard() {
  var data = storageGet(LEADERBOARD_KEY, []);
  if (!Array.isArray(data)) return [];
  var list = [];
  for (var i = 0; i < data.length; i++) {
    if (data[i] && typeof data[i].score === 'number' && isFinite(data[i].score)) {
      list.push({
        score: Math.floor(data[i].score),
        time: data[i].time || Date.now()
      });
    }
  }
  list.sort(function (a, b) { return b.score - a.score; });
  return list.slice(0, 10);
}

function submitScoreIfNeeded() {
  if (submittedThisRun || score <= 0) return;
  submittedThisRun = true;
  var list = getLeaderboard();
  list.push({ score: Math.floor(score), time: Date.now() });
  list.sort(function (a, b) { return b.score - a.score; });
  storageSet(LEADERBOARD_KEY, list.slice(0, 10));
}

/* ==================== 激励视频广告 ==================== */
var rewardAd = null;
var adShowing = false;
var pendingRevive = false;

function initRewardedAd() {
  if (!CONFIG.AD_UNIT_ID || CONFIG.AD_UNIT_ID === 'YOUR_REWARDED_AD_UNIT_ID') return;
  if (!tt.createRewardedVideoAd) return;

  try {
    rewardAd = tt.createRewardedVideoAd({ adUnitId: CONFIG.AD_UNIT_ID });

    rewardAd.onClose(function (res) {
      adShowing = false;
      if (!pendingRevive) return;
      pendingRevive = false;
      var completed = !res || res.isEnded !== false;
      if (completed) {
        doRevive();
      } else {
        showToast('需要完整观看广告才能复活');
      }
    });

    rewardAd.onError(function () {
      adShowing = false;
      pendingRevive = false;
      showToast('广告加载失败，请稍后再试');
    });

    if (rewardAd.load) {
      var loading = rewardAd.load();
      if (loading && loading.catch) loading.catch(function () {});
    }
  } catch (e) {
    rewardAd = null;
  }
}

function showReviveAd() {
  if (phase !== 'gameover' || revivesLeft <= 0 || adShowing) return;

  if (CONFIG.DEBUG_SIMULATE_AD) {
    doRevive();
    return;
  }

  if (!rewardAd) {
    showToast('广告位未配置，请先在 game.js 填写 AD_UNIT_ID');
    return;
  }

  adShowing = true;
  pendingRevive = true;

  try {
    rewardAd.show().catch(function () {
      return rewardAd.load().then(function () {
        return rewardAd.show();
      });
    }).catch(function () {
      adShowing = false;
      pendingRevive = false;
      showToast('广告暂时不可用，请稍后再试');
    });
  } catch (e) {
    adShowing = false;
    pendingRevive = false;
    showToast('广告暂时不可用，请稍后再试');
  }
}

/* ==================== 全服排行榜（官方 IM Rank） ==================== */
function flushLoginCallbacks(ok) {
  var callbacks = loginCallbacks.slice();
  loginCallbacks = [];
  for (var i = 0; i < callbacks.length; i++) {
    try { callbacks[i](ok); } catch (e) {}
  }
}

function ensureLogin(callback) {
  if (loggedIn) {
    callback(true);
    return;
  }
  if (!tt.login) {
    callback(false);
    return;
  }
  loginCallbacks.push(callback);
  if (loginPending) return;
  loginPending = true;
  try {
    tt.login({
      success: function () {
        loggedIn = true;
        loginPending = false;
        flushLoginCallbacks(true);
      },
      fail: function () {
        loginPending = false;
        flushLoginCallbacks(false);
      }
    });
  } catch (e) {
    loginPending = false;
    flushLoginCallbacks(false);
  }
}

function syncRankScore(value) {
  value = Math.floor(value || 0);
  if (value <= 0 || value <= lastSyncedScore || !tt.setImRankData) return;
  value = Math.min(value, 2147483646);

  ensureLogin(function (ok) {
    if (!ok || value <= lastSyncedScore) return;
    try {
      tt.setImRankData({
        dataType: 0,          // 数字类型（分数）
        value: String(value),
        priority: 0,
        extra: '',
        zoneId: CONFIG.RANK_ZONE_ID,
        success: function () {
          if (value > lastSyncedScore) {
            lastSyncedScore = value;
            storageSet('douyin2048_synced_v1_' + CONFIG.RANK_ZONE_ID, value);
          }
        },
        fail: function () {}
      });
    } catch (e) {}
  });
}

function syncBestToCloud() {
  syncRankScore(best);
}

function openLocalLeaderboard() {
  overlayBeforeLeaderboard = overlay === 'leaderboard' ? 'none' : overlay;
  overlay = 'leaderboard';
}

function openGlobalLeaderboard() {
  if (!tt.getImRankList) {
    openLocalLeaderboard();
    showToast('当前版本不支持全服榜，已显示本机记录');
    return;
  }
  if (nativeRankOpening) return;
  nativeRankOpening = true;

  ensureLogin(function (ok) {
    if (!ok) {
      nativeRankOpening = false;
      openLocalLeaderboard();
      showToast('登录后才能查看全服排行榜');
      return;
    }
    try {
      tt.getImRankList({
        relationType: 'all',   // 全服总榜
        dataType: 0,           // 按数字分数排序
        rankType: CONFIG.RANK_TYPE,
        suffix: CONFIG.RANK_SUFFIX,
        rankTitle: CONFIG.RANK_TITLE,
        zoneId: CONFIG.RANK_ZONE_ID,
        success: function () {
          nativeRankOpening = false;
        },
        fail: function (res) {
          nativeRankOpening = false;
          var errMsg = res && res.errMsg ? res.errMsg : '';
          if (errMsg.indexOf('rank list is showing') >= 0) return;
          openLocalLeaderboard();
          showToast('全服榜加载失败，已显示本机记录');
        }
      });
    } catch (e) {
      nativeRankOpening = false;
      openLocalLeaderboard();
      showToast('全服榜暂不可用，已显示本机记录');
    }
  });
}

/* ==================== 按钮与交互 ==================== */

function closeLeaderboard() {
  overlay = overlayBeforeLeaderboard || 'none';
}

function handleButton(id) {
  if (id === 'new') {
    submitScoreIfNeeded();
    syncBestToCloud();
    resetGame();
    return;
  }
  if (id === 'leaderboard') {
    syncBestToCloud();
    openGlobalLeaderboard();
    return;
  }
  if (id === 'revive') {
    showReviveAd();
    return;
  }
  if (id === 'restart-over') {
    submitScoreIfNeeded();
    syncBestToCloud();
    resetGame();
    return;
  }
  if (id === 'leaderboard-over') {
    syncBestToCloud();
    openGlobalLeaderboard();
    return;
  }
  if (id === 'continue-win') {
    overlay = 'none';
    phase = 'playing';
    if (!hasMoves()) {
      phase = 'gameover';
      overlay = 'gameover';
      if (revivesLeft <= 0) submitScoreIfNeeded();
    }
    return;
  }
  if (id === 'restart-win') {
    submitScoreIfNeeded();
    syncBestToCloud();
    resetGame();
    return;
  }
  if (id === 'leaderboard-win') {
    syncBestToCloud();
    openGlobalLeaderboard();
    return;
  }
  if (id === 'close-leaderboard') {
    closeLeaderboard();
    return;
  }
  if (id === 'share') {
    shareScore();
  }
}

function hitButton(x, y) {
  for (var i = buttons.length - 1; i >= 0; i--) {
    var b = buttons[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

function getTouchPoint(event) {
  var t = null;
  if (event.touches && event.touches.length) t = event.touches[0];
  else if (event.changedTouches && event.changedTouches.length) t = event.changedTouches[0];
  else t = event;

  var x = t.clientX !== undefined ? t.clientX : (t.pageX !== undefined ? t.pageX : 0);
  var y = t.clientY !== undefined ? t.clientY : (t.pageY !== undefined ? t.pageY : 0);
  return { x: x, y: y };
}

function onTouchStart(event) {
  var p = getTouchPoint(event);
  touchStart = { x: p.x, y: p.y, time: Date.now() };
}

function onTouchEnd(event) {
  if (!touchStart) return;
  var p = getTouchPoint(event);
  var start = touchStart;
  touchStart = null;

  var dx = p.x - start.x;
  var dy = p.y - start.y;
  var adx = Math.abs(dx);
  var ady = Math.abs(dy);
  var distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 14) {
    var button = hitButton(p.x, p.y);
    if (button) handleButton(button.id);
    return;
  }

  if (overlay !== 'none' || phase !== 'playing' || animating) return;
  if (Math.max(adx, ady) < 24) return;

  if (adx > ady) {
    tryMove(dx > 0 ? 1 : 3);
  } else {
    tryMove(dy > 0 ? 2 : 0);
  }
}

if (typeof tt.onTouchStart === 'function') {
  tt.onTouchStart(onTouchStart);
  tt.onTouchEnd(onTouchEnd);
} else if (gameCanvas.addEventListener) {
  gameCanvas.addEventListener('touchstart', onTouchStart);
  gameCanvas.addEventListener('touchend', onTouchEnd);
}

/* ==================== 分享 ==================== */
function shareScore() {
  if (!tt.shareAppMessage) {
    showToast('当前环境不支持分享');
    return;
  }
  try {
    tt.shareAppMessage({
      title: '我在 2048 拿到了 ' + score + ' 分，来挑战我！',
      query: 'score=' + score
    });
  } catch (e) {
    showToast('分享失败，请稍后再试');
  }
}

/* ==================== 绘制工具 ==================== */
function drawRoundRect(x, y, w, h, r, fill, stroke, lineWidth) {
  var radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

function drawButton(id, label, x, y, w, h, bg, fg, fontSize) {
  drawRoundRect(x, y, w, h, Math.min(9, h / 2), bg);
  ctx.fillStyle = fg;
  ctx.font = 'bold ' + (fontSize || 15) + 'px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  buttons.push({ id: id, x: x, y: y, w: w, h: h });
}

function drawScoreCard(x, y, w, h, label, value) {
  drawRoundRect(x, y, w, h, 8, '#bbada0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#eee4da';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText(label, x + w / 2, y + 7);

  var text = String(value);
  var fs = text.length > 5 ? 14 : (text.length > 3 ? 17 : 21);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold ' + fs + 'px Arial, sans-serif';
  ctx.fillText(text, x + w / 2, y + 22);
}

function drawTile(value, rowFloat, colFloat, scale) {
  var x = BOARD_X + BOARD_PAD + colFloat * (CELL + TILE_GAP);
  var y = BOARD_Y + BOARD_PAD + rowFloat * (CELL + TILE_GAP);
  var s = scale || 1;
  var size = CELL * s;
  var offset = (CELL - size) / 2;
  var fill = TILE_COLORS[value] || (value > 2048 ? '#3c3a32' : '#eee4da');

  drawRoundRect(x + offset, y + offset, size, size, Math.max(4, size * 0.08), fill);

  var beastImage = CONFIG.USE_BEAST_IMAGES ? beastImages[value] : null;
  if (beastImage) {
    ctx.save();
    if (value >= 1024) {
      ctx.shadowColor = value >= 2048 ? 'rgba(255,215,120,0.9)' : 'rgba(120,200,255,0.75)';
      ctx.shadowBlur = Math.max(8, size * 0.12);
    }
    ctx.drawImage(beastImage, x + offset, y + offset, size, size);
    ctx.restore();
    return;
  }

  var text = String(value);
  var textSize = text.length >= 4 ? size * 0.26 : (text.length === 3 ? size * 0.33 : size * 0.42);
  textSize = Math.max(11, textSize);
  ctx.fillStyle = value <= 4 ? '#776e65' : '#f9f6f2';
  ctx.font = 'bold ' + Math.round(textSize) + 'px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + CELL / 2, y + CELL / 2 + 1);
}

function getAnimatedPosition(tile, now) {
  if (tile.moveStart) {
    var p = clamp((now - tile.moveStart) / CONFIG.MOVE_MS, 0, 1);
    if (p >= 1) {
      tile.moveStart = 0;
      return { r: tile.r, c: tile.c };
    }
    var e = easeOutCubic(p);
    return {
      r: tile.fromR + (tile.r - tile.fromR) * e,
      c: tile.fromC + (tile.c - tile.fromC) * e
    };
  }
  return { r: tile.r, c: tile.c };
}

function getTileScale(tile, now) {
  if (!tile.bornAt) return 1;
  var age = now - tile.bornAt;
  if (age < 0) return 0.6;
  if (age < 160) {
    var p = clamp(age / 160, 0, 1);
    return 0.6 + 0.4 * easeOutBack(p);
  }
  return 1;
}

/* ==================== 页面绘制 ==================== */
function drawHeader() {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = '900 44px Arial, sans-serif';
  ctx.fillText('2048', MARGIN, 12);

  ctx.fillStyle = '#a69a8d';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('合并数字，挑战最高分', MARGIN + 1, 61);

  var cardW = 78;
  var cardH = 50;
  var gap = 8;
  var sx = SCREEN_W - MARGIN - cardW * 2 - gap;
  drawScoreCard(sx, 12, cardW, cardH, '得分', score);
  drawScoreCard(sx + cardW + gap, 12, cardW, cardH, '最高分', best);

  if (overlay === 'none') {
    drawButton('new', '新游戏', MARGIN, 80, 88, 36, '#8f7a66', '#f9f6f2', 15);
    drawButton('leaderboard', '全服榜', MARGIN + 96, 80, 96, 36, '#edc22e', '#776e65', 15);
  }
}

function drawBoard(now) {
  drawRoundRect(BOARD_X, BOARD_Y, BOARD_SIZE, BOARD_SIZE, 10, '#bbada0');

  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var x = BOARD_X + BOARD_PAD + c * (CELL + TILE_GAP);
      var y = BOARD_Y + BOARD_PAD + r * (CELL + TILE_GAP);
      drawRoundRect(x, y, CELL, CELL, Math.max(4, CELL * 0.08), '#cdc1b4');
    }
  }

  for (var rr = 0; rr < SIZE; rr++) {
    for (var cc = 0; cc < SIZE; cc++) {
      var tile = grid[rr][cc];
      if (tile && !tile.pending) {
        var pos = getAnimatedPosition(tile, now);
        drawTile(tile.value, pos.r, pos.c, getTileScale(tile, now));
      }
    }
  }

  if (mergeAnims.length) {
    var p = clamp((now - moveStart) / CONFIG.MOVE_MS, 0, 1);
    var e = easeOutCubic(p);
    for (var i = 0; i < mergeAnims.length; i++) {
      var m = mergeAnims[i];
      drawTile(m.a.value, m.a.fromR + (m.toR - m.a.fromR) * e, m.a.fromC + (m.toC - m.a.fromC) * e, 1);
      drawTile(m.b.value, m.b.fromR + (m.toR - m.b.fromR) * e, m.b.fromC + (m.toC - m.b.fromC) * e, 1);
    }
  }
}

function drawFooter() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a69a8d';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('滑动方块 · 相同数字合并', SCREEN_W / 2, BOARD_Y + BOARD_SIZE + 24);
}

function drawBackdrop() {
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}

function drawGameOver() {
  drawBackdrop();

  var withRevive = revivesLeft > 0;
  var panelW = Math.min(SCREEN_W - 44, 340);
  var panelH = withRevive ? 348 : 296;
  var px = (SCREEN_W - panelW) / 2;
  var py = Math.max(18, (SCREEN_H - panelH) / 2);

  drawRoundRect(px, py, panelW, panelH, 18, '#faf8ef');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText('游戏结束', SCREEN_W / 2, py + 22);

  ctx.fillStyle = '#8f8377';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillText('本局得分', SCREEN_W / 2, py + 68);

  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 42px Arial, sans-serif';
  ctx.fillText(String(score), SCREEN_W / 2, py + 86);

  var by = py + 150;
  if (withRevive) {
    drawButton('revive', '看广告复活', px + 24, by, panelW - 48, 48, '#edc22e', '#776e65', 18);
    ctx.fillStyle = '#a69a8d';
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText('完整观看广告即可复活，并清除 ' + CONFIG.REVIVE_CLEAR_TILES + ' 个方块', SCREEN_W / 2, by + 52);
    by += 72;
  }

  drawButton('restart-over', '再来一局', px + 24, by, panelW - 48, 44, '#8f7a66', '#f9f6f2', 16);
  by += 54;
  drawButton('leaderboard-over', '全服榜', px + 24, by, panelW - 48, 40, '#d6cdc4', '#776e65', 14);
}

function drawWin() {
  drawBackdrop();

  var panelW = Math.min(SCREEN_W - 44, 340);
  var panelH = 330;
  var px = (SCREEN_W - panelW) / 2;
  var py = Math.max(18, (SCREEN_H - panelH) / 2);

  drawRoundRect(px, py, panelW, panelH, 18, '#faf8ef');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText('2048 达成！', SCREEN_W / 2, py + 22);

  ctx.fillStyle = '#8f8377';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillText('你成功合成了 2048', SCREEN_W / 2, py + 62);

  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 42px Arial, sans-serif';
  ctx.fillText(String(score), SCREEN_W / 2, py + 94);

  drawButton('continue-win', '继续游戏', px + 24, py + 168, panelW - 48, 48, '#edc22e', '#776e65', 18);
  drawButton('restart-win', '再来一局', px + 24, py + 224, panelW - 48, 42, '#8f7a66', '#f9f6f2', 15);
  drawButton('leaderboard-win', '全服榜', px + 24, py + 274, panelW - 48, 34, '#d6cdc4', '#776e65', 13);
}

function drawLeaderboard() {
  drawBackdrop();

  var panelW = Math.min(SCREEN_W - 40, 360);
  var panelH = Math.min(SCREEN_H - 80, 560);
  var px = (SCREEN_W - panelW) / 2;
  var py = (SCREEN_H - panelH) / 2;

  drawRoundRect(px, py, panelW, panelH, 18, '#faf8ef');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText('本机排行榜', SCREEN_W / 2, py + 20);

  ctx.fillStyle = '#a69a8d';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('全服榜不可用时的备用记录', SCREEN_W / 2, py + 56);

  var list = getLeaderboard();
  var rowTop = py + 82;

  if (!list.length) {
    ctx.fillStyle = '#a69a8d';
    ctx.font = '15px Arial, sans-serif';
    ctx.fillText('还没有记录，先玩一局吧！', SCREEN_W / 2, py + 170);
  } else {
    for (var i = 0; i < list.length; i++) {
      var rowY = rowTop + i * 30;
      if (i % 2 === 0) {
        drawRoundRect(px + 20, rowY - 10, panelW - 40, 27, 6, '#f3eee7');
      }

      var rankColor = i === 0 ? '#d4a017' : (i === 1 ? '#8c8c8c' : (i === 2 ? '#b87333' : '#a69a8d'));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = rankColor;
      ctx.font = 'bold 14px Arial, sans-serif';
      ctx.fillText(String(i + 1), px + 30, rowY + 4);

      ctx.fillStyle = '#8f8377';
      ctx.font = '12px Arial, sans-serif';
      ctx.fillText(formatDate(list[i].time), px + 52, rowY + 4);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#776e65';
      ctx.font = 'bold 15px Arial, sans-serif';
      ctx.fillText(list[i].score + ' 分', px + panelW - 30, rowY + 4);
    }
  }

  var by = py + panelH - 54;
  var btnW = (panelW - 56) / 2;
  drawButton('share', '分享成绩', px + 24, by, btnW, 38, '#8f7a66', '#f9f6f2', 14);
  drawButton('close-leaderboard', '返回', px + 32 + btnW, by, btnW, 38, '#d6cdc4', '#776e65', 14);
}

function drawToast(now) {
  if (!toast.text || now > toast.until) return;

  ctx.font = '13px Arial, sans-serif';
  var textWidth = ctx.measureText(toast.text).width;
  var boxW = Math.min(SCREEN_W - 36, textWidth + 34);
  var boxH = 34;
  var bx = (SCREEN_W - boxW) / 2;
  var by = SCREEN_H - 74;

  drawRoundRect(bx, by, boxW, boxH, 17, 'rgba(60,58,50,0.92)');
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(toast.text, SCREEN_W / 2, by + boxH / 2 + 1);
}

function render(now) {
  now = now || Date.now();
  buttons = [];

  ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = '#faf8ef';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  drawHeader();
  drawBoard(now);
  drawFooter();

  if (overlay === 'gameover') {
    drawGameOver();
  } else if (overlay === 'win') {
    drawWin();
  } else if (overlay === 'leaderboard') {
    drawLeaderboard();
  }

  drawToast(now);
  requestAnimationFrame(render);
}

/* ==================== 启动 ==================== */
function boot() {
  computeLayout();
  preloadBeastImages();
  initRewardedAd();
  ensureLogin(function () {});
  syncBestToCloud();

  if (tt.showShareMenu) {
    try { tt.showShareMenu({ withShareTicket: true }); } catch (e) {}
  }

  try {
    var launch = tt.getLaunchOptionsSync ? tt.getLaunchOptionsSync() : null;
    if (launch && launch.query && launch.query.score) {
      showToast('好友成绩：' + launch.query.score + ' 分');
    }
  } catch (e2) {}

  resetGame();
  requestAnimationFrame(render);
}

boot();