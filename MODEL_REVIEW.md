# WNBA Edge Lab — model review

The original calculation audit identified five structural issues that are now
enforced in code and tests.

## Corrections

1. **Opponent defence affects scoring.** Each offence is blended with the
   opponent's points allowed before the margin is calculated.
2. **Split and recent-form weights are active.** The configured weights flow
   directly into the single projection object used everywhere in the app.
3. **Every view shares one projection.** Scores, probabilities, market gaps and
   explanations read from the same game projection.
4. **The daily exposure cap is preventive.** Plays are allocated in tier/edge
   order, with one selected market per game. The minimum stake never forces the
   portfolio over its cap.
5. **Spread uncertainty is conservative.** The model uses an 11-point spread
   standard deviation and compresses extreme model/market disagreements before
   pricing a play.

## Preserved calculation rules

- proportional two-way de-vigging;
- break-even probability from the price actually offered;
- half-Kelly sizing with per-bet and daily caps;
- 3% Lean, 5% Good and 8% Best Bet presentation thresholds;
- 70% minimum confidence and home-court, rest, injury, form and split controls;
- moneyline, spread and total evaluation at live normalized prices.

## Added live safeguards

- completed results drive schedule-adjusted ridge ratings and recent profiles;
- projections are partially anchored to the current market, with hard
  disagreement compression and a selection haircut;
- a Best Bet is downgraded when confidence, price or line-gap checks fail;
- qualified prices are locked once in an immutable ledger and graded from final
  scores; later line movement cannot rewrite the entry;
- an unpriced or already-started game cannot become a wager;
- a failed refresh can reuse only a prior real-data cache and never creates a
  synthetic slate.

The test suite covers odds conversion, de-vigging, opponent-defence sensitivity,
rating construction, projection reconciliation, market pricing, no forced play,
portfolio limits, duplicate prevention and result grading.
