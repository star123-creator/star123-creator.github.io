/* =========================================================================
 * rt.js —— 实时行情模块（浏览器端直接拉腾讯行情）
 *
 * 腾讯 qt.gtimg.cn 接口返回 Access-Control-Allow-Origin:*，浏览器可跨域直连。
 * 这里实现：批量拉实时行情 + 短线量价动能评分（与后端 short_scan.py 同逻辑）
 * ========================================================================= */
(function (global) {
  'use strict';

  var TX = 'https://qt.gtimg.cn/q=';

  function txSymbol(code) {
    if (code.slice(0, 2) === '39' || code.slice(0, 2) === '98') return 'sz' + code;
    if (code[0] === '8') return 'bj' + code;
    return 'sh' + code;
  }

  function f(s, i, def) {
    var v = s[i];
    if (v === undefined || v === '' || v === '-' || v === '0.00') return def;
    var n = parseFloat(v);
    return isNaN(n) ? def : n;
  }

  function parseOne(line) {
    var parts = line.split('"');
    if (parts.length < 2) return null;
    var s = parts[1].split('~');
    if (s.length < 50) return null;
    return {
      code: s[2],
      name: s[1],
      price: f(s, 3),
      chgPct: f(s, 32),
      high: f(s, 33),
      low: f(s, 34),
      turnover: f(s, 38),
      pe: f(s, 39),
      amplitude: f(s, 43),
      volRatio: f(s, 49)
    };
  }

  /** 批量拉取实时行情，返回 {code: item} */
  function fetchRealTime(codes) {
    var all = codes.slice();
    var chunks = [];
    for (var i = 0; i < all.length; i += 60) chunks.push(all.slice(i, i + 60));

    var jobs = chunks.map(function (chunk) {
      var syms = chunk.map(txSymbol).join(',');
      // 腾讯接口 GBK 编码，用 arrayBuffer + TextDecoder('gbk') 避免中文乱码
      return fetch(TX + syms).then(function (r) { return r.arrayBuffer(); })
        .then(function (buf) { return new TextDecoder('gbk').decode(buf); });
    });

    return Promise.all(jobs).then(function (texts) {
      var out = {};
      texts.forEach(function (text) {
        text.split(';').forEach(function (line) {
          if (line.indexOf('"') < 0) return;
          var item = parseOne(line);
          if (item) out[item.code] = item;
        });
      });
      return out;
    });
  }

  /* ---- 短线量价动能评分（与 etl/short_scan.py 一致） ---- */

  function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function scoreShort(rt, marketPct) {
    var s = 0, reasons = [];
    var chg = rt.chgPct || 0;
    var vr = rt.volRatio || 0;
    var to = rt.turnover || 0;
    var amp = rt.amplitude || 0;

    // 1) 日内动能 30
    if (chg >= 5) { s += 30; reasons.push('大涨 ' + chg.toFixed(2) + '%（强动能）'); }
    else if (chg >= 3) { s += 26; reasons.push('涨 ' + chg.toFixed(2) + '%（动能足）'); }
    else if (chg >= 1.5) { s += 20; reasons.push('涨 ' + chg.toFixed(2) + '%'); }
    else if (chg >= 0.5) { s += 13; }
    else if (chg > 0) { s += 8; }
    else { reasons.push('下跌 ' + chg.toFixed(2) + '%'); }

    // 2) 放量强度 25
    if (vr >= 2.0) { s += 25; reasons.push('量比 ' + vr.toFixed(2) + ' 显著放量'); }
    else if (vr >= 1.5) { s += 20; reasons.push('量比 ' + vr.toFixed(2) + ' 放量'); }
    else if (vr >= 1.2) { s += 15; reasons.push('量比 ' + vr.toFixed(2) + ' 温和放量'); }
    else if (vr >= 0.9) { s += 8; }
    else { reasons.push('量比 ' + vr.toFixed(2) + ' 缩量'); }

    // 3) 活跃度 20（指数口径）
    if (to >= 3) { s += 18; reasons.push('换手 ' + to.toFixed(2) + '% 极活跃'); }
    else if (to >= 1.8) { s += 15; reasons.push('换手 ' + to.toFixed(2) + '% 活跃'); }
    else if (to >= 1.0) { s += 11; reasons.push('换手 ' + to.toFixed(2) + '% 适中'); }
    else if (to >= 0.5) { s += 6; }
    else { reasons.push('换手 ' + to.toFixed(2) + '% 偏低'); }
    if (amp >= 5) s += 3;
    else if (amp >= 3) s += 2;

    // 4) 相对强度 25
    var rel = chg - marketPct;
    if (rel >= 2) { s += 25; reasons.push('跑赢大盘 ' + rel.toFixed(2) + '%'); }
    else if (rel >= 1) { s += 19; reasons.push('跑赢大盘 ' + rel.toFixed(2) + '%'); }
    else if (rel >= 0.3) { s += 13; }
    else if (rel >= -0.5) { s += 7; }
    else { reasons.push('跑输大盘 ' + rel.toFixed(2) + '%'); }

    return { score: Math.round(Math.min(s, 100) * 10) / 10, reasons: reasons };
  }

  function signalOf(score, chg) {
    if (score >= 70) return '短线强势';
    if (score >= 55) return '短线可关注';
    if (score >= 40) return '活跃';
    if (chg > 0) return '温和';
    return '弱势';
  }

  /** 由实时行情计算短线榜（items 为指数元信息列表） */
  function buildShortList(rtMap, items, marketPct) {
    return items.map(function (x) {
      var rt = rtMap[x.code];
      if (!rt) return null;
      var sc = scoreShort(rt, marketPct);
      return {
        code: x.code,
        name: x.name,
        cat: x.cat,
        chgPct: Math.round((rt.chgPct || 0) * 100) / 100,
        volRatio: Math.round((rt.volRatio || 0) * 100) / 100,
        turnover: Math.round((rt.turnover || 0) * 100) / 100,
        amplitude: Math.round((rt.amplitude || 0) * 100) / 100,
        pe: rt.pe || null,
        shortScore: sc.score,
        signal: signalOf(sc.score, rt.chgPct || 0),
        live: true,       // 浏览器直连腾讯=盘中实时
        reasons: sc.reasons
      };
    }).filter(Boolean).sort(function (a, b) { return b.shortScore - a.shortScore; });
  }

  /** 计算大盘基准（全体涨跌幅中位数） */
  function medianPct(rtMap) {
    var arr = Object.keys(rtMap).map(function (k) { return rtMap[k].chgPct || 0; }).sort(function (a, b) { return a - b; });
    return arr[Math.floor(arr.length / 2)];
  }

  /* ---- 全球行情（海外指数 + 黄金）---- */

  // 美东时间(EDT)字符串 "YYYY-MM-DD HH:MM:SS" -> 北京时间 {date, time}（+12h）
  function usTimeToCn(raw) {
    if (!raw || raw.indexOf(' ') < 0) return { date: '', time: '' };
    var parts = raw.split(' ');
    var d = parts[0], t = parts[1];
    var dp = d.split('-').map(Number);
    var tp = t.split(':').map(Number);
    var dt = new Date(dp[0], dp[1] - 1, dp[2], tp[0], tp[1], tp[2]);
    dt.setHours(dt.getHours() + 12);  // EDT -> 北京时间
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return {
      date: dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()),
      time: p2(dt.getHours()) + ':' + p2(dt.getMinutes())
    };
  }

  function parseGold(line) {
    var parts = line.split('"');
    if (parts.length < 2) return null;
    var p = parts[1].split(',');
    if (p.length < 13) return null;
    var price = f(p, 0), chg = f(p, 1);
    var chgPct = null;
    if (price !== null && chg !== null && (price - chg) !== 0) {
      chgPct = Math.round(chg / (price - chg) * 10000) / 100;
    }
    return {
      name: p[13] || '黄金',
      price: price,
      chgPct: chgPct,
      high: f(p, 4),
      low: f(p, 5),
      date: p[12] || '',   // 黄金日期已是北京时间
      time: (p[6] || '').slice(0, 5)
    };
  }

  /** 拉取全球行情，返回 {sym: item}，sym 为 usNDX/usIXIC/usINX/hf_XAU */
  function fetchGlobal() {
    var syms = ['usNDX', 'usIXIC', 'usINX', 'hf_XAU'];
    // 腾讯接口返回 GBK 编码，需用 TextDecoder('gbk') 解码，否则中文名称乱码
    return fetch(TX + syms.join(',')).then(function (r) {
      return r.arrayBuffer();
    }).then(function (buf) {
      var text = new TextDecoder('gbk').decode(buf);
      var out = {};
      text.split(';').forEach(function (line) {
        line = line.trim();
        if (line.indexOf('"') < 0) return;
        var key = line.split('=')[0];
        var sym = key.indexOf('v_') === 0 ? key.slice(2) : key;
        if (sym === 'hf_XAU') {
          var g = parseGold(line);
          if (g) out[sym] = g;
        } else if (sym === 'usIXIC' || sym === 'usINX' || sym === 'usNDX') {
          var parts = line.split('"');
          if (parts.length < 2) return;
          var s = parts[1].split('~');
          if (s.length < 50) return;
          var cn = usTimeToCn(s[30] || '');
          out[sym] = {
            name: s[1],
            price: f(s, 3),
            chgPct: f(s, 32),
            high: f(s, 33),
            low: f(s, 34),
            date: cn.date,
            time: cn.time
          };
        }
      });
      return out;
    });
  }

  global.Realtime = {
    fetch: fetchRealTime,
    fetchGlobal: fetchGlobal,
    scoreShort: scoreShort,
    buildShortList: buildShortList,
    medianPct: medianPct
  };
})(window);
