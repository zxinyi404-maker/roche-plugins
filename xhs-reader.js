// ==================================================
// 小红书阅读插件 for Roche
// 功能：检测对话中的小红书链接/搜索请求，自动读取内容注入上下文
// 版本: 1.0.0
// ==================================================

(function (plugin) {

  // ============ 配置区 ============
  const CONFIG = {
    // 你的 VPS 地址，改成你自己的域名或 IP
    serverUrl: "http://182.92.218.147:18080",
    // 触发词：用户说这些词时触发搜索
    searchTriggers: ["搜一下", "搜索小红书", "小红书搜", "找找小红书"],
    // 是否在注入内容前显示提示
    showToast: true,
  };
  // ================================

  const XHS_URL_REGEX = /https?:\/\/(www\.)?xiaohongshu\.com\/[^\s\u4e00-\u9fa5"']+/gi;
  const XHS_SHORT_REGEX = /https?:\/\/xhslink\.com\/[^\s"']+/gi;

  // ---- 工具函数 ----

  function toast(msg) {
    if (!CONFIG.showToast) return;
    const el = document.createElement("div");
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
    setTimeout(() => el.remove(), 2500);
  }

  async function fetchService(path) {
    const url = CONFIG.serverUrl.replace(/\/$/, "") + path;
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    return resp.json();
  }

  function formatNote(data) {
    if (!data.ok) return `[小红书读取失败: ${data.error}]`;
    const tags = data.tags?.length ? `标签: ${data.tags.join(" ")}` : "";
    return [
      `📕 【小红书笔记】`,
      `标题: ${data.title || "无标题"}`,
      `作者: ${data.author || "未知"}`,
      `👍 ${data.likes}  ⭐ ${data.collects}  💬 ${data.comments}`,
      tags,
      ``,
      `正文:`,
      data.content || "（无正文）",
    ].filter(Boolean).join("\n");
  }

  function formatSearch(data, keyword) {
    if (!data.ok) return `[小红书搜索失败: ${data.error}]`;
    if (!data.notes?.length) return `[小红书搜索"${keyword}"无结果]`;
    const lines = [`📕 【小红书搜索: ${keyword}】\n`];
    data.notes.forEach((n, i) => {
      lines.push(`${i + 1}. ${n.title}`);
      lines.push(`   作者: ${n.author}  👍 ${n.likes}`);
      lines.push(`   ${n.url}`);
    });
    return lines.join("\n");
  }

  // ---- 核心：拦截发送，注入内容 ----

  async function processMessage(text) {
    const injections = [];

    // 1. 检测小红书链接
    const urls = [
      ...(text.match(XHS_URL_REGEX) || []),
      ...(text.match(XHS_SHORT_REGEX) || []),
    ];

    for (const url of urls) {
      toast(`正在读取小红书笔记…`);
      try {
        const encoded = encodeURIComponent(url);
        const data = await fetchService(`/read?url=${encoded}`);
        injections.push(formatNote(data));
      } catch (e) {
        injections.push(`[小红书读取出错: ${e.message}]`);
      }
    }

    // 2. 检测搜索指令
    for (const trigger of CONFIG.searchTriggers) {
      if (text.includes(trigger)) {
        // 提取关键词：触发词后面的内容
        const idx = text.indexOf(trigger) + trigger.length;
        const keyword = text.slice(idx).replace(/[：:，,。.！!？?\s]+$/, "").trim().split(/[，,\s]/)[0];
        if (keyword) {
          toast(`正在搜索小红书: ${keyword}`);
          try {
            const data = await fetchService(`/search?q=${encodeURIComponent(keyword)}`);
            injections.push(formatSearch(data, keyword));
          } catch (e) {
            injections.push(`[小红书搜索出错: ${e.message}]`);
          }
        }
        break;
      }
    }

    return injections;
  }

  // ---- Roche 插件入口 ----

  plugin.onLoad = function () {
    console.log("[xhs-reader] 小红书阅读插件已加载");

    // 健康检查
    fetchService("/health").then(d => {
      if (d.ok) console.log("[xhs-reader] 服务连接正常 ✅");
      else console.warn("[xhs-reader] 服务异常:", d);
    }).catch(e => {
      console.warn("[xhs-reader] 无法连接服务，请检查 VPS 是否运行:", e.message);
    });
  };

  // 拦截消息发送前，注入小红书内容
  plugin.beforeSend = async function (context) {
    const userMessage = context.messages?.[context.messages.length - 1]?.content;
    if (!userMessage || typeof userMessage !== "string") return context;

    const injections = await processMessage(userMessage);
    if (!injections.length) return context;

    // 把抓到的内容追加到用户消息后面，作为上下文
    const extra = "\n\n---\n[以下是系统自动读取的小红书内容，请据此回答]\n\n"
      + injections.join("\n\n---\n\n");

    const messages = [...context.messages];
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: userMessage + extra,
    };

    return { ...context, messages };
  };

})(plugin);
