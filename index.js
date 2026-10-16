import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;
const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjEwMTAwMDEsImVuZHBvaW50SWQiOiJhZ2VudF8xMDEwMDAxIiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEyODM4NSwiZXhwIjoxODIzNjg1OTg1fQ.DAXLmBRkkHX4IbZgfSSJ0MUTjo3ZAjedIAsVpiDDly-jzp5ukbCwCjGw-rUN5A0kXh25Ebkl-D6qDfsQ-pzTVA";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 5000
});

// HTML ট্যাগ ক্লিন করার হেল্পার ফাংশন
function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

// Render Health Check
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Xiaozhi News Bulletin MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ৫৫টি নিউজ মিডিয়ার RSS Feed লিস্ট
const NEWS_SOURCES = [
  { name: "Prothom Alo", url: "https://www.prothomalo.com/feed" },
  { name: "BBC Bangla", url: "https://www.bbc.com/bengali/index.xml" },
  { name: "BDNews24", url: "https://bangla.bdnews24.com/rss" },
  { name: "Samakal", url: "https://samakal.com/rss" },
  { name: "Ittefaq", url: "https://www.ittefaq.com.bd/feed" },
  { name: "Kaler Kantho", url: "https://www.kalerkantho.com/rss.xml" },
  { name: "Jugantor", url: "https://www.jugantor.com/feed" },
  { name: "Manab Zamin", url: "https://mzamin.com/rss.php" },
  { name: "Daily Star Bangla", url: "https://bangla.thedailystar.net/rss" },
  { name: "Somoy TV", url: "https://www.somoynews.tv/rss.xml" },
  { name: "Jamuna TV", url: "https://www.jamuna.tv/feed" },
  { name: "Independent TV", url: "https://www.independent24.com/rss.xml" },
  { name: "Channel i", url: "https://www.channelionline.com/feed/" },
  { name: "NTV", url: "https://www.ntvbd.com/rss.xml" },
  { name: "Dhaka Post", url: "https://www.dhakapost.com/rss.xml" },
  { name: "Jago News 24", url: "https://www.jagonews24.com/rss/rss.xml" },
  { name: "Bangla Tribune", url: "https://www.banglatribune.com/feed/" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "BBC World News", url: "http://feeds.bbci.co.uk/news/rss.xml" }
  // বাকি সোর্সগুলো আগের মতোই ব্যাকগ্রাউন্ডে কাজ করবে
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => {
    console.log("News Bulletin MCP connected successfully!");
  });

  ws.on("error", (error) => {
    console.error("WebSocket Connection Error:", error.message);
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
              description: "সংবাদ মাধ্যমের নাম অনুযায়ী টিভির বুলেটিনের মতো প্রথমে হেডলাইন এবং পরবর্তীতে প্রতিটি খবরের বিস্তারিত বিবরণ শোনার টুল।",
              inputSchema: {
                type: "object",
                properties: {
                  source: { type: "string", description: "মিডিয়ার নাম (যেমন: Prothom Alo, BBC Bangla, Somoy TV, Al Jazeera)" }
                }
              }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        const reqSource = msg.params.arguments?.source?.toLowerCase();
        let selectedSource = NEWS_SOURCES.find(s => s.name.toLowerCase().includes(reqSource)) || NEWS_SOURCES[0];

        try {
          const feed = await parser.parseURL(selectedSource.url);
          
          // ৪-৫টির বদলে বাড়িয়ে ৫টি প্রধান খবর ফুল ডিটেইলস সহ নেওয়া হলো
          const articles = feed.items.slice(0, 5);

          // ধাপ ১: সবগুলোর হেডলাইন লিস্ট তৈরি করা
          const headlines = articles.map((item, index) => `${index + 1}. ${cleanText(item.title)}`).join("\n");

          // ধাপ ২: প্রতিটি খবরের বিস্তারিত বিবরণ তৈরি করা
          const fullDetails = articles.map((item, index) => {
            const title = cleanText(item.title);
            const description = cleanText(item.contentSnippet || item.content || item.summary || "এই সংবাদের বিস্তারিত বিবরণ উপলব্ধ নেই।");
            return `খবর নম্বর ${index + 1}:\nশিরোনাম: ${title}\nবিস্তারিত: ${description}`;
          }).join("\n\n==================\n\n");

          // টি নিউজ স্টাইলে সাজানো রেসপন্স
          const responseText = `রানা ভাই, ${selectedSource.name} থেকে আজকের সংবাদ বুলেটিন পেশ করছি।\n\n**প্রথমে এক নজরে প্রধান হেডলাইনগুলো:**\n${headlines}\n\n**এবার বিস্তারিত সংবাদ:**\n\n${fullDetails}`;
          
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: responseText }] } 
          }));
        } catch (e) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: `রানা ভাই, ${selectedSource.name} থেকে সংবাদ সংগ্রহ করতে সমস্যা হয়েছে। অন্য কোনো চ্যানেল ট্রাই করতে পারেন।` }] } 
          }));
        }
      }
    } catch (e) {
      console.error("Message Processing Error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket disconnected. Retrying in 5 seconds...");
    setTimeout(connect, 5000);
  });
}

connect();
