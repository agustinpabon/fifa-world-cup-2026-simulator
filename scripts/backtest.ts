import { computeEloRatings, getWCTeamRatings } from "../artifacts/api-server/src/lib/elo.js";
import { runSimulations, matchProbabilities } from "../artifacts/api-server/src/lib/simulation.js";

async function main() {
  console.log("🚀 Running World Cup Predictor verification & backtest...");
  const start = Date.now();

  const { ratings, matchCount } = await computeEloRatings();
  console.log(`✅ Loaded ${matchCount} historical matches.`);

  const wcRatings = getWCTeamRatings(ratings);
  console.log("🏆 Top 5 Rated World Cup Teams:");
  const top5 = Object.entries(wcRatings)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [team, elo] of top5) {
    console.log(`   - ${team}: ${elo} Elo`);
  }

  console.log("\n⚽ Testing Dixon-Coles Match Predictor (Argentina vs France):");
  const argElo = wcRatings["Argentina"] ?? 2000;
  const fraElo = wcRatings["France"] ?? 1950;
  const pred = matchProbabilities(argElo, fraElo, 50_000);
  console.log(`   - Argentina Win: ${Math.round(pred.pWinA * 100)}%`);
  console.log(`   - Draw: ${Math.round(pred.pDraw * 100)}%`);
  console.log(`   - France Win: ${Math.round(pred.pWinB * 100)}%`);
  console.log(`   - Most Likely Score: ${pred.mostLikelyScore}`);

  console.log("\n🎰 Executing 10,000 Monte Carlo Tournament Simulations...");
  const simResult = runSimulations(wcRatings);
  console.log("🏆 Top 5 Favorites to win FIFA World Cup 2026:");
  const topFavs = Object.entries(simResult.titles)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [team, titles] of topFavs) {
    const pct = (titles / 10_000) * 100;
    console.log(`   - ${team}: ${pct.toFixed(1)}% chance to win`);
  }

  console.log(`\n✨ Verification finished in ${((Date.now() - start) / 1000).toFixed(2)}s!`);
}

main().catch(console.error);
