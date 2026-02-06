const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 3000;

// Fetch JSON from NBA stats API with timeout
function fetchNBA(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      timeout: 15000,
      headers: {
        Referer: "https://www.nba.com",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
    };

    const req = https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Failed to parse NBA response"));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

// Determine current NBA season string (e.g. "2025-26")
function getNBASeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 9 ? year : year - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, "0")}`;
}

// Calculate EPT rating
function calcEPT(pts, reb, ast, stl, blk, tov) {
  return +(pts * 1.5 + reb * 1.5 + ast * 1.5 + stl * 3 + blk * 3 - tov * 1.5).toFixed(1);
}

// Fetch current season leaders from the reliable leagueLeaders endpoint
async function getSeasonStats() {
  const season = getNBASeason();
  const url =
    `https://stats.nba.com/stats/leagueLeaders?` +
    `ActiveFlag=&LeagueID=00&PerMode=Totals&Scope=S` +
    `&Season=${season}&SeasonType=Regular+Season&StatCategory=PTS`;

  console.log("Fetching NBA stats...");
  const data = await fetchNBA(url);
  const headers = data.resultSet.headers;
  const rows = data.resultSet.rowSet;

  // Map header names to indices
  const idx = {};
  headers.forEach((h, i) => (idx[h] = i));

  // Build player objects and calculate EPT
  const players = rows.map((r) => {
    const gp = r[idx["GP"]] ?? 0;
    const pts = r[idx["PTS"]] ?? 0;
    const reb = r[idx["REB"]] ?? 0;
    const ast = r[idx["AST"]] ?? 0;
    const stl = r[idx["STL"]] ?? 0;
    const blk = r[idx["BLK"]] ?? 0;
    const tov = r[idx["TOV"]] ?? 0;
    const fgm = r[idx["FGM"]] ?? 0;
    const fga = r[idx["FGA"]] ?? 0;
    const fg3m = r[idx["FG3M"]] ?? 0;
    const fg3a = r[idx["FG3A"]] ?? 0;
    const ftm = r[idx["FTM"]] ?? 0;
    const fta = r[idx["FTA"]] ?? 0;
    const fgPct = r[idx["FG_PCT"]] ?? (fga ? fgm / fga : 0);
    const ftPct = r[idx["FT_PCT"]] ?? (fta ? ftm / fta : 0);
    const tpPct = r[idx["FG3_PCT"]] ?? (fg3a ? fg3m / fg3a : 0);

    return {
      name: r[idx["PLAYER"]],
      team: r[idx["TEAM"]],
      gp,
      pts,
      reb,
      ast,
      stl,
      blk,
      tov,
      fgm, fga,
      fg3m, fg3a,
      ftm, fta,
      fgPct: +(fgPct * 100).toFixed(1),
      ftPct: +(ftPct * 100).toFixed(1),
      tpPct: +(tpPct * 100).toFixed(1),
      ppg: gp ? +(pts / gp).toFixed(1) : 0,
      rpg: gp ? +(reb / gp).toFixed(1) : 0,
      apg: gp ? +(ast / gp).toFixed(1) : 0,
      spg: gp ? +(stl / gp).toFixed(1) : 0,
      bpg: gp ? +(blk / gp).toFixed(1) : 0,
      topg: gp ? +(tov / gp).toFixed(1) : 0,
      ept: calcEPT(pts, reb, ast, stl, blk, tov),
    };
  });

  // Sort by EPT descending, take top 25
  players.sort((a, b) => b.ept - a.ept);

  console.log(`Got ${rows.length} players, returning top 25`);

  return {
    players: players.slice(0, 25),
    season,
    updatedAt: new Date().toISOString(),
  };
}

// Simple static file serving
function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[ext] || "text/plain",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    });
    res.end(data);
  });
}

// Create server
const server = http.createServer(async (req, res) => {
  if (req.url === "/api/stats") {
    try {
      const stats = await getSeasonStats();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(stats));
    } catch (err) {
      console.error("Error fetching stats:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.url === "/" || req.url === "/index.html") {
    serveFile(res, path.join(__dirname, "index.html"));
    return;
  }

  serveFile(res, path.join(__dirname, req.url));
});

server.listen(PORT, () => {
  console.log(`\n  Elite Player Tracker is running!\n`);
  console.log(`  Open in your browser: http://localhost:${PORT}\n`);
});
