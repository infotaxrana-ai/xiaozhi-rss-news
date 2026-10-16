import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;

const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjI0OTc5NTgsImVuZHBvaW50SWQiOjJhZ2VudF8yNDk3OTU4IiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEzODU0MywiZXhwIjoxODIzNjk2MTQzfQ.F4FFJg5FiZDpepoTk_YKvaeQ3WiW6Y7z0XDHfSUR_yo1vF2EWTlxgvTN05FE0v3T5fU_FfRbrr5eaZn2NRpXXw";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 8000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 150);
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("BBC Categorical Structured News MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ── বিবিসি বাংলা ও ক্যাটাগরিভিত্তিক সোর্স লিস্ট ──
const CATEGORY_SOURCES = [
  { category: "politics", name: "বিবিসি বাংলা রাজনীতি", url: "https://www.bbc.com/bengali/topics/c1e0z97424yt.xml" },
  { category: "national", name: "বিবিসি বাংলা জাতীয়", url: "https://www.bbc.com/bengali/news/index.xml" },
  { category: "other", name: "বিবিসি বাংলা বাংলাদেশ", url: "https://www.bbc.com/bengali/index.xml" },
  { category: "international", name: "বিবিসি বাংলা আন্তর্জাতিক", url: "https://www.bbc.com/bengali/world/index.xml" },
  { category: "sports", name: "বিবিসি বাংলা খেলাধুলা", url: "https://www.bbc.com/bengali/topics/c2dwqdpne3rt.xml" },
  { category: "showbiz", name: "বিবিসি বাংলা বিনোদন", url: "https://www.bbc.com/bengali/topics/cyx527y704gt.xml" },
  { category: "tech", name: "বিবিসি বাংলা তথ্যপ্রযুক্তি", url: "https://www.bbc.com/bengali/topics/c1e0z9741x8t.xml" }
];

// ── ফলব্যাক সোর্স (বিবিসি ফিডে খবর কম থাকলে ব্যাকআপ) ──
const FALLBACK_SOURCES = [
  { name: "প্রথম আলো", url: "https://www.prothomalo.com/feed/bangladesh" },
  { name: "সময় টিভি", url: "https://www.somoynews.tv/rss/bangladesh" },
  { name: "ঢাকা পোস্ট", url: "https://www.dhakapost.com/rss/national.xml" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("BBC Structured News MCP connected!"));
  ws.on("error", (error) => console.error("WS Connection Error:", error.message));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.method === "tools/list") {
        ws.send(JSON.stringify({
          jsonrpc: "2.0", id: msg.id,
          result: {
            tools: [{
              name: "get_latest_news",
              description: "নির্দিষ্ট সিকোয়েন্সে বিবিসি বাংলার রাজনীতি, জাতীয়, আন্তর্জাতিক, খেলাধুলা, বিনোদন ও আইটি খবর পড়ার টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let newsByCat = {
          politics: [],
          national: [],
          other: [],
          international: [],
          sports: [],
          showbiz: [],
          tech: []
        };
        const seenTitles = new Set();

        // ১. প্রতিটি ক্যাটাগরি অনুযায়ী খবর সংগ্রহ
        for (const source of CATEGORY_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const title = cleanText(item.title);
              const content = cleanText(item.contentSnippet || item.content || item.summary);
              
              if (title && !seenTitles.has(title) && content.length > 15) {
                seenTitles.add(title);
                newsByCat[source.category].push({
                  title,
                  content,
                  sourceName: source.name
                });
              }
            });
          } catch (e) {}
        }

        // ২. খবর কম থাকলে ফলব্যাক দিয়ে ব্যাকআপ
        let fallbackNews = [];
        for (const source of FALLBACK_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const title = cleanText(item.title);
              const content = cleanText(item.contentSnippet || item.content || item.summary);
              if (title && !seenTitles.has(title) && content.length > 15) {
                seenTitles.add(title);
                fallbackNews.push({ title, content, sourceName: source.name });
              }
            });
          } catch (e) {}
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' });
        const formattedTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

        let script = `আজ ${formattedDate}, সময় ${formattedTime}। বিবিসি বাংলা থেকে বিশেষ সংবাদ বুলেটিন শুরু করছি।\n\n`;

        // নির্দিষ্ট সিকোয়েন্সে স্ক্রিপ্ট সাজানো
        const addSection = (sectionHeader, items) => {
          if (items.length === 0) return "";
          let sectionText = `--- ${sectionHeader} ---\n`;
          items.slice(0, 3).forEach((art, idx) => {
            sectionText += `সংবাদ: ${art.title}। উৎস: ${art.sourceName}। বিস্তারিত: ${art.content}।\n\n`;
          });
          return sectionText;
        };

        // নির্দিষ্ট ক্রম অনুযায়ী যুক্তকরণ
        script += addSection("রাজনৈতিক সংবাদ", newsByCat.politics);
        script += addSection("জাতীয় সংবাদ", newsByCat.national);
        script += addSection("দেশের অন্যান্য সংবাদ", newsByCat.other.length > 0 ? newsByCat.other : fallbackNews.slice(0, 2));
        script += addSection("আন্তর্জাতিক সংবাদ", newsByCat.international);
        script += addSection("খেলাধুলার খবর", newsByCat.sports);
        script += addSection("বিনোদন জগতের খবর", newsByCat.showbiz);
        script += addSection("তথ্য ও প্রযুক্তি সংবাদ", newsByCat.tech);

        script += `বিবিসি বাংলা থেকে আজকের প্রধান প্রধান সকল ক্যাটাগরির সংবাদের উপস্থাপনা এখানেই শেষ হলো। ধন্যবাদ।`;

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", id: msg.id, 
          result: { content: [{ type: "text", text: script }] } 
        }));

      }
    } catch (e) {
      console.error("Message Error:", e.message);
    }
  });

  ws.on("close", () => {
    setTimeout(connect, 5000);
  });
}

connect();
