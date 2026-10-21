(function () {
  'use strict';

  var isMobile = window.innerWidth <= 600;
  var LOGICAL_W = isMobile ? window.innerWidth : 430;
  var LOGICAL_H = isMobile ? window.innerHeight : 820;
  var DPR = Math.min(window.devicePixelRatio || 1, 3);
  var touchStartHandler = null;
  var touchEndHandler = null;
  var touchAttached = false;

  function isAdOverlayOpen() {
    var o = document.getElementById('ad-overlay');
    return !!(o && o.classList.contains('show'));
  }

  function makeTouchEvent(x, y) {
    var p = { clientX: x, clientY: y, pageX: x, pageY: y };
    return { touches: [p], changedTouches: [p] };
  }

  function getCanvas() { return document.getElementById('game-canvas'); }

  function fireStart(x, y) {
    if (isAdOverlayOpen()) return;
    if (touchStartHandler) touchStartHandler(makeTouchEvent(x, y));
  }

  function fireEnd(x, y) {
    if (isAdOverlayOpen()) return;
    if (touchEndHandler) touchEndHandler(makeTouchEvent(x, y));
  }

  function logicalPoint(clientX, clientY) {
    var c = getCanvas();
    if (!c) return null;
    var r = c.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: (clientX - r.left) * (LOGICAL_W / r.width),
      y: (clientY - r.top) * (LOGICAL_H / r.height)
    };
  }

  function attachTouch() {
    if (touchAttached) return;
    touchAttached = true;

    document.addEventListener('touchstart', function (e) {
      if (isAdOverlayOpen()) return;
      var t = e.touches[0];
      if (!t) return;
      fireStart(t.clientX, t.clientY);
    }, { passive: true });

    document.addEventListener('touchend', function (e) {
      if (isAdOverlayOpen()) return;
      var t = e.changedTouches[0];
      if (!t) return;
      fireEnd(t.clientX, t.clientY);
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!isAdOverlayOpen()) e.preventDefault();
    }, { passive: false });

    var mouseDown = false;
    document.addEventListener('mousedown', function (e) {
      if (isAdOverlayOpen()) return;
      var p = logicalPoint(e.clientX, e.clientY);
      if (!p) return;
      if (p.x < 0 || p.x > LOGICAL_W || p.y < 0 || p.y > LOGICAL_H) return;
      mouseDown = true;
      fireStart(p.x, p.y);
    });

    document.addEventListener('mouseup', function (e) {
      if (!mouseDown) return;
      mouseDown = false;
      var p = logicalPoint(e.clientX, e.clientY);
      if (!p) return;
      fireEnd(p.x, p.y);
    });
  }

  var tt = {
    getSystemInfoSync: function () {
      return { windowWidth: LOGICAL_W, windowHeight: LOGICAL_H, pixelRatio: DPR };
    },
    createCanvas: function () {
      var root = document.getElementById('game-root');
      var canvas = document.createElement('canvas');
      canvas.id = 'game-canvas';
      var scale = 1;
      if (!isMobile) {
        scale = Math.min(1, (window.innerWidth - 24) / LOGICAL_W, (window.innerHeight - 24) / LOGICAL_H);
      }
      canvas.style.width = Math.round(LOGICAL_W * scale) + 'px';
      canvas.style.height = Math.round(LOGICAL_H * scale) + 'px';
      root.appendChild(canvas);
      return canvas;
    },
    createImage: function () { return new Image(); },
    getStorageSync: function (key) {
      try {
        if (key && typeof key === 'object') key = key.key;
        var v = localStorage.getItem(key);
        return v === null ? '' : v;
      } catch (e) { return ''; }
    },
    setStorageSync: function (key, value) {
      try {
        if (key && typeof key === 'object') { value = key.data; key = key.key; }
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    },
    login: function (opts) {
      if (opts && opts.success) opts.success({ code: 'web-demo' });
    },
    setImRankData: function (opts) {
      if (opts && opts.success) opts.success({});
    },
    getImRankList: function (opts) {
      setTimeout(function () {
        if (opts && opts.fail) opts.fail({ errMsg: 'web-demo: rank list unavailable' });
      }, 120);
    },
    showShareMenu: function () {},
    shareAppMessage: function (opts) {
      var title = (opts && opts.title) ? opts.title : '山海经 2048';
      var url = location.href;
      if (navigator.share) {
        navigator.share({ title: title, text: title, url: url }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(title + ' ' + url).then(function () {
          alert('链接已复制，可以分享给朋友了！');
        }).catch(function () { alert(url); });
      } else {
        alert(url);
      }
    },
    getLaunchOptionsSync: function () {
      var query = {};
      try {
        new URLSearchParams(location.search).forEach(function (v, k) { query[k] = v; });
      } catch (e) {}
      return { query: query };
    },
    onTouchStart: function (cb) { touchStartHandler = cb; attachTouch(); },
    onTouchEnd: function (cb) { touchEndHandler = cb; attachTouch(); },
    createInnerAudioContext: function () {
      if (typeof Audio === 'undefined') return null;
      var audio = new Audio();
      var wrapper = {
        play: function () {
          try {
            audio.currentTime = 0;
            var p = audio.play();
            if (p && p.catch) p.catch(function () {});
          } catch (e) {}
        },
        stop: function () {
          try { audio.pause(); audio.currentTime = 0; } catch (e) {}
        },
        pause: function () { try { audio.pause(); } catch (e) {} },
        destroy: function () { try { audio.pause(); } catch (e) {} }
      };
      Object.defineProperty(wrapper, 'src', {
        get: function () { return audio.src; },
        set: function (v) { audio.src = v; }
      });
      Object.defineProperty(wrapper, 'volume', {
        get: function () { return audio.volume; },
        set: function (v) { audio.volume = v; }
      });
      wrapper.loop = false;
      wrapper.obeyMuteSwitch = true;
      return wrapper;
    },
    createRewardedVideoAd: function () {
      var closeCb = null;
      var errorCb = null;
      return {
        onClose: function (cb) { closeCb = cb; },
        onError: function (cb) { errorCb = cb; },
        load: function () { return Promise.resolve(); },
        show: function () {
          return new Promise(function (resolve) {
            var overlay = document.getElementById('ad-overlay');
            var finish = document.getElementById('ad-finish');
            var cancel = document.getElementById('ad-cancel');
            overlay.classList.add('show');

            function cleanup() {
              overlay.classList.remove('show');
              finish.onclick = null;
              cancel.onclick = null;
            }

            finish.onclick = function (e) {
              if (e) { e.preventDefault(); e.stopPropagation(); }
              cleanup();
              if (closeCb) closeCb({ isEnded: true });
              resolve();
            };

            cancel.onclick = function (e) {
              if (e) { e.preventDefault(); e.stopPropagation(); }
              cleanup();
              if (closeCb) closeCb({ isEnded: false });
              resolve();
            };
          });
        }
      };
    }
  };

  window.tt = tt;
})();