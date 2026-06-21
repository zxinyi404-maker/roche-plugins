(function () {
  "use strict";

  var PLUGIN_ID = "xhs-reader";

  // ============ 配置区 ============
  var CONFIG = {
    serverUrl: "http://182.92.218.147:18080",
    searchTriggers: ["搜一下", "搜索小红书", "小红书搜", "找找小红书"],
    showToast: true,
  };
  // ================================

  var XHS_URL_REGEX = /https?:\/\/(www\.)?xiaohongshu\.com\/[^\s\u4e00-\u9fa5"']+/gi;
  var XHS_SHORT_REGEX = /https?:\/\/xhslink\.com\/[^\s"']+/gi;

  function toast(msg) {
    if (!CONFIG.showToast) return;
    var el = document.createElement("div");
    el.textContent = msg;
    Object.assign(el.style, {
      position: "fixed", bottom: "80px", left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.75)", color: "#fff",
      padding: "8px 16px", borderRadius: "20px",
      fontSize: "13px", zIndex: 9999,
      pointerEvents: "none",
    });
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2500);
  }

  async function fetchService(path) {
    var url = CONFIG.serverUrl.replace(/\/$/, "") + path;
    var resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    return resp.json();
  }

  function formatNote(data) {
    if (!data.ok) return "[小红书读取失败: " + data.error + "]";
    var tags = data.tags && data.tags.length ? "标签: " + data.tags.join(" ") : "";
    return [
      "📕 【小红书笔记】",
      "标题: " + (data.title || "无标题"),
      "作者: " + (data.author || "未知"),
      "👍 " + data.likes + "  ⭐ " + data.collects + "  💬 " + data.comments,
      tags,
      "",
      "正文:",
      data.content || "（无正文）",
    ].filter(Boolean).join("\n");
  }

  function formatSearch(data, keyword) {
    if (!data.ok) return "[小红书搜索失败: " + data.error + "]";
    if (!data.notes || !data.notes.length) return "[小红书搜索\"" + keyword + "\"无结果]";
    var lines = ["📕 【小红书搜索: " + keyword + "】\n"];
    data.notes.forEach(function (n, i) {
      lines.push((i + 1) + ". " + n.title);
      lines.push("   作者: " + n.author + "  👍 " + n.likes);
      lines.push("   " + n.url);
    });
    return lines.join("\n");
  }

  async function processMessage(text) {
    var injections = [];

    var urls = [
      ...(text.match(XHS_URL_REGEX) || []),
      ...(text.match(XHS_SHORT_REGEX) || []),
    ];

    for (var url of urls) {
      toast("正在读取小红书笔记…");
      try {
        var encoded = encodeURIComponent(url);
        var data = await fetchService("/read?url=" + encoded);
        injections.push(formatNote(data));
      } catch (e) {
        injections.push("[小红书读取出错: " + e.message + "]");
      }
    }

    for (var trigger of CONFIG.searchTriggers) {
      if (text.includes(trigger)) {
        var idx = text.indexOf(trigger) + trigger.length;
        var keyword = text.slice(idx).replace(/[：:，,。.！!？?\s]+$/, "").trim().split(/[，,\s]/)[0];
        if (keyword) {
          toast("正在搜索小红书: " + keyword);
          try {
            var searchData = await fetchService("/search?q=" + encodeURIComponent(keyword));
            injections.push(formatSearch(searchData, keyword));
          } catch (e) {
            injections.push("[小红书搜索出错: " + e.message + "]");
          }
        }
        break;
      }
    }

    return injections;
  }

  // 注入到 Roche 的消息发送流程
  var _originalFetch = window.fetch;
  window.fetch = async function (input, init) {
    // 只拦截聊天 API 请求
    var url = typeof input === "string" ? input : input.url;
    if (url && (url.includes("/v1/messages") || url.includes("/chat/completions")) && init && init.body) {
      try {
        var body = JSON.parse(init.body);
        var messages = body.messages;
        if (messages && messages.length) {
          var last = messages[messages.length - 1];
          if (last.role === "user" && typeof last.content === "string") {
            var injections = await processMessage(last.content);
            if (injections.length) {
              var extra = "\n\n---\n[以下是系统自动读取的小红书内容，请据此回答]\n\n" + injections.join("\n\n---\n\n");
              messages[messages.length - 1] = Object.assign({}, last, { content: last.content + extra });
              init = Object.assign({}, init, { body: JSON.stringify(Object.assign({}, body, { messages: messages })) });
            }
          }
        }
      } catch (e) {
        console.warn("[xhs-reader] 处理消息出错:", e);
      }
    }
    return _originalFetch.call(this, input, init);
  };

  // 健康检查
  fetchService("/health").then(function (d) {
    if (d.ok) console.log("[xhs-reader] 服务连接正常 ✅");
    else console.warn("[xhs-reader] 服务异常:", d);
  }).catch(function (e) {
    console.warn("[xhs-reader] 无法连接服务:", e.message);
  });

  console.log("[xhs-reader] 小红书阅读插件已加载 ✅");
})();
