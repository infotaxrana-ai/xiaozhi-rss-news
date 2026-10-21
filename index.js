import http from 'node:http';
import WebSocket from 'ws';
import Parser from 'rss-parser';

const PORT = Number(process.env.PORT || 10000);
const SERVICE_NAME = 'Alexa Bangla News Radio';

// Render Environment-এ পুরোনো WSS URL রাখবে।
const XIAOZHI_WSS_URL = process.env.XIAOZHI_WSS_URL || '';

const TZ = 'Asia/Dhaka';
const CACHE_MS = 5 * 60_000;
const MAX_NEWS = 400;

const SOURCES = [
  {
    name: 'প্রথম আলো',
    url: 'https://www.prothomalo.com/feed/',
    language: 'bn'
  },
  {
    name: 'জাগোনিউজ২৪',
    url: 'https://www.jagonews24.com/rss/rss.xml',
    language: 'bn'
  },
  {
    name: 'বিডি২৪লাইভ',
    url: 'https://www.bd24live.com/feed',
    language: 'bn'
  },
  {
    name: 'বিবিসি বাংলা',
    url: 'https://feeds.bbci.co.uk/bengali/rss.xml',
    language: 'bn'
  },
  {
    name: 'বাংলাদেশ টুডে',
    url: 'https://thebangladeshtoday.com/feed/',
    language: 'en'
  }
];

const parser = new Parser({
  timeout: 9000,
  headers: {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*'
  }
});

let connected = false;
let socket = null;
let reconnectTimer = null;
let reconnectDelay = 5000;
let fetching = null;

let cache = {
  at: 0,
  date: '',
  articles: [],
  statuses: []
};

function bdDate(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const value = type =>
    parts.find(p => p.type === type)?.value;

  return `${value('year')}-${value('month')}-${value('day')}`;
}

function cleanText(value, max = 3500) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function categoryOf(text) {
  const t = String(text).toLowerCase();

  if (/রাজনীতি|নির্বাচন|সংসদ|politic|election/.test(t))
    return 'রাজনীতি';

  if (/ক্রিকেট|ফুটবল|খেলা|sport|cricket|football/.test(t))
    return 'খেলাধুলা';

  if (/প্রযুক্তি|বিজ্ঞান|এআই|technology|science|artificial intelligence/.test(t))
    return 'প্রযুক্তি';

  if (/অর্থনীতি|ব্যবসা|বাণিজ্য|economy|business|market/.test(t))
    return 'অর্থনীতি';

  if (/বিশ্ব|আন্তর্জাতিক|যুক্তরাষ্ট্র|চীন|রাশিয়া|world|international/.test(t))
    return 'আন্তর্জাতিক';

  if (/বিনোদন|সিনেমা|তারকা|entertainment|film/.test(t))
    return 'বিনোদন';

  return 'বাংলাদেশ ও অন্যান্য';
}

function duplicateKey(title) {
  return cleanText(title, 500)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

async function refreshNews() {
  const today = bdDate(new Date());
  const now = Date.now();

  if (
    cache.date === today &&
    cache.articles.length &&
    now - cache.at < CACHE_MS
  ) {
    return cache;
  }

  if (fetching) return fetching;

  fetching = (async () => {
    const results = await Promise.allSettled(
      SOURCES.map(async source => {
        const feed = await parser.parseURL(source.url);

        return (feed.items || []).flatMap(item => {
          const stamp =
            item.isoDate ||
            item.pubDate ||
            item.published;

          if (!stamp) return [];

          const published = new Date(stamp);

          if (
            !Number.isFinite(published.getTime()) ||
            bdDate(published) !== today
          ) {
            return [];
          }

          const title = cleanText(item.title, 400);
          if (!title) return [];

          const summary = cleanText(
            item.contentSnippet ||
            item.summary ||
            item.content ||
            item['content:encoded']
          );

          return [{
            title,
            summary,
            source: source.name,
            language: source.language,
            category: categoryOf(title + ' ' + summary),
            published: published.toISOString()
          }];
        });
      })
    );

    const statuses = results.map((result, index) => ({
      source: SOURCES[index].name,
      healthy: result.status === 'fulfilled',
      count: result.status === 'fulfilled'
        ? result.value.length
        : 0,
      error: result.status === 'rejected'
        ? String(result.reason?.message || result.reason).slice(0, 120)
        : ''
    }));

    for (const state of statuses) {
      if (!state.healthy) {
        console.warn(
          '[RSS FAILED]',
          state.source,
          state.error
        );
      }
    }

    const seen = new Map();

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;

      for (const item of result.value) {
        const key = duplicateKey(item.title);

        if (key && !seen.has(key)) {
          seen.set(key, item);
        }
      }
    }

    const articles = [...seen.values()]
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
      cache = {
        ...cache,
        at: now,
        statuses
      };
    }

    console.log(
      '[NEWS]',
      today,
      'articles:',
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
  name: 'get_latest_news',

  description:
    'Alexa Bangla News Radio। বাংলাদেশ সময় অনুযায়ী আজকের সংবাদ TV বা Radio Anchor-এর মতো উপস্থাপন করো। offset দিয়ে পরবর্তী সংবাদ নেওয়া যায়।',

  inputSchema: {
    type: 'object',
    properties: {
      offset: {
        type: 'integer',
        minimum: 0,
        description:
          'প্রথমে 0, পরের ব্যাচে আগের offset+limit'
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 3,
        description: 'একবারে সর্বোচ্চ 3টি, ডিফল্ট 2'
      },
      category: {
        type: 'string',
        description:
          'সব, রাজনীতি, খেলাধুলা, প্রযুক্তি, অর্থনীতি, আন্তর্জাতিক, বিনোদন, বাংলাদেশ ও অন্যান্য'
      }
    }
  }
};

function makeBulletin(news, args = {}) {
  if (!news.articles.length) {
    return 'আজকের যাচাইযোগ্য সংবাদ এই মুহূর্তে পাওয়া যাচ্ছে না। একটু পর আবার চেষ্টা করুন।';
  }

  const offset = Number.isInteger(args.offset)
    ? Math.max(0, Math.min(args.offset, MAX_NEWS))
    : 0;

  const limit = Number.isInteger(args.limit)
    ? Math.max(1, Math.min(args.limit, 3))
    : 2;

  const category = typeof args.category === 'string'
    ? args.category.trim()
    : '';

  const pool = category && category !== 'সব'
    ? news.articles.filter(a => a.category === category)
    : news.articles;

  const selected = pool.slice(offset, offset + limit);

  if (!selected.length) {
    return 'এই বিভাগের আর কোনো সংবাদ নেই।';
  }

  let script =
    `আজ ${news.date}, বাংলাদেশ সময়। ` +
    `${SERVICE_NAME} সংবাদ বুলেটিন।\n\n`;

  selected.forEach((item, i) => {
    script +=
      `সংবাদ ${offset + i + 1}। ` +
      `${item.title}। ` +
      `সূত্র: ${item.source}। `;

    if (item.language === 'en') {
      script +=
        'ইংরেজি উৎসের তথ্য অপরিবর্তিত রেখে বাংলায় উপস্থাপন করুন। ';
    }

    script +=
      (item.summary || 'RSS ফিডে বিস্তারিত পাওয়া যায়নি।') +
      '\n\n';
  });

  const next = offset + selected.length;

  script += next < pool.length
    ? `আরও ${pool.length - next}টি সংবাদ আছে। ` +
      `পরের খবর শুনতে বলুন, পরের খবর। ` +
      `পরবর্তী offset: ${next}।`
    : 'এই বুলেটিনের সব উপলব্ধ সংবাদ শেষ। ধন্যবাদ।';

  return script;
}

function reply(ws, id, payload) {
  if (
    ws.readyState === WebSocket.OPEN &&
    id !== undefined &&
    id !== null
  ) {
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      ...payload
    }));
  }
}

