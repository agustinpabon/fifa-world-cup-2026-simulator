import assert from "node:assert/strict";
import test from "node:test";

import { parseResultsCsv } from "./csv.js";

test("parseResultsCsv handles quoted CSV fields without shifting later columns", () => {
  const raw = [
    "date,home_team,away_team,home_score,away_score,tournament,city,country,neutral",
    '2024-01-01,"Alpha, FC",Beta,2,1,Friendly,"City, Region","Country, Republic",TRUE',
  ].join("\n");

  assert.deepEqual(parseResultsCsv(raw), [
    {
      date: "2024-01-01",
      homeTeam: "Alpha, FC",
      awayTeam: "Beta",
      homeScore: 2,
      awayScore: 1,
      tournament: "Friendly",
      neutral: true,
    },
  ]);
});
