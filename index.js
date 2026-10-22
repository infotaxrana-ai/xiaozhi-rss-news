import http from "node:http";
import WebSocket from "ws";
import Parser from "rss-parser";

// ==============================================
// ALEXA BANGLA NEWS RADIO FALLBACK v3.4
// Detailed Article Retrieval + Story Parts
// Official Xiaozhi MCP
// ==============================================

const VERSION = "3.4.0";
const SERVICE = "Alexa Bangla News Radio Fallback";
const PORT = Number(process.env.PORT || 10000);

const WSS_URL = process.env.XIAOZHI_WSS_URL || "";

const CACHE_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 36 * 60 * 60 * 1000;

const ARTICLE_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1500000;

// Prevent long LLM/TTS responses.
const PART_CHARS = 520;
const MAX_REPORT_CHARS = 1650;

const SOURCES = [
  {
    name: "প্রথম আলো",
    url: "https://www.prothomalo.com/feed/",
    host: "prothomalo.com",
    language: "bn"
  },
  {
    name: "জাগোনিউজ২৪",
    url: "https://www.jagonews24.com/rss/rss.xml",
    host: "jagonews24.com",
    language: "bn"
  },
  {
    name: "বিডি২৪লাইভ",
    url: "https://www.bd24live.com/feed",
    host: "bd24live.com",
    language: "bn"
  },
  {
    name: "বিবিসি বাংলা",
    url: "https://feeds.bbci.co.uk/bengali/rss.xml",
    host: "bbc.com",
    language: "bn"
  },
  {
    name: "বাংলাদেশ টুডে",
    url: "https://thebangladeshtoday.com/feed/",
    host: "thebangladeshtoday.com",
    language: "en"
  }
];

