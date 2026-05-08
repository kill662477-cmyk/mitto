import fs from "fs";
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

  for(const boardKey of boardKeys){
    result.boards[boardKey] = await collectBoard(boardKey);
  }

  const total = Object
    .values(result.boards)
    .reduce((sum, board) => {
      return sum +
        board.live.length +
        board.closed.length +
        board.result.length;
    }, 0);

  if(total === 0){
    console.error("수집 결과 0개 - 기존 watos.json 유지");
    process.exit(1);
  }

  fs.mkdirSync("data", {
    recursive:true
  });

  fs.writeFileSync(
    "data/watos.json",
    JSON.stringify(result, null, 2),
    "utf8"
  );

  console.log("");
  console.log("저장 완료: data/watos.json");
  console.log("전체: " + total + "개");

  for(const [key, board] of Object.entries(result.boards)){
    console.log(
      BOARDS[key].name +
      " 진행중: " + board.live.length
    );

    console.log(
      BOARDS[key].name +
      " 마감: " + board.closed.length
    );

    console.log(
      BOARDS[key].name +
      " 결과: " + board.result.length
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
