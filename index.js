import WebSocket from "ws";
import http from "http";
import Parser from "rss-parser";

const PORT = process.env.PORT || 10000;

// আপনার দেওয়া নতুন আপডেট করা টোকেনসহ URL
const XIAOZHI_WSS_URL = "wss://api.xiaozhi.me/mcp/?token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEwMzIwNzcsImFnZW50SWQiOjI0OTc5NTgsImVuZHBvaW50SWQiOiJhZ2VudF8yNDk3OTU4IiwicHVycG9zZSI6Im1jcC1lbmRwb2ludCIsImlhdCI6MTc5MjEyODM4NSwiZXhwIjoxODIzNjg1OTg1fQ.DAXLmBRkkHX4IbZgfSSJ0MUTjo3ZAjedIAsVpiDDly-jzp5ukbCwCjGw-rUN5A0kXh25Ebkl-D6qDfsQ-pzTVA";

const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  timeout: 5000
});

// HTML ট্যাগ ক্লিন করার হেল্পার ফাংশন
function cleanText(text) {
  if (!text) return "";
  return text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}

// Render Health Check (Render সচল রাখার জন্য)
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Xiaozhi News Feed MCP (55 Feeds) is Live!");
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));

// ৫৫টি নিউজ মিডিয়ার RSS Feed লিস্ট
const NEWS_SOURCES = [
  // জাতীয় ও জনপ্রিয় দৈনিক (বাংলাদেশ)
  { name: "Prothom Alo", url: "https://www.prothomalo.com/feed" },
  { name: "BBC Bangla", url: "https://www.bbc.com/bengali/index.xml" },
  { name: "BDNews24", url: "https://bangla.bdnews24.com/rss" },
  { name: "Samakal", url: "https://samakal.com/rss" },
  { name: "Ittefaq", url: "https://www.ittefaq.com.bd/feed" },
  { name: "Kaler Kantho", url: "https://www.kalerkantho.com/rss.xml" },
  { name: "Jugantor", url: "https://www.jugantor.com/feed" },
  { name: "Manab Zamin", url: "https://mzamin.com/rss.php" },
  { name: "Daily Star Bangla", url: "https://bangla.thedailystar.net/rss" },
  { name: "Naya Diganta", url: "https://www.dailynayadiganta.com/rss" },
  { name: "Janakantha", url: "https://www.dailyjanakantha.com/rss.xml" },
  { name: "Bhorer Kagoj", url: "https://www.bhorerkagoj.com/feed/" },
  { name: "Jaijaidin", url: "https://www.jaijaidinbd.com/rss.xml" },
  { name: "Daily Inqilab", url: "https://www.dailyinqilab.com/rss.xml" },
  { name: "Amader Shomoy", url: "https://www.dainikamadershomoy.com/rss.xml" },
  
  // টিভি চ্যানেল (বাংলাদেশ)
  { name: "Somoy TV", url: "https://www.somoynews.tv/rss.xml" },
  { name: "Jamuna TV", url: "https://www.jamuna.tv/feed" },
  { name: "Independent TV", url: "https://www.independent24.com/rss.xml" },
  { name: "Channel i", url: "https://www.channelionline.com/feed/" },
  { name: "NTV", url: "https://www.ntvbd.com/rss.xml" },
  { name: "ATN News", url: "https://www.atnnewstv.com/feed/" },
  { name: "Ekattor TV", url: "https://ekattor.tv/feed/" },
  { name: "News24", url: "https://www.news24bd.tv/rss.xml" },
  { name: "DBC News", url: "https://dbcnews.tv/feed/" },
  { name: "RTV", url: "https://www.rtvonline.com/feed/" },

  // অনলাইন নিউজ পোর্টাল
  { name: "Dhaka Post", url: "https://www.dhakapost.com/rss.xml" },
  { name: "Jago News 24", url: "https://www.jagonews24.com/rss/rss.xml" },
  { name: "Bangla Tribune", url: "https://www.banglatribune.com/feed/" },
  { name: "RisingBD", url: "https://www.risingbd.com/rss.xml" },
  { name: "Barta24", url: "https://barta24.com/rss.xml" },
  { name: "Channel24", url: "https://www.channel24bd.tv/feed/" },
  { name: "BD Pratidin", url: "https://www.bd-pratidin.com/rss.xml" },

  // আন্তর্জাতিক বাংলা বিভাগ
  { name: "Deutsche Welle Bangla", url: "https://rss.dw.com/xml/rss-ben-news" },
  { name: "VOA Bangla", url: "https://www.voabangla.com/api/z-$m_qvyov" },
  { name: "TRT Bangla", url: "https://www.trt.net.tr/bengali/rss" },

  // টেকনোলজি ও খেলাধুলা
  { name: "TechShohor", url: "https://techshohor.com/feed/" },
  { name: "Techtunes", url: "https://www.techtunes.co/feed/" },
  { name: "Cricfrenzy", url: "https://www.cricfrenzy.com/rss.xml" },
  { name: "Sports24", url: "https://www.sports24.com.bd/feed/" },

  // ইংরেজি ও আন্তর্জাতিক
  { name: "The Daily Star (English)", url: "https://www.thedailystar.net/frontpage/rss.xml" },
  { name: "Dhaka Tribune", url: "https://www.dhakatribune.com/feed/" },
  { name: "BBC World News", url: "http://feeds.bbci.co.uk/news/rss.xml" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "Reuters Top News", url: "https://www.reutersagency.com/feed/?best-topics=top-news" },
  { name: "CNN Edition", url: "http://rss.cnn.com/rss/edition.rss" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "Wired", url: "https://www.wired.com/feed/rss" },
  { name: "Goal.com", url: "https://www.goal.com/en/feeds/news" },
  { name: "ESPN Cricinfo", url: "https://www.espncricinfo.com/rss/content/story/feeds/0.xml" },
  { name: "NDTV News", url: "https://feeds.feedburner.com/ndtvnews-top-stories" },
  { name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms" },
  { name: "Anandabazar Patrika", url: "https://www.anandabazar.com/rss.xml" }
];

function connect() {
  console.log("Connecting to Xiaozhi WebSocket server...");
  const ws = new WebSocket(XIAOZHI_WSS_URL);

  ws.on("open", () => {
    console.log("Connected News MCP (55 Feeds) to Xiaozhi!");
  });

  // 🔴 গুরুত্বপূর্ণ: Error Catch করে App Crash হওয়া বন্ধ করবে
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
              description: "৫৫টি দেশি ও আন্তর্জাতিক সংবাদ মাধ্যম থেকে সর্বশেষ খবর ও বিবরণ পাওয়ার টুল।",
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
          
          // শীর্ষ ৩টি সংবাদের শিরোনাম এবং বিবরণ একসাথে প্রসেস করা হচ্ছে
          const topArticles = feed.items.slice(0, 3).map((item, index) => {
            const title = cleanText(item.title);
            const summary = cleanText(item.contentSnippet || item.content || item.summary || "বিস্তারিত বিবরণ পাওয়া যায়নি।");
            return `সংবাদ ${index + 1}:\nশিরোনাম: ${title}\nবিবরণ: ${summary}`;
          }).join("\n\n---\n\n");

          const responseText = `রানা ভাই, ${selectedSource.name} থেকে সর্বশেষ খবর এবং বিবরণ নিচে দেওয়া হলো:\n\n${topArticles}`;
          
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: responseText }] } 
          }));
        } catch (e) {
          ws.send(JSON.stringify({ 
            jsonrpc: "2.0", 
            id: msg.id, 
            result: { content: [{ type: "text", text: `রানা ভাই, ${selectedSource.name} এর ফিড পেতে সমস্যা হয়েছে। আবার চেষ্টা করুন।` }] } 
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
