// Stubs HackerRank's REST endpoints with made-up data so the real extension code can be
// screenshotted without a live contest or real contestants.
(() => {
  const START = Date.UTC(2026, 10, 12, 4, 30) / 1000; // 12 Nov 2026 10:00 IST
  const END = START + 120 * 60;
  const challenges = [
    { slug: 'signal-towers', name: 'Signal Towers', max_score: 100 },
    { slug: 'river-crossing', name: 'River Crossing', max_score: 100 },
    { slug: 'prime-garden', name: 'Prime Garden', max_score: 150 },
    { slug: 'maze-runner', name: 'Maze Runner', max_score: 200 },
  ];
  // [team, challengeIndex, status, minute]
  const W = 'Wrong Answer', A = 'Accepted', CE = 'Compilation error', R = 'Runtime Error', T = 'Terminated due to timeout';
  const plan = [
    ['team_falcon', 0, A, 6], ['team_falcon', 1, W, 14], ['team_falcon', 1, A, 19], ['team_falcon', 2, A, 41], ['team_falcon', 3, T, 70], ['team_falcon', 3, A, 88],
    ['code_crafters', 0, A, 4], ['code_crafters', 1, A, 22], ['code_crafters', 2, W, 35], ['code_crafters', 2, W, 44], ['code_crafters', 2, A, 52], ['code_crafters', 3, A, 97],
    ['byte_busters', 0, CE, 8], ['byte_busters', 0, A, 11], ['byte_busters', 2, A, 38], ['byte_busters', 1, A, 46], ['byte_busters', 3, W, 101],
    ['null_pointers', 1, A, 9], ['null_pointers', 0, A, 17], ['null_pointers', 2, R, 60], ['null_pointers', 2, A, 74],
    ['stack_smashers', 0, A, 13], ['stack_smashers', 2, A, 57], ['stack_smashers', 1, W, 63], ['stack_smashers', 1, W, 79],
    ['loop_legends', 0, W, 10], ['loop_legends', 0, A, 25], ['loop_legends', 1, A, 49], ['loop_legends', 3, CE, 90],
    ['binary_bees', 1, A, 31], ['binary_bees', 0, R, 40], ['binary_bees', 0, W, 55],
    ['debug_ducks', 0, A, 66], ['debug_ducks', 1, CE, 84], ['debug_ducks', 1, W, 93],
    ['merge_masters', 0, CE, 20], ['merge_masters', 0, W, 28], ['merge_masters', 2, W, 112],
    ['heap_heroes', 1, W, 36], ['heap_heroes', 1, 'Processing', 119],
  ];
  const teams = [...new Set(plan.map((p) => p[0]))];
  const subs = plan.map(([team, c, status, min], i) => ({
    id: 1000 + i, kind: 'code', hacker_id: teams.indexOf(team) + 1, hacker_username: team,
    challenge: { slug: challenges[c].slug, name: challenges[c].name }, status,
    created_at: START + min * 60 - 17,
  })).reverse(); // API returns newest first

  const json = (o) => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  window.fetch = (url) => {
    const u = new URL(url, 'https://www.hackerrank.com');
    const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 10;
    if (/\/judge_submissions\/?$/.test(u.pathname)) return json({ total: subs.length, models: subs.slice(off, off + lim) });
    if (/\/challenges$/.test(u.pathname)) return json({ total: challenges.length, models: challenges.slice(off, off + lim) });
    return json({ model: { slug: 'demo-contest', epoch_starttime: START, epoch_endtime: END } });
  };
})();
