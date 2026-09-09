/* =========================================================================
 * chart.js —— K 线 + 成交量 + MACD + KDJ 绘制（Canvas 2D）
 * 无第三方依赖，逻辑可直接迁移到微信小程序（canvas type="2d"）
 * 约定：bars = [[date 'YYYYMMDD', open, high, low, close, volume], ...]
 *
 * 布局模式：
 *   sub = 'vol' | 'macd' | 'kdj'   —— 单副图（主图 + 一个副图）
 *   sub = 'all'                    —— 主图 + 成交量 + MACD + KDJ 垂直堆叠
 * 每个子图都带 Y 轴刻度，底部带 X 轴日期。
 * ========================================================================= */
(function (global) {
  'use strict';

  var C = {
    up: '#e5343d', down: '#12a150', flat: '#9aa1ad',
    grid: '#f0f1f3', axis: '#c7cad0', text: '#9aa1ad',
    ma5: '#f59e0b', ma20: '#2563eb', ma60: '#8b5cf6',
    bg: '#ffffff', cross: '#6b7280',
    dif: '#f59e0b', dea: '#2563eb'
  };

  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return '-';
    var s = Number(n).toFixed(d === undefined ? 2 : d);
    return s;
  }
  function fmtVol(v) {
    if (!v) return '0';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1) + '万';
    return String(Math.round(v));
  }
  function maLine(vals, n) {
    var out = [], s = 0;
    for (var i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      out.push(i >= n - 1 ? s / n : null);
    }
    return out;
  }
  function ema(vals, n) {
    var k = 2 / (n + 1), out = [], prev = null;
    for (var i = 0; i < vals.length; i++) {
      prev = prev === null ? vals[i] : vals[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  }
  function macdOf(closes) {
    var ef = ema(closes, 12), es = ema(closes, 26), dif = [], i;
    for (i = 0; i < closes.length; i++) dif.push(ef[i] - es[i]);
    var dea = ema(dif, 9), hist = [];
    for (i = 0; i < dif.length; i++) hist.push((dif[i] - dea[i]) * 2);
    return { dif: dif, dea: dea, hist: hist };
  }
  function kdjOf(highs, lows, closes, n) {
    n = n || 9;
    var k = [], d = [], j = [];
    var pk = 50, pd = 50;
    for (var i = 0; i < closes.length; i++) {
      var hh = -Infinity, ll = Infinity;
      for (var t = Math.max(0, i - n + 1); t <= i; t++) {
        hh = Math.max(hh, highs[t]); ll = Math.min(ll, lows[t]);
      }
      var rsv = (hh === ll) ? 50 : (closes[i] - ll) / (hh - ll) * 100;
      pk = 2 / 3 * pk + 1 / 3 * rsv;
      pd = 2 / 3 * pd + 1 / 3 * pk;
      k.push(pk); d.push(pd); j.push(3 * pk - 2 * pd);
    }
    return { k: k, d: d, j: j };
  }

  /**
   * 核心绘制。
   * @param ctx
   * @param cssW / cssH 逻辑像素
   * @param bars  [[date,o,h,l,c,v]]
   * @param opt  {sub:'vol'|'macd'|'kdj'|'all', ma:[5,20,60], cross:index|null}
   */
  function drawOn(ctx, cssW, cssH, bars, opt) {
    opt = opt || {};
    var sub = opt.sub || 'vol';
    var maN = opt.ma || [5, 20, 60];
    var cross = (opt.cross === undefined) ? null : opt.cross;

    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    if (!bars || bars.length < 2) return;

    var padL = 4, padR = 46, padT = 8, padB = 16, gapH = 10;

    var n = bars.length;
    var closes = [], highs = [], lows = [], vols = [], dates = [];
    for (var i = 0; i < n; i++) {
      dates.push(bars[i][0]);
      highs.push(bars[i][2]); closes.push(bars[i][4]);
      lows.push(bars[i][3]); vols.push(bars[i][5] || 0);
    }


    // 计算 MA（用全量数据预热，opt.fullBars 供短周期视图仍能画出完整 MA）
    var maBars = (opt.fullBars && opt.fullBars.length > bars.length) ? opt.fullBars : bars;
    var maCloses = [];
    for (var k = 0; k < maBars.length; k++) maCloses.push(maBars[k][4]);
    var maSets = [];
    for (var m = 0; m < maN.length; m++) {
      // MA 值对齐到可见 bars 的末尾，只取最后 n 个（n=可见bars长度）
      var s = maLine(maCloses, maN[m]).slice(-n);
      maSets.push({ n: maN[m], data: s, color: m === 0 ? C.ma5 : (m === 1 ? C.ma20 : C.ma60) });
    }

    // 决定布局：哪些副图显示
    var panels;  // [{type, h}]
    if (sub === 'all') {
      panels = [{ type: 'kline', h: 0.44 }, { type: 'vol', h: 0.16 }, { type: 'macd', h: 0.20 }, { type: 'kdj', h: 0.20 }];
    } else if (sub === 'none') {
      panels = [{ type: 'kline', h: 1.0 }];
    } else {
      panels = [{ type: 'kline', h: 0.66 }, { type: sub, h: 0.34 }];
    }

    var totalGap = gapH * (panels.length - 1);
    var availH = cssH - padT - padB - totalGap;
    var y = padT;
    var panelsY = [];
    for (i = 0; i < panels.length; i++) {
      var ph = Math.round(availH * panels[i].h);
      panelsY.push({ type: panels[i].type, y: y, h: ph });
      y += ph + gapH;
    }

    var plotW = cssW - padL - padR;
    var x0 = padL;
    var cw = plotW / n;
    var bw = Math.max(1, Math.min(cw * 0.66, 9));
    var px = function (i) { return x0 + cw * i + cw / 2; };

    ctx.font = '10px -apple-system,system-ui,sans-serif';

    // ---- 每个面板绘制 ----
    var mc = null, kd = null, vMax = 0;
    if (sub === 'all' || sub === 'macd') mc = macdOf(closes);
    if (sub === 'all' || sub === 'kdj') kd = kdjOf(highs, lows, closes, 9);
    for (i = 0; i < n; i++) vMax = Math.max(vMax, vols[i]);
    if (vMax <= 0) vMax = 1;

    // 主图价格范围（含 MA）
    var lo = Infinity, hi = -Infinity;
    for (i = 0; i < n; i++) {
      lo = Math.min(lo, lows[i]); hi = Math.max(hi, highs[i]);
      for (m = 0; m < maSets.length; m++) {
        var v = maSets[m].data[i];
        if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (hi === lo) { hi += 1; lo -= 1; }
    var padY = (hi - lo) * 0.06;
    lo -= padY; hi += padY;

    for (var p = 0; p < panelsY.length; p++) {
      var panel = panelsY[p];
      drawPanel(ctx, panel, {
        x0: x0, plotW: plotW, px: px, bw: bw, n: n,
        dates: dates, closes: closes, highs: highs, lows: lows, vols: vols,
        bars: bars, maSets: maSets, mc: mc, kd: kd, vMax: vMax,
        lo: lo, hi: hi, cross: cross, isLast: p === panelsY.length - 1
      });
    }
  }

  function drawPanel(ctx, panel, g) {
    var type = panel.type;
    var y0 = panel.y, H = panel.h;
    var x0 = g.x0, plotW = g.plotW, px = g.px, bw = g.bw, n = g.n;

    // Y 轴刻度线 + 网格
    var yTicks = 4;  // 每个子图 5 条水平线
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.fillStyle = C.text; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

    function yScale(lo, hi, fmtFn) {
      for (var t = 0; t <= yTicks; t++) {
        var yy = Math.round(y0 + H / yTicks * t) + 0.5;
        var val = hi - (hi - lo) / yTicks * t;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + plotW, yy); ctx.stroke();
        ctx.fillText(fmtFn(val), x0 + plotW + 5, yy);
      }
      // 左边界线
      ctx.strokeStyle = C.axis;
      ctx.beginPath(); ctx.moveTo(x0 + 0.5, y0); ctx.lineTo(x0 + 0.5, y0 + H); ctx.stroke();
      ctx.strokeStyle = C.grid;
    }

    // 绘制子图内容
    if (type === 'kline') {
      var lo = g.lo, hi = g.hi;
      yScale(lo, hi, function (v) { return fmt(v, 0); });
      var py = function (v) { return y0 + (hi - v) / (hi - lo) * H; };

      // 蜡烛
      for (var i = 0; i < n; i++) {
        var o = g.bars[i][1], c = g.closes[i], h = g.highs[i], l = g.lows[i];
        var col = c >= o ? C.up : C.down;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        var xx = Math.round(px(i)) + 0.5;
        ctx.beginPath(); ctx.moveTo(xx, py(h)); ctx.lineTo(xx, py(l)); ctx.stroke();
        var yO = py(o), yC = py(c);
        var top = Math.min(yO, yC), hgt = Math.max(Math.abs(yC - yO), 1);
        ctx.fillRect(px(i) - bw / 2, top, bw, hgt);
      }
      // 均线
      ctx.lineWidth = 1.1;
      for (var m = 0; m < g.maSets.length; m++) {
        var set = g.maSets[m];
        ctx.strokeStyle = set.color;
        ctx.beginPath(); var started = false;
        for (i = 0; i < n; i++) {
          if (set.data[i] === null) continue;
          var X = px(i), Y = py(set.data[i]);
          if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
    } else if (type === 'vol') {
      var vMax = g.vMax;
      yScale(0, vMax, fmtVol);
      for (var i = 0; i < n; i++) {
        var rising = g.closes[i] >= g.bars[i][1];
        ctx.fillStyle = rising ? C.up : C.down;
        var vh = Math.max(g.vols[i] / vMax * H, 0.8);
        ctx.fillRect(px(i) - bw / 2, y0 + H - vh, bw, vh);
      }
      // 5 日均量线
      var v5 = maLine(g.vols, 5);
      ctx.strokeStyle = C.ma5; ctx.lineWidth = 1;
      ctx.beginPath(); var st2 = false;
      for (i = 0; i < n; i++) {
        if (v5[i] === null) continue;
        var X2 = px(i), Y2 = y0 + H - v5[i] / vMax * H;
        if (!st2) { ctx.moveTo(X2, Y2); st2 = true; } else ctx.lineTo(X2, Y2);
      }
      ctx.stroke();
    } else if (type === 'macd') {
      var mc = g.mc;
      if (!mc) return;
      var mx = 0;
      for (var i = 0; i < n; i++) {
        mx = Math.max(mx, Math.abs(mc.hist[i]), Math.abs(mc.dif[i]), Math.abs(mc.dea[i]));
      }
      if (mx <= 0) mx = 1;
      yScale(-mx, mx, function (v) { return fmt(v, 1); });
      var my = function (v) { return y0 + H / 2 - v / mx * (H / 2 - 2); };
      // 零轴
      ctx.strokeStyle = C.axis;
      ctx.beginPath(); ctx.moveTo(x0, Math.round(my(0)) + 0.5); ctx.lineTo(x0 + plotW, Math.round(my(0)) + 0.5); ctx.stroke();
      for (i = 0; i < n; i++) {
        ctx.fillStyle = mc.hist[i] >= 0 ? C.up : C.down;
        var h0 = my(0), h1 = my(mc.hist[i]);
        ctx.fillRect(px(i) - bw / 2, Math.min(h0, h1), bw, Math.max(Math.abs(h1 - h0), 0.8));
      }
      var line = function (arr, color) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (var j = 0; j < n; j++) {
          var X = px(j), Y = my(arr[j]);
          if (j === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      };
      line(mc.dif, C.dif);
      line(mc.dea, C.dea);
    } else if (type === 'kdj') {
      var kd = g.kd;
      if (!kd) return;
      var ky = function (v) { return y0 + (100 - Math.max(-20, Math.min(120, v))) / 140 * H; };
      yScale(-20, 120, function (v) { return Math.round(v); });
      // 参考线 20/50/80
      ctx.strokeStyle = C.axis;
      [20, 50, 80].forEach(function (lv) {
        ctx.beginPath();
        ctx.moveTo(x0, Math.round(ky(lv)) + 0.5);
        ctx.lineTo(x0 + plotW, Math.round(ky(lv)) + 0.5);
        ctx.stroke();
      });
      var kline = function (arr, color) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.1;
        ctx.beginPath();
        for (var j = 0; j < n; j++) {
          var X = px(j), Y = ky(arr[j]);
          if (j === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
        ctx.stroke();
      };
      kline(kd.k, C.ma5);
      kline(kd.d, C.ma20);
      kline(kd.j, C.ma60);
    }

    // X 轴日期（只在最底部面板画）
    if (g.isLast) {
      ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      var lastMon = '';
      var xAxisY = y0 + H + 4;
      for (var i = 0; i < n; i++) {
        var mon = g.dates[i].slice(4, 6);
        if (mon !== lastMon && i > n * 0.04 && i < n * 0.97) {
          lastMon = mon;
          ctx.fillText(mon + '月', px(i), xAxisY);
        }
      }
    }

    // 十字光标（只画在主图 + 当前副图所在面板）
    var cross = g.cross;
    if (cross !== null && cross >= 0 && cross < n) {
      // 垂直虚线贯穿所有面板（跨面板画一次，这里在每个面板都画竖线）
      ctx.strokeStyle = C.cross; ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);
      var cx = px(cross);
      ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y0 + H); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 十字光标提示框（多行：OHLC+涨跌 / 成交量 / MACD / KDJ）
  function drawCrossTip(ctx, cssW, bars, dates, cross, sub) {
    if (cross === null || cross < 0 || cross >= bars.length) return;
    var b = bars[cross];
    var col2 = b[4] >= b[1] ? C.up : C.down;
    var chg = '';
    if (cross > 0 && bars[cross - 1][4] > 0) {
      var pct = (b[4] - bars[cross - 1][4]) / bars[cross - 1][4] * 100;
      chg = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    }

    // 计算 MACD / KDJ（用 bars 全量数据）
    var closes = bars.map(function (x) { return x[4]; });
    var highs = bars.map(function (x) { return x[2]; });
    var lows = bars.map(function (x) { return x[3]; });
    var mc = macdOf(closes);
    var kd = kdjOf(highs, lows, closes, 9);

    // 量能比：今日成交量 / 前5日均量
    var volRatio = null;
    if (cross >= 5) {
      var sum5 = 0;
      for (var t = cross - 5; t < cross; t++) sum5 += bars[t][5];
      var avg5 = sum5 / 5;
      if (avg5 > 0) volRatio = b[5] / avg5;
    }

    var lines = [];
    // 第1行：日期 + OHLC + 涨跌
    lines.push({ t: dates[cross].slice(4) + '  开' + fmt(b[1]) + ' 高' + fmt(b[2]) + ' 低' + fmt(b[3]) + ' 收' + fmt(b[4]), c: '#fff' });
    lines.push({ t: '涨跌 ' + chg, c: col2 });
    // 第2行：成交量 + 量能比
    var volTxt = '成交量 ' + fmtVol(b[5]);
    if (volRatio !== null) {
      var vrLabel = volRatio >= 1.5 ? '放量' : (volRatio >= 1.0 ? '温和放量' : (volRatio >= 0.8 ? '缩量' : '地量'));
      volTxt += '  量比 ' + volRatio.toFixed(2) + '（' + vrLabel + '）';
    }
    lines.push({ t: volTxt, c: col2 });
    // 第3行：MACD
    lines.push({ t: 'MACD  DIF ' + fmt(mc.dif[cross]) + '  DEA ' + fmt(mc.dea[cross]) + '  柱 ' + fmt(mc.hist[cross]), c: mc.hist[cross] >= 0 ? C.up : C.down });
    // 第4行：KDJ
    lines.push({ t: 'KDJ  K ' + fmt(kd.k[cross], 1) + '  D ' + fmt(kd.d[cross], 1) + '  J ' + fmt(kd.j[cross], 1), c: '#fff' });

    ctx.font = '10.5px -apple-system,system-ui,sans-serif';
    var maxW = 0;
    lines.forEach(function (l) { maxW = Math.max(maxW, ctx.measureText(l.t).width); });
    var tw = maxW + 16;
    var th = lines.length * 15 + 8;
    var bx = Math.min(Math.max(4 - tw / 2, 2), cssW - tw - 2);
    ctx.fillStyle = 'rgba(22,24,29,.35)';
    ctx.fillRect(bx, 2, tw, th);
    lines.forEach(function (l, i) {
      ctx.fillStyle = l.c;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(l.t, bx + 8, 6 + i * 15);
    });
  }

  /** 绑定触摸/鼠标十字光标，回调返回当前索引 */
  function bindCross(cv, getBars, onMove) {
    var cur = null;
    function calc(clientX) {
      var r = cv.getBoundingClientRect();
      var w = r.width - 4 - 46;
      var i = Math.floor((clientX - r.left - 4) / (w / getBars().length));
      return Math.max(0, Math.min(getBars().length - 1, i));
    }
    function move(e) {
      var t = e.touches ? e.touches[0] : e;
      if (!t) return;
      cur = calc(t.clientX);
      if (onMove) onMove(cur);
    }
    function end() { cur = null; if (onMove) onMove(null); }
    cv.addEventListener('touchstart', move, { passive: true });
    cv.addEventListener('touchmove', move, { passive: true });
    cv.addEventListener('touchend', end);
    cv.addEventListener('mousemove', move);
    cv.addEventListener('mouseleave', end);
  }

  /** H5 便捷入口 */
  function draw(cv, bars, opt) {
    opt = opt || {};
    var sub = opt.sub || 'vol';
    var dpr = opt.dpr || (global.devicePixelRatio || 1);
    var cssW = cv.clientWidth || opt.width || 340;
    var cssH = opt.height || (sub === 'all' ? 480 : (sub === 'none' ? 170 : 250));
    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    if (cv.style) cv.style.height = cssH + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOn(ctx, cssW, cssH, bars, opt);
    // 十字光标提示框画在顶部
    if (opt.cross !== undefined && opt.cross !== null) {
      var dates = bars.map(function (b) { return b[0]; });
      drawCrossTip(ctx, cssW, bars, dates, opt.cross, sub);
    }
  }

  global.KChart = {
    draw: draw, drawOn: drawOn, bindCross: bindCross,
    ma: maLine, ema: ema, macd: macdOf, kdj: kdjOf,
    fmtVol: fmtVol, fmt: fmt, C: C
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));

if (typeof module !== 'undefined' && module.exports) {
  var _g = typeof window !== 'undefined' ? window : globalThis;
  module.exports = _g.KChart;
}
