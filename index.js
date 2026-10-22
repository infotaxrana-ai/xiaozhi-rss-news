import http from "node:http";
import WebSocket from "ws";
import Parser from "rss-parser";

// Alexa Bangla News Radio - MCP Fallback v3.3
// Existing Music System remains unchanged.

const PORT = Number(process.env.PORT || 10000);
const SERVICE = "Alexa Bangla News Radio Fallback";
const VERSION = "3.3.0";
const WSS_URL = process.env.XIAOZHI_WSS_URL || "";

const CACHE_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 36 * 60 * 60 * 1000;
const MAX_DETAIL = 850;

const SOURCES = [
  {
    name: "প্রথম আলো",
    url: "https://www.prothomalo.com/feed/",
    language: "bn"
  },
  {
    name: "জাগোনিউজ২৪",
    url: "https://www.jagonews24.com/rss/rss.xml",
    language: "bn"
  },
  {
    name: "বিডি২৪লাইভ",
    url: "https://www.bd24live.com/feed",
    language: "bn"
  },
  {
    name: "বিবিসি বাংলা",
    url: "https://feeds.bbci.co.uk/bengali/rss.xml",
    language: "bn"
  },
  {
    name: "বাংলাদেশ টুডে",
    url: "https://thebangladeshtoday.com/feed/",
    language: "en"
  }
];

const parser = new Parser({
  timeout: 9000,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*"
  }
});

let cache = {
  at: 0,
  articles: [],
  status: []
};

let fetching = null;
let connected = false;
let socket = null;
let retryTimer = null;
let retryDelay = 5000;
let heartbeat = null;

let queue = [];
let queueIndex = 0;
let queueCategory = "সব";
let queueActive = false;

