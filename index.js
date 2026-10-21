import http from "node:http";
import WebSocket from "ws";
import Parser from "rss-parser";

// ====================================================
// ALEXA BANGLA NEWS RADIO v2.1
// Official Xiaozhi MCP - Full Ready-Made Version
// Music firmware and Music MCP are not modified.
// ====================================================

const PORT = Number(process.env.PORT || 10000);
const SERVICE_NAME = "Alexa Bangla News Radio";
const VERSION = "2.1.0";

// Keep your existing Xiaozhi endpoint in Render Environment.
const XIAOZHI_WSS_URL =
  process.env.XIAOZHI_WSS_URL || "";

const TIME_ZONE = "Asia/Dhaka";
const CACHE_MS = 5 * 60 * 1000;
const MAX_NEWS = 400;
const RSS_TIMEOUT = 9000;

const NEWS_SOURCES = [
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

// ====================================================
// RSS CONFIGURATION
// ====================================================

const parser = new Parser({
  timeout: RSS_TIMEOUT,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept":
      "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*"
  }
});

let cache = {
  at: 0,
  date: "",
  articles: [],
  statuses: []
};

let fetching = null;

// ====================================================
// DATE AND TEXT UTILITIES
// ====================================================

function bdDate(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);

  const get = type =>
    parts.find(p => p.type === type)?.value;

  return (
    get("year") + "-" +
    get("month") + "-" +
    get("day")
  );
}

