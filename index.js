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
  res.end("BBC Priority & Fallback News MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ── ১. প্রাইমারি সোর্স (BBC Bangla-র সকল ক্যাটাগরি + CNN) ──
const PRIMARY_SOURCES = [
  { name: "বিবিসি বাংলা - প্রচ্ছদ", url: "https://www.bbc.com/bengali/index.xml" },
  { name: "বিবিসি বাংলা - খবর", url: "https://www.bbc.com/bengali/news/index.xml" },
  { name: "বিবিসি বাংলা - আন্তর্জাতিক", url: "https://www.bbc.com/bengali/world/index.xml" },
  { name: "BBC Bangla - World", url: "https://feeds.bbci.co.uk/bengali/rss.xml" },
  { name: "CNN World", url: "http://rss.cnn.com/rss/edition_world.rss" }
];

// ── ২. ফলব্যাক সোর্স (BBC-তে পর্যাপ্ত খবর না থাকলে এগুলো ব্যবহার হবে) ──
const FALLBACK_SOURCES = [
  { name: "প্রথম আলো", url: "https://www.prothomalo.com/feed/bangladesh" },
  { name: "সময় টিভি", url: "https://www.somoynews.tv/rss/bangladesh" },
  { name: "ঢাকা পোস্ট", url: "https://www.dhakapost.com/rss/national.xml" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("BBC Priority News MCP connected!"));
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
              description: "বিবিসি বাংলার সকল ক্যাটাগরি ও সিএনএন এর খবর এবং ব্যাকআপ হিসেবে ফলব্যাক পোর্টের খবর পড়ার টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let bbcArticles = [];
        let fallbackArticles = [];

        // ১. আগে বিবিসি বাংলা ও সিএনএন এর ক্যাটাগরি ফিড ফেচ করা
        for (const source of PRIMARY_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const cleanContent = cleanText(item.contentSnippet || item.content || item.summary);
              if (cleanContent && cleanContent.length > 15) {
                bbcArticles.push({
                  title: cleanText(item.title),
                  content: cleanContent,
                  sourceName: source.name
                });
              }
            });
          } catch (e) {}
        }

        // ২. ব্যাকআপ বা ফলব্যাক ফিড ফেচ করা
        for (const source of FALLBACK_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const cleanContent = cleanText(item.contentSnippet || item.content || item.summary);
              if (cleanContent && cleanContent.length > 15) {
                fallbackArticles.push({
                  title: cleanText(item.title),
                  content: cleanContent,
                  sourceName: source.name
                });
              }
            });
          } catch (e) {}
        }

        // বিবিসি/সিএনএন-এর খবরকে সবার আগে অগ্রাধিকার দেওয়া হবে
        let combinedNews = [...bbcArticles];

        // যদি বিবিসি-র খবর কম থাকে, তবে ফলব্যাক থেকে যুক্ত করা হবে
        if (combinedNews.length < 8) {
          combinedNews = combinedNews.concat(fallbackArticles);
        }

        if (combinedNews.length === 0) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", id: msg.id, 
            result: { content: [{ type: "text", text: "রানা ভাই, বর্তমানে নতুন কোনো সংগৃহীত সংবাদ পাওয়া যায়নি।" }] } 
          }));
          return;
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' });
        const formattedTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

        // লুপ বা ওভারফ্লো এড়াতে সর্বোচ্চ ১০টি তাজা সংবাদ নেওয়া হচ্ছে
        const selectedArticles = combinedNews.slice(0, 10);

        let script = `আজ ${formattedDate}, সময় ${formattedTime}। বিবিসি বাংলা, সিএনএন এবং শীর্ষ সংবাদ মাধ্যম থেকে সংগৃহীত সংবাদ বুলেটিন শুরু করছি।\n\n`;

        selectedArticles.forEach((art, idx) => {
          script += `খবর ${idx + 1}: ${art.title}। মাধ্যম: ${art.sourceName}। বিস্তারিত: ${art.content}।\n\n`;
        });

        script += `আজকের সংগৃহীত বিবিসি বাংলা ও অন্যান্য আন্তর্জাতিক সংবাদ বিশ্লেষণ করে দেশ ও বিদেশের বর্তমান পরিস্থিতি তুলে ধরা হলো। এই ছিল আমাদের সংবাদ বুলেটিন। ধন্যবাদ।`;

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", id: msg.id, 
          result: { content: [{ type: "text", text: script }] } 
        }));

      }
    } catch (e) {
      console.error("Message Processing Error:", e.message);
    }
  });

  ws.on("close", () => {
    setTimeout(connect, 5000);
  });
}

connect();