function clean(value, limit = 2000) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalize(text) {
  return clean(text, 500)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function categoryOf(text) {
  const t = String(text).toLowerCase();

  if (/রাজনীতি|নির্বাচন|সংসদ/.test(t))
    return "রাজনীতি";

  if (/ক্রিকেট|ফুটবল|খেলা|ম্যাচ/.test(t))
    return "খেলাধুলা";

  if (/প্রযুক্তি|বিজ্ঞান|কৃত্রিম বুদ্ধিমত্তা/.test(t))
    return "প্রযুক্তি";

  if (/অর্থনীতি|বাণিজ্য|ব্যবসা|শেয়ারবাজার/.test(t))
    return "অর্থনীতি";

  if (/আন্তর্জাতিক|বিশ্ব|যুক্তরাষ্ট্র|রাশিয়া|চীন|গাজা/.test(t))
    return "আন্তর্জাতিক";

  if (/বিনোদন|সিনেমা|অভিনেতা|অভিনেত্রী/.test(t))
    return "বিনোদন";

  return "বাংলাদেশ";
}

function normalizeCategory(input) {
  const t = String(input || "সব").trim().toLowerCase();

  if (/বাংলাদেশ|জাতীয়|জাতীয়|national|bangladesh/.test(t))
    return "বাংলাদেশ";

  if (/রাজনীতি|politic/.test(t))
    return "রাজনীতি";

  if (/খেলা|sport/.test(t))
    return "খেলাধুলা";

  if (/প্রযুক্তি|বিজ্ঞান|tech/.test(t))
    return "প্রযুক্তি";

  if (/অর্থনীতি|ব্যবসা|বাণিজ্য|econom/.test(t))
    return "অর্থনীতি";

  if (/বিশ্ব|আন্তর্জাতিক|world|international/.test(t))
    return "আন্তর্জাতিক";

  if (/বিনোদন|entertainment/.test(t))
    return "বিনোদন";

  return "সব";
}

async function loadNews() {
  const now = Date.now();

  if (cache.at && now - cache.at < CACHE_MS) {
    return cache;
  }

  if (fetching) return fetching;

  fetching = (async () => {
    const cutoff = Date.now() - LOOKBACK_MS;

    const results = await Promise.allSettled(
      SOURCES.map(async source => {
        const feed = await parser.parseURL(source.url);
        const articles = [];

        for (const item of feed.items || []) {
          const dateValue = item.isoDate || item.pubDate;
          if (!dateValue) continue;

          const timestamp = Date.parse(dateValue);

          if (
            !Number.isFinite(timestamp) ||
            timestamp < cutoff ||
            timestamp > Date.now() + 600000
          ) continue;

          const title = clean(item.title, 300);

          const detail = clean(
            item.contentSnippet ||
            item.summary ||
            item.content ||
            item["content:encoded"],
            MAX_DETAIL
          );

          if (!title) continue;

          articles.push({
            title,
            detail,
            source: source.name,
            language: source.language,
            published: timestamp,
            category: categoryOf(title + " " + detail)
          });
        }

        return articles;
      })
    );

    const status = [];
    const unique = new Map();

    results.forEach((result, index) => {
      const source = SOURCES[index];

      const ok = result.status === "fulfilled";

      status.push({
        name: source.name,
        ok,
        count: ok ? result.value.length : 0,
        error: ok ? "" : String(result.reason?.message || result.reason).slice(0, 100)
      });

      if (!ok) {
        console.warn("[RSS FAILED]", source.name, status[index].error);
        return;
      }

      for (const item of result.value) {
        // English content needs a real translation
        // service before it can become Bengali audio.
        if (item.language !== "bn") continue;

        const key = normalize(item.title);

        if (key && !unique.has(key)) {
          unique.set(key, item);
        }
      }
    });

    const articles = [...unique.values()]
      .sort((a, b) => b.published - a.published);

    if (articles.length) {
      cache = { at: now, articles, status };
    } else {
      cache = {
        at: now,
        articles: cache.articles.filter(a =>
          a.published >= cutoff &&
          a.published <= now
        ),
        status
      };
    }

    console.log(
      "[NEWS]",
      "Available:", cache.articles.length,
      "Sources:", JSON.stringify(status)
    );

    return cache;
  })();

  try {
    return await fetching;
  } finally {
    fetching = null;
  }
}

function startQueue(news, category) {
  queueCategory = normalizeCategory(category);

  queue = news.articles.filter(a =>
    queueCategory === "সব" ||
    a.category === queueCategory
  );

  queueIndex = 0;
  queueActive = queue.length > 0;

  console.log(
    "[QUEUE START]",
    queueCategory,
    "Total:", queue.length
  );
}

function nextStory() {
  if (!queueActive || !queue.length) {
    return "এই মুহূর্তে কোনো সক্রিয় সংবাদ বুলেটিন নেই। নতুন করে খবর চালাতে বলুন।";
  }

  if (queueIndex >= queue.length) {
    queueActive = false;
    return "সংগৃহীত সব সংবাদ শেষ হয়েছে। ধন্যবাদ।";
  }

  const article = queue[queueIndex];
  const number = queueIndex + 1;
  queueIndex++;

  let text = "";

  if (number === 1) {
    text += "স্বাগতম অ্যালেক্সা বাংলা নিউজ রেডিওতে। ";
  }

  text += "শিরোনাম। ";
  text += article.title + "। ";
  text += "এবার বিস্তারিত। ";
  text += article.detail ||
    "এই সংবাদের বিস্তারিত বিবরণ RSS-এ পাওয়া যায়নি।";

  text += "। সংবাদ সূত্র " + article.source + "। ";

  if (queueIndex >= queue.length) {
    queueActive = false;
    text += "এই বুলেটিনের সব সংবাদ শেষ।";
  }

  console.log(
    "[QUEUE NEXT]",
    number,
    "Remaining:",
    queue.length - queueIndex
  );

  return text;
}

const newsTool = {
  name: "get_latest_news",
  description:
    "Alexa Bangla News Radio fallback MCP. " +
    "খবর শুরু করতে action=start, পরের খবরের জন্য " +
    "action=next এবং বন্ধ করতে action=stop ব্যবহার করো। " +
    "প্রতিবার শুধু একটি খবরের শিরোনাম এবং বিস্তারিত ফেরত আসে। " +
    "সবসময় বাংলায় পড়বে। কোনো Markdown বা সংখ্যার তালিকা তৈরি করবে না। " +
    "এই টুল নিজের থেকে অডিও চালু রাখতে পারে না।",

  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "next", "stop"],
        description:
          "start নতুন সংবাদ, next পরবর্তী সংবাদ, stop বন্ধ।"
      },
      category: {
        type: "string",
        description:
          "সব, বাংলাদেশ, রাজনীতি, আন্তর্জাতিক, খেলাধুলা, অর্থনীতি, প্রযুক্তি, বিনোদন।"
      }
    }
  }
};

