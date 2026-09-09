/* =========================================================================
 * app.js —— 板块罗盘 主逻辑
 * 数据：window.APP_DATA = { asOf, count, items:[...], klines:{code:[bars]} }
 * ========================================================================= */
(function () {
  'use strict';

  var D = window.APP_DATA || { items: [], klines: {} };
  var ITEMS = D.items || [];
  var KL = D.klines || {};
  var SHORT = D.short || [];
  var SHORT_TS = D.shortTs || '';
  var MARKET_PCT = D.marketPct;
  var GLOBAL = D.global || {};       // { sym: {name, price, chgPct, ...} }
  var GKL = D.globalKlines || {};    // { sym: [[date,o,h,l,c,v],...] }
  var GLOBAL_ORDER = [['usNDX', '纳斯达克100'], ['usIXIC', '纳斯达克'],
                      ['usINX', '标普500'], ['hf_XAU', '伦敦金']];
  var gdetail = { sym: null, period: 120, cross: null };

  var CATS = ['全部', '规模', '行业', '主题', '策略', '风格', '综合'];
  var SORTS = {
    trend: [
      { k: 'score', t: '综合评分' },
      { k: 'r20', t: '20日涨幅' },
      { k: 'r60', t: '60日涨幅' },
      { k: 'rsi', t: 'RSI强度' }
    ],
    bottom: [
      { k: 'score', t: '见底评分' },
      { k: 'dd', t: '回撤深度' },
      { k: 'vol', t: '量能萎缩' },
      { k: 'rsi', t: 'RSI超卖' }
    ],
    short: [
      { k: 'score', t: '短线评分' },
      { k: 'chg', t: '当日涨幅' },
      { k: 'vr', t: '量比' },
      { k: 'turnover', t: '换手率' }
    ]
  };
  var HINTS = {
    trend: '做多动量榜：均线多头排列 + 动量强化 + MACD 走强 + 上涨放量，找趋势已经走出来的板块。评分越高趋势越健康，但注意高位追高风险。',
    bottom: '超跌见底榜：深度回撤 + RSI/KDJ 超卖 + 地量缩量（抛压衰竭）+ 放量启动信号。评分高只代表「下跌动能耗尽」，不等于立即反转，需要等右侧确认。',
    short: '短线榜：当日涨跌幅 + 量比（放量强度）+ 换手率（活跃度）+ 相对大盘强度，找今日资金活跃、动能强的板块，适合短线博弈。评分高=今日动能足，不等于明天必涨。'
  };

  var S = { rank: 'trend', cat: '全部', sort: 'score', q: '' };
  var detail = { code: null, period: 120, sub: 'all', cross: null };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function cls(v) { return v > 0 ? 'up' : (v < 0 ? 'down' : 'flat'); }
  function sign(v, d) { return (v > 0 ? '+' : '') + Number(v).toFixed(d === undefined ? 2 : d); }
  function fmtDate(s) {
    return s ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : '--';
  }

  /* ---------------- 列表 ---------------- */

  function matchQ(x) {
    if (!S.q) return true;
    var q = S.q.trim().toLowerCase();
    return (x.name || '').toLowerCase().indexOf(q) >= 0 ||
      (x.code || '').indexOf(S.q.trim()) >= 0;
  }

  function visible() {
    // 短线榜用独立数据源
    if (S.rank === 'short') {
      var arr = SHORT.filter(function (x) {
        // "实时"/"未实时"是特殊筛选，不按 cat 匹配
        if (S.cat === '实时') return x.live === true && matchQ(x);
        if (S.cat === '未实时') return x.live !== true && matchQ(x);
        return (S.cat === '全部' || x.cat === S.cat) && matchQ(x);
      });
      arr.sort(function (a, b) {
        if (S.sort === 'score') return b.shortScore - a.shortScore;
        if (S.sort === 'chg') return b.chgPct - a.chgPct;
        if (S.sort === 'vr') return b.volRatio - a.volRatio;
        if (S.sort === 'turnover') return b.turnover - a.turnover;
        return 0;
      });
      return arr;
    }
    var arr = ITEMS.filter(function (x) {
      return (S.cat === '全部' || x.cat === S.cat) && matchQ(x);
    });
    var key = S.rank === 'trend' ? 'trendScore' : 'bottomScore';
    arr.sort(function (a, b) {
      if (S.sort === 'score') return b[key] - a[key];
      if (S.sort === 'r20') return b.ret20 - a.ret20;
      if (S.sort === 'r60') return b.ret60 - a.ret60;
      if (S.sort === 'dd') return a.dd60 - b.dd60;
      if (S.sort === 'vol') return (a.volShrink === null ? 9 : a.volShrink) - (b.volShrink === null ? 9 : b.volShrink);
      if (S.sort === 'rsi') return (a.rsi14 === null ? 999 : a.rsi14) - (b.rsi14 === null ? 999 : b.rsi14);
      return 0;
    });
    return arr;
  }

  function barColor(v, rank) {
    var a = rank === 'trend' ? ['#f97316', '#dc2626'] : ['#14b8a6', '#0f766e'];
    var t = Math.max(0, Math.min(1, v / 100));
    return 'linear-gradient(90deg,' + a[0] + ',' + a[1] + ')';
  }

  function cardHTML(x, i) {
    var rank = S.rank;
    // 短线榜：独立渲染
    if (rank === 'short') {
      var sc = x.shortScore;
      var color = 'var(--brand)';
      var m = function (label, val, v) {
        return '<span>' + label + ' <b class="' + (v === undefined ? '' : cls(v)) + '">' + val + '</b></span>';
      };
      var metrics = m('当日', sign(x.chgPct, 2) + '%', x.chgPct) +
        m('量比', x.volRatio != null ? x.volRatio.toFixed(2) : '-') +
        m('换手', x.turnover != null ? x.turnover.toFixed(2) + '%' : '-') +
        m('振幅', x.amplitude != null ? x.amplitude.toFixed(2) + '%' : '-');
      var rel = x.chgPct - (MARKET_PCT || 0);
      var why = (x.reasons || []).slice(0, 3).map(function (r) {
        return '<li>' + esc(r) + '</li>';
      }).join('');
      return '<div class="card" data-code="' + x.code + '" data-short="1">' +
        '<div class="c-head">' +
          '<span class="c-rank">' + (i + 1) + '</span>' +
          '<span class="c-name">' + esc(x.name) + '</span>' +
          '<span class="c-code">' + x.code + '</span>' +
          '<span class="c-score" style="color:' + color + '">' + sc.toFixed(1) + '<small>分</small></span>' +
        '</div>' +
        '<div class="c-mid">' +
          '<span class="c-price ' + cls(x.chgPct) + '">' + sign(x.chgPct, 2) + '%</span>' +
          '<span class="c-chg ' + (rel >= 0 ? 'up' : 'down') + '">' + (rel >= 0 ? '跑赢' : '跑输') + '大盘 ' + Math.abs(rel).toFixed(2) + '%</span>' +
          '<span class="c-tag" style="color:' + color + ';background:#eef2ff">' + esc(x.signal) + '</span>' +
          (x.live === false ? '<span class="c-tag c-live" title="盘中非实时，显示最近交易日收盘数据">未实时</span>' : '') +
          '<span class="c-tag">' + esc(x.cat) + '</span>' +
        '</div>' +
        '<div class="c-bar"><i style="width:' + Math.max(2, sc) + '%;background:linear-gradient(90deg,#3b82f6,#1d4ed8)"></i></div>' +
        '<div class="c-metrics">' + metrics + '</div>' +
        (why ? '<ul class="c-why">' + why + '</ul>' : '') +
        '</div>';
    }

    var score = rank === 'trend' ? x.trendScore : x.bottomScore;
    var reasons = (rank === 'trend' ? x.trendReasons : x.bottomReasons) || [];
    var color = rank === 'trend' ? 'var(--hot)' : 'var(--cool)';

    var metrics = '';
    function m(label, val, v) {
      return '<span>' + label + ' <b class="' + (v === undefined ? '' : cls(v)) + '">' + val + '</b></span>';
    }
    if (rank === 'trend') {
      metrics = m('20日', sign(x.ret20, 1) + '%', x.ret20) +
        m('60日', sign(x.ret60, 1) + '%', x.ret60) +
        m('年内位置', x.pos250 === null ? '-' : x.pos250.toFixed(0) + '%') +
        m('量比', x.volRatio === null ? '-' : x.volRatio.toFixed(2));
    } else {
      metrics = m('60日回撤', sign(x.dd60, 1) + '%', x.dd60) +
        m('年内回撤', sign(x.dd250, 1) + '%', x.dd250) +
        m('RSI', x.rsi14 === null ? '-' : x.rsi14.toFixed(0)) +
        m('量能比', x.volShrink === null ? '-' : x.volShrink.toFixed(2));
    }
    // 估值信息（两榜都展示）
    if (x.pe !== null && x.pe !== undefined) {
      metrics += m('PE', x.pe.toFixed(1) + '×', null);
    }
    if (x.dp !== null && x.dp !== undefined) {
      metrics += m('股息', x.dp.toFixed(2) + '%', null);
    }

    var why = reasons.length
      ? '<ul class="c-why">' + reasons.slice(0, 3).map(function (r) {
        return '<li>' + esc(r) + '</li>';
      }).join('') + '</ul>'
      : '';

    return '<div class="card" data-code="' + x.code + '">' +
      '<div class="c-head">' +
        '<span class="c-rank">' + (i + 1) + '</span>' +
        '<span class="c-name">' + esc(x.name) + '</span>' +
        '<span class="c-code">' + x.code + '</span>' +
        '<span class="c-score" style="color:' + color + '">' + score.toFixed(1) + '<small>分</small></span>' +
      '</div>' +
      '<div class="c-mid">' +
        '<span class="c-price ' + cls(x.chg1) + '">' + x.close.toFixed(2) + '</span>' +
        '<span class="c-chg ' + cls(x.chg1) + '">' + sign(x.chg1) + '%</span>' +
        '<span class="c-tag" style="color:' + color + ';background:' +
          (rank === 'trend' ? '#fff5ef' : '#f0fdfa') + '">' + x.signal + '</span>' +
        '<span class="c-tag">' + esc(x.cat) + '</span>' +
      '</div>' +
      '<div class="c-bar"><i style="width:' + Math.max(2, score) + '%;background:' +
        barColor(score, rank) + '"></i></div>' +
      '<div class="c-metrics">' + metrics + '</div>' +
      why +
      '</div>';
  }

  function renderGlobal() {
    var el = $('globalBar');
    if (!el) return;
    var html = GLOBAL_ORDER.map(function (pair) {
      var sym = pair[0], fallbackName = pair[1];
      var g = GLOBAL[sym];
      if (!g) return '';
      var name = g.name || fallbackName;
      var price = g.price;
      var chgPct = g.chgPct;
      var c = chgPct > 0 ? 'up' : (chgPct < 0 ? 'down' : 'flat');
      var pStr = price === null || price === undefined ? '--'
        : Number(price).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var chgStr = chgPct === null || chgPct === undefined ? '--'
        : (chgPct > 0 ? '+' : '') + Number(chgPct).toFixed(2) + '%';
      // 显示「MM-DD HH:MM」（北京时间）
      var tm = '';
      var d = g.date || '';
      var t = (g.time || '').slice(0, 5);
      if (d || t) {
        tm = (d ? d.slice(5) : '') + (t ? ' ' + t : '');
      }
      return '<div class="gq" data-sym="' + sym + '">' +
        '<div class="gq-name">' + esc(name) + '</div>' +
        '<div class="gq-price ' + c + '">' + pStr + '</div>' +
        '<div class="gq-chg ' + c + '">' + chgStr + '</div>' +
        (tm ? '<div class="gq-time">' + esc(tm) + '</div>' : '') +
        '</div>';
    }).join('');
    el.innerHTML = html || '<div class="gq"><div class="gq-name">全球行情加载中…</div></div>';
  }

  function gBars() {
    return (GKL[gdetail.sym] || []).slice(-gdetail.period);
  }

  function drawGlobalChart() {
    var cv = $('gkcv');
    if (!cv) return;
    var bars = gBars();
    window.KChart.draw(cv, bars, { sub: 'all', cross: gdetail.cross, height: 480 });
  }

  function openGlobalDetail(sym) {
    var g = GLOBAL[sym];
    if (!g) return;
    gdetail.sym = sym; gdetail.cross = null; gdetail.period = 120;
    var name = g.name || sym;
    var chgPct = g.chgPct;
    var c = chgPct > 0 ? 'up' : (chgPct < 0 ? 'down' : 'flat');
    var pStr = g.price == null ? '--' : Number(g.price).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var chgStr = chgPct == null ? '--' : (chgPct > 0 ? '+' : '') + Number(chgPct).toFixed(2) + '%';
    var hi = g.high == null ? '--' : Number(g.high).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var lo = g.low == null ? '--' : Number(g.low).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var bars = GKL[sym] || [];
    var hasK = bars.length >= 30;
    // 详情页时间：日期 + 时间（北京时间）
    var fullTime = ((g.date || '') + ' ' + (g.time || '')).trim();

    $('dName').textContent = name;
    $('dCode').textContent = sym + ' · 全球行情';
    $('dBody').innerHTML =
      '<div class="panel">' +
        '<div class="p-h"><b>实时行情</b><span style="font-size:11px;color:var(--t3)">' + esc(fullTime) + '</span></div>' +
        '<div class="gq-big">' +
          '<div class="gq-big-price ' + c + '">' + pStr + '</div>' +
          '<div class="gq-big-chg ' + c + '">' + chgStr + '</div>' +
        '</div>' +
        '<div class="kv">' +
          '<div><span>最高</span><em>' + hi + '</em></div>' +
          '<div><span>最低</span><em>' + lo + '</em></div>' +
          '<div><span>涨跌幅</span><em class="' + c + '">' + chgStr + '</em></div>' +
        '</div>' +
      '</div>' +
      (hasK
        ? '<div class="panel">' +
            '<div class="p-h"><b>走势</b>' +
              '<div class="segbar" id="gsegPeriod">' +
                [60, 120, 240, 320].map(function (p) {
                  return '<button class="seg' + (gdetail.period === p ? ' on' : '') + '" data-p="' + p + '">' + p + '日</button>';
                }).join('') +
              '</div>' +
            '</div>' +
            '<canvas id="gkcv"></canvas>' +
            '<div style="text-align:center;font-size:10.5px;color:var(--t3);margin-top:2px">长按图表查看每日明细（K线 · 成交量 · MACD · KDJ）</div>' +
          '</div>'
        : '<div class="panel"><div class="p-h"><b>走势</b></div>' +
            '<p style="font-size:12px;color:var(--t3);margin:0">暂无历史 K 线数据</p></div>') +
      '<div class="panel"><div class="p-h"><b>说明</b></div>' +
        '<p style="font-size:12px;color:var(--t2);line-height:1.7;margin:0">' +
        '海外指数与黄金为实时价格展示，未纳入 A 股板块的做多/超跌评分体系。' +
        '数据来自公开行情接口，仅供研究参考。</p></div>';
    $('detail').classList.add('show');
    document.body.style.overflow = 'hidden';

    // 绑定全球图表事件（周期切换 + 十字光标）
    if (hasK) {
      var gcv = $('gkcv');
      window.KChart.bindCross(gcv, gBars, function (i) {
        gdetail.cross = i;
        drawGlobalChart();
      });
      var gsp = $('gsegPeriod');
      if (gsp) gsp.onclick = function (e) {
        var b = e.target.closest('.seg'); if (!b) return;
        gdetail.period = +b.dataset.p; gdetail.cross = null;
        gsp.querySelectorAll('.seg').forEach(function (s) { s.classList.remove('on'); });
        b.classList.add('on');
        drawGlobalChart();
      };
      drawGlobalChart();
    }
  }

  function render() {
    var arr = visible();
    $('hint').textContent = HINTS[S.rank];
    var html;
    if (S.rank === 'short' && !arr.length) {
      html = S.q
        ? '<div class="empty">没有匹配「' + esc(S.q) + '」的指数</div>'
        : '<div class="empty">暂无短线数据<br>（短线榜需在交易日 14:40 后、16:00 盘后更新才生成）</div>';
    } else {
      html = arr.length
        ? arr.map(cardHTML).join('')
        : (S.q ? '<div class="empty">没有匹配「' + esc(S.q) + '」的指数</div>'
               : '<div class="empty">该分类下暂无数据</div>');
    }
    $('list').innerHTML = html;
    // Tab 数量标注
    var t1 = $('cntTrend'), t2 = $('cntBottom'), t3 = $('cntShort');
    if (t1) t1.textContent = ITEMS.length + ' 只 · 趋势走强';
    if (t2) t2.textContent = ITEMS.length + ' 只 · 地量待启';
    if (t3) t3.textContent = SHORT.length + ' 只 · 量价动能';
    if (S.rank === 'short') {
      $('tbStat').innerHTML = '短线榜 <b>' + SHORT.length + '</b> 只<br>长线榜 ' + ITEMS.length + ' 只';
      $('asOf').textContent = '数据生成 ' + (D.builtAt || '') + (SHORT_TS ? ' · 实时 ' + SHORT_TS.slice(11, 16) : '');
    } else {
      $('tbStat').innerHTML = '本榜 <b>' + arr.length + '</b> 只<br>共 ' + ITEMS.length + ' 只指数';
      $('asOf').textContent = '数据生成 ' + (D.builtAt || '');
    }
  }

  function renderChips() {
    // 短线榜额外加"实时"/"未实时"筛选：按盘中能否实时更新分组
    var cats = S.rank === 'short' ? CATS.concat(['实时', '未实时']) : CATS;
    $('catChips').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (S.cat === c ? ' on' : '') + '" data-cat="' + c + '">' + c + '</button>';
    }).join('');
    $('sortChips').innerHTML = SORTS[S.rank].map(function (s) {
      return '<button class="chip' + (S.sort === s.k ? ' on' : '') + '" data-sort="' + s.k + '">' + s.t + '</button>';
    }).join('');
  }

  /* ---------------- 详情 ---------------- */

  function openDetail(code) {
    var x = ITEMS.filter(function (v) { return v.code === code; })[0];
    if (!x) return;
    detail.code = code; detail.cross = null;

    $('dName').textContent = x.name;
    $('dCode').textContent = x.code + ' · ' + x.cat;

    var m = x.macd || {};
    var kv = [
      ['20日涨幅', sign(x.ret20, 1) + '%', x.ret20],
      ['60日涨幅', sign(x.ret60, 1) + '%', x.ret60],
      ['年内位置', x.pos250 === null ? '-' : x.pos250.toFixed(0) + '%', null],
      ['RSI14', x.rsi14 === null ? '-' : x.rsi14.toFixed(1), null],
      ['乖离率', x.bias20 === null ? '-' : sign(x.bias20, 1) + '%', x.bias20],
      ['60日回撤', sign(x.dd60, 1) + '%', x.dd60],
      ['年内回撤', sign(x.dd250, 1) + '%', x.dd250],
      ['量能比', x.volShrink === null ? '-' : x.volShrink.toFixed(2), null],
      ['MACD柱', m.hist === undefined ? '-' : sign(m.hist, 2), m.hist]
    ];
    // 估值字段（追加）
    if (x.pe !== null && x.pe !== undefined) {
      kv.push(['滚动PE', x.pe.toFixed(1) + '×', null]);
    }
    if (x.pePct !== null && x.pePct !== undefined) {
      var peCheap = x.pePct <= 25;
      var peLabel = x.pePctKind === 'history' ? 'PE历史分位' : 'PE横向分位';
      kv.push([peLabel, x.pePct.toFixed(0) + '%' + (peCheap ? ' 低' : ''), null]);
    }
    if (x.dp !== null && x.dp !== undefined) {
      kv.push(['股息率', x.dp.toFixed(2) + '%', null]);
    }

    var tr = (x.trendReasons || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');
    var br = (x.bottomReasons || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('');

    $('dBody').innerHTML =
      '<div class="panel">' +
        '<div class="d-price"><em class="' + cls(x.chg1) + '">' + x.close.toFixed(2) + '</em>' +
        '<span class="' + cls(x.chg1) + '">' + sign(x.chg1) + '%</span></div>' +
        '<div class="scorebox">' +
          '<div class="scorecard sc-trend"><em>' + x.trendScore.toFixed(1) + '</em>' +
            '<span>做多动量</span><i>' + (x.trendScore >= 65 ? '趋势确立' : x.trendScore >= 50 ? '偏强' : '偏弱') + '</i></div>' +
          '<div class="scorecard sc-bottom"><em>' + x.bottomScore.toFixed(1) + '</em>' +
            '<span>超跌见底</span><i>' + (x.bottomScore >= 60 ? '底部信号' : x.bottomScore >= 45 ? '有待确认' : '未见底') + '</i></div>' +
        '</div>' +
        '<div class="kv">' + kv.map(function (k) {
          return '<div><em class="' + (k[2] === null ? '' : cls(k[2])) + '">' + k[1] + '</em><span>' + k[0] + '</span></div>';
        }).join('') + '</div>' +
      '</div>' +

      '<div class="panel">' +
        '<div class="p-h"><b>走势</b>' +
          '<div class="segbar" id="segPeriod">' +
            [10, 30, 60, 120, 150].map(function (p) {
              return '<button class="seg' + (detail.period === p ? ' on' : '') + '" data-p="' + p + '">' + p + '日</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="p-h" style="margin-bottom:4px">' +
          '<div class="legend">' +
            '<span><i style="background:#f59e0b"></i>MA5</span>' +
            '<span><i style="background:#2563eb"></i>MA20</span>' +
            '<span><i style="background:#8b5cf6"></i>MA60</span>' +
          '</div>' +
          '<div class="legend" style="margin-left:auto">' +
            '<span>成交量 · MACD · KDJ</span>' +
          '</div>' +
        '</div>' +
        '<canvas id="kcv"></canvas>' +
        '<div style="text-align:center;font-size:10.5px;color:var(--t3);margin-top:2px">长按图表查看每日明细</div>' +
      '</div>' +

      (tr ? '<div class="panel"><div class="p-h"><b>做多动量依据</b></div><ul class="c-why" style="margin:0">' + tr + '</ul></div>' : '') +
      (br ? '<div class="panel"><div class="p-h"><b>超跌见底依据</b></div><ul class="c-why" style="margin:0">' + br + '</ul></div>' : '');

    bindDetailEvents();
    drawChart();
    $('detail').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function curBars() {
    return (KL[detail.code] || []).slice(-detail.period);
  }

  function drawChart() {
    var cv = $('kcv');
    if (!cv) return;
    // 传入全量 K 线作为 fullBars，保证短周期视图下 MA20/MA60 也能完整画出
    window.KChart.draw(cv, curBars(), { sub: detail.sub, cross: detail.cross, height: 480, fullBars: KL[detail.code] || [] });
  }

  function bindDetailEvents() {
    var cv = $('kcv');
    if (!cv) return;
    // 只绑定一次：bars 通过函数动态取，切换周期后索引依然正确
    window.KChart.bindCross(cv, curBars, function (i) {
      detail.cross = i;
      drawChart();
    });

    var sp = $('segPeriod');
    if (sp) sp.onclick = function (e) {
      var b = e.target.closest('.seg'); if (!b) return;
      detail.period = +b.dataset.p; detail.cross = null;
      sp.querySelectorAll('.seg').forEach(function (s) { s.classList.remove('on'); });
      b.classList.add('on');
      drawChart();
    };
  }

  function closeDetail() {
    $('detail').classList.remove('show');
    document.body.style.overflow = '';
  }

  /* ---------------- 实时更新 ---------------- */

  function updateRealTime() {
    var btn = $('btnUpdate'), info = $('updateInfo');
    if (!window.Realtime) {
      info.textContent = '实时模块未加载';
      return;
    }
    btn.classList.add('loading');
    btn.textContent = '更新中…';
    info.textContent = '正在拉取实时行情…';

    var codes = ITEMS.map(function (x) { return x.code; });
    window.Realtime.fetch(codes).then(function (rtMap) {
      var n = Object.keys(rtMap).length;
      if (n === 0) {
        btn.classList.remove('loading');
        btn.textContent = '↻ 更新实时数据';
        info.textContent = '拉取失败（非交易时段或网络问题）';
        return;
      }
      // 重算短线榜：腾讯实时数据覆盖 + 9系保留快照（腾讯拉不到的指数不丢）
      var mkt = window.Realtime.medianPct(rtMap);
      var liveShort = window.Realtime.buildShortList(rtMap, ITEMS, mkt);
      var liveMap = {};
      liveShort.forEach(function (x) { liveMap[x.code] = x; });
      // 快照里 9 系的短线数据保留（它们腾讯拉不到，但快照有）
      var snapshotMap = {};
      SHORT.forEach(function (x) { snapshotMap[x.code] = x; });
      // 合并：实时优先，快照兜底
      var merged = ITEMS.map(function (x) {
        return liveMap[x.code] || snapshotMap[x.code] || null;
      }).filter(Boolean);
      merged.sort(function (a, b) { return b.shortScore - a.shortScore; });
      SHORT = merged;
      MARKET_PCT = Math.round(mkt * 100) / 100;
      SHORT_TS = new Date().toLocaleTimeString('zh-CN', { hour12: false });

      render();
      btn.classList.remove('loading');
      btn.textContent = '↻ 更新实时数据';
      info.textContent = '已更新 ' + n + ' 只 · ' + SHORT_TS;

      // 同时刷新全球行情（海外指数 + 黄金）
      if (window.Realtime.fetchGlobal) {
        window.Realtime.fetchGlobal().then(function (gMap) {
          if (gMap && Object.keys(gMap).length) {
            Object.keys(gMap).forEach(function (k) { GLOBAL[k] = gMap[k]; });
            renderGlobal();
          }
        }).catch(function () { /* 全球行情拉取失败忽略 */ });
      }
    }).catch(function (e) {
      btn.classList.remove('loading');
      btn.textContent = '↻ 更新实时数据';
      info.textContent = '更新失败：' + (e && e.message ? e.message : '网络错误');
    });
  }

  /* ---------------- 事件 ---------------- */

  function bind() {
    $('tabs').onclick = function (e) {
      var t = e.target.closest('.tab'); if (!t) return;
      S.rank = t.dataset.rank; S.sort = 'score';
      if (S.cat === '实时' || S.cat === '未实时') S.cat = '全部';  // 切榜时重置筛选
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      renderChips(); render();
    };
    $('catChips').onclick = function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      S.cat = b.dataset.cat;
      renderChips(); render();
    };
    $('sortChips').onclick = function (e) {
      var b = e.target.closest('.chip'); if (!b) return;
      S.sort = b.dataset.sort;
      renderChips(); render();
    };
    $('list').onclick = function (e) {
      var c = e.target.closest('.card'); if (!c) return;
      openDetail(c.dataset.code);
    };
    // 搜索
    var si = $('searchInput'), sc = $('searchClear');
    si.oninput = function () {
      S.q = si.value;
      sc.style.display = si.value ? 'block' : 'none';
      render();
    };
    sc.onclick = function () {
      si.value = ''; S.q = ''; sc.style.display = 'none'; render();
    };
    $('btnBack').onclick = closeDetail;
    $('btnUpdate').onclick = updateRealTime;
    // 全球行情卡片点击 → 轻量详情
    $('globalBar').onclick = function (e) {
      var g = e.target.closest('.gq'); if (!g) return;
      openGlobalDetail(g.dataset.sym);
    };
    window.addEventListener('resize', function () {
      if (detail.code && $('detail').classList.contains('show')) drawChart();
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    if (!ITEMS.length) {
      $('list').innerHTML = '<div class="loading">未加载到数据<br>请先运行 etl 目录下的采集脚本</div>';
      return;
    }
    renderChips(); render(); renderGlobal(); bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else boot();
})();
