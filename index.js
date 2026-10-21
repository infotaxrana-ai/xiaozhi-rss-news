
import http from "node:http";
import WebSocket from "ws";
import Parser from "rss-parser";

const PORT = Number(process.env.PORT || 10000);

const SERVICE_NAME = "Alexa Bangla News Radio";

// Render Environment Variable:
// XIAOZHI_WSS_URL = your existing full WSS endpoint
const XIAOZHI_WSS_URL = process.env.XIAOZHI_WSS_URL || "";

const TIME_ZONE = "Asia/Dhaka";
const CACHE_TTL = 5 * 60 * 1000;
const MAX_NEWS = 400;

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

const parser = new Parser({
  timeout: 9000,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
  }
});

let mcpConnected = false;
let fetching = null;

let cache = {
  at: 0,
  date: "",
  articles: [],
  statuses: []
};

function bdDate(value) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);

  const find = type => parts.find(p => p.type === type)?.value;

  return `${find("year")}-${find("month")}-${find("day")}`;
}

function cleanText(value, limit = 4000) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
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

function duplicateKey(title) {
  return cleanText(title, 500)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function refreshNews() {
  const today = bdDate(new Date());
  const now = Date.now();

  if (
    cache.date === today &&
    cache.articles.length &&
    now - cache.at < CACHE_TTL
  ) {
    return cache;
  }

  if (fetching) return fetching;

  fetching = (async () => {
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

          if (Number.isNaN(published.getTime()))
            continue;

          if (bdDate(published) !== today)
            continue;

          const title = cleanText(item.title, 400);

          if (!title) continue;

          const summary = cleanText(
            item.contentSnippet ||
            item.summary ||
            item.content ||
            item["content:encoded"],
            3500
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
          ? String(result.reason?.message || result.reason).slice(0, 120)
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

    const unique = new Map();

    for (const result of results) {
      if (result.status !== "fulfilled") continue;

      for (const article of result.value) {
        const key = duplicateKey(article.title);

        if (key && !unique.has(key)) {
          unique.set(key, article);
        }
      }
    }

    const articles = [...unique.values()]
      .sort((a, b) => b.published.localeCompare(a.published))
      .slice(0, MAX_NEWS);

    if (articles.length || cache.date !== today) {
      cache = {
        at: now,
        date: today,
        articles,
        statuses
      };
    } else {
      // Retain only same-day cached news.
      cache = {
        ...cache,
        at: now,
        statuses
      };
    }

    console.log(
      "[NEWS]",
      today,
      "articles:",
      cache.articles.length,
      JSON.stringify(statuses)
    );

    return cache;
  })();

  try {
    return await fetching;
  } finally {
    fetching = null;
  }
}

const newsTool = {
  name: "get_latest_news",

  description:
    "Alexa Bangla News Radio। আজকের বাংলাদেশ ও আন্তর্জাতিক সংবাদ বাংলা টিভি বা রেডিও সংবাদ উপস্থাপকের মতো পড়ে শোনাও। সংবাদগুলো বিস্তারিতভাবে উপস্থাপন করো। offset দিয়ে পরবর্তী সংবাদ সংগ্রহ করা যায়।",

  inputSchema: {
    type: "object",

    properties: {
      offset: {
        type: "integer",
        minimum: 0,
        description: "কোন সংবাদ থেকে শুরু হবে। প্রথমে 0।"
      },

      limit: {
        type: "integer",
        minimum: 1,
        maximum: 3,
        description: "একবারে সর্বোচ্চ 3টি সংবাদ। ডিফল্ট 2।"
      },

      category: {
        type: "string",
        description:
          "সব, রাজনীতি, খেলাধুলা, প্রযুক্তি, অর্থনীতি, আন্তর্জাতিক, বিনোদন, বাংলাদেশ ও অন্যান্য"
      }
    }
  }
};

function makeBulletin(news, args = {}) {
  if (!news.articles.length) {
    return "আজকের যাচাইযোগ্য সংবাদ এই মুহূর্তে সংগ্রহ করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।";
  }

  const offset = Number.isInteger(args.offset)
    ? Math.max(0, Math.min(args.offset, MAX_NEWS))
    : 0;

  const limit = Number.isInteger(args.limit)
    ? Math.max(1, Math.min(args.limit, 3))
    : 2;

  const group =
    typeof args.category === "string"
      ? args.category.trim()
      : "";

  const articles =
    group && group !== "সব"
      ? news.articles.filter(a => a.category === group)
      : news.articles;

  const selected = articles.slice(offset, offset + limit);

  if (!selected.length) {
    return "এই বিভাগের আর কোনো সংবাদ নেই।";
  }

  let script =
    `আজ ${news.date}, বাংলাদেশ সময়। ` +
    `${SERVICE_NAME} সংবাদ বুলেটিন। ` +
    `স্বাগতম আজকের সংবাদ আয়োজনে।\n\n`;

  selected.forEach((article, i) => {
    script +=
      `সংবাদ ${offset + i + 1}। ` +
      `${article.title}। ` +
      `সূত্র: ${article.source}। `;

    if (article.language === "en") {
      script +=
        "এই সংবাদটি ইংরেজি উৎস থেকে এসেছে। " +
        "তথ্য অপরিবর্তিত রেখে বাংলায় উপস্থাপন করুন। ";
    }

    script += article.summary ||
      "এই সংবাদটির বিস্তারিত RSS ফিডে পাওয়া যায়নি।";

    script += "\n\n";
  });

  const next = offset + selected.length;

  if (next < articles.length) {
    script +=
      `আরও ${articles.length - next}টি সংবাদ বাকি রয়েছে। ` +
      `পরবর্তী সংবাদ শুনতে বলুন, পরের খবর। ` +
      `পরবর্তী offset: ${next}।`;
  } else {
    script +=
      "এ পর্যন্তই এই বিভাগের আজকের উপলব্ধ সংবাদ। " +
      "আমাদের সঙ্গে থাকার জন্য ধন্যবাদ।";
  }

  return script;
}

function respond(ws, id, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id,
    ...payload
  }));
}

