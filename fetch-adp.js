/**
 * fetch-adp.js
 * ------------------------------------------------------------
 * Pulls current-season ADP data from SportsDataIO and writes it
 * to data/rankings.json in the same shape rankings.html expects.
 *
 * Run manually:   SPORTSDATAIO_API_KEY=yourkey node fetch-adp.js
 * Run on schedule: see .github/workflows/update-adp.yml
 * ------------------------------------------------------------
 * SETUP NOTES:
 * 1. Your API key goes in the SPORTSDATAIO_API_KEY environment
 *    variable — never hardcode it into this file.
 * 2. Verify ADP_ENDPOINT below against your SportsDataIO
 *    dashboard (Fantasy Football > ADP feed) — SportsDataIO
 *    occasionally versions/renames endpoints, and the exact
 *    path/season format depends on your subscription tier.
 *    Log into sportsdata.io/developers to confirm the current
 *    path and swap it in below if it differs.
 * ------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.SPORTSDATAIO_API_KEY;
if (!API_KEY) {
  console.error('Missing SPORTSDATAIO_API_KEY environment variable.');
  process.exit(1);
}

const SEASON = process.env.ADP_SEASON || '2026';

// Confirm this path in your SportsDataIO dashboard before relying on it.
const ADP_ENDPOINT = 'https://api.sportsdata.io/v3/nfl/stats/json/FantasyPlayers';

const OUTPUT_PATH = path.join(__dirname, 'data', 'rankings.json');

// Tier labels applied to auto-generated tiers, in order.
const TIER_LABELS = [
  'Elite Anchors',
  'Round 2 Core',
  'Positional Studs',
  'Solid Starters',
  'Value Plays',
  'Deep League Fliers',
];

// ADP gap (in picks) that triggers a new tier break.
const TIER_GAP_THRESHOLD = 6;

async function fetchADP() {
  const res = await fetch(ADP_ENDPOINT, {
    headers: {
      'Ocp-Apim-Subscription-Key': API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`SportsDataIO request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Groups sorted players into tiers based on ADP gaps rather than
 * a fixed round count — a bigger jump in ADP between two adjacent
 * players signals a real talent cliff, which is what best ball
 * drafters actually care about.
 */
function assignTiers(players) {
  const sorted = [...players].sort((a, b) => a.adpValue - b.adpValue);
  let tier = 1;
  let tiered = [];

  sorted.forEach((player, i) => {
    if (i > 0) {
      const gap = player.adpValue - sorted[i - 1].adpValue;
      if (gap >= TIER_GAP_THRESHOLD) tier += 1;
    }
    tiered.push({ ...player, tier });
  });

  return tiered;
}

function transform(raw) {
  // Adjust field names below to match the actual SportsDataIO response
  // shape for your subscribed feed — field names vary by endpoint/tier.
  const cleaned = raw
    .filter(p => p.AverageDraftPosition && p.Position && p.Name)
    .map(p => ({
      name: p.Name,
      team: p.Team || '',
      pos: p.Position,
      adpValue: p.AverageDraftPosition,
      adp: p.AverageDraftPosition.toFixed(1),
    }));

  const withTiers = assignTiers(cleaned);

  return withTiers.map(({ adpValue, ...rest }) => rest);
}

async function main() {
  console.log(`Fetching ADP data for ${SEASON} season...`);
  const raw = await fetchADP();
  const players = transform(raw);

  const output = {
    updatedAt: new Date().toISOString(),
    season: SEASON,
    tierLabels: TIER_LABELS,
    players,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log(`Wrote ${players.length} players to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('fetch-adp.js failed:', err.message);
  process.exit(1);
});
