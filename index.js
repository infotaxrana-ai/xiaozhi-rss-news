import http from "node:http";
import WebSocket from "ws";
import Parser from "rss-parser";

// ==================================================
// ALEXA BANGLA NEWS RADIO v3.0
// Headlines first, then detailed radio bulletin
// Official Xiaozhi MCP
// ==================================================

const PORT = Number(process.env.PORT || 10000);
const SERVICE_NAME = "Alexa Bangla News Radio";
const VERSION = "3.0.0";

const XIAOZHI_WSS_URL =
  process.env.XIAOZHI_WSS_URL || "";

const TIME_ZONE = "Asia/Dhaka";
const CACHE_MS = 5 * 60 * 1000;

// Last 36 hours, including yesterday's news.
const LOOKBACK_HOURS = 36;

// News per bulletin. Limits protect Xiaozhi TTS.
const DEFAULT_BATCH = 8;
const MAX_BATCH = 12;
const MAX_STORIES = 400;
const MAX_SUMMARY_CHARS = 850;

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
    "Accept":
      "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*"
  }
});

let cache = {
  at: 0,
  articles: [],
  statuses: []
};

let fetching = null;
let connected = false;
let socket = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let reconnectDelay = 5000;

let lastCloseCode = null;
let lastCloseReason = "";
let lastMethod = "";

// ==================================================
// DATE UTILITIES
// ==================================================

function bdDate(value) {
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(value);
}

function bdDateKey(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).formatToParts(value);

  const get = key =>
    parts.find(x => x.type === key)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function bdTime(value) {
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(value);
}

// ==================================================
// TEXT UTILITIES
// ==================================================

