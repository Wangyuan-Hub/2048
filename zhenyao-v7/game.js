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
  RANK_TITLE: '山海经镇妖录 全服榜',
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
  BOARD_TOP = Math.max(198, Math.min(220, Math.round(SCREEN_H * 0.25)));
  BOARD_SIZE = Math.min(SCREEN_W - MARGIN * 2, SCREEN_H - BOARD_TOP - 178, 440);
  BOARD_X = Math.round((SCREEN_W - BOARD_SIZE) / 2);
  BOARD_Y = BOARD_TOP;
  BOARD_PAD = Math.round(BOARD_SIZE * 0.028);
  TILE_GAP = BOARD_PAD;
  CELL = (BOARD_SIZE - BOARD_PAD * 2 - TILE_GAP * 3) / 4;
}
computeLayout();

/* ==================== 游戏状态 ==================== */
var SIZE = 4;
var LEADERBOARD_KEY = 'zhenyao2048_leaderboard_v1';
var BEST_KEY = 'zhenyao2048_best_v1';

var grid = emptyGrid();
var score = 0;
var best = Number(storageGet(BEST_KEY, 0)) || 0;
var sequence = 0;
var phase = 'playing';      // playing | gameover | reward | victory
var overlay = 'none';       // none | gameover | reward | victory | leaderboard
var overlayBeforeLeaderboard = 'none';
var revivesLeft = CONFIG.MAX_REVIVES;
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
var lastSyncedScore = Number(storageGet('zhenyao2048_synced_v1_' + CONFIG.RANK_ZONE_ID, 0)) || 0;
var nativeRankOpening = false;

var BOSSES = [
  { name: '饕餮', title: '青铜贪兽', value: 256, maxHP: 60, attack: 12, attackEvery: 5, mechanic: '妖袭吞噬最低阶妖块', weakSkill: 'bifang', weakName: '毕方焚林' },
  { name: '穷奇', title: '雷翼凶虎', value: 512, maxHP: 100, attack: 18, attackEvery: 5, mechanic: '妖袭降下双雷与妖气', weakSkill: 'jiuwei', weakName: '九尾魅惑' },
  { name: '烛龙', title: '昼夜之龙', value: 2048, maxHP: 160, attack: 26, attackEvery: 4, mechanic: '昼夜交替，夜间合并伤害降低', weakSkill: 'yinglong', weakName: '应龙甘霖' }
];

var SKILLS = [
  { id: 'jiuwei', name: '九尾魅惑', desc: '清除4个低阶妖块', cost: 3, color: '#EDCF72' },
  { id: 'bifang', name: '毕方焚林', desc: '清除妖气并造成40伤害', cost: 5, color: '#F67C5F' },
  { id: 'yinglong', name: '应龙甘霖', desc: '恢复35灵台', cost: 4, color: '#4FA3A5' }
];

var RELICS = [
  { id: 'zhulong_breath', name: '烛龙之息', desc: '技能造成的伤害 +50%' },
  { id: 'jiuwei_charm', name: '九尾灵魅', desc: '技能消耗 -1' },
  { id: 'luwu_mountain', name: '陆吾镇山', desc: '灵台上限 +30，并恢复 30' },
  { id: 'yinglong_rain', name: '应龙甘霖', desc: '每 4 步恢复 4 点灵台' },
  { id: 'taotie_gluttony', name: '饕餮贪食', desc: '每次合并额外 +1 灵力' },
  { id: 'qiongqi_thunder', name: '穷奇雷罚', desc: '每 8 次合并造成 25 伤害' },
  { id: 'baize_insight', name: '白泽洞察', desc: '每场战斗开始额外 +3 灵力' },
  { id: 'bifang_ember', name: '毕方余烬', desc: '合并伤害 +1' }
];

