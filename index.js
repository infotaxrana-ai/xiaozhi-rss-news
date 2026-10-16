import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;
const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjEwMTAwMDEsImVuZHBvaW50SWQiOiJhZ2VudF8xMDEwMDAxIiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEyODM4NSwiZXhwIjoxODIzNjg1OTg1fQ.DAXLmBRkkHX4IbZgfSSJ0MUTjo3ZAjedIAsVpiDDly-jzp5ukbCwCjGw-rUN5A0kXh25Ebkl-D6qDfsQ-pzTVA";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 6000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Interactive News MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

const NEWS_SOURCES = [
  // বাংলাদেশ রাজনীতি ও জাতীয়
  { name: "Prothom Alo", url: "https://www.prothomalo.com/feed", category: "politics" },
  { name: "Somoy TV", url: "https://www.somoynews.tv/rss.xml", category: "politics" },
  { name: "Jamuna TV", url: "https://www.jamuna.tv/feed", category: "politics" },
  { name: "BDNews24", url: "https://bangla.bdnews24.com/rss", category: "politics" },
  { name: "Samakal", url: "https://samakal.com/rss", category: "politics" },
  { name: "Jugantor", url: "https://www.jugantor.com/feed", category: "politics" },

  // আন্তর্জাতিক
  { name: "BBC Bangla", url: "https://www.bbc.com/bengali/index.xml", category: "international" },
  { name: "Deutsche Welle Bangla", url: "https://rss.dw.com/xml/rss-ben-news", category: "international" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "international" },
  { name: "Reuters Top News", url: "https://www.reutersagency.com/feed/?best-topics=top-news", category: "international" },

  // খেলাধুলা
  { name: "Cricfrenzy", url: "https://www.cricfrenzy.com/rss.xml", category: "sports" },
  { name: "Sports24", url: "https://www.sports24.com.bd/feed/", category: "sports" }
];

function connect() {
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("Interactive News MCP connected successfully!"));
  ws.on("error", (error) => console.error("WS Error:", error.message));

  ws.on("message", async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.method === "tools/list") {
        ws.send(JSON.stringify({
          jsonrpc: "2.0", id: msg.id,
          result: {
            tools: [{
              name: "get_latest_news",
              description: "প্রতিটি সংবাদের শিরোনাম বলে ব্যবহারকারীকে জিজ্ঞাসা করবে বিস্তারিত শুনতে চান কিনা। রাজনীতি, আন্তর্জাতিক ও খেলাধুলার ধারাবাহিক পোর্টালে সাজানো তথ্য দিতে পারে।",
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
                  category: source.category,
                  sourceName: source.name
                });
              }
            });
          } catch (e) {}
        }

        // যদি কোনো কারণে আর্টিকেল কম পাওয়া যায় তবে সাধারণ ক্যাটাগরিতে ব্যাকআপ আর্টিকেলে যাবে
        if (allArticles.length === 0) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: "রানা ভাই, বর্তমানে সার্ভারে সংবাদ রিফ্রেশ হচ্ছে। অনুগ্রহ করে আর ১০ সেকেন্ড পর আবার চেষ্টা করুন।" }] } 
          }));
          return;
        }

        // প্রথম প্রধান ব্রেকিং খবরটি বাছাই করা
        const firstArticle = allArticles[0];

        // AI এর জন্য বিশেষ নির্দেশনা যুক্ত উত্তর ফরম্যাট
        const responseText = `রানা ভাই, এই মুহূর্তের ব্রেকিং নিউজ [${firstArticle.sourceName}]:\n\n` +
          `"${firstArticle.title}"\n\n` +
          `[রানা ভাই, আপনি কি এই সংবাদের বিস্তারিত বিবরণ শুনতে চান?]\n\n` +
          `(সম্পূর্ণ বিবরণ ডাটাবেজে তৈরি রয়েছে: ${firstArticle.content})`;

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", 
          id: msg.id, 
          result: { content: [{ type: "text", text: responseText }] } 
        }));

      }
    } catch (e) {}
  });

  ws.on("close", () => setTimeout(connect, 5000));
}

connect();