function cleanText(value, max = 3500) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function duplicateKey(title) {
  return cleanText(title, 500)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function categoryOf(text) {
  const t = String(text).toLowerCase();

  if (/রাজনীতি|নির্বাচন|সংসদ|politic|election/.test(t))
    return "রাজনীতি";

  if (/ক্রিকেট|ফুটবল|খেলা|sport|cricket|football/.test(t))
    return "খেলাধুলা";

  if (/প্রযুক্তি|বিজ্ঞান|এআই|technology|science|artificial intelligence/.test(t))
    return "প্রযুক্তি";

  if (/অর্থনীতি|ব্যবসা|বাণিজ্য|economy|business|market/.test(t))
    return "অর্থনীতি";

  if (/বিশ্ব|আন্তর্জাতিক|যুক্তরাষ্ট্র|চীন|রাশিয়া|world|international/.test(t))
    return "আন্তর্জাতিক";

  if (/বিনোদন|সিনেমা|তারকা|entertainment|film/.test(t))
    return "বিনোদন";

  return "বাংলাদেশ ও অন্যান্য";
}

// ====================================================
// NEWS COLLECTION
// ====================================================

async function refreshNews() {
  const today = bdDate(new Date());
  const now = Date.now();

  if (
    cache.date === today &&
    cache.articles.length > 0 &&
    now - cache.at < CACHE_MS
  ) {
    return cache;
  }

  if (fetching) return fetching;

  fetching = (async () => {
    console.log("[RSS] Fetching today's news...");

    const results = await Promise.allSettled(
      NEWS_SOURCES.map(async source => {
        const feed = await parser.parseURL(source.url);
        const articles = [];

        for (const item of feed.items || []) {
          const rawDate =
            item.isoDate ||
            item.pubDate ||
            item.published;

          if (!rawDate) continue;

          const published = new Date(rawDate);

          if (!Number.isFinite(published.getTime()))
            continue;

          if (bdDate(published) !== today)
            continue;

          const title = cleanText(item.title, 400);

          if (!title) continue;

          const summary = cleanText(
            item.contentSnippet ||
            item.summary ||
            item.content ||
            item["content:encoded"]
          );

          articles.push({
            title,
            summary,
            source: source.name,
            language: source.language,
            category: categoryOf(title + " " + summary),
            published: published.toISOString()
          });
        }

        return articles;
      })
    );

    const statuses = results.map((result, i) => ({
      source: NEWS_SOURCES[i].name,
      healthy: result.status === "fulfilled",
      count:
        result.status === "fulfilled"
          ? result.value.length
          : 0,
      error:
        result.status === "rejected"
          ? String(
              result.reason?.message || result.reason
            ).slice(0, 120)
          : ""
    }));

    for (const status of statuses) {
      if (!status.healthy) {
        console.warn(
          "[RSS FAILED]",
          status.source,
          status.error
        );
      }
    }

    const seen = new Map();

    for (const result of results) {
      if (result.status !== "fulfilled") continue;

      for (const article of result.value) {
        const key = duplicateKey(article.title);

        if (key && !seen.has(key)) {
          seen.set(key, article);
        }
      }
    }

    const articles = [...seen.values()]
      .sort((a, b) =>
        b.published.localeCompare(a.published)
      )
      .slice(0, MAX_NEWS);

    if (articles.length || cache.date !== today) {
      cache = {
        at: now,
        date: today,
        articles,
        statuses
      };
    } else {
      cache = {
        ...cache,
        at: now,
        statuses
      };
    }

    console.log(
      "[NEWS]",
      "Date:", today,
      "Articles:", cache.articles.length,
      "Sources:", JSON.stringify(statuses)
    );

    return cache;
  })();

  try {
    return await fetching;
  } finally {
    fetching = null;
  }
}

// ====================================================
// MCP NEWS TOOL
// ====================================================

const newsTool = {
  name: "get_latest_news",

  description:
    "Alexa Bangla News Radio। আজকের বাংলাদেশ ও আন্তর্জাতিক সংবাদ বাংলা TV বা Radio Anchor-এর মতো উপস্থাপন করো। খবরের সূত্র উল্লেখ করো। offset দিয়ে পরবর্তী সংবাদ পাওয়া যায়।",

  inputSchema: {
    type: "object",
    properties: {
      offset: {
        type: "integer",
        minimum: 0,
        description:
          "প্রথম সংবাদে 0। পরবর্তী ব্যাচে আগের offset + limit।"
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 3,
        description:
          "একবারে 1 থেকে 3টি সংবাদ। ডিফল্ট 2।"
      },
      category: {
        type: "string",
        description:
          "সব, রাজনীতি, খেলাধুলা, প্রযুক্তি, অর্থনীতি, আন্তর্জাতিক, বিনোদন, বাংলাদেশ ও অন্যান্য।"
      }
    }
  }
};

function makeBulletin(news, args = {}) {
  if (!news.articles.length) {
    return (
      "আজকের যাচাইযোগ্য সংবাদ এই মুহূর্তে পাওয়া যাচ্ছে না। " +
      "একটু পরে আবার চেষ্টা করুন।"
    );
  }

  const offset = Number.isInteger(args.offset)
    ? Math.max(0, Math.min(args.offset, MAX_NEWS))
    : 0;

  const limit = Number.isInteger(args.limit)
    ? Math.max(1, Math.min(args.limit, 3))
    : 2;

  const category =
    typeof args.category === "string"
      ? args.category.trim()
      : "";

  const pool =
    category && category !== "সব"
      ? news.articles.filter(
          article => article.category === category
        )
      : news.articles;

  const selected = pool.slice(offset, offset + limit);

  if (!selected.length) {
    return "এই বিভাগের আর কোনো সংবাদ নেই।";
  }

  let script =
    `আজ ${news.date}, বাংলাদেশ সময়। ` +
    `${SERVICE_NAME} সংবাদ বুলেটিন। ` +
    "স্বাগতম আজকের সংবাদ আয়োজনে।\n\n";

  selected.forEach((article, i) => {
    script +=
      `সংবাদ ${offset + i + 1}। ` +
      `${article.title}। ` +
      `সূত্র: ${article.source}। `;

    if (article.language === "en") {
      script +=
        "এটি ইংরেজি উৎসের সংবাদ। " +
        "তথ্য অপরিবর্তিত রেখে বাংলায় উপস্থাপন করুন। ";
    }

    script +=
      (article.summary ||
        "RSS ফিডে বিস্তারিত তথ্য পাওয়া যায়নি।") +
      "\n\n";
  });

  const next = offset + selected.length;

  if (next < pool.length) {
    script +=
      `আরও ${pool.length - next}টি সংবাদ রয়েছে। ` +
      "পরবর্তী সংবাদ শুনতে বলুন, পরের খবর। " +
      `পরবর্তী offset: ${next}।`;
  } else {
    script +=
      "আজকের এই বিভাগের উপলব্ধ সংবাদ শেষ। ধন্যবাদ।";
  }

  return script;
}

// ====================================================
// HTTP HEALTH ENDPOINT
// ====================================================

let mcpConnected = false;
let lastMcpMethod = "";
let lastCloseCode = null;
let lastCloseReason = "";

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
    service: SERVICE_NAME,
    version: VERSION,
    mcpConnected,
    lastMcpMethod,
    lastCloseCode,
    lastCloseReason,
    cachedArticles: cache.articles.length,
    dateBD: cache.date,
    rssSources: cache.statuses
  }));
}).listen(PORT, "0.0.0.0", () => {
  console.log("[HTTP] Listening on", PORT);
});

// ====================================================
// MCP CONNECTION MANAGEMENT
// ====================================================

let socket = null;
let reconnectTimer = null;
let reconnectDelay = 5000;
let heartbeatTimer = null;

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(ws) {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    if (
      socket !== ws ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    try {
      // WebSocket control-frame heartbeat.
      ws.ping();
    } catch (error) {
      console.warn(
        "[MCP HEARTBEAT ERROR]",
        error.message
      );
    }
  }, 30000);
}