function cleanText(value, max = 4000) {
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

function duplicateKey(text) {
  return cleanText(text, 500)
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

// ==================================================
// RSS COLLECTION
// ==================================================

async function refreshNews() {
  const now = Date.now();

  if (
    cache.articles.length &&
    now - cache.at < CACHE_MS
  ) {
    return cache;
  }

  if (fetching) return fetching;

  fetching = (async () => {
    const started = Date.now();
    const cutoff =
      started - LOOKBACK_HOURS * 60 * 60 * 1000;

    console.log(
      "[RSS] Fetching last",
      LOOKBACK_HOURS,
      "hours of news"
    );

    const results = await Promise.allSettled(
      SOURCES.map(async source => {
        const feed = await parser.parseURL(source.url);
        const articles = [];

        for (const item of feed.items || []) {
          const rawDate =
            item.isoDate ||
            item.pubDate ||
            item.published;

          if (!rawDate) continue;

          const published = new Date(rawDate);
          const timestamp = published.getTime();

          if (!Number.isFinite(timestamp)) continue;

          // Ignore future-dated and old news.
          if (
            timestamp < cutoff ||
            timestamp > started + 10 * 60 * 1000
          ) {
            continue;
          }

          const title = cleanText(item.title, 400);
          if (!title) continue;

          const summary = cleanText(
            item.contentSnippet ||
            item.summary ||
            item.content ||
            item["content:encoded"],
            MAX_SUMMARY_CHARS
          );

          articles.push({
            title,
            summary,
            source: source.name,
            language: source.language,
            published: published.toISOString(),
            category: categoryOf(title + " " + summary)
          });
        }

        return articles;
      })
    );

    const statuses = results.map((result, i) => ({
      source: SOURCES[i].name,
      healthy: result.status === "fulfilled",
      count: result.status === "fulfilled"
        ? result.value.length
        : 0,
      error: result.status === "rejected"
        ? String(
            result.reason?.message || result.reason
          ).slice(0, 120)
        : ""
    }));

    for (const state of statuses) {
      if (!state.healthy) {
        console.warn(
          "[RSS FAILED]",
          state.source,
          state.error
        );
      }
    }

    const seen = new Map();

    for (const result of results) {
      if (result.status !== "fulfilled") continue;

      for (const article of result.value) {
        const key = duplicateKey(article.title);

        if (!key || seen.has(key)) continue;
        seen.set(key, article);
      }
    }

    const articles = [...seen.values()]
      .sort((a, b) =>
        b.published.localeCompare(a.published)
      )
      .slice(0, MAX_STORIES);

    if (articles.length) {
      cache = {
        at: started,
        articles,
        statuses
      };
    } else {
      // Retain recent cached content only.
      const recent = cache.articles.filter(
        item => {
          const stamp = Date.parse(item.published);
          return stamp >= cutoff && stamp <= started;
        }
      );

      cache = {
        at: started,
        articles: recent,
        statuses
      };
    }

    console.log(
      "[NEWS]",
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

// ==================================================
// RADIO NEWS SCRIPT
// ==================================================

function makeBulletin(news, args = {}) {
  if (!news.articles.length) {
    return (
      "দুঃখিত, গত ছত্রিশ ঘণ্টার যাচাইযোগ্য " +
      "সংবাদ এই মুহূর্তে পাওয়া যাচ্ছে না।"
    );
  }

  const offset = Number.isInteger(args.offset)
    ? Math.max(0, Math.min(args.offset, MAX_STORIES))
    : 0;

  const limit = Number.isInteger(args.limit)
    ? Math.max(1, Math.min(args.limit, MAX_BATCH))
    : DEFAULT_BATCH;

  const category =
    typeof args.category === "string"
      ? args.category.trim()
      : "";

  const pool =
    category && category !== "সব"
      ? news.articles.filter(
          item => item.category === category
        )
      : news.articles;

  const selected = pool.slice(offset, offset + limit);

  if (!selected.length) {
    return (
      "এই নির্বাচিত সংবাদ তালিকার আর কোনো খবর " +
      "নেই। চাইলে অন্য বিভাগের খবর শুনতে পারেন।"
    );
  }

  const now = new Date();

  let script = "";

  // News anchor opening.
  if (offset === 0) {
    script +=
      "আসসালামু আলাইকুম। " +
      "স্বাগতম অ্যালেক্সা বাংলা নিউজ রেডিওতে। " +
      `আজ ${bdDate(now)}। ` +
      `বাংলাদেশ সময় ${bdTime(now)}। ` +
      "এখন শুনছেন সাম্প্রতিক সংবাদ বুলেটিন। " +
      "এতে গত ছত্রিশ ঘণ্টায় প্রকাশিত খবর রয়েছে। " +
      "\n\n";
  } else {
    script +=
      "স্বাগতম। এবার শুনুন সংবাদ বুলেটিনের " +
      "পরবর্তী অংশ।\n\n";
  }

  // All headlines before the detailed reports.
  script += "প্রথমেই সংবাদ শিরোনাম।\n\n";

  selected.forEach((article, i) => {
    script +=
      `${offset + i + 1} নম্বর শিরোনাম। ` +
      `${article.title}।\n`;
  });

  script +=
    "\nএবার শুনুন বিস্তারিত সংবাদ।\n\n";

  // Detailed stories.
  selected.forEach((article, i) => {
    script +=
      `সংবাদ ${offset + i + 1}। ` +
      `${article.title}।\n`;

    script +=
      `সংবাদ সূত্র, ${article.source}। `;

    if (article.language === "en") {
      script +=
        "এই সংবাদটি ইংরেজি উৎস থেকে সংগ্রহ করা। " +
        "মূল তথ্য অপরিবর্তিত রেখে বাংলায় " +
        "উপস্থাপন করুন। ";
    }

    script += article.summary
      ? `${article.summary}।\n\n`
      : "RSS সূত্রে এই খবরের বিস্তারিত " +
        "বিবরণ পাওয়া যায়নি।\n\n";
  });

  const next = offset + selected.length;

  if (next < pool.length) {
    script +=
      "এই পর্বের বিস্তারিত সংবাদ এখানেই শেষ। " +
      `আরও ${pool.length - next}টি সংবাদ রয়েছে। ` +
      "পরবর্তী পর্ব শুনতে বলুন, পরের খবর। " +
      `পরবর্তী offset ${next}।`;
  } else {
    script +=
      "সাম্প্রতিক সংগৃহীত সংবাদ বুলেটিন " +
      "এখানেই শেষ। আমাদের সঙ্গে থাকার " +
      "জন্য ধন্যবাদ।";
  }

  return script;
}

// ==================================================
// MCP TOOL
// ==================================================

const newsTool = {
  name: "get_latest_news",

  description:
    "Alexa Bangla News Radio। এই টুল দিয়ে " +
    "গত ৩৬ ঘণ্টার বাংলা ও আন্তর্জাতিক সংবাদ " +
    "পাওয়া যায়। ব্যবহারকারী খবর শুনতে চাইলে " +
    "এই টুল ব্যবহার করো। ফিরিয়ে দেওয়া " +
    "বুলেটিনের শুরুতে সব শিরোনাম, তারপর " +
    "প্রতিটি খবরের বিস্তারিত রয়েছে। " +
    "বুলেটিনের ধারাবাহিকতা বজায় রাখো। " +
    "নতুন বুলেটিনে offset 0 ব্যবহার করো। " +
    "ব্যবহারকারী পরের খবর চাইলে আগের " +
    "offset এবং limit অনুযায়ী পরবর্তী " +
    "offset ব্যবহার করো। সংবাদ বানিয়ে বলবে না।",

  inputSchema: {
    type: "object",
    properties: {
      offset: {
        type: "integer",
        minimum: 0,
        description:
          "প্রথম পর্বে 0। পরের পর্বে " +
          "পূর্ববর্তী offset + limit।"
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: MAX_BATCH,
        description:
          "প্রতি পর্বে সর্বোচ্চ 12টি খবর। " +
          "ডিফল্ট 8।"
      },
      category: {
        type: "string",
        description:
          "সব, রাজনীতি, খেলাধুলা, প্রযুক্তি, " +
          "অর্থনীতি, আন্তর্জাতিক, বিনোদন, " +
          "বাংলাদেশ ও অন্যান্য।"
      }
    }
  }
};

// ==================================================
// HTTP HEALTH
// ==================================================

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
    mcpConnected: connected,
    cachedArticles: cache.articles.length,
    sources: cache.statuses,
    lastMethod,
    lastCloseCode,
    lastCloseReason
  }));
}).listen(PORT, "0.0.0.0", () => {
  console.log("[HTTP] Listening on", PORT);
});

// ==================================================
// MCP CONNECTION
// ==================================================

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
      socket === ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      try {
        ws.ping();
      } catch (error) {
        console.warn(
          "[MCP HEARTBEAT]",
          error.message
        );
      }
    }
  }, 30000);
}

