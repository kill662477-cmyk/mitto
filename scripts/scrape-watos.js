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

const MAX_CANDIDATES_PER_TAB = 80;
const DELAY_MS = 350;

const BLOCK_TITLE_KEYWORDS = [
  "📢",
  "공지",
  "규정",
  "이용 규정",
  "일정",
  "대진표",
  "선점룰",
  "진출자",
  "플레이오프 대진표",
  "가이드",
  "안내",
  "필독",
  "이벤트",
  "업데이트",
  "요청",
  "문의",
  "건의"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "referer": "https://ygosu.com/"
    }
  });

  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function shouldBlockByTitle(title) {
  const t = normalizeText(title);
  return BLOCK_TITLE_KEYWORDS.some(k => t.includes(k));
}

function parseCandidates(html, tab) {
  const $ = cheerio.load(html);
  const items = [];

  $("a[href*='/board/pan_ccy/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = normalizeText($(el).text());
    const match = href.match(/\/board\/pan_ccy\/(\d+)/);

    if (!match || !title) return;

    const id = match[1];

    if (id.length < 5) return;
    if (title.length < 4) return;
    if (shouldBlockByTitle(title)) return;

    const menuTitles = [
      "전체",
      "인기",
      "와토",
      "선점",
      "진행중",
      "마감",
      "결과",
      "사진/영상",
      "정보",
      "공지",
      "이벤트",
      "관리자공지",
      "콘텐츠 추천",
      "미네랄창고"
    ];

    if (menuTitles.includes(title)) return;

    items.push({
      id,
      title,
      tab,
      tabName: CATEGORIES[tab].name,
      articleUrl: `https://ygosu.com/board/pan_ccy/${id}`,
      watoUrl: `https://ygosu.com/board/pan_ccy/${id}/?s_wato=Y`
    });
  });

  return Array.from(new Map(items.map(v => [v.id, v])).values()).slice(
    0,
    MAX_CANDIDATES_PER_TAB
  );
}

function isWatoPageText(text) {
  const t = normalizeText(text);

  if (
    t.includes("게시글이 존재하지 않습니다") ||
    t.includes("삭제된 게시글") ||
    t.includes("권한이 없습니다")
  ) {
    return false;
  }

  const requiredSignals = [
    "참여현황",
    "총 미네랄",
    "참여연속수",
    "마감 시각",
    "진행 상태"
  ];

  const signalCount = requiredSignals.filter(k => t.includes(k)).length;

  const hasBettingState =
    t.includes("무효 처리됨") ||
    t.includes("진행중") ||
    t.includes("마감") ||
    t.includes("정산") ||
    t.includes("적중") ||
    t.includes("미적중");

  return signalCount >= 3 && hasBettingState;
}

async function isRealWato(item) {
  if (shouldBlockByTitle(item.title)) return false;

  try {
    const html = await fetchHtml(item.watoUrl);
    const text = normalizeText(html);

    return isWatoPageText(text);
  } catch (e) {
    console.warn(`[검증실패] ${item.id} ${item.title}`);
    return false;
  }
}

async function collectTab(tab) {
  const category = CATEGORIES[tab];
  console.log(`\n[${category.name}] 목록 수집 시작`);

  const html = await fetchHtml(category.url);
  const candidates = parseCandidates(html, tab);

  console.log(`[${category.name}] 후보 ${candidates.length}개`);

  const realWatos = [];

  for (const item of candidates) {
    const ok = await isRealWato(item);

    if (ok) {
      realWatos.push(item);
      console.log(`  OK   ${item.id} ${item.title}`);
    } else {
      console.log(`  SKIP ${item.id} ${item.title}`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`[${category.name}] 최종 ${realWatos.length}개`);
  return realWatos;
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
    result.tabs[tab] = await collectTab(tab);
  }

  fs.mkdirSync("public/data", { recursive: true });

  fs.writeFileSync(
    "public/data/watos.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("\n저장 완료: public/data/watos.json");
  console.log(`진행중: ${result.tabs.live.length}개`);
  console.log(`마감: ${result.tabs.closed.length}개`);
  console.log(`결과: ${result.tabs.result.length}개`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