// HTTP health endpoint.
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
    mcpConnected,
    cachedArticles: cache.articles.length,
    dateBD: cache.date,
    sources: cache.statuses
  }));
}).listen(PORT, "0.0.0.0", () => {
  console.log("[HTTP] Listening on", PORT);
});

function connect() {
  if (!XIAOZHI_WSS_URL.startsWith("wss://")) {
    console.error(
      "[MCP] Set XIAOZHI_WSS_URL in Render Environment."
    );
    return;
  }

  console.log("[MCP] Connecting to Xiaozhi...");

  const ws = new WebSocket(XIAOZHI_WSS_URL, {
    handshakeTimeout: 15000
  });

  ws.on("open", () => {
    mcpConnected = true;
    console.log("[MCP] Connected successfully");
  });

  ws.on("error", error => {
    mcpConnected = false;
    console.error("[MCP ERROR]", error.message);
  });

  ws.on("close", () => {
    mcpConnected = false;
    console.warn("[MCP] Disconnected. Reconnecting...");
    setTimeout(connect, 5000);
  });

  ws.on("message", async data => {
    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.method === "tools/list") {
      respond(ws, msg.id, {
        result: {
          tools: [newsTool]
        }
      });

      return;
    }

    if (msg.method === "tools/call") {
      if (msg.params?.name !== newsTool.name) {
        respond(ws, msg.id, {
          error: {
            code: -32601,
            message: "Unknown tool"
          }
        });
        return;
      }

      try {
        const news = await refreshNews();

        const output = makeBulletin(
          news,
          msg.params?.arguments || {}
        );

        respond(ws, msg.id, {
          result: {
            content: [
              {
                type: "text",
                text: output
              }
            ]
          }
        });
      } catch (error) {
        console.error("[NEWS ERROR]", error.message);

        respond(ws, msg.id, {
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: "সংবাদ সংগ্রহ করতে সমস্যা হয়েছে।"
              }
            ]
          }
        });
      }

      return;
    }

    if (msg.method && msg.id !== undefined) {
      respond(ws, msg.id, {
        error: {
          code: -32601,
          message: "Method not found"
        }
      });
    }
  });
}

connect();
