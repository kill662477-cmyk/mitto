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
  },
  soop: {
    name: "숲게",
    boardUrl: "https://ygosu.com/board/soop",
    listUrl: "https://ygosu.com/board/soop/?s_wato=Y"
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

const CATEGORY_KEYWORDS = {
  basketball: ["NBA", "KBL"],
  baseball: ["MLB", "KBO"],
  football: [
    "PL",
  "EPL",
  "epl",
  "프리미어리그",
  "잉글랜드",
  "챔스",
  "챔피언스리그",
  "UCL",
  "ucl",
  "유로파",
  "UEL",
  "uel",
  "세리에",
  "세리아",
  "라리가",
  "리그1",
  "분데스리가",
  "FA컵",
  "카라바오컵",
  "코파델레이",
  "코파 이탈리아",
  "DFB포칼",
  "컨퍼런스리그",
  "ACL",
  "아챔",
  "AFC",
  "월드컵",
  "유로",
  "코파아메리카",
  "네이션스리그"
  ],
  lol: [
  "LCK",
  "EWC",
  "롤",
  "LOL",
  "리그오브레전드"
],
  star: ["스타", "스타크래프트", "대학", "메프", "끝장전"]
};

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

  if (!res.ok) {
    throw new Error("Fetch failed " + res.status + " " + url);
  }

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
  return BLOCK_TITLE_KEYWORDS.some(keyword => t.includes(keyword));
}
function normalizeTitleForCategory(title) {
  return clean(title)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}
function detectCategory(title) {
  const upper =  normalizeTitleForCategory(title);

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (upper.includes(normalizeTitleForCategory(keyword))) {
  return category;
}
    }
  }

  return "etc";
}

function getBoardSlug(boardUrl) {
  const parts = boardUrl.split("/");
  return parts[parts.length - 1];
}

function parseCandidatesFromList(html, boardKey) {
  const board = BOARDS[boardKey];
  const boardSlug = getBoardSlug(board.boardUrl);
  const selector = "a[href*='/board/" + boardSlug + "/']";
  const re = new RegExp("/board/" + boardSlug + "/(\\d+)");

  const $ = cheerio.load(html);
  const items = [];

  $(selector).each(function(_, el) {
    const href = $(el).attr("href") || "";
    const title = clean($(el).text());
    const match = href.match(re);

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
      category: boardKey === "mitto" ? detectCategory(title) : null,
      id: id,
      title: title,
      articleUrl: board.boardUrl + "/" + id,
      watoUrl: board.boardUrl + "/" + id + "/?s_wato=Y"
    });
  });

  return items;
}

async function collectCandidates(boardKey) {
  const board = BOARDS[boardKey];
  const all = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = board.listUrl + "&page=" + page;
    console.log("[" + board.name + "] 와토목록 page=" + page + " " + url);

    const html = await fetchHtml(url);
    all.push.apply(all, parseCandidatesFromList(html, boardKey));

    await sleep(DELAY_MS);
  }

  const map = new Map();

  for (const item of all) {
    map.set(item.board + "-" + item.id, item);
  }

  return Array.from(map.values()).slice(0, MAX_CANDIDATES);
}

function hasWatoBox(text) {
  const t = clean(text);

  const signals = [
    "참여현황",
    "총 미네랄",
    "마감 시각",
    "진행 상태"
  ];

  const count = signals.filter(signal => t.includes(signal)).length;

  return count >= 3;
}

function extractStatusText(text) {
  const t = clean(text);

  const match = t.match(
    /진행 상태\s*[:：]?\s*(진행중|마감|종료|결과|[^ ]+\s*남음|[0-9일시간분초:\s]+남음)/i
  );

  if (!match) return "";

  return clean(match[1]);
}

function detectWatoStatus(statusText) {
  const s = clean(statusText).replace(/\s+/g, "");

  if (!s) return null;

  if (s.includes("무효") || s.includes("취소") || s.includes("삭제")) {
    return null;
  }

  if (s === "진행중" || s.includes("남음")) {
    return "live";
  }

  if (s === "마감" || s === "마감됨") {
    return "closed";
  }

  if (s === "종료" || s === "결과" || s === "종료됨") {
    return "result";
  }

  return null;
}

async function verifyAndClassify(item) {
  if (shouldBlockByTitle(item.title)) {
    return null;
  }

  try {
    const html = await fetchHtml(item.watoUrl);
    const $ = cheerio.load(html);
    const text = clean($.root().text());

    if (!hasWatoBox(text)) {
      return null;
    }

    const statusText = extractStatusText(text);
    const tab = detectWatoStatus(statusText);

    if (!tab) {
      return null;
    }

    return {
      board: item.board,
      boardName: item.boardName,
      category: item.category,
      id: item.id,
      title: item.title,
      articleUrl: item.articleUrl,
      watoUrl: item.watoUrl,
      tab: tab,
      tabName: TAB_NAMES[tab],
      statusText: statusText
    };
  } catch (err) {
    console.warn(
      "[검증실패] " +
      item.boardName +
      " " +
      item.id +
      " " +
      item.title +
      " / " +
      err.message
    );

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

  console.log("");
  console.log("[" + board.name + "] 후보 수집 시작");

  const candidates = await collectCandidates(boardKey);

  console.log("[" + board.name + "] 후보 " + candidates.length + "개");

  for (const item of candidates) {
    const classified = await verifyAndClassify(item);

    if (classified && grouped[classified.tab]) {
      grouped[classified.tab].push(classified);

      console.log(
        "OK " +
        classified.boardName +
        " / " +
        classified.tabName +
        " / " +
        classified.id +
        " / " +
        classified.statusText +
        " / " +
        classified.title
      );
    } else {
      console.log(
        "SKIP " +
        item.boardName +
        " " +
        item.id +
        " " +
        item.title
      );
    }

    await sleep(DELAY_MS);
  }

  return grouped;
}

async function main() {
  const result = {
    checkedAt: new Date().toISOString(),
    boards: {
      mitto: {
        live: [],
        closed: [],
        result: []
      },
      monstarz: {
        live: [],
        closed: [],
        result: []
      },
      soop: {
        live: [],
        closed: [],
        result: []
      }
    }
  };

  const boardKeys = Object.keys(BOARDS);

  for (const boardKey of boardKeys) {
    result.boards[boardKey] = await collectBoard(boardKey);
  }

  const total = Object.values(result.boards).reduce(function(sum, board) {
    return sum + board.live.length + board.closed.length + board.result.length;
  }, 0);

  if (total === 0) {
    console.error("수집 결과 0개 - 기존 watos.json 유지");
    process.exit(1);
  }

  fs.mkdirSync("data", {
    recursive: true
  });

  fs.writeFileSync(
    "data/watos.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("");
  console.log("저장 완료: data/watos.json");
  console.log("전체: " + total + "개");

  for (const [key, board] of Object.entries(result.boards)) {
    console.log(BOARDS[key].name + " 진행중: " + board.live.length);
    console.log(BOARDS[key].name + " 마감: " + board.closed.length);
    console.log(BOARDS[key].name + " 결과: " + board.result.length);
  }
}

main().catch(function(err) {
  console.error(err);
  process.exit(1);
});
