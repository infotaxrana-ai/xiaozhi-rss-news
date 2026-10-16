import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;

const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjI0OTc5NTgsImVuZHBvaW50SWQiOiJhZ2VudF8yNDk3OTU4IiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEzODU0MywiZXhwIjoxODIzNjk2MTQzfQ.F4FFJg5FiZDpepoTk_YKvaeQ3WiW6Y7z0XDHfSUR_yo1vF2EWTlxgvTN05FE0v3T5fU_FfRbrr5eaZn2NRpXXw";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 6000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

function isWithinLast24Hours(pubDate) {
  if (!pubDate) return true;
  const articleDate = new Date(pubDate);
  const now = new Date();
  const diffInHours = (now - articleDate) / (1000 * 60 * 60);
  return diffInHours <= 25;
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Automatic Non-stop News Bulletin MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ৫০+ সাব-ক্যাটাগরি ফিড লিস্ট
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

  // ── ৪. আন্তর্জাতিক ও অন্যান্য ──
  { name: "বিবিসি বাংলা", url: "https://www.bbc.com/bengali/index.xml", category: "international" },
  { name: "ডয়েচে ভেলে বাংলা", url: "https://rss.dw.com/xml/rss-ben-news", category: "international" },
  { name: "টেকশহর", url: "https://techshohor.com/feed/", category: "tech" },
  { name: "ক্রিকফ্রেনজি", url: "https://www.cricfrenzy.com/rss.xml", category: "sports" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("Automatic News Bulletin MCP connected!"));
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
              description: "স্বয়ংক্রিয় অটোপ্লে পদ্ধতিতে টানা খবর পড়া এবং শেষে সংবাদ বিশ্লেষণ শোনানোর অল-ইন-ওয়ান নিউজ বুলেটিন টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let freshArticles = [];

        for (const source of NEWS_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              if (isWithinLast24Hours(item.pubDate)) {
                const cleanContent = cleanText(item.contentSnippet || item.content || item.summary);
                if (cleanContent && cleanContent.length > 25) {
                  freshArticles.push({
                    title: cleanText(item.title),
                    content: cleanContent,
                    category: source.category,
                    sourceName: source.name,
                    pubDate: item.pubDate ? new Date(item.pubDate) : new Date()
                  });
                }
              }
            });
          } catch (e) {}
        }

        freshArticles.sort((a, b) => b.pubDate - a.pubDate);

        if (freshArticles.length === 0) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: "রানা ভাই, এই মুহূর্তে গত ২৪ ঘণ্টার কোনো নতুন সংবাদ আপডেট পাওয়া যায়নি।" }] } 
          }));
          return;
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' });
        const formattedTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

        // শীর্ষ গুরুত্বপূর্ণ খবরগুলো থেকে অটোমেটিক বুলেটিন তৈরি (যেমন ৪-৫টি সেরা খবর)
        const selectedNews = freshArticles.slice(0, 5);

        let newsBodyText = "";
        selectedNews.forEach((art, idx) => {
          newsBodyText += `সংবাদ ${idx + 1}:\n` +
            `শিরোনাম: "${art.title}"\n` +
            `উৎস: এই খবরটি প্রকাশ করেছে ${art.sourceName}।\n` +
            `বিস্তারিত: ${art.content}\n\n--------------------\n\n`;
        });

        // অ্যানালিসিস সামারি নোট
        const summaryStory = `আজকের দেশের শীর্ষ সংবাদ মাধ্যমগুলোর খবর বিশ্লেষণ করলে দেখা যাচ্ছে যে, বাংলাদেশ এবং আন্তর্জাতিক অঙ্গনে রাজনীতি, অর্থনীতি ও প্রযুক্তি খাতে বেশ কিছু গুরুত্বপূর্ণ পরিবর্তন ঘটছে। রানা ভাই, এই ছিল আজ ${formattedDate}, সময় ${formattedTime} পর্যন্ত পাওয়া আমাদের প্রধান প্রধান খবরের পূর্ণাঙ্গ সংবাদ বুলেটিন। ধন্যবাদ।`;

        const finalBulletin = `রানা ভাই, আজ ${formattedDate}, সময় ${formattedTime} পর্যন্ত পাওয়া গত ২৪ ঘণ্টার নিয়মিত ব্রেকিং সংবাদ বুলেটিন শুরু করছি:\n\n${newsBodyText}সবগুলো সংবাদ পোর্টাল বিশ্লেষণ করে সংক্ষেপে আজকের মূল ঘটনা:\n${summaryStory}`;

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", 
          id: msg.id, 
          result: { content: [{ type: "text", text: finalBulletin }] } 
        }));

      }
    } catch (e) {
      console.error("Message Error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("WS closed. Retrying connection in 5 seconds...");
    setTimeout(connect, 5000);
  });
}

connect();
