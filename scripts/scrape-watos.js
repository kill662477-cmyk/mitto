import fs from "fs";
import * as cheerio from "cheerio";

const BOARD_URL = "https://ygosu.com/board/pan_ccy";
const MAX_PAGES = 3;
const MAX_CANDIDATES = 180;
const DELAY_MS = 350;

const TAB_NAMES = {
  live: "진행중",
  closed: "마감",
  result: "결과"
};

const BLOCK_TITLE_KEYWORDS = [
  "📢", "공지", "규정", "일정", "대진표", "선점룰",
  "진출자", "플레이오프", "가이드", "안내", "필독",
  "이벤트", "업데이트", "요청", "문의", "건의"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "referer": "https://ygosu.com/"
    }
  });

  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  return await res.text();
}

function clean(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldBlockByTitle(title) {
  const t = clean(title);
  return BLOCK_TITLE_KEYWORDS.some(k => t.includes(k));
}

function parseCandidatesFromList(html) {
  const $ = cheerio.load(html);
  const items = [];

  $("a[href*='/board/pan_ccy/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = clean($(el).text());
    const match = href.match(/\/board\/pan_ccy\/(\d+)/);

    if (!match || !title) return;

    const id = match[1];

    if (id.length < 5) return;
    if (title.length < 4) return;
    if (shouldBlockByTitle(title)) return;

    const menuTitles = [
      "전체", "인기", "와토", "선점", "진행중", "마감", "결과",
      "사진/영상", "정보", "공지", "이벤트", "관리자공지",
      "콘텐츠 추천", "미네랄창고"
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
    console.log(`[목록] ${url}`);

    const html = await fetchHtml(url);
    all.push(...parseCandidatesFromList(html));

    await sleep(DELAY_MS);
  }

  return Array.from(new Map(all.map(v => [v.id, v])).values()).slice(0, MAX_CANDIDATES);
}

function hasWatoBox(text) {
  const t = clean(text);

  const signals = [
    "참여현황",
    "총 미네랄",
    "참여연속수",
    "마감 시각",
    "진행 상태"
  ];

  return signals.filter(k => t.includes(k)).length >= 4;
}

function extractStatusText(text) {
  const t = clean(text);
  const idx = t.indexOf("진행 상태");

  if (idx === -1) return "";

  return t
    .slice(idx, idx + 80)
    .replace("진행 상태", "")
    .replace(/^[:：\s]+/, "")
    .trim();
}

function detectWatoStatus(text) {
  const status = extractStatusText(text);

  if (!status) return null;

  // 제일 먼저 진행중 판정
  if (
    status.includes("진행중") ||
    status.includes("진행 중") ||
    status.includes("정상 진행") ||
    status.includes("베팅 가능")
  ) {
    return "live";
  }

  // 그 다음 마감 판정
  if (
    status.includes("마감") ||
    status.includes("베팅 마감") ||
    status.includes("참여 마감")
  ) {
    return "closed";
  }

  // 마지막 결과/정산 판정
  if (
    status.includes("정산") ||
    status.includes("처리됨") ||
    status.includes("무효") ||
    status.includes("결과")
  ) {
    return "result";
  }

  return null;
}

async function verifyAndClassify(item) {
  if (shouldBlockByTitle(item.title)) return null;

  try {
    const html = await fetchHtml(item.watoUrl);
    const $ = cheerio.load(html);
    const text = clean($.root().text());

    if (!hasWatoBox(text)) return null;

    const tab = detectWatoStatus(text);
    const statusText = extractStatusText(text);

    if (!tab) {
      console.log(`  상태판독실패 ${item.id} / ${statusText}`);
      return null;
    }

    return {
      ...item,
      tab,
      tabName: TAB_NAMES[tab],
      statusText
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
      console.log(`OK ${classified.tabName} / ${classified.id} / ${classified.statusText} / ${classified.title}`);
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

  console.log("\n저장 완료");
  console.log(`진행중: ${result.tabs.live.length}개`);
  console.log(`마감: ${result.tabs.closed.length}개`);
  console.log(`결과: ${result.tabs.result.length}개`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
