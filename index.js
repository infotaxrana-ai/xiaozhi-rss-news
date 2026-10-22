
import http from "node:http";
import WebSocket from "ws";
import Parser from "rss-parser";

// ============================================
// ALEXA BANGLA NEWS RADIO v3.8
// Original v3.5 features preserved
// Auto Next / Continue / Stop
// Bengali News | 36 Hours | Detailed Reports
// ============================================

const VERSION = "3.8.0";
const SERVICE = "Alexa Bangla News Radio";
const PORT = Number(process.env.PORT || 10000);
const WSS_URL = process.env.XIAOZHI_WSS_URL || "";

const TIME_ZONE = "Asia/Dhaka";
const CACHE_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 36 * 60 * 60 * 1000;
const ARTICLE_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1500000;

// Preserve short audio segments.
const PART_CHARS = 520;
const MAX_REPORT_CHARS = 1650;

// NEWS RADIO v3.8
const NEWS_PER_BATCH = 2;
const FIRST_BATCH_DETAIL_CHARS = 420;
const NEXT_BATCH_DETAIL_CHARS = 600;
const NEWS_BATCH_WAIT_MS = 5000;

// Agent-side continuation target.
// This is metadata, not a server-side TTS timer.
const AUTO_DELAY_MS = 5000; // Advisory only

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
    "Accept":
      "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*"
  },
  customFields: {
    item: [
      ["content:encoded", "fullContent"],
      ["description", "description"]
    ]
  }
});

// ============================================
// CACHE AND CONNECTION
// ============================================

let cache = {
  at: 0,
  articles: [],
  status: []
};

let fetching = null;

let socket = null;
let retryTimer = null;
let heartbeat = null;
let retryDelay = 5000;

// ============================================
// NEWS QUEUE STATE
// ============================================

let queue = [];
let queueIndex = 0;
let queueActive = false;
let queueCategory = "সব";

let currentStory = null;
let currentParts = [];
let currentPartIndex = 0;

let bulletinIntroSent = false;
let bulletinGeneration = 0;

// Prevent simultaneous queue mutations.
let queueOperation = Promise.resolve();

const articleCache = new Map();

// ============================================
// BANGLADESH DATE / TIME
// ============================================

function banglaDigits(value) {
  const digits = "০১২৩৪৫৬৭৮৯";

  return String(value).replace(
    /[0-9]/g,
    digit => digits[Number(digit)]
  );
}

function dhakaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = type =>
    Number(parts.find(p => p.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day")
  };
}

function bengaliCalendar(date = new Date()) {
  const { year, month, day } = dhakaDateParts(date);

  const currentUTC = Date.UTC(
    year, month - 1, day
  );

  const newYearStarted =
    month > 4 ||
    (month === 4 && day >= 14);

  const startYear = newYearStarted
    ? year
    : year - 1;

  const banglaYear = startYear - 593;

  const startUTC = Date.UTC(
    startYear, 3, 14
  );

  let daysPassed = Math.floor(
    (currentUTC - startUTC) / 86400000
  );

  const nextYear = startYear + 1;

  const leap =
    nextYear % 400 === 0 ||
    (nextYear % 4 === 0 &&
     nextYear % 100 !== 0);

  const months = [
    ["বৈশাখ", 31],
    ["জ্যৈষ্ঠ", 31],
    ["আষাঢ়", 31],
    ["শ্রাবণ", 31],
    ["ভাদ্র", 31],
    ["আশ্বিন", 31],
    ["কার্তিক", 30],
    ["অগ্রহায়ণ", 30],
    ["পৌষ", 30],
    ["মাঘ", 30],
    ["ফাল্গুন", leap ? 30 : 29],
    ["চৈত্র", 30]
  ];

  for (const [name, days] of months) {
    if (daysPassed < days) {
      return (
        banglaDigits(daysPassed + 1) +
        " " + name +
        " " + banglaDigits(banglaYear) +
        " বঙ্গাব্দ"
      );
    }

    daysPassed -= days;
  }

  return "বাংলা তারিখ পাওয়া যায়নি";
}