function reply(ws, id, payload) {
  if (
    ws.readyState !== WebSocket.OPEN ||
    id === undefined ||
    id === null
  ) {
    return;
  }

  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id,
    ...payload
  }));
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  const delay = reconnectDelay;

  console.log(
    `[MCP] Reconnecting in ${delay / 1000} seconds...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);

  reconnectDelay = Math.min(
    30000,
    Math.round(reconnectDelay * 1.5)
  );
}

function connect() {
  if (!XIAOZHI_WSS_URL.startsWith("wss://")) {
    console.error(
      "[MCP] XIAOZHI_WSS_URL is missing or invalid."
    );
    return;
  }

  if (
    socket &&
    (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.OPEN
    )
  ) {
    return;
  }

  console.log("[MCP] Connecting to Xiaozhi...");

  const ws = new WebSocket(XIAOZHI_WSS_URL, {
    handshakeTimeout: 15000
  });

  socket = ws;

  let openedAt = 0;
  let initialized = false;
  let registered = false;

  ws.on("open", () => {
    openedAt = Date.now();
    mcpConnected = true;

    console.log("[MCP] Connected successfully");

    startHeartbeat(ws);
  });

  ws.on("pong", () => {
    // Server responded to the WebSocket heartbeat.
  });

  ws.on("error", error => {
    console.error(
      "[MCP ERROR]",
      error.message
    );
  });

  ws.on("close", (code, reason) => {
    const closeReason =
      reason?.toString("utf8") ||
      "No reason provided";

    const connectedSeconds = openedAt
      ? Math.round((Date.now() - openedAt) / 1000)
      : 0;

    lastCloseCode = code;
    lastCloseReason = closeReason.slice(0, 200);

    console.warn(
      "[MCP DISCONNECTED]",
      JSON.stringify({
        code,
        reason: lastCloseReason,
        connectedSeconds,
        initialized,
        registered,
        lastMethod: lastMcpMethod,
        time: new Date().toISOString()
      })
    );

    if (socket === ws) {
      socket = null;
      mcpConnected = false;
      stopHeartbeat();
      scheduleReconnect();
    }
  });

  // ==================================================
  // MCP JSON-RPC REQUEST HANDLER
  // ==================================================

  ws.on("message", async data => {
    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch (error) {
      console.warn(
        "[MCP INVALID JSON]",
        error.message
      );
      return;
    }

    const method = msg.method || "";
    const id = msg.id;

    if (method) {
      lastMcpMethod = method;
      console.log("[MCP REQUEST]", method);
    }

    // ----------------------------------------------
    // INITIALIZE
    // ----------------------------------------------

    if (method === "initialize") {
      const requestedVersion =
        msg.params?.protocolVersion;

      const supportedVersions = [
        "2024-11-05",
        "2025-03-26",
        "2025-06-18"
      ];

      const protocolVersion =
        supportedVersions.includes(requestedVersion)
          ? requestedVersion
          : "2024-11-05";

      reply(ws, id, {
        result: {
          protocolVersion,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: SERVICE_NAME,
            version: VERSION
          }
        }
      });

      initialized = true;

      console.log(
        "[MCP] Initialize response sent:",
        protocolVersion
      );

      return;
    }

    // ----------------------------------------------
    // INITIALIZATION NOTIFICATION
    // ----------------------------------------------

    if (method === "notifications/initialized") {
      console.log(
        "[MCP] Initialization acknowledged"
      );
      return;
    }

    // ----------------------------------------------
    // MCP PING
    // ----------------------------------------------

    if (method === "ping") {
      reply(ws, id, {
        result: {}
      });

      console.log("[MCP] Ping response sent");
      return;
    }

    // ----------------------------------------------
    // TOOL DISCOVERY
    // ----------------------------------------------

    if (method === "tools/list") {
      reply(ws, id, {
        result: {
          tools: [newsTool],
          nextCursor: ""
        }
      });

      registered = true;
      reconnectDelay = 5000;

      console.log(
        "[MCP] News tool registered:",
        newsTool.name
      );

      return;
    }

    // ----------------------------------------------
    // NEWS TOOL EXECUTION
    // ----------------------------------------------

    if (method === "tools/call") {
      if (msg.params?.name !== newsTool.name) {
        reply(ws, id, {
          error: {
            code: -32601,
            message: "Unknown tool"
          }
        });
        return;
      }

      console.log("[NEWS] Tool called");

      try {
        const news = await refreshNews();

        const output = makeBulletin(
          news,
          msg.params?.arguments || {}
        );

        reply(ws, id, {
          result: {
            content: [
              {
                type: "text",
                text: output
              }
            ],
            isError: false
          }
        });

        console.log(
          "[NEWS] Tool response sent",
          "Characters:", output.length
        );
      } catch (error) {
        console.error(
          "[NEWS ERROR]",
          error.message
        );

        reply(ws, id, {
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "সংবাদ সংগ্রহ করতে সমস্যা হয়েছে।"
              }
            ]
          }
        });
      }

      return;
    }

    // ----------------------------------------------
    // UNKNOWN METHODS
    // ----------------------------------------------

    if (
      method &&
      id !== undefined &&
      id !== null
    ) {
      reply(ws, id, {
        error: {
          code: -32601,
          message: "Method not found"
        }
      });

      console.warn(
        "[MCP] Unsupported method:",
        method
      );
    }
  });
}

// ====================================================
// START NEWS MCP
// ====================================================

console.log(
  "[SYSTEM]",
  SERVICE_NAME,
  "Version:", VERSION
);

console.log(
  "[SYSTEM] Configured RSS sources:",
  NEWS_SOURCES.length
);

connect();
