import fs from "fs";
import * as cheerio from "cheerio";

const BOARDS = {
  mitto: {
    name: "미또게",
    boardUrl: "https://ygosu.com/board/pan_ccy",
    listUrl: "https://ygosu.com/board/pan_ccy/?s_wato=Y"
  },
  monstarz: {
    name: "스대게",
    boardUrl: "https://ygosu.com/board/pan_monstarz",
    listUrl: "https://ygosu.com/board/pan_monstarz/?s_wato=Y"
  }
};

const MAX_PAGES = 4;
const MAX_CANDIDATES = 500;
const DELAY_MS = 350;

const TAB_NAMES = {
  live: "진행중",
  closed: "마감",
  result: "결과"
};

const BLOCK_TITLE_KEYWORDS = [
  "📢", "공지", "규정", "이용 규정", "일정", "대진표", "선점룰",
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

function parseCandidatesFromList(html, boardKey) {
  const board = BOARDS[boardKey];
  const $ = cheerio.load(html);
  const items = [];

  $(`a[href*='/board/${board.boardUrl.split("/").pop()}/']`).each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = clean($(el).text());
    const boardSlug = board.boardUrl.split("/").pop();
    const match = href.match(new RegExp(`/board/${boardSlug}/(\\d+)`));

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
      board: boardKey,
      boardName: board.name,
      id,
      title,
      articleUrl: `${board.boardUrl}/${id}`,
      watoUrl: `${board.boardUrl}/${id}/?s_wato=Y`
    });
  });

  return items;
}

async function collectCandidates(boardKey) {
  const board = BOARDS[boardKey];
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${board.listUrl}&page=${page}`;
    console.log(`[${board.name}] 와토목록 page=${page} ${url}`);

    const html = await fetchHtml(url);
    all.push(...parseCandidatesFromList(html, boardKey));

    await sleep(DELAY_MS);
  }

  return Array.from(new Map(all.map(v => [`${v.board}-${v.id}`, v])).values())
    .slice(0, MAX_CANDIDATES);
}

function hasWatoBox(text) {
  const t = clean(text);

  const signals = [
    "참여현황",
    "총 미네랄",
    "마감 시각",
    "진행 상태"
  ];

  return signals.filter(k => t.includes(k)).length >= 3;
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
  const statusText = extractStatusText(text);

  if (!statusText) return null;

  if (
  s.includes("진행") ||
  s.includes("남은시간")
) {
  tab = "live"; }
  if (statusText.includes("마감됨")) return "closed";
  if (statusText.includes("종료됨")) return "result";

  return null;
}

async function verifyAndClassify(item) {
  if (shouldBlockByTitle(item.title)) return null;

  try {
    const html = await fetchHtml(item.watoUrl);
    const $ = cheerio.load(html);
    const text = clean($.root().text());

    if (!hasWatoBox(text)) return null;

    const statusText = extractStatusText(text);
    const tab = detectWatoStatus(text);

    if (!tab) {
      console.log(`상태판독실패 ${item.boardName} ${item.id} / ${statusText} / ${item.title}`);
      return null;
    }

    return {
      ...item,
      tab,
      tabName: TAB_NAMES[tab],
      statusText
    };
  } catch {
    console.warn(`[검증실패] ${item.boardName} ${item.id} ${item.title}`);
    return null;
  }
}

async function collectBoard(boardKey) {
  const board = BOARDS[boardKey];

  const grouped = {
    live: [],
    closed: [],
    result: []
  };

  console.log(`\n[${board.name}] 후보 수집 시작`);
  const candidates = await collectCandidates(boardKey);
  console.log(`[${board.name}] 후보 ${candidates.length}개`);

  for (const item of candidates) {
    const classified = await verifyAndClassify(item);

    if (classified) {
      grouped[classified.tab].push(classified);
      console.log(
        `OK ${classified.boardName} / ${classified.tabName} / ${classified.id} / ${classified.statusText} / ${classified.title}`
      );
    } else {
      console.log(`SKIP ${item.boardName} ${item.id} ${item.title}`);
    }

    await sleep(DELAY_MS);
  }

  return grouped;
}

async function main() {
  const result = {
    checkedAt: new Date().toISOString(),
    boards: {
      mitto: { live: [], closed: [], result: [] },
      monstarz: { live: [], closed: [], result: [] }
    }
  };

  for (const boardKey of Object.keys(BOARDS)) {
    result.boards[boardKey] = await collectBoard(boardKey);
  }

  const total = Object.values(result.boards).reduce((sum, board) => {
    return sum + board.live.length + board.closed.length + board.result.length;
  }, 0);

  if (total === 0) {
    console.error("수집 결과 0개 - 기존 watos.json 유지");
    process.exit(1);
  }

  fs.mkdirSync("public/data", { recursive: true });

  fs.writeFileSync(
    "public/data/watos.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("\n저장 완료: public/data/watos.json");
  console.log(`전체: ${total}개`);
  console.log(`미또게 진행중: ${result.boards.mitto.live.length}`);
  console.log(`미또게 마감: ${result.boards.mitto.closed.length}`);
  console.log(`미또게 결과: ${result.boards.mitto.result.length}`);
  console.log(`스대게 진행중: ${result.boards.monstarz.live.length}`);
  console.log(`스대게 마감: ${result.boards.monstarz.closed.length}`);
  console.log(`스대게 결과: ${result.boards.monstarz.result.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