var stageIndex = 0;
var bossHP = 0;
var bossMaxHP = 0;
var playerHP = 100;
var playerMaxHP = 100;
var energy = 2;
var movesSinceAttack = 0;
var turnCount = 0;
var mergeCount = 0;
var relics = [];
var rewardChoices = [];
var defeatReason = '';
var floatingTexts = [];
var bossEnraged = false;
var attackEveryCurrent = 5;
var attackDamageCurrent = 12;
var isNight = false;
var maxCombo = 0;
var bossStun = 0;
var screenShakeUntil = 0;
var screenShakePower = 0;
var flashUntil = 0;
var flashColor = 'rgba(0,0,0,0)';
var bossBannerText = '';
var bossBannerColor = '#ffffff';
var bossBannerUntil = 0;
var particles = [];
var rings = [];
var comboGlowUntil = 0;
var bossHitUntil = 0;
var soundEnabled = storageGet('zhenyao2048_sound', true) !== false;
var soundPools = {};
var soundPoolIndex = {};
var audioDisabled = false;
var audioPlayed = {};

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
  var gainedScore = 0;
  var totalDamage = 0;

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

      if (i + 1 < tiles.length && !tile.cursed && !tiles[i + 1].cursed && tiles[i + 1].value === tile.value) {
        var other = tiles[i + 1];
        var mergedTile = { id: ++sequence, value: tile.value * 2, r: pos.r, c: pos.c, bornAt: 0, pending: true, moveStart: 0, fromR: null, fromC: null };
        next[pos.r][pos.c] = mergedTile;
        merges.push({ a: { value: tile.value, fromR: tile.r, fromC: tile.c }, b: { value: other.value, fromR: other.r, fromC: other.c }, toR: pos.r, toC: pos.c, nt: mergedTile });

        var dmg = getMergeDamage(mergedTile.value);
        totalDamage += dmg;
        bossHP = Math.max(0, bossHP - dmg);
        bossHitUntil = Date.now() + 140;
        spawnTileParticles(pos.r, pos.c, TILE_COLORS[mergedTile.value] || '#FFD36E');
        gainedScore += mergedTile.value + dmg * 20;
        energy += 1 + (hasRelic('taotie_gluttony') ? 1 : 0);
        mergeCount++;
        addFloatingText('-' + dmg, pos.r, pos.c, '#FFD36E');

        if (hasRelic('qiongqi_thunder') && mergeCount % 8 === 0) {
          totalDamage += 25;
          bossHP = Math.max(0, bossHP - 25);
          bossHitUntil = Date.now() + 140;
          gainedScore += 250;
          addFloatingText('雷罚 -25', pos.r, pos.c, '#FF8A65');
        }
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

  var combo = merges.length;
  if (combo > maxCombo) maxCombo = combo;
  if (combo >= 2) {
    var mult = 1 + (combo - 1) * 0.25;
    var bonus = Math.round(totalDamage * (mult - 1));
    bossHP = Math.max(0, bossHP - bonus);
    gainedScore += bonus * 20 + combo * 10;
    energy += combo - 1;
    addFloatingText(combo + '连击!', 1.5, 1.5, '#FFD36E', 20);
    triggerShake(6, 220);
    if (combo >= 3) {
      bossStun = 1;
      showBossBanner(combo + ' 连击 · 打断!', '#FFD36E', 1000);
    } else {
      showBossBanner(combo + ' 连击!', '#FFD36E', 750);
    }
    playSound('combo');
    spawnParticles(SCREEN_W / 2, BOARD_Y + BOARD_SIZE / 2, '#FFD36E', 18, 150);
    spawnRing(SCREEN_W / 2, BOARD_Y + BOARD_SIZE / 2, '#FFD36E', BOARD_SIZE * 0.55);
    comboGlowUntil = Date.now() + 650;
    vibrate('medium');
  }

  if (!moved) return;

  if (merges.length === 1) playSound('merge');

  grid = next;
  if (gainedScore) score += gainedScore;
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

  setTimeout(function () {
    if (token !== moveToken || !animating) return;
    animating = false;
    for (var wi = 0; wi < mergeAnims.length; wi++) {
      mergeAnims[wi].nt.pending = false;
      mergeAnims[wi].nt.bornAt = Date.now();
    }
    mergeAnims = [];
    showToast('合并动画超时，已自动恢复');
  }, CONFIG.MOVE_MS + 800);
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
  turnCount++;

  if (hasRelic('yinglong_rain') && turnCount % 4 === 0) {
    playerHP = Math.min(playerMaxHP, playerHP + 4);
  }

  if (bossHP <= 0) {
    onBossDefeated();
    return;
  }

  checkBossEnrage();

  movesSinceAttack++;
  if (movesSinceAttack >= attackEveryCurrent) {
    bossAttack();
    if (phase !== 'playing') return;
  }

  if (!hasMoves()) {
    defeatBattle('无路可走');
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
      if (tile.cursed) continue;
      if (c + 1 < SIZE && grid[r][c + 1] && !grid[r][c + 1].cursed && grid[r][c + 1].value === tile.value) return true;
      if (r + 1 < SIZE && grid[r + 1][c] && !grid[r + 1][c].cursed && grid[r + 1][c].value === tile.value) return true;
    }
  }
  return false;
}

function doRevive() {
  if (phase !== 'gameover' || revivesLeft <= 0) return;

  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (grid[r][c] && grid[r][c].cursed) grid[r][c] = null;
    }
  }

  var cells = [];
  for (var rr = 0; rr < SIZE; rr++) {
    for (var cc = 0; cc < SIZE; cc++) {
      if (grid[rr][cc] && !grid[rr][cc].cursed) cells.push({ r: rr, c: cc, value: grid[rr][cc].value });
    }
  }
  cells.sort(function (a, b) { return a.value - b.value; });
  var clearCount = Math.min(CONFIG.REVIVE_CLEAR_TILES, cells.length);
  for (var i = 0; i < clearCount; i++) {
    grid[cells[i].r][cells[i].c] = null;
  }

  revivesLeft--;
  playerHP = Math.min(playerMaxHP, 50);
  defeatReason = '';
  phase = 'playing';
  overlay = 'none';
  playSound('skill');
  showToast('复活成功！灵台恢复，妖气清除');
}

function resetGame() {
  moveToken++;
  score = 0;
  revivesLeft = CONFIG.MAX_REVIVES;
  submittedThisRun = false;
  playerMaxHP = 100;
  playerHP = 100;
  relics = [];
  stageIndex = 0;
  maxCombo = 0;
  startBattle(0);
}

function startBattle(index) {
  moveToken++;
  stageIndex = index;
  var boss = BOSSES[index];
  bossMaxHP = boss.maxHP;
  bossHP = boss.maxHP;
  bossEnraged = false;
  attackEveryCurrent = boss.attackEvery;
  attackDamageCurrent = boss.attack;
  isNight = false;
  bossStun = 0;
  screenShakeUntil = 0;
  flashUntil = 0;
  bossBannerUntil = 0;
  movesSinceAttack = 0;
  turnCount = 0;
  mergeCount = 0;
  energy = 2 + (hasRelic('baize_insight') ? 3 : 0);
  grid = emptyGrid();
  overlayBeforeLeaderboard = 'none';
  overlay = 'none';
  phase = 'playing';
  animating = false;
  mergeAnims = [];
  rewardChoices = [];
  defeatReason = '';
  floatingTexts = [];
  particles = [];
  rings = [];
  comboGlowUntil = 0;
  bossHitUntil = 0;
  if (index > 0) playerHP = Math.min(playerMaxHP, playerHP + 15);
  spawnTile();
  spawnTile();
}

