import fs from "fs";
import * as cheerio from "cheerio";

const CATEGORIES = {
  live: {
    name: "진행중",
    url: "https://ygosu.com/board/pan_ccy/?s_category=C6938f1bb8fabd2.21596542"
  },
  closed: {
    name: "마감",
    url: "https://ygosu.com/board/pan_ccy/?s_category=C6938f1e977c8b5.46393728"
  },
  result: {
    name: "결과",
    url: "https://ygosu.com/board/pan_ccy/?s_category=C6833e1ff5463c0.12972472"
  }
};

const OUTPUT = "public/data/watos.json";
const MAX_ITEMS_PER_TAB = 100;

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      "referer": "https://ygosu.com/"
    }
  });

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${url}`);
  }

  return await res.text();
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function absoluteYgosuUrl(href) {
  if (!href) return "";
  if (href.startsWith("http")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return `https://ygosu.com${href}`;
  return `https://ygosu.com/${href}`;
}

function parseList(html, tab) {
  const $ = cheerio.load(html);
  const map = new Map();

  $("a[href*='/board/pan_ccy/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const text = cleanText($(el).text());
    const match = href.match(/\/board\/pan_ccy\/(\d+)/);

    if (!match) return;
    const id = match[1];
    if (!id || id.length < 5) return;

    let title = text;
    const row = $(el).closest("tr, li, div");
    const rowText = cleanText(row.text());

    if (!title || title.length < 2) {
      title = rowText || `게시글 #${id}`;
    }

    title = title
      .replace(/^\[[^\]]+\]\s*/, "")
      .replace(/\s*댓글\s*\d+\s*$/, "")
      .trim();

    if (!title) title = `게시글 #${id}`;

    const articleUrl = `https://ygosu.com/board/pan_ccy/${id}`;
    const watoUrl = `https://ygosu.com/board/pan_ccy/${id}/?s_wato=Y`;

    if (!map.has(id)) {
      map.set(id, {
        id,
        title,
        tab,
        tabName: CATEGORIES[tab].name,
        articleUrl,
        watoUrl,
        sourceHref: absoluteYgosuUrl(href)
      });
    }
  });

  return Array.from(map.values())
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, MAX_ITEMS_PER_TAB);
}

async function main() {
  const result = {
    checkedAt: new Date().toISOString(),
    tabs: {
      live: [],
      closed: [],
      result: []
    }
  };

  for (const tab of Object.keys(CATEGORIES)) {
    const html = await fetchHtml(CATEGORIES[tab].url);
    result.tabs[tab] = parseList(html, tab);
    console.log(`${CATEGORIES[tab].name}: ${result.tabs[tab].length}개`);
  }

  fs.mkdirSync("public/data", { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2), "utf8");
  console.log(`saved: ${OUTPUT}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