function respond(ws, id, payload) {
  if (
    id === undefined ||
    id === null ||
    ws.readyState !== WebSocket.OPEN
  ) return;

  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id,
    ...payload
  }));
}

function scheduleReconnect() {
  if (retryTimer) return;

  const delay = retryDelay;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);

  retryDelay = Math.min(30000, retryDelay * 1.5);

  console.log("[MCP] Reconnect in", delay, "ms");
}

function connect() {
  if (!WSS_URL.startsWith("wss://")) {
    console.error("[MCP] Missing XIAOZHI_WSS_URL");
    return;
  }

  if (
    socket &&
    socket.readyState !== WebSocket.CLOSED
  ) return;

  const ws = new WebSocket(WSS_URL, {
    handshakeTimeout: 15000
  });

  socket = ws;

  ws.on("open", () => {
    connected = true;
    retryDelay = 5000;

    console.log("[MCP] Connected");

    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on("error", e => {
    console.error("[MCP ERROR]", e.message);
  });

  ws.on("close", (code, reason) => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (socket === ws) {
      socket = null;
      connected = false;
      scheduleReconnect();
    }

    console.warn(
      "[MCP CLOSED]",
      code,
      reason.toString("utf8").slice(0, 120)
    );
  });

  ws.on("message", async raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const method = msg.method;
    const id = msg.id;

    if (method === "initialize") {
      respond(ws, id, {
        result: {
          protocolVersion: msg.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: {
            name: SERVICE,
            version: VERSION
          }
        }
      });
      return;
    }

    if (method === "notifications/initialized") return;

    if (method === "ping") {
      respond(ws, id, { result: {} });
      return;
    }

    if (method === "tools/list") {
      respond(ws, id, {
        result: { tools: [newsTool] }
      });

      console.log("[MCP] Tool registered");
      return;
    }

    if (method === "tools/call") {
      if (msg.params?.name !== newsTool.name) {
        respond(ws, id, {
          error: {
            code: -32601,
            message: "Unknown tool"
          }
        });
        return;
      }

      const args = msg.params?.arguments || {};
      const action = args.action || "start";

      let output;

      try {
        if (action === "stop") {
          queueActive = false;
          queue = [];
          queueIndex = 0;
          output = "সংবাদ পরিবেশনা বন্ধ করা হলো.";
        } else if (action === "next") {
          output = nextStory();
        } else {
          const news = await loadNews();
          startQueue(news, args.category);
          output = nextStory();
        }

        respond(ws, id, {
          result: {
            content: [{ type: "text", text: output }],
            isError: false
          }
        });

        console.log(
          "[NEWS SENT]",
          "action:", action,
          "characters:", output.length
        );
      } catch (e) {
        console.error("[NEWS ERROR]", e.message);

        respond(ws, id, {
          result: {
            isError: true,
            content: [{
              type: "text",
              text: "সংবাদ সংগ্রহ করতে সমস্যা হয়েছে।"
            }]
          }
        });
      }

      return;
    }

    if (method && id !== undefined && id !== null) {
      respond(ws, id, {
        error: {
          code: -32601,
          message: "Method not found"
        }
      });
    }
  });
}

http.createServer((req, res) => {
  if (req.url !== "/" && req.url !== "/health") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify({
    service: SERVICE,
    version: VERSION,
    mcpConnected: connected,
    cachedNews: cache.articles.length,
    queueActive,
    nextIndex: queueIndex,
    remaining: Math.max(0, queue.length - queueIndex),
    sources: cache.status
  }));
}).listen(PORT, "0.0.0.0", () => {
  console.log("[HTTP] Listening on", PORT);
});

console.log("[SYSTEM]", SERVICE, VERSION);
connect();
