import { describe, it, expect } from "bun:test";
import { generateSessionName } from "./session-names.ts";

describe("generateSessionName", () => {
  it("returns a non-empty string", () => {
    const name = generateSessionName([]);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });

  it("avoids names in the existing list", () => {
    // Pass all towns except "zillah" — the only option left
    const allTowns = Array.from({ length: 100 }, (_, i) => generateSessionName([]));
    const uniqueTowns = [...new Set(allTowns)];

    // With 92 towns, passing 91 should force the remaining one
    // Use a known subset approach: pass all except one specific town
    const existing = [
      "anacortes", "ashland", "astoria", "belfair", "birkenfeld", "blaine",
      "brinnon", "bucoda", "carbonado", "cascade", "cathlamet", "chimacum",
      "chinook", "clatskanie", "concrete", "conconully", "copalis", "darrington",
      "deception", "diablo", "duvall", "edgewood", "ellensburg", "entiat",
      "enumclaw", "forks", "freeland", "glacier", "goldbar", "goldendale",
      "granite", "humptulips", "hurricane", "hyak", "ilwaco", "kalama",
      "kalaloch", "klickitat", "klipsan", "la-push", "leavenworth", "lilliwaup",
      "loomis", "lummi", "manzanita", "mazama", "moclips", "mosier",
      "mukilteo", "nehalem", "nooksack", "nordland", "orcas", "ozette",
      "packwood", "peshastin", "poulsbo", "quilcene", "quinault", "rockaway",
      "roslyn", "salal", "sappho", "sasquatch", "sekiu", "sequim",
      "silverton", "skykomish", "snoqualmie", "stehekin", "steilacoom", "sumas",
      "taholah", "tahuya", "tenino", "tieton", "tokeland", "toppenish",
      "twisp", "umbrella", "union", "vashon", "wahkiakum", "walla-walla",
      "washougal", "westport", "whistler", "winthrop", "yachats", "yelm",
      // omit "zillah"
    ];
    const name = generateSessionName(existing);
    expect(name).toBe("zillah");
  });

  it("falls back to full pool when all names exhausted", () => {
    const allTowns = [
      "anacortes", "ashland", "astoria", "belfair", "birkenfeld", "blaine",
      "brinnon", "bucoda", "carbonado", "cascade", "cathlamet", "chimacum",
      "chinook", "clatskanie", "concrete", "conconully", "copalis", "darrington",
      "deception", "diablo", "duvall", "edgewood", "ellensburg", "entiat",
      "enumclaw", "forks", "freeland", "glacier", "goldbar", "goldendale",
      "granite", "humptulips", "hurricane", "hyak", "ilwaco", "kalama",
      "kalaloch", "klickitat", "klipsan", "la-push", "leavenworth", "lilliwaup",
      "loomis", "lummi", "manzanita", "mazama", "moclips", "mosier",
      "mukilteo", "nehalem", "nooksack", "nordland", "orcas", "ozette",
      "packwood", "peshastin", "poulsbo", "quilcene", "quinault", "rockaway",
      "roslyn", "salal", "sappho", "sasquatch", "sekiu", "sequim",
      "silverton", "skykomish", "snoqualmie", "stehekin", "steilacoom", "sumas",
      "taholah", "tahuya", "tenino", "tieton", "tokeland", "toppenish",
      "twisp", "umbrella", "union", "vashon", "wahkiakum", "walla-walla",
      "washougal", "westport", "whistler", "winthrop", "yachats", "yelm",
      "zillah",
    ];
    // Even with all names used, it should still return something
    const name = generateSessionName(allTowns);
    expect(typeof name).toBe("string");
    expect(name.length).toBeGreaterThan(0);
  });
});
