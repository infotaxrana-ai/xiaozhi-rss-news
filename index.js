import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;

const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjI0OTc5NTgsImVuZHBvaW50SWQiOiJhZ2VudF8yNDk3OTU4IiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEzODU0MywiZXhwIjoxODIzNjk2MTQzfQ.F4FFJg5FiZDpepoTk_YKvaeQ3WiW6Y7z0XDHfSUR_yo1vF2EWTlxgvTN05FE0v3T5fU_FfRbrr5eaZn2NRpXXw";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 10000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

// ফ্লেক্সিবল ডেট ফিল্টার (সর্বোচ্চ ৪৮ ঘণ্টা)
function isFreshNews(pubDateStr, isoDateStr) {
  const dateStr = pubDateStr || isoDateStr;
  if (!dateStr) return true; // তারিখের ট্যাগ না থাকলেও খবরটি নেওয়া হবে
  
  const articleDate = new Date(dateStr);
  if (isNaN(articleDate.getTime())) return true; // ডেট পার্স না হলে বাদ দেওয়া হবে না

  const now = new Date();
  const diffInHours = (now - articleDate) / (1000 * 60 * 60);
  return diffInHours <= 48; // ৪৮ ঘণ্টার মধ্যে হলে নিবে
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Robust High-Availability News MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ৫০+ ক্যাটাগরি মিডিয়া তালিকা
const NEWS_SOURCES = [
  // ── ১. প্রথম আলো ──
  { name: "প্রথম আলো জাতীয়", url: "https://www.prothomalo.com/feed/bangladesh", category: "politics" },
  { name: "প্রথম আলো রাজনীতি", url: "https://www.prothomalo.com/feed/politics", category: "politics" },
  { name: "প্রথম আলো আন্তর্জাতিক", url: "https://www.prothomalo.com/feed/world", category: "international" },
  { name: "প্রথম আলো খেলাধুলা", url: "https://www.prothomalo.com/feed/sports", category: "sports" },
  { name: "প্রথম আলো বিনোদন", url: "https://www.prothomalo.com/feed/entertainment", category: "showbiz" },
  { name: "প্রথম আলো প্রযুক্তি", url: "https://www.prothomalo.com/feed/technology", category: "tech" },

  // ── ২. সময় টিভি ──
  { name: "সময় টিভি জাতীয়", url: "https://www.somoynews.tv/rss/bangladesh", category: "politics" },
  { name: "সময় টিভি রাজনীতি", url: "https://www.somoynews.tv/rss/politics", category: "politics" },
  { name: "সময় টিভি আন্তর্জাতিক", url: "https://www.somoynews.tv/rss/world", category: "international" },
  { name: "সময় টিভি বিনোদন", url: "https://www.somoynews.tv/rss/entertainment", category: "showbiz" },
  { name: "সময় টিভি প্রযুক্তি", url: "https://www.somoynews.tv/rss/tech", category: "tech" },
  { name: "সময় টিভি খেলাধুলা", url: "https://www.somoynews.tv/rss/sports", category: "sports" },

  // ── ৩. ঢাকা পোস্ট ──
  { name: "ঢাকা পোস্ট জাতীয়", url: "https://www.dhakapost.com/rss/national.xml", category: "politics" },
  { name: "ঢাকা পোস্ট আন্তর্জাতিক", url: "https://www.dhakapost.com/rss/international.xml", category: "international" },
  { name: "ঢাকা পোস্ট বিনোদন", url: "https://www.dhakapost.com/rss/entertainment.xml", category: "showbiz" },
  { name: "ঢাকা পোস্ট প্রযুক্তি", url: "https://www.dhakapost.com/rss/tech.xml", category: "tech" },
  { name: "ঢাকা পোস্ট খেলাধুলা", url: "https://www.dhakapost.com/rss/sports.xml", category: "sports" },

  // ── ৪. জাগো নিউজ ২৪ ──
  { name: "জাগো নিউজ জাতীয়", url: "https://www.jagonews24.com/rss/national.xml", category: "politics" },
  { name: "জাগো নিউজ আন্তর্জাতিক", url: "https://www.jagonews24.com/rss/international.xml", category: "international" },
  { name: "জাগো নিউজ বিনোদন", url: "https://www.jagonews24.com/rss/entertainment.xml", category: "showbiz" },
  { name: "জাগো নিউজ প্রযুক্তি", url: "https://www.jagonews24.com/rss/technology.xml", category: "tech" },
  { name: "জাগো নিউজ খেলাধুলা", url: "https://www.jagonews24.com/rss/sports.xml", category: "sports" },

  // ── ৫. আন্তর্জাতিক ও স্পেশাল ──
  { name: "বিবিসি বাংলা", url: "https://www.bbc.com/bengali/index.xml", category: "international" },
  { name: "ডয়েচে ভেলে বাংলা", url: "https://rss.dw.com/xml/rss-ben-news", category: "international" },
  { name: "টেকশহর", url: "https://techshohor.com/feed/", category: "tech" },
  { name: "ক্রিকফ্রেনজি", url: "https://www.cricfrenzy.com/rss.xml", category: "sports" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("High-Availability News MCP connected!"));
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
              description: "সংবাদ পোর্টালের লাইভ ক্যাটাগরি অনুযায়ী খবর পড়ার টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let freshArticles = [];
        let fallbackArticles = [];

        for (const source of NEWS_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const cleanContent = cleanText(item.contentSnippet || item.content || item.summary);
              if (cleanContent && cleanContent.length > 20) {
                const articleData = {
                  title: cleanText(item.title),
                  content: cleanContent,
                  category: source.category,
                  sourceName: source.name,
                  pubDate: item.pubDate || item.isoDate ? new Date(item.pubDate || item.isoDate) : new Date()
                };

                fallbackArticles.push(articleData); // ব্যাকআপ
                if (isFreshNews(item.pubDate, item.isoDate)) {
                  freshArticles.push(articleData); // ফিল্টার করা খবর
                }
              }
            });
          } catch (e) {}
        }

        // যদি ফিল্টার করার পর খবর না পাওয়া যায় তবে ফিডের ব্যাকআপ নিউজ থেকে নেওয়া হবে
        let finalArticles = freshArticles.length > 0 ? freshArticles : fallbackArticles;

        finalArticles.sort((a, b) => b.pubDate - a.pubDate);

        const now = new Date();
        const formattedDate = now.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' });
        const formattedTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

        const politicsNews = finalArticles.filter(a => a.category === 'politics');
        const intlNews = finalArticles.filter(a => a.category === 'international');
        const sportsNews = finalArticles.filter(a => a.category === 'sports');
        const showbizNews = finalArticles.filter(a => a.category === 'showbiz');
        const techNews = finalArticles.filter(a => a.category === 'tech');

        let script = `আজ ${formattedDate}, সময় ${formattedTime}। সাম্প্রতিক সময়ের সকল খবরের পূর্ণাঙ্গ সংবাদ বুলেটিন শুরু করছি।\n\n`;

        const appendCategory = (catTitle, items) => {
          if (items.length === 0) return "";
          let text = `--- ${catTitle} --- \n`;
          items.forEach((art) => {
            text += `শিরোনাম: ${art.title}। এই খবরটি প্রকাশ করেছে ${art.sourceName}। বিস্তারিত: ${art.content}।\n\n`;
          });
          return text;
        };

        script += appendCategory("জাতীয় ও রাজনীতি", politicsNews);
        script += appendCategory("আন্তর্জাতিক", intlNews);
        script += appendCategory("খেলাধুলা", sportsNews);
        script += appendCategory("শোবিজ ও বিনোদন", showbizNews);
        script += appendCategory("বিজ্ঞান ও প্রযুক্তি", techNews);

        script += `আজকের সংগৃহীত সকল খবর বিশ্লেষণ করে দেখা যাচ্ছে যে, বিভিন্ন ক্যাটাগরিতে সাম্প্রতিক সময়ে বেশ কিছু গুরুত্বপূর্ণ ঘটনা ঘটেছে। এই ছিল আমাদের পূর্ণাঙ্গ সংবাদ বুলেটিন। ধন্যবাদ।`;

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", 
          id: msg.id, 
          result: { content: [{ type: "text", text: script }] } 
        }));

      }
    } catch (e) {
      console.error("Message Processing Error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("WS closed. Retrying connection in 5 seconds...");
    setTimeout(connect, 5000);
  });
}

connect();
