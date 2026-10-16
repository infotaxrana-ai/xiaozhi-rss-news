import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;
const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjEwMTAwMDEsImVuZHBvaW50SWQiOiJhZ2VudF8xMDEwMDAxIiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEyODM4NSwiZXhwIjoxODIzNjg1OTg1fQ.DAXLmBRkkHX4IbZgfSSJ0MUTjo3ZAjedIAsVpiDDly-jzp5ukbCwCjGw-rUN5A0kXh25Ebkl-D6qDfsQ-pzTVA";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 5000
});

function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Comprehensive News Bulletin MCP is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// বাংলাদেশ, ভারত (৩টি) এবং আন্তর্জাতিক (কমপক্ষে ৫টি) সহ সমস্ত সংবাদ মাধ্যমের তালিকা
const NEWS_SOURCES = [
  // ── বাংলাদেশের প্রধান সংবাদ মাধ্যম ও টিভি চ্যানেল ──
  { name: "Prothom Alo", url: "https://www.prothomalo.com/feed", category: "others" },
  { name: "BBC Bangla", url: "https://www.bbc.com/bengali/index.xml", category: "international" },
  { name: "BDNews24", url: "https://bangla.bdnews24.com/rss", category: "others" },
  { name: "Samakal", url: "https://samakal.com/rss", category: "politics" },
  { name: "Ittefaq", url: "https://www.ittefaq.com.bd/feed", category: "others" },
  { name: "Kaler Kantho", url: "https://www.kalerkantho.com/rss.xml", category: "others" },
  { name: "Jugantor", url: "https://www.jugantor.com/feed", category: "politics" },
  { name: "Manab Zamin", url: "https://mzamin.com/rss.php", category: "politics" },
  { name: "Daily Star Bangla", url: "https://bangla.thedailystar.net/rss", category: "others" },
  { name: "Naya Diganta", url: "https://www.dailynayadiganta.com/rss", category: "politics" },
  { name: "Janakantha", url: "https://www.dailyjanakantha.com/rss.xml", category: "others" },
  { name: "Bhorer Kagoj", url: "https://www.bhorerkagoj.com/feed/", category: "others" },
  { name: "Jaijaidin", url: "https://www.jaijaidinbd.com/rss.xml", category: "others" },
  { name: "Daily Inqilab", url: "https://www.dailyinqilab.com/rss.xml", category: "politics" },
  { name: "Amader Shomoy", url: "https://www.dainikamadershomoy.com/rss.xml", category: "others" },
  
  // টিভি চ্যানেল (বাংলাদেশ)
  { name: "Somoy TV", url: "https://www.somoynews.tv/rss.xml", category: "politics" },
  { name: "Jamuna TV", url: "https://www.jamuna.tv/feed", category: "politics" },
  { name: "Independent TV", url: "https://www.independent24.com/rss.xml", category: "politics" },
  { name: "Channel i", url: "https://www.channelionline.com/feed/", category: "others" },
  { name: "NTV", url: "https://www.ntvbd.com/rss.xml", category: "others" },
  { name: "ATN News", url: "https://www.atnnewstv.com/feed/", category: "politics" },
  { name: "Ekattor TV", url: "https://ekattor.tv/feed/", category: "politics" },
  { name: "News24", url: "https://www.news24bd.tv/rss.xml", category: "others" },
  { name: "DBC News", url: "https://dbcnews.tv/feed/", category: "politics" },
  { name: "RTV", url: "https://www.rtvonline.com/feed/", category: "others" },

  // অনলাইন নিউজ পোর্টাল (বাংলাদেশ)
  { name: "Dhaka Post", url: "https://www.dhakapost.com/rss.xml", category: "others" },
  { name: "Jago News 24", url: "https://www.jagonews24.com/rss/rss.xml", category: "others" },
  { name: "Bangla Tribune", url: "https://www.banglatribune.com/feed/", category: "politics" },
  { name: "RisingBD", url: "https://www.risingbd.com/rss.xml", category: "others" },
  { name: "Barta24", url: "https://barta24.com/rss.xml", category: "others" },
  { name: "Channel24", url: "https://www.channel24bd.tv/feed/", category: "others" },
  { name: "BD Pratidin", url: "https://www.bd-pratidin.com/rss.xml", category: "others" },

  // আন্তর্জাতিক বাংলা বিভাগ
  { name: "Deutsche Welle Bangla", url: "https://rss.dw.com/xml/rss-ben-news", category: "international" },
  { name: "VOA Bangla", url: "https://www.voabangla.com/api/z-$m_qvyov", category: "international" },
  { name: "TRT Bangla", url: "https://www.trt.net.tr/bengali/rss", category: "international" },

  // খেলাধুলা
  { name: "Cricfrenzy", url: "https://www.cricfrenzy.com/rss.xml", category: "sports" },
  { name: "Sports24", url: "https://www.sports24.com.bd/feed/", category: "sports" },
  { name: "ESPN Cricinfo", url: "https://www.espncricinfo.com/rss/content/story/feeds/0.xml", category: "sports" },
  { name: "Goal.com", url: "https://www.goal.com/en/feeds/news", category: "sports" },

  // ── ভারতের শীর্ষ ৩টি সংবাদ মাধ্যম ──
  { name: "Anandabazar Patrika", url: "https://www.anandabazar.com/rss.xml", category: "others" },
  { name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", category: "international" },
  { name: "NDTV News", url: "https://feeds.feedburner.com/ndtvnews-top-stories", category: "international" },

  // ── আন্তর্জাতিক ৫+ শীর্ষ সংবাদ মাধ্যম ──
  { name: "BBC World News", url: "http://feeds.bbci.co.uk/news/rss.xml", category: "international" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "international" },
  { name: "Reuters Top News", url: "https://www.reutersagency.com/feed/?best-topics=top-news", category: "international" },
  { name: "CNN Edition", url: "http://rss.cnn.com/rss/edition.rss", category: "international" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "others" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "others" }
];

function connect() {
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => console.log("Comprehensive News MCP connected!"));
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
              description: "বাংলাদেশ, ভারত ও আন্তর্জাতিক ৫০+ চ্যানেল স্ক্যান করে ব্রেকিং নিউজ এবং রাজনীতি, আন্তর্জাতিক, খেলাধুলা ও অন্যান্য ক্যাটাগরিতে সাজানো বিস্তারিত নিউজ বুলেটিন পড়ার টুল।",
              inputSchema: { type: "object", properties: {} }
            }]
          }
        }));
      }

      if (msg.method === "tools/call" && msg.params?.name === "get_latest_news") {
        let allArticles = [];

        // সব সোর্স থেকে ডাটা ফেচ করা
        for (const source of NEWS_SOURCES) {
          try {
            const feed = await parser.parseURL(source.url);
            feed.items.forEach(item => {
              allArticles.push({
                title: cleanText(item.title),
                content: cleanText(item.contentSnippet || item.content || item.summary || "বিস্তারিত বিবরণ নেই।"),
                category: source.category,
                sourceName: source.name,
                pubDate: new Date(item.pubDate || Date.now())
              });
            });
          } catch (e) {}
        }

        // ক্যাটাগরি অনুযায়ী সাজানো (রাজনীতি, আন্তর্জাতিক, খেলাধুলা, অন্যান্য)
        const politics = allArticles.filter(a => a.category === 'politics').slice(0, 3);
        const international = allArticles.filter(a => a.category === 'international').slice(0, 3);
        const sports = allArticles.filter(a => a.category === 'sports').slice(0, 3);
        const others = allArticles.filter(a => a.category === 'others').slice(0, 3);

        const formatSection = (title, items) => {
          if (items.length === 0) return "";
          return `\n\n📌 **${title} সংবাদ:**\n` + items.map((art, idx) => 
            `খবর ${idx + 1} (${art.sourceName}):\nশিরোনাম: ${art.title}\nবিস্তারিত: ${art.content}`
          ).join("\n\n");
        };

        const bulletinText = `রানা ভাই, বাংলাদেশ, ভারত ও আন্তর্জাতিক শীর্ষ সংবাদ মাধ্যমগুলো স্ক্যান করে গত ২৪ ঘণ্টার আপডেট নিউজ বুলেটিন পেশ করছি।\n\n` +
          `**প্রথমে একনজরে প্রধান ব্রেকিং নিউজ হেডলাইনস:**\n` +
          allArticles.slice(0, 5).map((a, i) => `${i + 1}. [${a.sourceName}] ${a.title}`).join("\n") +
          `\n\n**এছাড়াও আরও বিস্তারিত খবর ক্যাটাগরি অনুযায়ী নিচে দেওয়া হলো:**` +
          formatSection("রাজনীতি", politics) +
          formatSection("আন্তর্জাতিক", international) +
          formatSection("খেলাধুলা", sports) +
          formatSection("অন্যান্য ও সমসাময়িক", others);

        ws.send(JSON.stringify({ 
          jsonrpc: "2.0", 
          id: msg.id, 
          result: { content: [{ type: "text", text: bulletinText }] } 
        }));

      }
    } catch (e) {}
  });

  ws.on("close", () => setTimeout(connect, 5000));
}

connect();
