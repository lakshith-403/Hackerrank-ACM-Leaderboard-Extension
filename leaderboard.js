// Core: fetch contest data from HackerRank's internal REST API and compute the leaderboard.
// Runs as a content script on www.hackerrank.com, so every request is same-origin and
// carries the signed-in session. judge_submissions only works for contest moderators.

// ---- Scoring rule -------------------------------------------------------------------
// Per solved problem:  max_score + (duration - minutes) / 5 - wrongBeforeAC * 10
// duration = contest end - start in minutes, read from the contest settings.
// minutes = time of first Accepted submission since contest start, fractions rounded up.
// Unsolved problems contribute 0.
const HRACM_CONFIG = {
  DEFAULT_DURATION: 120, // minutes; used only when the contest has no end time
  TIME_BONUS_DIVISOR: 5,
  WRONG_PENALTY: 10,
  // Statuses that never count as a wrong attempt.
  NOT_PENALISED: new Set(['Compilation error']),
  PAGE_SIZE: 500,
  DEFAULT_MAX_SCORE: 100, // used only if a challenge is missing from the challenges list
};

const HRACM = (() => {
  const C = HRACM_CONFIG;

  async function getJSON(path) {
    const res = await fetch(path, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
    return res.json();
  }

  async function fetchContest(slug) {
    const j = await getJSON(`/rest/contests/${encodeURIComponent(slug)}`);
    if (!j.model) throw new Error(`Contest "${slug}" not found`);
    return j.model;
  }

  async function fetchChallenges(slug) {
    const out = [];
    for (let offset = 0; ; offset += 50) {
      const j = await getJSON(`/rest/contests/${encodeURIComponent(slug)}/challenges?offset=${offset}&limit=50`);
      out.push(...(j.models || []));
      if (!j.models || j.models.length < 50 || out.length >= (j.total || 0)) break;
    }
    return out.map((c) => ({ slug: c.slug, name: c.name, maxScore: Number(c.max_score) || C.DEFAULT_MAX_SCORE }));
  }

  async function fetchSubmissions(slug, onProgress) {
    const out = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += C.PAGE_SIZE) {
      const j = await getJSON(
        `/rest/contests/${encodeURIComponent(slug)}/judge_submissions/?offset=${offset}&limit=${C.PAGE_SIZE}`
      );
      total = j.total || 0;
      const page = j.models || [];
      out.push(...page);
      if (onProgress) onProgress(out.length, total);
      if (page.length === 0) break;
    }
    // Pages are newest-first; a submission arriving mid-fetch can shift a row across pages.
    const seen = new Map();
    for (const s of out) seen.set(s.id, s);
    return [...seen.values()];
  }

  const isPending = (status) => !status || /queue|process|running|judging|pending/i.test(status);
  const isAccepted = (status) => status === 'Accepted';

  // includeOutside: count submissions made before start / after start+duration
  // (times are clamped into the window). Useful for testing on finished contests.
  // Contest length in minutes from its settings, or null if it has no end time.
  function contestDuration(contest) {
    const s = Number(contest.epoch_starttime);
    const e = Number(contest.epoch_endtime);
    return s > 0 && e > s ? Math.round((e - s) / 60) : null;
  }

  // startOverride (epoch seconds) / durationOverride (minutes) replace the contest's own
  // values, e.g. for a past contest whose times were later edited on HackerRank.
  function compute({ contest, challenges, submissions, includeOutside = false, startOverride = null, durationOverride = null }) {
    const start = startOverride != null ? Number(startOverride) : Number(contest.epoch_starttime);
    const fromContest = contestDuration(contest);
    const duration = durationOverride != null ? Number(durationOverride) : fromContest ?? C.DEFAULT_DURATION;
    const durationSource = durationOverride != null ? 'override' : fromContest != null ? 'contest' : 'default';
    const windowEnd = start + duration * 60;
    const chMap = new Map(challenges.map((c) => [c.slug, c]));
    let pending = 0;
    let outside = 0;

    // hacker -> challengeSlug -> submissions[]
    const byHacker = new Map();
    for (const s of submissions) {
      if (s.kind && s.kind !== 'code') continue;
      if (isPending(s.status)) { pending++; continue; }
      const t = Number(s.created_at);
      if (t < start || t > windowEnd) {
        outside++;
        if (!includeOutside) continue;
      }
      const chSlug = s.challenge && s.challenge.slug;
      if (!chSlug) continue;
      if (!chMap.has(chSlug)) {
        const ch = { slug: chSlug, name: (s.challenge && s.challenge.name) || chSlug, maxScore: C.DEFAULT_MAX_SCORE };
        chMap.set(chSlug, ch);
        challenges.push(ch);
      }
      let h = byHacker.get(s.hacker_id);
      if (!h) {
        h = { id: s.hacker_id, username: s.hacker_username, probs: new Map() };
        byHacker.set(s.hacker_id, h);
      }
      if (!h.probs.has(chSlug)) h.probs.set(chSlug, []);
      h.probs.get(chSlug).push(s);
    }

    const rows = [];
    for (const h of byHacker.values()) {
      const cells = {};
      let total = 0;
      let solved = 0;
      let lastAC = 0;
      for (const [chSlug, subs] of h.probs) {
        subs.sort((a, b) => a.created_at - b.created_at || a.id - b.id);
        let wrong = 0;
        let ignored = 0; // rejected but not penalised (compilation errors)
        let cell = null;
        for (const s of subs) {
          if (isAccepted(s.status)) {
            const secs = Math.min(Math.max(s.created_at - start, 0), duration * 60);
            const minutes = Math.ceil(secs / 60);
            const max = chMap.get(chSlug).maxScore;
            const score = max + (duration - minutes) / C.TIME_BONUS_DIVISOR - wrong * C.WRONG_PENALTY;
            cell = { solved: true, minutes, wrong, ignored, score, acAt: s.created_at };
            break;
          }
          if (C.NOT_PENALISED.has(s.status)) ignored++;
          else wrong++;
        }
        if (!cell) cell = { solved: false, wrong, ignored, score: 0 };
        cells[chSlug] = cell;
        if (cell.solved) {
          solved++;
          total += cell.score;
          lastAC = Math.max(lastAC, cell.minutes);
        }
      }
      rows.push({ id: h.id, username: h.username, cells, total: round(total), solved, lastAC });
    }

    // Rank: total desc, then solved desc, then earliest last accepted minute.
    rows.sort((a, b) => b.total - a.total || b.solved - a.solved || a.lastAC - b.lastAC || a.username.localeCompare(b.username));
    rows.forEach((r, i) => {
      const p = rows[i - 1];
      r.rank = p && p.total === r.total && p.solved === r.solved && p.lastAC === r.lastAC ? p.rank : i + 1;
    });

    // First solver of each problem.
    const firstSolve = {};
    for (const r of rows) {
      for (const [slug, c] of Object.entries(r.cells)) {
        if (c.solved && (!firstSolve[slug] || c.acAt < firstSolve[slug].acAt)) firstSolve[slug] = { id: r.id, acAt: c.acAt };
      }
    }
    for (const r of rows) {
      for (const [slug, c] of Object.entries(r.cells)) c.first = !!(c.solved && firstSolve[slug] && firstSolve[slug].id === r.id);
    }

    return { rows, challenges, pending, outside, start, windowEnd, duration, durationSource };
  }

  const round = (x) => Math.round(x * 100) / 100;

  async function load(slug, { includeOutside = false, startOverride = null, durationOverride = null, onProgress } = {}) {
    const [contest, challenges] = await Promise.all([fetchContest(slug), fetchChallenges(slug)]);
    const submissions = await fetchSubmissions(slug, onProgress);
    return {
      contest,
      submissionCount: submissions.length,
      ...compute({ contest, challenges, submissions, includeOutside, startOverride, durationOverride }),
    };
  }

  return { load, compute, contestDuration, config: C };
})();
