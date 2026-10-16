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

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Absolute Unlimited News Stream MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

const NEWS_SOURCES = [
  { name: "প্রথম আলো জাতীয়", url: "https://www.prothomalo.com/feed/bangladesh" },
  { name: "প্রথম আলো রাজনীতি", url: "https://www.prothomalo.com/feed/politics" },
  { name: "প্রথম আলো আন্তর্জাতিক", url: "https://www.prothomalo.com/feed/world" },
  { name: "প্রথম আলো বিনোদন", url: "https://www.prothomalo.com/feed/entertainment" },
  { name: "প্রথম আলো খেলাধুলা", url: "https://www.prothomalo.com/feed/sports" },
  { name: "প্রথম আলো প্রযুক্তি", url: "https://www.prothomalo.com/feed/technology" },
  { name: "সময় টিভি জাতীয়", url: "https://www.somoynews.tv/rss/bangladesh" },
  { name: "সময় টিভি রাজনীতি", url: "https://www.somoynews.tv/rss/politics" },
  { name: "ঢাকা পোস্ট জাতীয়", url: "https://www.dhakapost.com/rss/national.xml" },
  { name: "ঢাকা পোস্ট বিনোদন", url: "https://www.dhakapost.com/rss/entertainment.xml" },
  { name: "বিবিসি বাংলা", url: "https://www.bbc.com/bengali/index.xml" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("Absolute Unlimited News MCP connected!"));
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
              description: "কোনো প্রকার লিমিট ছাড়া সকল সংবাদ একটানা রিডআউট করার টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let allArticles = [];

        for (const source of NEWS_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const cleanContent = cleanText(item.contentSnippet || item.content || item.summary);
              if (cleanContent && cleanContent.length > 20) {
                allArticles.push({
                  title: cleanText(item.title),
                  content: cleanContent,
                  sourceName: source.name
                });
              }
            });
          } catch (e) {}
        }

        if (allArticles.length === 0) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", id: msg.id, 
            result: { content: [{ type: "text", text: "রানা ভাই, এই মুহূর্তে নতুন সংবাদ ফেচ করা হচ্ছে। একটু পর আবার চেষ্টা করুন।" }] } 
          }));
          return;
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' });
        const formattedTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

        // কোনো .slice() বা কাটছাঁট নেই — ফেচ হওয়া সবগুলো খবরই যাবে!
        let script = `আজ ${formattedDate}, সময় ${formattedTime}। সকল ক্যাটাগরির সংবাদ বুলেটিন শুরু করছি।\n\n`;

        allArticles.forEach((art, idx) => {
          script += `খবর ${idx + 1}: ${art.title}। উৎস: ${art.sourceName}। বিস্তারিত: ${art.content}।\n\n`;
        });

        script += `আজকের সংগৃহীত সকল সংবাদ পোর্টালের খবর বিশ্লেষণ করে দেশের ও বিদেশের বর্তমান পরিস্থিতি তুলে ধরা হলো। এই ছিল আমাদের আজকের পূর্ণাঙ্গ সংবাদ বুলেটিন।`;

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
