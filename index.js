import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;

// আপনার নতুন সচল টোকেনসহ URL
const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjI0OTc5NTgsImVuZHBvaW50SWQiOiJhZ2VudF8yNDk3OTU4IiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEzODU0MywiZXhwIjoxODIzNjk2MTQzfQ.F4FFJg5FiZDpepoTk_YKvaeQ3WiW6Y7z0XDHfSUR_yo1vF2EWTlxgvTN05FE0v3T5fU_FfRbrr5eaZn2NRpXXw";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 6000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

// ২৫ ঘণ্টার পুরনো খবর ফিল্টার করার ফাংশন
function isWithinLast24Hours(pubDate) {
  if (!pubDate) return true;
  const articleDate = new Date(pubDate);
  const now = new Date();
  const diffInHours = (now - articleDate) / (1000 * 60 * 60);
  return diffInHours <= 25;
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Xiaozhi Real-Time News MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// সমৃদ্ধ RSS মিডিয়া লিস্ট (রাজনীতি, বিনোদন, বিজ্ঞান-প্রযুক্তি, আন্তর্জাতিক ও খেলাধুলা)
const NEWS_SOURCES = [
  // ── রাজনীতি ও জাতীয় (বাংলাদেশ) ──
  { name: "প্রথম আলো", url: "https://www.prothomalo.com/feed", category: "politics" },
  { name: "সময় টিভি", url: "https://www.somoynews.tv/rss.xml", category: "politics" },
  { name: "যমুনা টিভি", url: "https://www.jamuna.tv/feed", category: "politics" },
  { name: "বিডিনিউজ২৪", url: "https://bangla.bdnews24.com/rss", category: "politics" },
  { name: "সমকাল", url: "https://samakal.com/rss", category: "politics" },
  { name: "ইত্তেফাক", url: "https://www.ittefaq.com.bd/feed", category: "politics" },
  { name: "যুগান্তর", url: "https://www.jugantor.com/feed", category: "politics" },

  // ── বিনোদন ও শোবিজ (Showbiz) ──
  { name: "প্রথম আলো বিনোদন", url: "https://www.prothomalo.com/feed/entertainment", category: "showbiz" },
  { name: "ঢাকাপোস্ট বিনোদন", url: "https://www.dhakapost.com/rss/entertainment.xml", category: "showbiz" },
  { name: "জাগোনিউজ শোবিজ", url: "https://www.jagonews24.com/rss/entertainment.xml", category: "showbiz" },
  { name: "চ্যানেল আই আনন্দধারা", url: "https://www.channelionline.com/category/entertainment/feed/", category: "showbiz" },

  // ── বিজ্ঞান ও প্রযুক্তি (Science & Tech) ──
  { name: "টেকশহর", url: "https://techshohor.com/feed/", category: "tech" },
  { name: "টেকটিউনস", url: "https://www.techtunes.co/feed/", category: "tech" },
  { name: "প্রথম আলো টেকনোলজি", url: "https://www.prothomalo.com/feed/technology", category: "tech" },
  { name: "The Verge Tech", url: "https://www.theverge.com/rss/index.xml", category: "tech" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "tech" },

  // ── আন্তর্জাতিক ──
  { name: "বিবিসি বাংলা", url: "https://www.bbc.com/bengali/index.xml", category: "international" },
  { name: "ডয়েচে ভেলে বাংলা", url: "https://rss.dw.com/xml/rss-ben-news", category: "international" },
  { name: "আল জাজিরা", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "international" },

  // ── খেলাধুলা ──
  { name: "ক্রিকফ্রেনজি", url: "https://www.cricfrenzy.com/rss.xml", category: "sports" },
  { name: "স্পোর্টস২৪", url: "https://www.sports24.com.bd/feed/", category: "sports" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("Real-time News MCP connected successfully!"));
  
  ws.on("error", (error) => {
    console.error("WS Connection Error:", error.message);
  });

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.method === "tools/list") {
        ws.send(JSON.stringify({
          jsonrpc: "2.0", id: msg.id,
          result: {
            tools: [{
              name: "get_latest_news",
              description: "আজকের লাইভ তারিখ ও সময়সহ গত ২৪ ঘণ্টার ব্রেকিং নিউজ, রাজনীতি, শোবিজ, সায়েন্স-টেক ও খেলাধুলার খবর পড়ার ইন্টারঅ্যাক্টিভ টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let freshArticles = [];

        // সব সোর্স স্ক্যান করে গত ২৪ ঘণ্টার খবর ফিল্টার
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

        // সবচেয়ে রিসেন্ট খবরগুলো আগে পাওয়ার জন্য সর্ট
        freshArticles.sort((a, b) => b.pubDate - a.pubDate);

        if (freshArticles.length === 0) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: "রানা ভাই, এই মুহূর্তে গত ২৪ ঘণ্টার কোনো নতুন ব্রেকিং নিউজ আপডেট পাওয়া যায়নি। একটু পর আবার চেষ্টা করুন।" }] } 
          }));
          return;
        }

        // বর্তমান তারিখ এবং সময় ফরম্যাট করা
        const now = new Date();
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' };
        const timeOptions = { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' };
        
        const formattedDate = now.toLocaleDateString('bn-BD', dateOptions);
        const formattedTime = now.toLocaleTimeString('bn-BD', timeOptions);

        const topArticle = freshArticles[0];

        const responseText = `রানা ভাই, আজ ${formattedDate}, সময় ${formattedTime} পর্যন্ত পাওয়া গত ২৪ ঘণ্টার আপডেট ব্রেকিং নিউজ পেশ করছি।\n\n` +
          `**ব্রেকিং নিউজ [উৎস: ${topArticle.sourceName}]:**\n` +
          `"${topArticle.title}"\n\n` +
          `[রানা ভাই, আপনি কি এই সংবাদের বিস্তারিত জানতে চান?]\n\n` +
          `(বিস্তারিত বিবরণ: ${topArticle.content})`;

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", 
          id: msg.id, 
          result: { content: [{ type: "text", text: responseText }] } 
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