function gregorianDate(date = new Date()) {
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function bangladeshTime(date = new Date()) {
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

// ============================================
// PROFESSIONAL INTRO — ONCE PER BULLETIN
// ============================================

function professionalNewsOpening() {
  const now = new Date();

  const englishDate = gregorianDate(now);
  const banglaDate = bengaliCalendar(now);
  const time = bangladeshTime(now);

  const lines = [
    "আসসালামু আলাইকুম।",
    "আমি মিসেস এলেক্সা।",
    "এলেক্সার বিগত ছত্রিশ ঘণ্টার সংবাদ বুলেটিনে আপনাকে স্বাগতম।",
    `আজ ${englishDate} খ্রিষ্টাব্দ।`,
    `বাংলা ${banglaDate}।`,
    `বাংলাদেশ সময় এখন ${time}।`,
    "সংবাদের উৎস হলো বিবিসি বাংলা, প্রথম আলো, জাগো নিউজ টুয়েন্টিফোর, বিডি টুয়েন্টিফোর লাইভ এবং বাংলাদেশ টুডে।",
    "চলুন, শুরু করা যাক।"
  ];

  console.log("[NEWS INTRO]", JSON.stringify({
    gregorian: englishDate,
    bengali: banglaDate,
    time
  }));

  return lines.join(" ");
}

// ============================================
// TEXT CLEANING
// ============================================

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
      .replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style\b[^>]*>[\s\S]*?<\/style>/gi,
        " "
      )
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

// ============================================
// SAFE ARTICLE URL
// ============================================

function allowedArticleUrl(rawUrl, sourceHost) {
  try {
    const u = new URL(rawUrl);

    if (u.protocol !== "https:") return null;
    if (u.port && u.port !== "443") return null;
    if (u.username || u.password) return null;

    const host = u.hostname.toLowerCase();
    const allowed = sourceHost.toLowerCase();

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

// ============================================
// DETAILED ARTICLE EXTRACTION
// ============================================

function extractArticleParagraphs(html) {
  const original = String(html || "");

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

  return paragraphs
    .join(" ")
    .slice(0, MAX_REPORT_CHARS);
}

async function readArticle(url, host) {
  const safe = allowedArticleUrl(url, host);

  if (!safe) return "";

  const saved = articleCache.get(safe);

  if (
    saved &&
    Date.now() - saved.at < 3600000
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

    const type =
      response.headers.get("content-type") || "";

    if (!type.includes("text/html")) return "";

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

  if (articleCache.size > 150) {
    const first = articleCache.keys().next().value;
    articleCache.delete(first);
  }

  return result;
}

// ============================================
// RSS NEWS COLLECTION — 36 HOURS
// ============================================

async function loadNews() {
  const now = Date.now();

  if (
    cache.at &&
    now - cache.at < CACHE_MS
  ) {
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
          ) {
            continue;
          }

          const title = cleanText(item.title, 300);

          if (!title) continue;

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

          const detail =
            options.sort(
              (a, b) => b.length - a.length
            )[0] || "";

          articles.push({
            title,
            detail,
            url: allowedArticleUrl(
              item.link,
              source.host
            ),
            host: source.host,
            source: source.name,
            language: source.language,
            published,
            category: categoryOf(
              title + " " + detail
            )
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
        // Original v3.5 behaviour preserved:
        // English articles are excluded because
        // no reliable Bengali translation exists.
        if (article.language !== "bn") continue;

        const key = normalize(article.title);

        if (!key) continue;

        const previous = unique.get(key);

        if (
          !previous ||
          article.detail.length >
            previous.detail.length
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

// ============================================
// SPLIT DETAILS INTO SHORT AUDIO PARTS
// ============================================

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
      current.length + sentence.length + 1 >
        PART_CHARS
    ) {
      parts.push(current.trim());
      current = "";
    }

    current +=
      (current ? " " : "") + sentence;
  }

  if (current) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}

// ============================================
// NEWS QUEUE v3.6
// ============================================

function startQueue(news, category) {
  queueCategory = normalizeCategory(category);

  queue = news.articles.filter(article =>
    queueCategory === "সব" ||
    article.category === queueCategory
  );

  queueIndex = 0;
  queueActive = queue.length > 0;

  currentStory = null;
  currentParts = [];
  currentPartIndex = 0;

  bulletinIntroSent = false;
  bulletinGeneration++;

  console.log(
    "[QUEUE START]",
    queueCategory,
    "Total:", queue.length,
    "Generation:", bulletinGeneration
  );
}

async function prepareStory(article) {
  let report = article.detail;

  if (
    report.length < 500 &&
    article.url
  ) {
    const extracted = await readArticle(
      article.url,
      article.host
    );

    if (
      extracted.length > report.length + 100
    ) {
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

// ============================================
// v3.6 RESPONSE HELPER
// ============================================

function newsResponse(text, done = false) {
  const remainingStories = Math.max(
    0,
    queue.length - queueIndex
  );

  const hasMore =
    !done &&
    queueActive &&
    remainingStories > 0;

  let speech = String(text || "").trim();

  // Announce Stop only once, at the end of
  // a complete two-news batch.
  if (hasMore && speech) {
    speech +=
      " রানা ভাই, সংবাদ বন্ধ করতে স্টপ বলুন।";
  }

  return {
    text: speech,
    hasMore,
    done: !hasMore,
    nextAction: hasMore ? "auto" : null,
    suggestedDelayMs:
      hasMore ? NEWS_BATCH_WAIT_MS : 0,
    remainingParts: 0,
    remainingStories
  };
}
// ============================================
// v3.8 TWO-NEWS BATCH ENGINE
// ============================================

// Truncate near a sentence ending whenever
// possible, preserving a sensible summary.
function boundedNewsDetail(raw, maxChars) {
  const text = cleanText(raw, MAX_REPORT_CHARS);

  if (!text) {
    return "এই সংবাদের বিস্তারিত তথ্য পাওয়া যায়নি।";
  }

  if (text.length <= maxChars) {
    return text;
  }

  const candidate = text.slice(0, maxChars + 1);

  const stops = [
    ...candidate.matchAll(/[।!?]/gu)
  ].map(m => m.index + m[0].length);

  const goodStop = stops
    .filter(i => i >= Math.floor(maxChars * 0.55))
    .pop();

  if (goodStop) {
    return text.slice(0, goodStop).trim();
  }

  const cut = candidate.lastIndexOf(" ", maxChars);

  return text.slice(
    0,
    cut > 180 ? cut : maxChars
  ).trim() + "…";
}

async function nextBatch() {
  if (!queueActive || !queue.length) {
    return newsResponse(
      "সক্রিয় সংবাদ বুলেটিন নেই।",
      true
    );
  }

  if (queueIndex >= queue.length) {
    queueActive = false;
    return newsResponse(
      "সংগৃহীত সব সংবাদ শেষ হয়েছে।",
      true
    );
  }

  const firstBatch = !bulletinIntroSent;

  const detailLimit = firstBatch
    ? FIRST_BATCH_DETAIL_CHARS
    : NEXT_BATCH_DETAIL_CHARS;

  const lines = [];

  if (firstBatch) {
    lines.push(professionalNewsOpening());
    bulletinIntroSent = true;
  }

  let count = 0;

  while (
    count < NEWS_PER_BATCH &&
    queueIndex < queue.length
  ) {
    const article = queue[queueIndex];

    // Advance the cursor once per article.
    queueIndex++;

    const parts = await prepareStory(article);

    const detail = boundedNewsDetail(
      parts.join(" "),
      detailLimit
    );

    lines.push(
      "শিরোনাম " +
      banglaDigits(queueIndex) + "। " +
      article.title + "। " +
      "এবার বিস্তারিত সংবাদ। " +
      detail + "। " +
      "সংবাদ সূত্র " + article.source + "।"
    );

    count++;
  }

  // No incomplete part should leak into
  // the following batch.
  currentStory = null;
  currentParts = [];
  currentPartIndex = 0;

  const hasMore = queueIndex < queue.length;

  if (!hasMore) {
    queueActive = false;
    lines.push(
      "রানা ভাই, আজকের সংবাদ পরিবেশনা " +
      "এখানেই শেষ। ধন্যবাদ।"
    );
  }

  console.log(
    "[NEWS BATCH]",
    "Count:", count,
    "Index:", queueIndex,
    "Remaining:", queue.length - queueIndex,
    "First:", firstBatch
  );

  return newsResponse(
    lines.join(" "),
    !hasMore
  );
}

// Backward compatible MCP actions.
// Each advance returns the next TWO stories.
async function nextStory() {
  return nextBatch();
}

async function nextPart() {
  return nextBatch();
}

async function autoAdvance() {
  return nextBatch();
}
// ============================================
// MANUAL STOP
// ============================================

function stopNews() {
  queue = [];
  queueIndex = 0;
  queueActive = false;

  currentStory = null;
  currentParts = [];
  currentPartIndex = 0;

  bulletinIntroSent = false;
  bulletinGeneration++;

  console.log("[NEWS STOPPED]");

  return newsResponse(
    "সংবাদ পরিবেশনা বন্ধ করা হলো।",
    true
  );
}

// ============================================
// SERIALIZE NEWS OPERATIONS
// ============================================

function runQueueOperation(work) {
  const operation = queueOperation.then(work);

  queueOperation = operation.catch(error => {
    console.error(
      "[QUEUE ERROR]",
      error.message
    );
  });

  return operation;
}

// ============================================
// MCP TOOL v3.6
// ============================================

const newsTool = {
  name: "get_latest_news",

  description:
    "Alexa Bangla News Radio v3.8। " +
    "action=start প্রথম দুই খবরের ব্যাচ দেয়। " +
    "প্রথম ব্যাচে সালাম, মিসেস এলেক্সার পরিচয়, " +
    "বাংলা ও ইংরেজি তারিখ, বাংলাদেশ সময় থাকবে। " +
    "প্রতি MCP response-এ দুটি খবর ও বিস্তারিত সারাংশ। " +
    "একটি ব্যাচের দুই খবর সম্পূর্ণ পড়বে। " +
    "শেষের Stop ঘোষণা আগে বলবে না। " +
    "Stop শনাক্ত হলে action=stop। " +
    "আরও খবরের জন্য action=auto। " +
    "Official Cloud সমর্থন করলে পাঁচ সেকেন্ড " +
    "Listening Window-এর পরে auto চালাবে। " +
    "নিজে থেকে MCP call হওয়ার নিশ্চয়তা নেই। " +
    "সংবাদ বানাবে না।",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "start",
          "auto",
          "next",
          "continue",
          "stop"
        ],
        description:
          "start = first two-news batch; auto/next/continue = next two-news batch; stop = stop bulletin."
      },
      category: {
        type: "string",
        description:
          "সব, বাংলাদেশ, রাজনীতি, আন্তর্জাতিক, খেলাধুলা, অর্থনীতি, প্রযুক্তি, বিনোদন"
      }
    }
  }
};

// ============================================
// MCP JSON-RPC RESPONSE
// ============================================

function respond(ws, id, payload) {
  if (
    id === undefined ||
    id === null ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  ws.send(JSON.stringify({
    jsonrpc: "2.0",
    id,
    ...payload
  }));
}

// ============================================
// MCP RECONNECT
// ============================================

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

  console.log(
    "[MCP] Reconnect in",
    delay,
    "ms"
  );
}

// ============================================
// MCP WEBSOCKET CONNECTION
// ============================================

function connect() {
  if (!WSS_URL.startsWith("wss://")) {
    console.error(
      "[MCP] Missing XIAOZHI_WSS_URL"
    );
    return;
  }

  if (
    socket &&
    socket.readyState !== WebSocket.CLOSED
  ) {
    return;
  }

  const ws = new WebSocket(WSS_URL, {
    handshakeTimeout: 15000
  });

  socket = ws;

  ws.on("open", () => {
    retryDelay = 5000;

    console.log(
      "[MCP] Connected successfully"
    );

    if (heartbeat) {
      clearInterval(heartbeat);
    }

    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);
  });

  ws.on("error", error => {
    console.error(
      "[MCP ERROR]",
      error.message
    );
  });

  ws.on("close", (code, reason) => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    if (socket === ws) {
      socket = null;
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
      const requested =
        msg.params?.protocolVersion;

      const supported = [
        "2024-11-05",
        "2025-03-26",
        "2025-06-18"
      ];

      respond(ws, id, {
        result: {
          protocolVersion:
            supported.includes(requested)
              ? requested
              : "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: SERVICE,
            version: VERSION
          }
        }
      });

      console.log(
        "[MCP] Initialize response sent"
      );
      return;
    }

    if (method === "notifications/initialized") {
      console.log("[MCP] Initialized");
      return;
    }

    if (method === "ping") {
      respond(ws, id, {
        result: {}
      });
      return;
    }

    if (method === "tools/list") {
      respond(ws, id, {
        result: {
          tools: [newsTool]
        }
      });

      console.log(
        "[MCP] News tool registered"
      );
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

      const args =
        msg.params?.arguments || {};

      const action =
        args.action || "start";

      console.log(
        "[NEWS TOOL]",
        "Action:", action,
        "Category:", args.category || "সব"
      );

      try {
        const output = await runQueueOperation(
          async () => {
            if (action === "stop") {
              return stopNews();
            }

            if (action === "auto") {
              return await autoAdvance();
            }

            if (action === "continue") {
              return nextPart();
            }

            if (action === "next") {
              return await nextStory();
            }

            if (action === "start") {
              const news = await loadNews();

              startQueue(
                news,
                args.category
              );

              return await nextStory();
            }

            throw new Error(
              "Unsupported news action: " + action
            );
          }
        );

        const speech =
          output.text ||
          (output.done
            ? "সংগৃহীত সংবাদ শেষ হয়েছে।"
            : "সংবাদের পরবর্তী অংশ প্রস্তুত।");

        respond(ws, id, {
          result: {
            content: [{
              type: "text",
              text: speech
            }],
            isError: false,

            // Optional metadata.
            // Client may ignore these fields.
            _meta: {
              news_radio_version: VERSION,
              auto_mode: true,
              has_more: output.hasMore,
              next_action: output.nextAction,
              suggested_delay_ms:
                output.suggestedDelayMs,
              listening_window_ms: output.hasMore ? 5000 : 0,
              requires_listening_window: output.hasMore,
              batch_size: NEWS_PER_BATCH,
              batch_wait_ms: output.hasMore
                ? NEWS_BATCH_WAIT_MS : 0,
              remaining_parts:
                output.remainingParts,
              remaining_stories:
                output.remainingStories,
              bulletin_generation:
                bulletinGeneration
            }
          }
        });

        console.log(
          "[NEWS SENT]",
          "Action:", action,
          "Characters:", speech.length,
          "HasMore:", output.hasMore,
          "NextAction:", output.nextAction,
          "QueueIndex:", queueIndex,
          "Part:", currentPartIndex,
          "/", currentParts.length
        );

      } catch (error) {
        console.error(
          "[NEWS ERROR]",
          error.message
        );

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

    if (
      method &&
      id !== undefined &&
      id !== null
    ) {
      respond(ws, id, {
        error: {
          code: -32601,
          message: "Method not found"
        }
      });
    }
  });
}

// ============================================
// HTTP HEALTH CHECK
// ============================================

http.createServer((req, res) => {
  if (
    req.url !== "/" &&
    req.url !== "/health"
  ) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type":
      "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  res.end(JSON.stringify({
    service: SERVICE,
    version: VERSION,
    status: "running",
    mcp_connected:
      socket?.readyState === WebSocket.OPEN,
    news_available: cache.articles.length,
    news_active: queueActive,
    auto_mode: true,
    auto_action: "auto",
    suggested_pause_ms: AUTO_DELAY_MS,
    queued_news: queue.length,
    current_news_index: queueIndex
  }));
}).listen(PORT, "0.0.0.0", () => {
  console.log(
    "[HTTP] Listening on",
    PORT
  );
});

// ============================================
// START MCP
// ============================================

console.log(
  "[SYSTEM] Alexa Bangla News Radio",
  VERSION
);

console.log(
  "[SYSTEM] RSS Sources:",
  SOURCES.length
);

console.log(
  "[SYSTEM] Auto News Mode: ENABLED"
);

console.log(
  "[SYSTEM] Auto Action: auto"
);

console.log(
  "[SYSTEM] Suggested Pause:",
  AUTO_DELAY_MS,
  "ms"
);

connect();
