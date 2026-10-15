import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import Parser from "rss-parser";
import http from "http";

// === Render Web Service Port Binding ===
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Xiaozhi Mega News Feed MCP Server is Live!");
}).listen(PORT, () => {
  console.log(`HTTP Health check server running on port ${PORT}`);
});

// === MCP Server Setup ===
const server = new Server(
  { name: "xiaozhi-mega-news-feed", version: "2.0.0" }, 
  { capabilities: { tools: {} } }
);
const parser = new Parser();

// ৫৫টি শীর্ষ গ্লোবাল ও ন্যাশনাল মিডিয়ার আরএসএস ফিড ডেটাবেজ
const NEWS_FEEDS = {
  // === বাংলাদেশের ১০টি শীর্ষ পত্রিকা ===
  "প্রথম আলো": "https://prothomalo.com",
  "দ্য ডেইলি স্টার (বাংলা)": "https://thedailystar.net",
  "যুগান্তর": "https://jugantor.com",
  "কালের কণ্ঠ": "https://kalerkantho.com",
  "সমকাল": "https://samakal.com",
  "ইত্তেফাক": "https://ittefaq.com.bd",
  "বাংলাদেশ প্রতিদিন": "https://bd-pratidin.com",
  "দৈনিক ইনকিলাব": "https://dailyinqilab.com",
  "মানবজমিন": "https://mzamin.com",
  "আমাদের সময়": "https://amadershomoy.com",

  // === ৫টি সেরা ওয়েব-বেসড মিডিয়া ===
  "বিডিনিউজ২৪": "https://bdnews24.com",
  "বাংলানিউজ২৪": "https://banglanews24.com",
  "ঢাকা পোস্ট": "https://dhakapost.com",
  "জাগোনিউজ২৪": "https://jagonews24.com",
  "বাংলা ট্রিবিউন": "https://banglatribune.com",

  // === ২০টি টিভি চ্যানেল মিডিয়া ===
  "সময় টিভি": "https://somoynews.tv",
  "চ্যানেল আই": "https://channelionline.com",
  "এনটিভি অনলাইন": "https://ntvbd.com",
  "আরটিভি নিউজ": "https://rtvonline.com",
  "যমুনা টিভি": "https://jamuna.tv",
  "ডিবিসি নিউজ": "https://dbcnews.tv",
  "একাত্তর টিভি": "https://71.tv",
  "নিউজ২৪": "https://news24bd.tv",
  "ইন্ডিপেন্ডেন্ট টিভি": "https://independent24.com",
  "এটিএন বাংলা": "https://atnbangla.tv",
  "বাংলাভিশন": "https://bvnews24.com",
  "গাজী টিভি (জিটিভি)": "https://gtv.com.bd",
  "চ্যানেল টোয়েন্টিফোর": "https://channel24bd.tv",
  "দেশ টিভি": "https://desh.tv",
  "ডিডাব্লিউ বাংলা": "https://dw.com",
  "বিবিসি বাংলা": "https://bbci.co.uk",
  "ভয়েস অফ আমেরিকা": "https://voanews.com",
  "এনএইচকে ওয়ার্ল্ড বাংলা": "https://nhk.or.jp",
  "পিপলস রেডিও": "https://peoplesradio.fm",
  "রেডিও ভূমি": "https://radiobhumi.fm",

  // === ১০টি সেরা ভারতীয় মিডিয়া ===
  "আনন্দবাজার পত্রিকা": "https://anandabazar.com",
  "দ্য হিন্দু": "https://thehindu.com",
  "টাইমস অফ ইন্ডিয়া": "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms",
  "ইন্ডিয়ান এক্সপ্রেস": "https://indianexpress.com",
  "এনডিটিভি (NDTV)": "https://feedburner.com",
  "হিন্দুস্তান টাইমস": "https://hindustantimes.com",
  "ইন্ডিয়া টুডে": "https://indiatoday.in",
  "জি নিউজ (Zee News)": "https://india.com",
  "নিউজ১৮ ইন্ডিয়া": "https://news18.com",
  "দ্য প্রিন্ট (ThePrint)": "https://theprint.in",

  // === ১০টি আন্তর্জাতিক টপ ক্লাস মিডিয়া ===
  "রয়টার্স (Reuters)": "https://reutersagency.com",
  "আল জাজিরা": "https://aljazeera.com",
  "বিবিসি নিউজ (World)": "https://bbci.co.uk",
  "সিএনএন (CNN)": "http://cnn.com",
  "নিউ ইয়র্ক টাইমস": "https://nytimes.com",
  "দ্য গার্ডিয়ান": "https://theguardian.com",
  "ব্লুমবার্গ (Bloomberg)": "https://bloomberg.com",
  "ডয়েচে ভেলে (DW English)": "https://dw.com",
  "ফ্রান্স ২৪ (France 24)": "https://france24.com",
  "ইউরোনিউজ (Euronews)": "https://euronews.com"
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ 
    name: "get_global_breaking_news", 
    description: "বাংলাদেশ, ভারত এবং আন্তর্জাতিক শীর্ষ ৫৫টি মিডিয়া থেকে সর্বশেষ লাইভ ব্রেকিং নিউজ রিড করার টুল।" 
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "get_global_breaking_news") {
    let reportLines = [];
    
    for (const [mediaName, url] of Object.entries(NEWS_FEEDS)) {
      try {
        const feed = await parser.parseURL(url);
        if (feed.items && feed.items.length > 0) {
          const latestTitle = feed.items[0].title.trim();
          reportLines.push(`- [${mediaName}] ${latestTitle}`);
        }
      } catch (error) {
        continue; // কোনো নির্দিষ্ট মিডিয়া ডাউন থাকলে কোড ক্র্যাশ না করে পরেরটায় যাবে
      }
    }

    if (reportLines.length === 0) {
      return { content: [{ type: "text", text: "দুঃখিত, এই মুহূর্তে কোনো মিডিয়া সোর্স থেকে তাজা খবর পাওয়া যায়নি।" }] };
    }

    // সব সোর্স থেকে লেটেস্ট খবরগুলো একসাথে যুক্ত করে রেসপন্স পাঠাবে
    const fullSummary = reportLines.join("\n");
    return { content: [{ type: "text", text: `আজকের বৈশ্বিক ও জাতীয় শীর্ষ সংবাদাবলি:\n${fullSummary}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