function reconnect() {
  if (reconnectTimer) return;

  const delay = reconnectDelay;

  console.log(
    `[MCP] Reconnecting in ${delay / 1000}s`
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
      "[MCP] XIAOZHI_WSS_URL missing."
    );
    return;
  }

  if (
    socket &&
    (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
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

  ws.on("open", () => {
    openedAt = Date.now();
    connected = true;

    console.log("[MCP] Connected successfully");

    startHeartbeat(ws);
  });

  ws.on("error", error => {
    console.error(
      "[MCP ERROR]",
      error.message
    );
  });

  ws.on("close", (code, reason) => {
    const text =
      reason?.toString("utf8") ||
      "No reason provided";

    lastCloseCode = code;
    lastCloseReason = text.slice(0, 200);

    console.warn(
      "[MCP DISCONNECTED]",
      JSON.stringify({
        code,
        reason: lastCloseReason,
        connectedSeconds: openedAt
          ? Math.round(
              (Date.now() - openedAt) / 1000
            )
          : 0
      })
    );

    if (socket === ws) {
      socket = null;
      connected = false;
      stopHeartbeat();
      reconnect();
    }
  });

  ws.on("message", async data => {
    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.warn("[MCP] Invalid JSON");
      return;
    }

    const method = msg.method || "";
    const id = msg.id;

    if (method) {
      lastMethod = method;
      console.log("[MCP REQUEST]", method);
    }

    // MCP Initialize.
    if (method === "initialize") {
      const requested =
        msg.params?.protocolVersion;

      const supported = [
        "2024-11-05",
        "2025-03-26",
        "2025-06-18"
      ];

      reply(ws, id, {
        result: {
          protocolVersion:
            supported.includes(requested)
              ? requested
              : "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: SERVICE_NAME,
            version: VERSION
          }
        }
      });

      console.log("[MCP] Initialize response sent");
      return;
    }

    if (method === "notifications/initialized") {
      console.log("[MCP] Initialization complete");
      return;
    }

    if (method === "ping") {
      reply(ws, id, {
        result: {}
      });
      return;
    }

    if (method === "tools/list") {
      reply(ws, id, {
        result: {
          tools: [newsTool]
        }
      });

      reconnectDelay = 5000;

      console.log(
        "[MCP] Tool registered:",
        newsTool.name
      );
      return;
    }

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

      const args = msg.params?.arguments || {};

      console.log(
        "[NEWS] Tool called:",
        JSON.stringify(args)
      );

      try {
        const news = await refreshNews();
        const output = makeBulletin(news, args);

        reply(ws, id, {
          result: {
            content: [{
              type: "text",
              text: output
            }],
            isError: false
          }
        });

        console.log(
          "[NEWS] Bulletin sent",
          "Articles:", news.articles.length,
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
            content: [{
              type: "text",
              text:
                "সংবাদ সংগ্রহে সমস্যা হয়েছে।"
            }]
          }
        });
      }
      return;
    }

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
    }
  });
}

// ==================================================
// START
// ==================================================

console.log(
  "[SYSTEM]",
  SERVICE_NAME,
  "Version:",
  VERSION
);

console.log(
  "[SYSTEM] RSS sources:",
  SOURCES.length
);

connect();