const parser = new Parser({
  timeout: 9000,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/rss+xml,application/xml,text/xml,*/*"
  },
  customFields: {
    item: [
      ["content:encoded", "fullContent"],
      ["description", "description"]
    ]
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
let heartbeat = null;
let retryDelay = 5000;

let queue = [];
let queueIndex = 0;
let queueActive = false;
let queueCategory = "সব";

let currentStory = null;
let currentParts = [];
let currentPartIndex = 0;

const articleCache = new Map();

// ==============================================
// TEXT PROCESSING
// ==============================================

function decodeEntities(text) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”"
  };

  return String(text || "").replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, entity) => {
      const key = entity.toLowerCase();

      if (key.startsWith("#")) {
        const hex = key.startsWith("#x");
        const n = parseInt(
          entity.slice(hex ? 2 : 1),
          hex ? 16 : 10
        );

        if (
          Number.isInteger(n) &&
          n > 0 &&
          n <= 0x10ffff &&
          !(n >= 0xd800 && n <= 0xdfff)
        ) {
          return String.fromCodePoint(n);
        }

        return " ";
      }

      return named[key] ?? whole;
    }
  );
}

function cleanText(value, limit = 5000) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalize(text) {
  return cleanText(text, 500)
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

function normalizeCategory(value) {
  const t = String(value || "সব").toLowerCase();

  if (/বাংলাদেশ|জাতীয়|জাতীয়|national/.test(t))
    return "বাংলাদেশ";

  if (/রাজনীতি|politic/.test(t))
    return "রাজনীতি";

  if (/খেলা|sport/.test(t))
    return "খেলাধুলা";

  if (/প্রযুক্তি|বিজ্ঞান|tech/.test(t))
    return "প্রযুক্তি";

  if (/অর্থনীতি|ব্যবসা|econom/.test(t))
    return "অর্থনীতি";

  if (/আন্তর্জাতিক|বিশ্ব|world/.test(t))
    return "আন্তর্জাতিক";

  if (/বিনোদন|entertainment/.test(t))
    return "বিনোদন";

  return "সব";
}

// ==============================================
// SAFE ARTICLE URL
// ==============================================

function allowedArticleUrl(rawUrl, sourceHost) {
  try {
    const u = new URL(rawUrl);

    if (u.protocol !== "https:") return null;
    if (u.port && u.port !== "443") return null;
    if (u.username || u.password) return null;

    const host = u.hostname.toLowerCase();
    const allowed = sourceHost.toLowerCase();

    // Only the source's own domain.
    if (
      host !== allowed &&
      !host.endsWith("." + allowed)
    ) {
      return null;
    }

    return u.toString();
  } catch {
    return null;
  }
}

// ==============================================
// ARTICLE HTML EXTRACTION
// ==============================================

function extractArticleParagraphs(html) {
  const original = String(html || "");

  // Prefer semantic article body.
  const articleMatch = original.match(
    /<article\b[^>]*>([\s\S]*?)<\/article>/i
  );

  const mainMatch = original.match(
    /<main\b[^>]*>([\s\S]*?)<\/main>/i
  );

  let section = articleMatch
    ? articleMatch[1]
    : mainMatch
      ? mainMatch[1]
      : "";

  if (!section) {
    // Structured article sections used by news sites.
    const container = original.match(
      /<div\b[^>]*class=["'][^"']*(?:article-body|story-body|article-content|story-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
    );

    section = container?.[1] || "";
  }

  if (!section) return "";

  section = section
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, "");

  const matches = [
    ...section.matchAll(
      /<p\b[^>]*>([\s\S]*?)<\/p>/gi
    )
  ];

  const paragraphs = [];
  const seen = new Set();

  for (const match of matches) {
    const p = cleanText(match[1], 1200);

    if (p.length < 35) continue;

    const key = normalize(p);

    if (seen.has(key)) continue;
    seen.add(key);

    paragraphs.push(p);

    if (paragraphs.length >= 16) break;
  }

  // Return a bounded source-based extract, not full article.
  return paragraphs.join(" ").slice(0, MAX_REPORT_CHARS);
}

async function readArticle(url, host) {
  const safe = allowedArticleUrl(url, host);

  if (!safe) return "";

  const saved = articleCache.get(safe);

  if (
    saved &&
    Date.now() - saved.at < 60 * 60 * 1000
  ) {
    return saved.text;
  }

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    ARTICLE_TIMEOUT_MS
  );

  let result = "";

  try {
    const response = await fetch(safe, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      console.warn(
        "[ARTICLE HTTP]",
        response.status
      );

      return "";
    }

    const type = response.headers.get(
      "content-type"
    ) || "";

    if (!type.includes("text/html")) {
      return "";
    }

    const declaredSize = Number(
      response.headers.get("content-length") || 0
    );

    if (declaredSize > MAX_HTML_BYTES) {
      return "";
    }

    const reader = response.body?.getReader();

    if (!reader) return "";

    const pieces = [];
    let size = 0;
    let oversized = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        size += value.byteLength;

        if (size > MAX_HTML_BYTES) {
          oversized = true;
          await reader.cancel();
          break;
        }

        pieces.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    if (oversized) return "";

    const html = Buffer.concat(
      pieces.map(x => Buffer.from(x))
    ).toString("utf8");

    result = extractArticleParagraphs(html);

    console.log(
      "[ARTICLE EXTRACT]",
      result.length,
      "characters"
    );

  } catch (error) {
    console.warn(
      "[ARTICLE ERROR]",
      error.message
    );
  } finally {
    clearTimeout(timeout);
  }

  articleCache.set(safe, {
    at: Date.now(),
    text: result
  });

  // Bound cache size.
  if (articleCache.size > 150) {
    const first = articleCache.keys().next().value;
    articleCache.delete(first);
  }

  return result;
}

// ==============================================
// RSS COLLECTION
// ==============================================

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
          const dateValue =
            item.isoDate || item.pubDate;

          if (!dateValue) continue;

          const published = Date.parse(dateValue);

          if (
            !Number.isFinite(published) ||
            published < cutoff ||
            published > Date.now() + 600000
          ) continue;

          const title = cleanText(item.title, 300);

          if (!title) continue;

          // Prefer fuller RSS content over short snippet.
          const options = [
            item.fullContent,
            item["content:encoded"],
            item.content,
            item.description,
            item.summary,
            item.contentSnippet
          ]
            .map(x => cleanText(x, 3500))
            .filter(Boolean);

          const detail = options
            .sort((a, b) => b.length - a.length)[0] || "";

          articles.push({
            title,
            detail,
            url: allowedArticleUrl(item.link, source.host),
            host: source.host,
            source: source.name,
            language: source.language,
            published,
            category: categoryOf(title + " " + detail)
          });
        }

        return articles;
      })
    );

    const status = [];
    const unique = new Map();

    results.forEach((result, i) => {
      const source = SOURCES[i];
      const ok = result.status === "fulfilled";

      status.push({
        name: source.name,
        ok,
        count: ok ? result.value.length : 0,
        error: ok
          ? ""
          : String(
              result.reason?.message || result.reason
            ).slice(0, 100)
      });

      if (!ok) {
        console.warn(
          "[RSS FAILED]",
          source.name,
          status[i].error
        );
        return;
      }

      for (const article of result.value) {
        // English reports need actual translation first.
        if (article.language !== "bn") continue;

        const key = normalize(article.title);

        if (!key) continue;

        const previous = unique.get(key);

        if (
          !previous ||
          article.detail.length > previous.detail.length
        ) {
          unique.set(key, article);
        }
      }
    });

    const articles = [...unique.values()]
      .sort((a, b) => b.published - a.published);

    if (articles.length) {
      cache = {
        at: now,
        articles,
        status
      };
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

// ==============================================
// STORY SPLITTING
// ==============================================

function splitStory(text) {
  const source = cleanText(
    text,
    MAX_REPORT_CHARS
  );

  if (!source) return [];

  const sentences = source
    .split(/(?<=[।!?])\s+/u)
    .filter(Boolean);

  const parts = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > PART_CHARS) {
      if (current) {
        parts.push(current.trim());
        current = "";
      }

      for (
        let i = 0;
        i < sentence.length;
        i += PART_CHARS
      ) {
        parts.push(
          sentence.slice(i, i + PART_CHARS)
        );
      }

      continue;
    }

    if (
      current &&
      current.length + sentence.length + 1 > PART_CHARS
    ) {
      parts.push(current.trim());
      current = "";
    }

    current += (current ? " " : "") + sentence;
  }

  if (current) parts.push(current.trim());

  return parts.filter(Boolean);
}

// ==============================================
// NEWS QUEUE
// ==============================================

function startQueue(news, category) {
  queueCategory = normalizeCategory(category);

  queue = news.articles.filter(a =>
    queueCategory === "সব" ||
    a.category === queueCategory
  );

  queueIndex = 0;
  queueActive = queue.length > 0;

  currentStory = null;
  currentParts = [];
  currentPartIndex = 0;

  console.log(
    "[QUEUE START]",
    queueCategory,
    "Total:", queue.length
  );
}

async function prepareStory(article) {
  let report = article.detail;

  // Fetch original article only when RSS is too short.
  if (
    report.length < 500 &&
    article.url
  ) {
    const extracted = await readArticle(
      article.url,
      article.host
    );

    if (extracted.length > report.length + 100) {
      report = extracted;
    }
  }

  if (!report) {
    report =
      "এই সংবাদের বিস্তারিত তথ্য " +
      "সংবাদ উৎসে পাওয়া যায়নি।";
  }

  return splitStory(report);
}

async function nextStory() {
  if (!queueActive || !queue.length) {
    return "সক্রিয় সংবাদ বুলেটিন নেই। নতুন করে খবর চালাতে বলুন।";
  }

  if (queueIndex >= queue.length) {
    queueActive = false;
    return "সংগৃহীত সব সংবাদ শেষ হয়েছে।";
  }

  const article = queue[queueIndex];
  const isFirst = queueIndex === 0;

  queueIndex++;

  currentStory = article;
  currentParts = await prepareStory(article);
  currentPartIndex = 0;

  let text = "";

  if (isFirst) {
    text +=
      "স্বাগতম অ্যালেক্সা বাংলা নিউজ রেডিওতে। ";
  }

  text +=
    "শিরোনাম। " +
    article.title +
    "। এবার বিস্তারিত। ";

  if (currentParts.length) {
    text += currentParts[0];
    currentPartIndex = 1;
  } else {
    text +=
      "এই সংবাদটির বিস্তারিত তথ্য পাওয়া যায়নি।";
  }

  if (currentPartIndex < currentParts.length) {
    text +=
      " এই সংবাদের আরও বিস্তারিত রয়েছে। " +
      "বাকি অংশ শুনতে বলুন, পরের অংশ।";
  } else {
    text +=
      "। সংবাদ সূত্র " + article.source + "।";
  }

  console.log(
    "[STORY]",
    "News:", queueIndex,
    "Parts:", currentParts.length,
    "Remaining:", queue.length - queueIndex
  );

  return text;
}

function nextPart() {
  if (!currentStory || !currentParts.length) {
    return "বর্তমানে কোনো সংবাদের বাকি অংশ নেই।";
  }

  if (currentPartIndex >= currentParts.length) {
    return "এই সংবাদের বিস্তারিত শেষ হয়েছে। পরের খবর শুনতে পারেন।";
  }

  const text = currentParts[currentPartIndex];
  currentPartIndex++;

  if (currentPartIndex < currentParts.length) {
    return text +
      " আরও বিস্তারিত শুনতে বলুন, পরের অংশ।";
  }

  return text +
    "। সংবাদ সূত্র " +
    currentStory.source +
    "। এই সংবাদের বিস্তারিত শেষ।";
}

function stopNews() {
  queue = [];
  queueIndex = 0;
  queueActive = false;
  currentStory = null;
  currentParts = [];
  currentPartIndex = 0;

  return "সংবাদ পরিবেশনা বন্ধ করা হলো।";
}

// ==============================================
// MCP TOOL
// ==============================================

const newsTool = {
  name: "get_latest_news",
  description:
    "Alexa Bangla News Radio Fallback v3.4। " +
    "action=start দিয়ে খবর শুরু, next দিয়ে পরের সংবাদ, " +
    "continue দিয়ে বর্তমান সংবাদের পরের অংশ, " +
    "stop দিয়ে বন্ধ করো। " +
    "প্রতিবার একটি সংবাদ বা তার একটি অংশ দেওয়া হবে। " +
    "শিরোনামের পরে বিস্তারিত পড়ে শোনাও। " +
    "সবসময় বাংলায় বলবে। Markdown numbering করবে না। " +
    "অনুপস্থিত তথ্য নিজে থেকে তৈরি করবে না।",

  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "next", "continue", "stop"],
        description:
          "start, next, continue, stop"
      },
      category: {
        type: "string",
        description:
          "সব, বাংলাদেশ, রাজনীতি, আন্তর্জাতিক, খেলাধুলা, অর্থনীতি, প্রযুক্তি, বিনোদন"
      }
    }
  }
};

// ==============================================
// MCP WEBSOCKET
// ==============================================

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

function reconnect() {
  if (retryTimer) return;

  const delay = retryDelay;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, delay);

  retryDelay = Math.min(
    30000,
    Math.round(retryDelay * 1.5)
  );

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
      reconnect();
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
          protocolVersion:
            msg.params?.protocolVersion || "2024-11-05",
          capabilities: {
            tools: {}
          },
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
        result: {
          tools: [newsTool]
        }
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

      try {
        let output;

        if (action === "stop") {
          output = stopNews();
        } else if (action === "continue") {
          output = nextPart();
        } else if (action === "next") {
          output = await nextStory();
        } else {
          const news = await loadNews();
          startQueue(news, args.category);
          output = await nextStory();
        }

        respond(ws, id, {
          result: {
            content: [{
              type: "text",
              text: output
            }],
            isError: false
          }
        });

        console.log(
          "[NEWS SENT]",
          action,
          "Characters:", output.length,
          "QueueIndex:", queueIndex,
          "Part:", currentPartIndex,
          "/", currentParts.length
        );

      } catch (e) {
        console.error("[NEWS ERROR]", e.message);

        respond(ws, id, {
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

// ==============================================
// HTTP HEALTH
// ==============================================

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
    queueIndex,
    remaining: Math.max(
      0,
      queue.length - queueIndex
    ),
    currentStoryParts: currentParts.length,
    currentPartIndex,
    sources: cache.status
  }));
}).listen(PORT, "0.0.0.0", () => {
  console.log("[HTTP] Listening on", PORT);
});

console.log("[SYSTEM]", SERVICE, VERSION);
connect();