function startBattle(index) {
  moveToken++;
  stageIndex = index;
  var boss = BOSSES[index];
  bossMaxHP = boss.maxHP;
  bossHP = boss.maxHP;
  movesSinceAttack = 0;
  turnCount = 0;
  mergeCount = 0;
  energy = 2 + (hasRelic('baize_insight') ? 3 : 0);
  grid = emptyGrid();
  overlayBeforeLeaderboard = 'none';
  overlay = 'none';
  phase = 'playing';
  animating = false;
  mergeAnims = [];
  rewardChoices = [];
  defeatReason = '';
  floatingTexts = [];
  if (index > 0) playerHP = Math.min(playerMaxHP, playerHP + 15);
  spawnTile();
  spawnTile();
}

/* ==================== 镇妖战斗系统 ==================== */
function hasRelic(id) {
  for (var i = 0; i < relics.length; i++) {
    if (relics[i] === id) return true;
  }
  return false;
}

function getMergeDamage(value) {
  var dmg = Math.max(1, Math.round(Math.log(value) / Math.LN2) - 1);
  if (hasRelic('bifang_ember')) dmg += 1;
  if (stageIndex === 2 && isNight) dmg = Math.max(1, dmg - 1);
  return dmg;
}

function addFloatingText(text, row, col, color, size) {
  var x = BOARD_X + BOARD_PAD + col * (CELL + TILE_GAP) + CELL / 2;
  var y = BOARD_Y + BOARD_PAD + row * (CELL + TILE_GAP) + CELL / 2;
  floatingTexts.push({ text: text, x: x, y: y, bornAt: Date.now(), color: color || '#776e65', size: size || 13 });
  if (floatingTexts.length > 24) floatingTexts.shift();
}

function triggerShake(power, ms) {
  screenShakePower = power;
  screenShakeUntil = Date.now() + ms;
}

function triggerFlash(color, ms) {
  flashColor = color;
  flashUntil = Date.now() + ms;
}

function showBossBanner(text, color, ms) {
  bossBannerText = text;
  bossBannerColor = color || '#ffffff';
  bossBannerUntil = Date.now() + ms;
}

function addCurseTile() {
  var empty = [];
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (!grid[r][c]) empty.push({ r: r, c: c });
    }
  }
  if (!empty.length) return false;
  var p = empty[Math.floor(Math.random() * empty.length)];
  grid[p.r][p.c] = {
    id: ++sequence,
    value: 0,
    cursed: true,
    r: p.r,
    c: p.c,
    bornAt: Date.now(),
    pending: false,
    moveStart: 0,
    fromR: null,
    fromC: null
  };
  return true;
}

var SOUND_FILES = {
  merge: ['assets/audio/sfx-merge-1.wav', 'assets/audio/sfx-merge-2.wav', 'assets/audio/sfx-merge-3.wav'],
  boss_hit: 'assets/audio/sfx-boss-hit.wav',
  boss_attack: 'assets/audio/sfx-boss-attack.wav',
  skill: 'assets/audio/sfx-skill.wav',
  combo: 'assets/audio/sfx-combo.wav',
  victory: 'assets/audio/sfx-victory.wav',
  defeat: 'assets/audio/sfx-defeat.wav',
  click: ['assets/audio/sfx-click-1.wav', 'assets/audio/sfx-click-2.wav']
};

function initSound() {
  // 音频采用懒加载：第一次播放时才创建，避免启动时大量音频上下文导致卡顿。
}

function getAudioPool(name) {
  if (soundPools[name]) return soundPools[name];
  if (!soundEnabled || audioDisabled || !tt.createInnerAudioContext) return null;

  var files = Object.prototype.toString.call(SOUND_FILES[name]) === '[object Array]' ? SOUND_FILES[name] : [SOUND_FILES[name]];
  var pool = [];
  for (var i = 0; i < files.length; i++) {
    try {
      var audio = tt.createInnerAudioContext();
      if (!audio) continue;
      audio.src = files[i];
      audio.loop = false;
      audio.volume = (name === 'boss_attack' || name === 'boss_hit') ? 0.58 : 0.42;
      try { audio.obeyMuteSwitch = true; } catch (e) {}
      pool.push(audio);
    } catch (e2) {}
  }
  if (pool.length) {
    soundPools[name] = pool;
    soundPoolIndex[name] = 0;
    return pool;
  }
  audioDisabled = true;
  return null;
}

function playSound(name) {
  if (!soundEnabled || audioDisabled) return;
  var pool = getAudioPool(name);
  if (!pool || !pool.length) return;

  var index = soundPoolIndex[name] || 0;
  var audio = pool[index];
  soundPoolIndex[name] = (index + 1) % pool.length;
  var playKey = name + '_' + index;

  try {
    // 首次播放不要调用 stop，部分手机浏览器会在这里卡住
    if (audioPlayed[playKey] && audio.stop) audio.stop();
    if (audio.seek) { try { audio.seek(0); } catch (e) {} }
    audioPlayed[playKey] = true;
    var promise = audio.play ? audio.play() : null;
    if (promise && promise.catch) {
      promise.catch(function () { audioDisabled = true; });
    }
  } catch (e2) {
    audioDisabled = true;
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  storageSet('zhenyao2048_sound', soundEnabled);
  if (soundEnabled) { audioDisabled = false; playSound('click'); }
  showToast(soundEnabled ? '音效已开启' : '音效已关闭');
}

function spawnParticles(x, y, color, count, speed) {
  for (var i = 0; i < count; i++) {
    var angle = Math.random() * Math.PI * 2;
    var velocity = speed * (0.35 + Math.random());
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - 25,
      bornAt: Date.now(),
      life: 420 + Math.random() * 380,
      size: 2 + Math.random() * 3,
      color: color
    });
  }
  if (particles.length > 140) particles.splice(0, particles.length - 140);
}

