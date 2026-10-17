import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;

const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjI0OTc5NTgsImVuZHBvaW50SWQiOiJhZ2VudF8yNDk3OTU4IiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjI1MDg3MSwiZXhwIjoxODIzODA4NDcxfQ.xZFNwhfNq3sKAzL6ySs9ETVwy3ClJlGefCwEvr6ij_uzfXmErd_3ZW7OUDT3BzmVfX2EIxtM-wAxP4NJxPoCJA";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 10000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim().substring(0, 150);
}

// সংবাদের বিষয়বস্তু বিশ্লেষণ করে ক্যাটাগরি নির্ধারণ
function categorizeNews(title, content) {
  const text = (title + " " + content).toLowerCase();
  if (text.includes("রাজনীতি") || text.includes("নির্বাচন") || text.includes("সরকার") || text.includes("বিএনপি") || text.includes("দল") || text.includes("নেতা")) return "politics";
  if (text.includes("খেলা") || text.includes("ক্রিকেট") || text.includes("ফুটবল") || text.includes("ম্যাচ") || text.includes("সাকিব") || text.includes("বিসিবি")) return "sports";
  if (text.includes("আন্তর্জাতিক") || text.includes("বিশ্ব") || text.includes("ট্রাম্প") || text.includes("আমেরিকা") || text.includes("চীন") || text.includes("গাজা") || text.includes("রাশিয়া")) return "international";
  if (text.includes("প্রযুক্তি") || text.includes("আইটি") || text.includes("স্মার্টফোন") || text.includes("এআই") || text.includes("ফেসবুক") || text.includes("সফটওয়্যার")) return "tech";
  if (text.includes("বিনোদনে") || text.includes("সিনেমা") || text.includes("নাটক") || text.includes("তারকা") || text.includes("অভিনয়") || text.includes("গান")) return "showbiz";
  if (text.includes("জাতীয়") || text.includes("দেশ") || text.includes("ঢাকা") || text.includes("পুলিশ") || text.includes("আদালত") || text.includes("দুর্ঘটনা")) return "national";
  return "other";
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Popular Portals & BBC News MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ── বিবিসি বাংলা এবং জনপ্রিয় অনলাইন পোর্টালসমূহের ফিড ──
const NEWS_SOURCES = [
  { name: "বিবিসি বাংলা প্রধান", url: "https://www.bbc.com/bengali/index.xml" },
  { name: "বিবিসি বাংলা বিশ্ব", url: "https://www.bbc.com/bengali/world/index.xml" },
  { name: "প্রথম আলো বাংলাদেশ", url: "https://www.prothomalo.com/feed/bangladesh" },
  { name: "প্রথম আলো রাজনীতি", url: "https://www.prothomalo.com/feed/politics" },
  { name: "প্রথম আলো আন্তর্জাতিক", url: "https://www.prothomalo.com/feed/world" },
  { name: "বাংলানিউজটোয়েন্টিফোর", url: "https://www.banglanews24.com/rss/rss.xml" },
  { name: "বিডিনিউজ টোয়েন্টিফোর", url: "https://bangla.bdnews24.com/?widget=rss&get=all" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("Popular Portals News MCP connected!"));
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
              description: "জনপ্রিয় অনলাইন পোর্টাল ও বিবিসি বাংলা থেকে সিকোয়েন্স অনুযায়ী খবর পড়ার টুল।",
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
        let allArticles = [];

        // ফিডগুলো থেকে ডেটা ফেচ ও ক্যাটাগরি অনুযায়ী সাজানো
        for (const source of NEWS_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              const title = cleanText(item.title);
              const content = cleanText(item.contentSnippet || item.content || item.summary);
              
              if (title && !seenTitles.has(title) && content.length > 10) {
                seenTitles.add(title);
                const category = categorizeNews(title, content);
                const articleObj = { title, content, sourceName: source.name };
                newsByCat[category].push(articleObj);
                allArticles.push(articleObj);
              }
            });
          } catch (e) {}
        }

        if (allArticles.length === 0) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", id: msg.id, 
            result: { content: [{ type: "text", text: "রানা ভাই, এই মুহূর্তে নতুন সংবাদ ফেচ করা যাচ্ছে না। একটু পর আবার চেষ্টা করুন।" }] } 
          }));
          return;
        }

        const now = new Date();
        const formattedDate = now.toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' });
        const formattedTime = now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' });

        let script = `আজ ${formattedDate}, সময় ${formattedTime}। বিবিসি বাংলা এবং জনপ্রিয় অনলাইন পোর্টাল থেকে সংবাদ বুলেটিন শুরু করছি।\n\n`;

        const addSection = (sectionHeader, items, fallbackItems = []) => {
          const targetItems = items.length > 0 ? items : fallbackItems;
          if (targetItems.length === 0) return "";
          
          let sectionText = `--- ${sectionHeader} ---\n`;
          targetItems.slice(0, 2).forEach((art) => {
            sectionText += `সংবাদ: ${art.title}। মাধ্যম: ${art.sourceName}। বিস্তারিত: ${art.content}।\n\n`;
          });
          return sectionText;
        };

        // নির্দিষ্ট ৭টি সিকোয়েন্সে খবর সাজানো
        script += addSection("রাজনৈতিক সংবাদ", newsByCat.politics, allArticles.slice(0, 2));
        script += addSection("জাতীয় সংবাদ", newsByCat.national, allArticles.slice(2, 4));
        script += addSection("দেশের অন্যান্য সংবাদ", newsByCat.other, allArticles.slice(4, 6));
        script += addSection("আন্তর্জাতিক সংবাদ", newsByCat.international, allArticles.slice(0, 2));
        script += addSection("খেলাধুলার খবর", newsByCat.sports, allArticles.slice(2, 4));
        script += addSection("বিনোদন জগতের খবর", newsByCat.showbiz, allArticles.slice(4, 6));
        script += addSection("তথ্য ও প্রযুক্তি সংবাদ", newsByCat.tech, allArticles.slice(0, 2));

        script += `আজকের সংবাদ বুলেটিন এখানেই শেষ হলো। ধন্যবাদ।`;

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
