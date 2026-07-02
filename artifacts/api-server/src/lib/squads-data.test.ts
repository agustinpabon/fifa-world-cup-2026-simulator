import assert from "node:assert/strict";
import test from "node:test";

import { WC2026_TEAMS } from "./worldcup2026.js";
import { SquadsDataValidationError, WC2026_SQUADS, validateSquadsData } from "./squads-data.js";

test("validated 2026 squads data covers every qualified team and allows explicit incomplete squads", () => {
  assert.equal(WC2026_SQUADS.squads.length, WC2026_TEAMS.length);
  assert.deepEqual(
    new Set(WC2026_SQUADS.squads.map((squad) => squad.team)),
    new Set(WC2026_TEAMS.map((team) => team.name))
  );
  assert.ok(
    WC2026_SQUADS.squads.some(
      (squad) => squad.completeness.status === "incomplete" && squad.players.length === 0
    )
  );

  for (const squad of WC2026_SQUADS.squads) {
    assert.equal(squad.playerCount, squad.players.length);
    assert.equal(typeof squad.source.sourceName, "string");
    assert.ok(squad.source.sourceName.length > 0);
    assert.equal(typeof squad.source.sourceUrl, "string");
    assert.ok(squad.source.sourceUrl.length > 0);
  }
});

test("validator rejects unknown teams and unknown squad sources", () => {
  const invalid = {
    ...WC2026_SQUADS.raw,
    sources: WC2026_SQUADS.raw.sources.slice(1),
    squads: WC2026_SQUADS.raw.squads.map((squad, index) =>
      index === 0
        ? {
            ...squad,
            team: "Atlantis",
          }
        : squad
    ),
  };

  assert.throws(
    () => validateSquadsData(invalid),
    (error: unknown) => {
      assert.ok(error instanceof SquadsDataValidationError);
      assert.ok(error.issues.some((issue) => issue.includes("unknown team")));
      assert.ok(error.issues.some((issue) => issue.includes("unknown sourceId")));
      return true;
    }
  );
});