function spawnTileParticles(row, col, color) {
  var x = BOARD_X + BOARD_PAD + col * (CELL + TILE_GAP) + CELL / 2;
  var y = BOARD_Y + BOARD_PAD + row * (CELL + TILE_GAP) + CELL / 2;
  spawnParticles(x, y, color, 10, 120);
  spawnRing(x, y, color, CELL * 0.85);
}

function spawnRing(x, y, color, maxRadius) {
  rings.push({ x: x, y: y, color: color, bornAt: Date.now(), life: 460, maxRadius: maxRadius || 60 });
  if (rings.length > 30) rings.shift();
}

function drawRings(now) {
  if (!rings.length) return;
  for (var i = rings.length - 1; i >= 0; i--) {
    var r = rings[i];
    var age = now - r.bornAt;
    if (age > r.life) {
      rings.splice(i, 1);
      continue;
    }
    if (age < 0) {
      rings.splice(i, 1);
      continue;
    }
    var t = Math.max(0, Math.min(1, age / r.life));
    var radius = r.maxRadius * t;
    if (!isFinite(radius) || radius < 0) {
      rings.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.max(0, 1 - t);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(1, 3 * (1 - t));
    ctx.beginPath();
    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function spawnBossParticles() {
  spawnParticles(SCREEN_W / 2, 82, '#FFD36E', 12, 110);
}

function drawParticles(now) {
  if (!particles.length) return;
  for (var i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    var age = now - p.bornAt;
    if (age < 0 || age > p.life) {
      particles.splice(i, 1);
      continue;
    }
    var t = age / 1000;
    var x = p.x + p.vx * t;
    var y = p.y + p.vy * t + 90 * t * t;
    var radius = Math.max(1, p.size * (1 - age / p.life * 0.4));
    if (!isFinite(radius) || !isFinite(x) || !isFinite(y)) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.max(0, 1 - age / p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x, y, Math.min(radius, 40), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function vibrate(type) {
  if (tt.vibrateShort) {
    try { tt.vibrateShort({ type: type || 'light' }); } catch (e) {}
  }
}

function devourLowestTile() {
  var cells = [];
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (grid[r][c] && !grid[r][c].cursed) cells.push({ r: r, c: c, value: grid[r][c].value });
    }
  }
  if (!cells.length) return false;
  cells.sort(function (a, b) { return a.value - b.value; });
  var target = cells[0];
  grid[target.r][target.c] = null;
  addFloatingText('吞噬', target.r, target.c, '#C94C4C');
  return true;
}

function checkBossEnrage() {
  if (bossEnraged || bossHP <= 0 || bossHP > bossMaxHP * 0.5) return;
  bossEnraged = true;
  var boss = BOSSES[stageIndex];
  attackEveryCurrent = Math.max(3, boss.attackEvery - 1);
  attackDamageCurrent = boss.attack + 6;
  addFloatingText('狂暴!', 1.5, 1.5, '#C94C4C', 20);
  showBossBanner('狂暴!', '#FF6B6B', 1200);
  triggerShake(8, 300);
  triggerFlash('rgba(201,76,76,0.18)', 250);
  showToast(boss.name + '进入狂暴，妖袭更频繁！');
  playSound('boss_hit');
  spawnBossParticles();
  vibrate('heavy');
}

function bossAttack() {
  if (bossStun > 0) {
    bossStun--;
    movesSinceAttack = 0;
    showBossBanner('妖袭被打断!', '#EDCF72', 1000);
    addFloatingText('打断!', 1.5, 1.5, '#EDCF72', 20);
    showToast('连击打断了' + BOSSES[stageIndex].name + '的妖袭！');
    vibrate('medium');
    return;
  }

  var boss = BOSSES[stageIndex];
  var dmg = attackDamageCurrent;
  var message = '';

  if (stageIndex === 0) {
    var devoured = devourLowestTile();
    bossHP = Math.min(bossMaxHP, bossHP + 8);
    if (!devoured) addCurseTile();
    if (bossEnraged) addCurseTile();
    message = devoured ? '吞噬最低阶妖块并恢复生命' : '降下妖气';
    showBossBanner('饕餮 · 吞噬!', '#F67C5F', 1100);
    triggerShake(8, 260);
    triggerFlash('rgba(201,76,76,0.14)', 200);
  } else if (stageIndex === 1) {
    addCurseTile();
    addCurseTile();
    message = '降下双雷';
    showBossBanner('穷奇 · 双雷!', '#6FA8FF', 1100);
    triggerShake(10, 280);
    triggerFlash('rgba(110,168,255,0.18)', 200);
  } else {
    isNight = !isNight;
    addCurseTile();
    if (isNight) dmg += 6;
    message = isNight ? '进入夜晚' : '进入白昼';
    showBossBanner(isNight ? '烛龙 · 夜幕降临!' : '烛龙 · 白昼回归!', isNight ? '#AEB8D6' : '#E8B33A', 1200);
    triggerShake(6, 260);
    triggerFlash(isNight ? 'rgba(46,58,89,0.22)' : 'rgba(232,179,58,0.12)', 250);
  }

  playerHP -= dmg;
  movesSinceAttack = 0;
  addFloatingText('-' + dmg, 1.5, 1.5, '#C94C4C', 18);
  showToast(boss.name + message + '！灵台 -' + dmg);
  playSound('boss_attack');
  spawnParticles(SCREEN_W / 2, 85, stageIndex === 1 ? '#6FA8FF' : (stageIndex === 2 ? '#AEB8D6' : '#C94C4C'), 12, 110);
  spawnRing(SCREEN_W / 2, 85, stageIndex === 1 ? '#6FA8FF' : (stageIndex === 2 ? '#AEB8D6' : '#C94C4C'), 140);
  vibrate('heavy');

  if (playerHP <= 0) {
    playerHP = 0;
    defeatBattle('灵台耗尽');
  }
}

function defeatBattle(reason) {
  if (phase === 'gameover' || phase === 'victory') return;
  defeatReason = reason || '妖气侵体';
  playSound('defeat');
  phase = 'gameover';
  overlay = 'gameover';
  syncBestToCloud();
  if (revivesLeft <= 0) submitScoreIfNeeded();
}

function onBossDefeated() {
  spawnParticles(SCREEN_W / 2, BOARD_Y + BOARD_SIZE / 2, '#FFD36E', 22, 160);
  playSound(stageIndex >= BOSSES.length - 1 ? 'victory' : 'combo');
  score += bossMaxHP * 2;
  if (score > best) {
    best = score;
    storageSet(BEST_KEY, best);
  }
  if (stageIndex >= BOSSES.length - 1) {
    phase = 'victory';
    overlay = 'victory';
    submitScoreIfNeeded();
    syncBestToCloud();
    return;
  }
  phase = 'reward';
  overlay = 'reward';
  rewardChoices = pickRelics(3);
}

function pickRelics(count) {
  var available = [];
  for (var i = 0; i < RELICS.length; i++) {
    if (!hasRelic(RELICS[i].id)) available.push(RELICS[i]);
  }
  for (var j = available.length - 1; j > 0; j--) {
    var k = Math.floor(Math.random() * (j + 1));
    var temp = available[j];
    available[j] = available[k];
    available[k] = temp;
  }
  return available.slice(0, count);
}

function applyRelic(id) {
  relics.push(id);
  if (id === 'luwu_mountain') {
    playerMaxHP += 30;
    playerHP = Math.min(playerMaxHP, playerHP + 30);
  }
}

function chooseRelic(index) {
  if (phase !== 'reward') return;
  var relic = rewardChoices[index];
  if (!relic) return;
  applyRelic(relic.id);
  playerHP = Math.min(playerMaxHP, playerHP + 15);
  startBattle(stageIndex + 1);
}

function skillCost(skill) {
  return Math.max(1, skill.cost - (hasRelic('jiuwei_charm') ? 1 : 0));
}

function useSkill(id) {
  if (phase !== 'playing' || overlay !== 'none' || animating) return;
  var skill = null;
  for (var i = 0; i < SKILLS.length; i++) {
    if (SKILLS[i].id === id) skill = SKILLS[i];
  }
  if (!skill) return;
  var cost = skillCost(skill);
  if (energy < cost) {
    showToast('灵力不足，需要 ' + cost + ' 点');
    return;
  }
  energy -= cost;
  playSound('skill');
  spawnParticles(SCREEN_W / 2, BOARD_Y + BOARD_SIZE / 2, skill.color, 16, 130);

  if (id === 'jiuwei') {
    var targets = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (grid[r][c] && !grid[r][c].cursed) {
          targets.push({ r: r, c: c, value: grid[r][c].value });
        }
      }
    }
    targets.sort(function (a, b) { return a.value - b.value; });
    var n = Math.min(4, targets.length);
    for (var t = 0; t < n; t++) grid[targets[t].r][targets[t].c] = null;
    addFloatingText('魅惑!', 1.5, 1.5, '#EDCF72');
    showToast('九尾魅惑：清除 ' + n + ' 个低阶妖块');
  } else if (id === 'bifang') {
    var curses = 0;
    for (var rr = 0; rr < SIZE; rr++) {
      for (var cc = 0; cc < SIZE; cc++) {
        if (grid[rr][cc] && grid[rr][cc].cursed) {
          grid[rr][cc] = null;
          curses++;
        }
      }
    }
    var dmg = Math.round(40 * (hasRelic('zhulong_breath') ? 1.5 : 1));
    bossHP = Math.max(0, bossHP - dmg);
    score += dmg * 10;
    addFloatingText('焚林 -' + dmg, 1.5, 1.5, '#F67C5F');
    showToast('毕方焚林：清除 ' + curses + ' 个妖气，Boss -' + dmg);
    vibrate('medium');
  } else if (id === 'yinglong') {
    var healed = Math.min(playerMaxHP, playerHP + 35) - playerHP;
    playerHP += healed;
    showToast('应龙甘霖：灵台 +' + healed);
  }

  var boss = BOSSES[stageIndex];
  if (skill.id === boss.weakSkill) {
    bossHP = Math.max(0, bossHP - 20);
    score += 200;
    if (score > best) { best = score; storageSet(BEST_KEY, best); }
    addFloatingText('弱点 -20', 1.5, 1.5, '#FFD36E', 18);
    bossHitUntil = Date.now() + 180;
    playSound('boss_hit');
    spawnBossParticles();
    spawnRing(SCREEN_W / 2, BOARD_Y + BOARD_SIZE / 2, '#FFD36E', BOARD_SIZE * 0.62);
    showBossBanner('击中弱点!', '#FFD36E', 900);
    triggerFlash('rgba(237,194,46,0.16)', 200);
    triggerShake(6, 220);
    if (skill.id === 'jiuwei') bossStun = 1;
    if (skill.id === 'yinglong' && stageIndex === 2) isNight = false;
    vibrate('medium');
  }

  if (bossHP <= 0) {
    onBossDefeated();
    return;
  }
  checkBossEnrage();
  if (!hasMoves()) defeatBattle('无路可走');
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
  if (id === 'sound') {
    toggleSound();
    return;
  }
  playSound('click');
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
  if (id === 'victory-restart') {
    submitScoreIfNeeded();
    syncBestToCloud();
    resetGame();
    return;
  }
  if (id === 'victory-leaderboard') {
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
    return;
  }
  if (id.indexOf('skill-') === 0) {
    useSkill(id.substring(6));
    return;
  }
  if (id.indexOf('relic-') === 0) {
    chooseRelic(parseInt(id.substring(6), 10));
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
  ctx.font = '900 24px Arial, sans-serif';
  ctx.fillText('山海经·镇妖录', MARGIN, 8);

  drawScoreCard(SCREEN_W - MARGIN - 92, 8, 92, 40, '镇妖分', score);

  var boss = BOSSES[stageIndex];
  var bx = MARGIN;
  var by = 50;
  var bw = SCREEN_W - MARGIN * 2;
  var bh = 66;
  drawRoundRect(bx, by, bw, bh, 10, '#f3eee7');

  var avatar = beastImages[boss.value];
  if (avatar) {
    var avatarShake = Date.now() < bossHitUntil ? (Math.random() - 0.5) * 5 : 0;
    ctx.drawImage(avatar, bx + 6 + avatarShake, by + 8, 46, 46);
  } else {
    drawRoundRect(bx + 6, by + 8, 46, 46, 8, '#8f7a66');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.fillText(boss.name.charAt(0), bx + 29, by + 31);
  }

  var phaseTag = '';
  if (stageIndex === 2) phaseTag = isNight ? ' · 夜' : ' · 昼';
  if (bossEnraged) phaseTag += ' · 狂暴';
  if (bossStun > 0) phaseTag += ' · 眩晕';

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 15px Arial, sans-serif';
  ctx.fillText(boss.name + phaseTag, bx + 60, by + 7);
  ctx.fillStyle = '#a69a8d';
  ctx.font = '9px Arial, sans-serif';
  ctx.fillText('第 ' + (stageIndex + 1) + '/' + BOSSES.length + ' 关 · ' + boss.title, bx + 60, by + 26);
  ctx.fillStyle = '#b8afa5';
  ctx.font = '8px Arial, sans-serif';
  ctx.fillText(boss.mechanic + ' | 弱点：' + boss.weakName, bx + 60, by + 38);

  var barX = bx + 60;
  var barY = by + 51;
  var barW = bw - 72;
  var barH = 8;
  drawRoundRect(barX, barY, barW, barH, 4, '#d6cdc4');
  var bossPct = bossMaxHP > 0 ? Math.max(0, bossHP) / bossMaxHP : 0;
  drawRoundRect(barX, barY, Math.max(0, barW * bossPct), barH, 4, bossEnraged ? '#b33a3a' : '#c94c4c');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#776e65';
  ctx.font = '8px Arial, sans-serif';
  ctx.fillText(Math.max(0, Math.ceil(bossHP)) + ' / ' + bossMaxHP, barX + barW / 2, barY + 4);
  if (Date.now() < bossHitUntil) {
    drawRoundRect(bx, by, bw, bh, 10, null, 'rgba(255,255,255,0.9)', 3);
  }
  if (phase === 'playing' && movesSinceAttack + 1 >= attackEveryCurrent) {
    var warnPulse = 0.5 + 0.5 * Math.sin(Date.now() / 120);
    drawRoundRect(bx, by, bw, bh, 10, null, 'rgba(201,76,76,' + (0.35 + 0.35 * warnPulse) + ')', 2);
  }

  var sy = 120;
  var sh = 30;
  drawRoundRect(MARGIN, sy, SCREEN_W - MARGIN * 2, sh, 8, '#f3eee7');
  var hpW = (SCREEN_W - MARGIN * 2) * 0.42;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#776e65';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText('灵台', MARGIN + 8, sy + sh / 2);
  var hpBarX = MARGIN + 36;
  var hpBarY = sy + 10;
  var hpBarW = hpW - 40;
  drawRoundRect(hpBarX, hpBarY, hpBarW, 10, 5, '#d6cdc4');
  var hpPct = playerMaxHP > 0 ? Math.max(0, playerHP) / playerMaxHP : 0;
  drawRoundRect(hpBarX, hpBarY, Math.max(0, hpBarW * hpPct), 10, 5, '#6faf9b');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '9px Arial, sans-serif';
  ctx.fillText(Math.max(0, playerHP) + '/' + playerMaxHP, hpBarX + hpBarW / 2, hpBarY + 5);

  var willAttack = phase === 'playing' && movesSinceAttack + 1 >= attackEveryCurrent;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 12px Arial, sans-serif';
  ctx.fillText('灵力 ' + energy, MARGIN + hpW + 14, sy + sh / 2);
  ctx.fillStyle = willAttack ? '#c94c4c' : '#a69a8d';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText((willAttack ? '! ' : '') + '妖袭 ' + movesSinceAttack + '/' + attackEveryCurrent, MARGIN + hpW + 72, sy + sh / 2);

  if (overlay === 'none') {
    drawButton('new', '新一局', MARGIN, 158, 86, 30, '#8f7a66', '#f9f6f2', 13);
    drawButton('leaderboard', '全服榜', MARGIN + 94, 158, 90, 30, '#edc22e', '#776e65', 13);
    drawButton('sound', soundEnabled ? '音效开' : '音效关', MARGIN + 192, 158, 72, 30, '#d6cdc4', '#776e65', 12);
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
        var scale = getTileScale(tile, now);
        if (tile.cursed) {
          drawCurseTile(pos.r, pos.c, scale);
        } else {
          drawTile(tile.value, pos.r, pos.c, scale);
        }
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

  if (stageIndex === 2 && isNight) {
    drawRoundRect(BOARD_X, BOARD_Y, BOARD_SIZE, BOARD_SIZE, 10, null, 'rgba(120,150,255,0.5)', 2);
  }
  if (Date.now() < comboGlowUntil) {
    ctx.save();
    ctx.shadowColor = '#FFD36E';
    ctx.shadowBlur = 18;
    drawRoundRect(BOARD_X, BOARD_Y, BOARD_SIZE, BOARD_SIZE, 10, null, 'rgba(255,211,110,0.95)', 3);
    ctx.restore();
  }
}

function drawCurseTile(rowFloat, colFloat, scale) {
  var x = BOARD_X + BOARD_PAD + colFloat * (CELL + TILE_GAP);
  var y = BOARD_Y + BOARD_PAD + rowFloat * (CELL + TILE_GAP);
  var s = scale || 1;
  var size = CELL * s;
  var offset = (CELL - size) / 2;
  var pulse = 0.5 + 0.5 * Math.sin(Date.now() / 150);
  ctx.save();
  ctx.shadowColor = 'rgba(190,90,255,0.85)';
  ctx.shadowBlur = 8 + pulse * 10;
  drawRoundRect(x + offset, y + offset, size, size, Math.max(4, size * 0.08), '#3a2b45');
  ctx.restore();
  ctx.fillStyle = 'rgba(255,179,179,' + (0.72 + pulse * 0.28) + ')';
  ctx.font = 'bold ' + Math.round(Math.max(11, size * 0.36)) + 'px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('妖', x + CELL / 2, y + CELL / 2 + 1);
}

function drawFooter() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a69a8d';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText('滑动合成 · 击败 Boss · 点击技能释放', SCREEN_W / 2, SCREEN_H - 18);
}

function drawBackdrop() {
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}

function drawGameOver() {
  drawBackdrop();

  var withRevive = revivesLeft > 0;
  var panelW = Math.min(SCREEN_W - 44, 340);
  var panelH = withRevive ? 360 : 306;
  var px = (SCREEN_W - panelW) / 2;
  var py = Math.max(14, (SCREEN_H - panelH) / 2);

  drawRoundRect(px, py, panelW, panelH, 18, '#faf8ef');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillText('镇妖失败', SCREEN_W / 2, py + 20);

  ctx.fillStyle = '#a69a8d';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText((defeatReason || '灵台失守') + ' · 最高连击 ' + maxCombo, SCREEN_W / 2, py + 58);

  ctx.fillStyle = '#8f8377';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('镇妖分', SCREEN_W / 2, py + 86);
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.fillText(String(score), SCREEN_W / 2, py + 102);

  var by = py + 162;
  if (withRevive) {
    drawButton('revive', '看广告复活', px + 24, by, panelW - 48, 46, '#edc22e', '#776e65', 17);
    ctx.fillStyle = '#a69a8d';
    ctx.font = '10px Arial, sans-serif';
    ctx.fillText('恢复灵台并清除棋盘上的妖气', SCREEN_W / 2, by + 51);
    by += 68;
  }
  drawButton('restart-over', '再来一局', px + 24, by, panelW - 48, 40, '#8f7a66', '#f9f6f2', 15);
  by += 48;
  drawButton('leaderboard-over', '全服榜', px + 24, by, panelW - 48, 34, '#d6cdc4', '#776e65', 13);
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
  ctx.fillText('本机镇妖榜', SCREEN_W / 2, py + 20);

  ctx.fillStyle = '#a69a8d';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('全服榜不可用时的备用记录', SCREEN_W / 2, py + 56);

  var list = getLeaderboard();
  var rowTop = py + 82;

  if (!list.length) {
    ctx.fillStyle = '#a69a8d';
    ctx.font = '15px Arial, sans-serif';
    ctx.fillText('还没有记录，先镇一只妖吧！', SCREEN_W / 2, py + 170);
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

function drawSkills() {
  var y = BOARD_Y + BOARD_SIZE + 12;
  var gap = 8;
  var cardW = (BOARD_SIZE - gap * 2) / 3;
  for (var i = 0; i < SKILLS.length; i++) {
    var s = SKILLS[i];
    var x = BOARD_X + i * (cardW + gap);
    var cost = skillCost(s);
    var affordable = energy >= cost;
    var bg = affordable ? s.color : '#d6cdc4';
    var fg = affordable ? '#776e65' : '#a69a8d';
    drawRoundRect(x, y, cardW, 54, 8, bg);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = fg;
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.fillText(s.name, x + cardW / 2, y + 8);
    ctx.font = '10px Arial, sans-serif';
    ctx.fillText('灵力 ' + cost, x + cardW / 2, y + 27);
    if (cardW > 78) {
      ctx.fillStyle = affordable ? '#8f8377' : '#b8afa5';
      ctx.font = '9px Arial, sans-serif';
      ctx.fillText(s.desc, x + cardW / 2, y + 41);
    }
    if (overlay === 'none') {
      buttons.push({ id: 'skill-' + s.id, x: x, y: y, w: cardW, h: 54 });
    }
  }

  var names = [];
  for (var ri = 0; ri < relics.length; ri++) {
    var label = relics[ri];
    for (var rj = 0; rj < RELICS.length; rj++) {
      if (RELICS[rj].id === relics[ri]) label = RELICS[rj].name;
    }
    names.push(label);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a69a8d';
  ctx.font = '10px Arial, sans-serif';
  ctx.fillText('法宝：' + (names.length ? names.join(' / ') : '暂无'), SCREEN_W / 2, y + 66);
}

function drawFloatingTexts(now) {
  for (var i = floatingTexts.length - 1; i >= 0; i--) {
    var f = floatingTexts[i];
    var age = now - f.bornAt;
    if (age < 0 || age > 900) {
      floatingTexts.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.max(0, 1 - age / 900);
    ctx.fillStyle = f.color;
    ctx.font = 'bold ' + (f.size || 13) + 'px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.text, f.x, f.y - age * 0.04);
    ctx.globalAlpha = 1;
  }
}

function drawReward() {
  drawBackdrop();

  var panelW = Math.min(SCREEN_W - 40, 360);
  var panelH = Math.min(SCREEN_H - 60, 450);
  var px = (SCREEN_W - panelW) / 2;
  var py = Math.max(20, (SCREEN_H - panelH) / 2);

  drawRoundRect(px, py, panelW, panelH, 18, '#faf8ef');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 26px Arial, sans-serif';
  ctx.fillText('镇妖成功', SCREEN_W / 2, py + 18);
  ctx.fillStyle = '#a69a8d';
  ctx.font = '12px Arial, sans-serif';
  ctx.fillText('选择一件法宝，继续深入山海', SCREEN_W / 2, py + 52);

  var startY = py + 82;
  for (var i = 0; i < rewardChoices.length; i++) {
    var r = rewardChoices[i];
    var x = px + 20;
    var y = startY + i * 92;
    var w = panelW - 40;
    var h = 80;
    drawRoundRect(x, y, w, h, 10, '#f3eee7');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#776e65';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.fillText(r.name, x + 14, y + 12);
    ctx.fillStyle = '#8f8377';
    ctx.font = '11px Arial, sans-serif';
    ctx.fillText(r.desc, x + 14, y + 38);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a69a8d';
    ctx.font = '10px Arial, sans-serif';
    ctx.fillText('点击选择', x + w - 14, y + 60);
    buttons.push({ id: 'relic-' + i, x: x, y: y, w: w, h: h });
  }
}

function drawVictory() {
  drawBackdrop();

  var panelW = Math.min(SCREEN_W - 44, 340);
  var panelH = 320;
  var px = (SCREEN_W - panelW) / 2;
  var py = Math.max(18, (SCREEN_H - panelH) / 2);

  drawRoundRect(px, py, panelW, panelH, 18, '#faf8ef');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText('镇妖成功！', SCREEN_W / 2, py + 22);
  ctx.fillStyle = '#8f8377';
  ctx.font = '14px Arial, sans-serif';
  ctx.fillText('你击败了烛龙 · 最高连击 ' + maxCombo, SCREEN_W / 2, py + 62);
  ctx.fillStyle = '#776e65';
  ctx.font = 'bold 42px Arial, sans-serif';
  ctx.fillText(String(score), SCREEN_W / 2, py + 92);

  drawButton('victory-restart', '再来一局', px + 24, py + 170, panelW - 48, 46, '#8f7a66', '#f9f6f2', 16);
  drawButton('victory-leaderboard', '全服榜', px + 24, py + 226, panelW - 48, 38, '#edc22e', '#776e65', 14);
}

function drawFlash() {
  if (Date.now() >= flashUntil) return;
  ctx.fillStyle = flashColor;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}

function drawBossBanner() {
  if (Date.now() >= bossBannerUntil) return;
  var boxW = Math.min(SCREEN_W - 50, 320);
  var boxH = 58;
  var bx = (SCREEN_W - boxW) / 2;
  var by = (SCREEN_H - boxH) / 2;
  drawRoundRect(bx, by, boxW, boxH, 14, 'rgba(30,24,20,0.80)');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bossBannerColor;
  ctx.font = 'bold ' + (bossBannerText.length > 9 ? 18 : 22) + 'px Arial, sans-serif';
  ctx.fillText(bossBannerText, SCREEN_W / 2, by + boxH / 2 + 1);
}

function render(now) {
  now = Date.now();
  buttons = [];

  ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = '#faf8ef';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

  ctx.save();
  var t = Date.now();
  if (t < screenShakeUntil) {
    var p = (screenShakeUntil - t) / 250;
    ctx.translate((Math.random() - 0.5) * screenShakePower * p, (Math.random() - 0.5) * screenShakePower * p);
  }

  drawHeader();
  drawBoard(now);
  drawSkills();
  drawFooter();
  drawFloatingTexts(now);
  drawParticles(now);
  drawRings(now);

  if (overlay === 'gameover') {
    drawGameOver();
  } else if (overlay === 'reward') {
    drawReward();
  } else if (overlay === 'victory') {
    drawVictory();
  } else if (overlay === 'leaderboard') {
    drawLeaderboard();
  }

  ctx.restore();
  drawFlash();
  drawBossBanner();
  drawToast(now);
  requestAnimationFrame(render);
}

/* ==================== 启动 ==================== */
function boot() {
  computeLayout();
  preloadBeastImages();
  initSound();
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

if (typeof window !== 'undefined') {
  window.__zhenyaoStartBoss = function (index) {
    score = 0;
    maxCombo = 0;
    playerMaxHP = 100;
    playerHP = 100;
    relics = [];
    revivesLeft = CONFIG.MAX_REVIVES;
    submittedThisRun = false;
    bossStun = 0;
    startBattle(index);
  };
  window.__zhenyaoSetSound = function (on) {
    soundEnabled = !!on;
    audioDisabled = false;
    storageSet('zhenyao2048_sound', soundEnabled);
    if (soundEnabled) playSound('click');
    showToast(soundEnabled ? '音效已开启' : '音效已关闭');
  };
}
boot();