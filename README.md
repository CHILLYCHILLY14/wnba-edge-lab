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
- selects no more than one qualified play per game within the daily exposure cap;
- locks first-seen qualified plays, grades completed games and updates ROI;
- republishes the static dashboard to GitHub Pages.

The dashboard includes Best Bets, Full Board, Schedule, a 10,000-run scenario
simulator, Bet Ledger, Accuracy, Model and Data Sources views. One selected date
drives every relevant view.

## Risk rules

- C$200 starting model bankroll and half-Kelly sizing;
- C$5 minimum, C$60 per-bet maximum and 35% daily exposure cap;
- 3% Lean, 5% Good and 8% Best Bet thresholds;
- 70% minimum confidence, with stricter Best Bet gates;
- moneyline, spread and total pricing at the actual available quote;
- started games and unpriced markets are never selected.

See [`MODEL_REVIEW.md`](MODEL_REVIEW.md) for the calculation audit. Model output
is informational, not betting advice or a guarantee.
