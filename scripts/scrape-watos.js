import fs from "fs";
import * as cheerio from "cheerio";

const BOARD_URL = "https://ygosu.com/board/pan_ccy";
const MAX_PAGES = 2;
const MAX_CANDIDATES = 120;
const DELAY_MS = 350;

const TAB_NAMES = {
  live: "진행중",
  closed: "마감",
  result: "결과"
};

const BLOCK_TITLE_KEYWORDS = [
  "📢",
  "공지",
  "규정",
  "이용 규정",
  "일정",
  "대진표",
  "선점룰",
  "진출자",
  "플레이오프",
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

function parseCandidatesFromList(html) {
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
      articleUrl: `${BOARD_URL}/${id}`,
      watoUrl: `${BOARD_URL}/${id}/?s_wato=Y`
    });
  });

  return items;
}

async function collectCandidates() {
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BOARD_URL}?page=${page}`;
    console.log(`[목록] page=${page} ${url}`);

    const html = await fetchHtml(url);
    all.push(...parseCandidatesFromList(html));

    await sleep(DELAY_MS);
  }

  return Array.from(new Map(all.map(v => [v.id, v])).values()).slice(
    0,
    MAX_CANDIDATES
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

  return signalCount >= 3;
}

function detectWatoStatus(text) {
  const t = normalizeText(text);

  if (
    t.includes("적중") ||
    t.includes("미적중") ||
    t.includes("정산 완료") ||
    t.includes("정산완료") ||
    t.includes("결과 처리됨")
  ) {
    return "result";
  }

  if (
    t.includes("진행 상태: 마감") ||
    t.includes("진행 상태 : 마감") ||
    t.includes("마감 처리됨") ||
    t.includes("마감됨") ||
    t.includes("베팅 마감")
  ) {
    return "closed";
  }

  if (
    t.includes("진행 상태: 진행중") ||
    t.includes("진행 상태 : 진행중") ||
    t.includes("진행 상태: 진행") ||
    t.includes("베팅 가능")
  ) {
    return "live";
  }

  return null;
}

async function verifyAndClassify(item) {
  if (shouldBlockByTitle(item.title)) return null;

  try {
    const html = await fetchHtml(item.watoUrl);
    const text = normalizeText(html);

    if (!isWatoPageText(text)) return null;

    const detectedTab = detectWatoStatus(text);
    if (!detectedTab) return null;

    return {
      ...item,
      tab: detectedTab,
      tabName: TAB_NAMES[detectedTab]
    };
  } catch {
    console.warn(`[검증실패] ${item.id} ${item.title}`);
    return null;
  }
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

  console.log("[시작] 후보 수집");
  const candidates = await collectCandidates();
  console.log(`[후보] ${candidates.length}개`);

  for (const item of candidates) {
    const classified = await verifyAndClassify(item);

    if (classified) {
      result.tabs[classified.tab].push(classified);
      console.log(`OK ${classified.tabName} ${classified.id} ${classified.title}`);
    } else {
      console.log(`SKIP ${item.id} ${item.title}`);
    }

    await sleep(DELAY_MS);
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
