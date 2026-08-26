# WNBA Edge Lab

An automatic WNBA model and dashboard built to follow the same operating model
as MLB Edge Desk. It fetches the schedule, results, team performance, injury
reports and available DraftKings prices from ESPN's public feeds, then rebuilds
the board without asking the user for data or an API key.

There is no uploaded slate, spreadsheet input, sample board, demo mode or
fabricated fallback. If a live refresh fails, the last successfully fetched
real-data cache remains visible and is labeled. If no real cache exists, the
dashboard shows an honest no-data state.

## Run locally

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m pipeline.build
cd site && python -m http.server 8000
```

Open <http://localhost:8000>. `python -m pipeline.build --offline` rebuilds from
the last real cache only; it never synthesizes games or prices.

## Automatic operation

The GitHub Actions workflow refreshes several times daily and on every push to
`main`. Each run:

- refreshes the season schedule, final scores, current markets and injuries;
- calculates opponent-adjusted team ratings and one projection per game;
- selects no more than one side and one total per game within the daily exposure cap;
- freezes every priced model call in a separate accuracy shadow book;
- republishes the static dashboard to GitHub Pages.

Qualified plays are recommendations only. They are **not** written to My
Ledger automatically. Review the current sportsbook price, click **Add to My
Ledger** only after you place the wager, and edit the stake to the amount you
actually accepted. The browser locks that confirmed entry and grades it from
the final ESPN score. JSON and CSV export keep a portable backup.

The dashboard includes Best Bets, Full Board, Schedule, a 10,000-run scenario
simulator, My Ledger, Accuracy, Model and Data Sources views. One selected date
drives every relevant view.

## Risk rules

- C$200 starting model bankroll and half-Kelly sizing;
- C$5 minimum, C$60 per-bet maximum and 35% daily exposure cap;
- 1.2% Lean, 2.5% Good and 3.5% Best Bet compressed model-edge thresholds;
- 70% minimum confidence, with stricter Best Bet gates;
- no-vig two-way market comparison for qualification, with actual offered-price
  break-even and realized value kept separate;
- moneyline, spread and total pricing only when real two-sided quotes exist;
- started games and unpriced markets are never selected.

See [`MODEL_REVIEW.md`](MODEL_REVIEW.md) for the calculation audit. Model output
is informational, not betting advice or a guarantee.