// HTTP Health Check
http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/health') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify({
    service: SERVICE_NAME,
    mcpConnected: connected,
    cachedArticles: cache.articles.length,
    dateBD: cache.date,
    sources: cache.statuses
  }));
}).listen(PORT, '0.0.0.0', () => {
  console.log('[HTTP] Listening on', PORT);
});

// Reconnect Controller
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
  if (!XIAOZHI_WSS_URL.startsWith('wss://')) {
    console.error(
      '[MCP] Missing XIAOZHI_WSS_URL in Render Environment.'
    );
    return;
  }

  if (
    socket &&
    [WebSocket.CONNECTING, WebSocket.OPEN].includes(
      socket.readyState
    )
  ) {
    return;
  }

  console.log('[MCP] Connecting to Xiaozhi...');

  const ws = new WebSocket(XIAOZHI_WSS_URL, {
    handshakeTimeout: 15000
  });

  socket = ws;

  let openedAt = 0;

  ws.on('open', () => {
    openedAt = Date.now();
    connected = true;
    reconnectDelay = 5000;

    console.log('[MCP] Connected successfully');
  });

  ws.on('error', error => {
    console.error('[MCP ERROR]', error.message);
  });

  // Detailed Disconnect Diagnostics
  ws.on('close', (code, reason) => {
    if (socket === ws) {
      socket = null;
      connected = false;
    }

    const closeReason =
      reason?.toString('utf8') || 'No reason provided';

    const duration = openedAt
      ? Math.round((Date.now() - openedAt) / 1000)
      : 0;

    console.warn(
      '[MCP DISCONNECTED]',
      JSON.stringify({
        code,
        reason: closeReason.slice(0, 200),
        connectedSeconds: duration,
        time: new Date().toISOString()
      })
    );

    scheduleReconnect();
  });

  ws.on('message', async data => {
    let msg;

    try {
      msg = JSON.parse(data.toString());
    } catch (error) {
      console.warn(
        '[MCP] Non-JSON message:',
        error.message
      );
      return;
    }

    if (msg.method === 'tools/list') {
      reply(ws, msg.id, {
        result: {
          tools: [newsTool]
        }
      });
      return;
    }

    if (msg.method === 'tools/call') {
      if (msg.params?.name !== newsTool.name) {
        reply(ws, msg.id, {
          error: {
            code: -32601,
            message: 'Unknown tool'
          }
        });
        return;
      }

      try {
        const news = await refreshNews();

        reply(ws, msg.id, {
          result: {
            content: [{
              type: 'text',
              text: makeBulletin(
                news,
                msg.params?.arguments || {}
              )
            }]
          }
        });
      } catch (error) {
        console.error(
          '[NEWS ERROR]',
          error.message
        );

        reply(ws, msg.id, {
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: 'সংবাদ সংগ্রহ করতে সমস্যা হয়েছে।'
            }]
          }
        });
      }
      return;
    }

    if (
      msg.method &&
      msg.id !== undefined
    ) {
      reply(ws, msg.id, {
        error: {
          code: -32601,
          message: 'Method not found'
        }
      });
    }
  });
}

connect();
