"""WNBA ratings, projections, pricing and portfolio allocation.

Every displayed number is produced here from live season results and live
prices. There is no sample fallback and no forced-play branch.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone

import numpy as np


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def american_to_decimal(price: float) -> float:
    return 1.0 + (price / 100.0 if price > 0 else 100.0 / -price)


def american_to_prob(price: float) -> float:
    return 100.0 / (price + 100.0) if price > 0 else -price / (-price + 100.0)


def price_ok(price) -> bool:
    """True only for a usable American price from a real market."""
    try:
        value = float(price)
    except (TypeError, ValueError):
        return False
    return math.isfinite(value) and 100.0 <= abs(value) <= 5000.0


def prob_to_american(prob: float) -> int:
    p = min(max(prob, 0.001), 0.999)
    value = -100.0 * p / (1.0 - p) if p >= 0.5 else 100.0 * (1.0 - p) / p
    return int(round(value))


def devig(price_a: float, price_b: float) -> tuple[float | None, float | None]:
    """Remove a two-way hold with the same power method used by MLB Edge."""
    if not price_ok(price_a) or not price_ok(price_b):
        return None, None
    a, b = american_to_prob(float(price_a)), american_to_prob(float(price_b))
    lo, hi = 0.5, 2.0
    for _ in range(60):
        exponent = (lo + hi) / 2.0
        if a ** exponent + b ** exponent > 1.0:
            lo = exponent
        else:
            hi = exponent
    exponent = (lo + hi) / 2.0
    fair_a, fair_b = a ** exponent, b ** exponent
    total = fair_a + fair_b
    return fair_a / total, fair_b / total


def kelly_fraction(prob: float, price: float) -> float:
    b = american_to_decimal(price) - 1.0
    if b <= 0:
        return 0.0
    return max(0.0, (prob * b - (1.0 - prob)) / b)


def solve_ratings(history: list[dict], cfg: dict) -> dict[str, float]:
    """Ridge solve schedule-adjusted team strength from completed margins."""
    teams = sorted({game[side]["abbr"] for game in history for side in ("away", "home")})
    if not teams:
        return {}
    index = {team: i for i, team in enumerate(teams)}
    rows, targets = [], []
    hca = float(cfg["model"]["home_court_points"])
    cap = float(cfg["model"]["rating_mov_cap"])
    for game in history:
        away_score = game["away"].get("score")
        home_score = game["home"].get("score")
        if away_score is None or home_score is None:
            continue
        row = np.zeros(len(teams), dtype=float)
        row[index[game["home"]["abbr"]]] = 1.0
        row[index[game["away"]["abbr"]]] = -1.0
        rows.append(row)
        targets.append(max(-cap, min(cap, float(home_score) - float(away_score))) - hca)
    if not rows:
        return {team: 0.0 for team in teams}
    matrix = np.vstack(rows)
    ridge = float(cfg["model"]["rating_ridge"])
    lhs = matrix.T @ matrix + ridge * np.eye(len(teams))
    values = np.linalg.solve(lhs, matrix.T @ np.asarray(targets))
    values -= values.mean()
    return {team: round(float(values[index[team]]), 3) for team in teams}


def _pct(record: str | None) -> float:
    try:
        wins, losses = (int(part) for part in str(record).split("-")[:2])
        return wins / (wins + losses) if wins + losses else 0.5
    except (TypeError, ValueError):
        return 0.5


def team_profile(team: str, history: list[dict], next_tipoff: str, ratings: dict[str, float]) -> dict:
    games = [game for game in history if team in {game["away"]["abbr"], game["home"]["abbr"]}]
    games.sort(key=lambda game: game["tipoff"])
    scored, allowed, home_results, road_results = [], [], [], []
    for game in games:
        home = game["home"]["abbr"] == team
        mine = game["home"]["score"] if home else game["away"]["score"]
        theirs = game["away"]["score"] if home else game["home"]["score"]
        if mine is None or theirs is None:
            continue
        scored.append(float(mine))
        allowed.append(float(theirs))
        (home_results if home else road_results).append(float(mine) > float(theirs))
    recent_scored, recent_allowed = scored[-10:], allowed[-10:]
    recent_wins = [s > a for s, a in zip(recent_scored, recent_allowed)]
    league_fallback = 82.0
    last_tip = datetime.fromisoformat(games[-1]["tipoff"].replace("Z", "+00:00")) if games else None
    next_tip = datetime.fromisoformat(next_tipoff.replace("Z", "+00:00"))
    rest_days = max(0.0, (next_tip - last_tip).total_seconds() / 86400.0) if last_tip else 2.0
    return {
        "team": team,
        "games": len(scored),
        "ppg": round(sum(scored) / len(scored), 2) if scored else league_fallback,
        "papg": round(sum(allowed) / len(allowed), 2) if allowed else league_fallback,
        "l10_ppg": round(sum(recent_scored) / len(recent_scored), 2) if recent_scored else league_fallback,
        "l10_papg": round(sum(recent_allowed) / len(recent_allowed), 2) if recent_allowed else league_fallback,
        "win_pct": round(sum(s > a for s, a in zip(scored, allowed)) / len(scored), 4) if scored else 0.5,
        "l10_pct": round(sum(recent_wins) / len(recent_wins), 4) if recent_wins else 0.5,
        "home_pct": round(sum(home_results) / len(home_results), 4) if home_results else 0.5,
        "road_pct": round(sum(road_results) / len(road_results), 4) if road_results else 0.5,
        "rest_days": round(rest_days, 2),
        "power_rating": float(ratings.get(team, 0.0)),
    }


def _injury(team: str, injuries: dict[str, dict]) -> dict:
    return injuries.get(team) or {"team": team, "points": 0.0, "uncertain": False, "players": []}


def project_game(game: dict, away: dict, home: dict, injuries: dict[str, dict], cfg: dict) -> dict:
    """Project home-minus-away margin and total with every adjustment visible."""
    m = cfg["model"]
    away_injury, home_injury = _injury(game["away"]["abbr"], injuries), _injury(game["home"]["abbr"], injuries)

    # Opponent defense is explicitly wired into both scoring estimates.
    away_base = (float(away["ppg"]) + float(home["papg"])) / 2.0
    home_base = (float(home["ppg"]) + float(away["papg"])) / 2.0
    raw_base_margin = home_base - away_base
    power_adj = ((float(home["power_rating"]) - float(away["power_rating"]))
                 * float(m["power_rating_weight"]))
    split_adj = ((float(home["home_pct"]) - float(away["road_pct"]))
                 * float(m["split_scale"]) * float(m["split_weight"]))
    form_adj = ((float(home["l10_pct"]) - float(away["l10_pct"]))
                * float(m["recent_form_scale"]) * float(m["recent_form_weight"]))
    rest_raw = ((float(home["rest_days"]) - float(away["rest_days"]))
                * float(m["rest_points_per_day"]))
    rest_cap = float(m["max_rest_adjustment"])
    rest_adj = max(-rest_cap, min(rest_cap, rest_raw))
    injury_adj = ((float(away_injury["points"]) - float(home_injury["points"]))
                  * float(m["injury_weight"]))
    home_court = float(m["home_court_points"])
    raw_margin = raw_base_margin + power_adj + split_adj + form_adj + rest_adj + injury_adj + home_court

    recent_total = (float(away["l10_ppg"]) + float(home["l10_ppg"])
                    + float(away["l10_papg"]) + float(home["l10_papg"])) / 2.0
    season_total = away_base + home_base
    injury_total = ((float(away_injury["points"]) + float(home_injury["points"]))
                    * float(m["injury_total_weight"]))
    raw_total = 0.65 * season_total + 0.35 * recent_total - injury_total

    quotes = ((game.get("odds") or {}).get("quotes") or {})
    home_spread = (quotes.get("home_spread") or {}).get("line")
    market_total = (quotes.get("over") or quotes.get("under") or {}).get("line")
    anchored = home_spread is not None
    if anchored:
        market_margin = -float(home_spread)
        raw_gap = raw_margin - market_margin
        max_gap = float(m["max_spread_disagreement"])
        kept_gap = max_gap * math.tanh(raw_gap / max_gap)
        margin = market_margin + float(m["projection_blend"]) * kept_gap
    else:
        market_margin, raw_gap, kept_gap, margin = None, None, None, raw_margin
    if market_total is not None:
        raw_total_gap = raw_total - float(market_total)
        max_total_gap = float(m["max_total_disagreement"])
        kept_total_gap = max_total_gap * math.tanh(raw_total_gap / max_total_gap)
        total = float(market_total) + float(m["total_blend"]) * kept_total_gap
    else:
        raw_total_gap, kept_total_gap, total = None, None, raw_total

    min_games = min(int(away["games"]), int(home["games"]))
    confidence = min(0.95, 0.62 + 0.33 * min(1.0, min_games / float(m["min_games_for_full_confidence"])))
    if away_injury["uncertain"] or home_injury["uncertain"]:
        confidence -= float(cfg["injuries"]["uncertainty_confidence_penalty"])

    factors = [
        {"name": "Opponent-adjusted scoring", "points": round(raw_base_margin, 2), "note": "team scoring blended with opponent points allowed"},
        {"name": "Schedule-adjusted power", "points": round(power_adj, 2), "note": "ridge rating from completed margins"},
        {"name": "Home court", "points": round(home_court, 2), "note": "configured WNBA home-court value"},
        {"name": "Home/road split", "points": round(split_adj, 2), "note": "configured split weight applied"},
        {"name": "Recent form", "points": round(form_adj, 2), "note": "last ten win rate, weighted"},
        {"name": "Rest", "points": round(rest_adj, 2), "note": f'{home["rest_days"]:.1f} vs {away["rest_days"]:.1f} days'},
        {"name": "Injuries", "points": round(injury_adj, 2), "note": "live ESPN status report, capped by team"},
    ]
    return {
        "raw_margin": round(raw_margin, 2),
        "margin": round(margin, 2),
        "market_margin": round(market_margin, 2) if market_margin is not None else None,
        "raw_line_gap": round(raw_gap, 2) if raw_gap is not None else None,
        "line_gap": round(margin - market_margin, 2) if market_margin is not None else None,
        "kept_line_gap": round(kept_gap, 2) if kept_gap is not None else None,
        "raw_total": round(raw_total, 2),
        "total": round(total, 2),
        "market_total": round(float(market_total), 2) if market_total is not None else None,
        "raw_total_gap": round(raw_total_gap, 2) if raw_total_gap is not None else None,
        "kept_total_gap": round(kept_total_gap, 2) if kept_total_gap is not None else None,
        "away_score": round((total - margin) / 2.0, 1),
        "home_score": round((total + margin) / 2.0, 1),
        "confidence": round(max(0.0, confidence), 4),
        "anchored": anchored,
        "factors": factors,
        "away_profile": away,
        "home_profile": home,
        "away_injuries": away_injury,
        "home_injuries": home_injury,
    }


def _compress_edge(raw_edge: float, cfg: dict, market: str) -> float:
    model_cfg = cfg["model"]
    ceiling = float(model_cfg["total_edge_ceiling"] if market == "TOTAL"
                    else model_cfg["side_edge_ceiling"])
    compressed = ceiling * math.tanh(raw_edge / ceiling)
    if compressed > 0:
        compressed = max(0.0, compressed - float(model_cfg.get("selection_haircut", 0.0)))
    return compressed


def _tier(edge: float, confidence: float, line_gap: float | None, price: float, cfg: dict) -> tuple[str, str | None]:
    tiers = cfg["tiers"]
    if edge < float(tiers["lean"]):
        return "AVOID", None
    if edge >= float(tiers["best_bet"]):
        reasons = []
        if confidence < float(tiers["best_bet_min_confidence"]):
            reasons.append("confidence below BEST BET minimum")
        if line_gap is None or abs(line_gap) < float(tiers["best_bet_min_line_gap"]):
            reasons.append("model line is too close to market")
        if line_gap is not None and abs(line_gap) > float(tiers["best_bet_max_line_gap"]):
            reasons.append("model/market disagreement exceeds safety limit")
        if price < float(tiers["best_bet_min_price"]):
            reasons.append("price is too short for BEST BET")
        if price > float(tiers["best_bet_max_price"]):
            reasons.append("price is too long for BEST BET")
        return ("BEST BET", None) if not reasons else ("GOOD", "; ".join(reasons))
    if edge >= float(tiers["good"]):
        return "GOOD", None
    return "LEAN", None


def _candidate(game: dict, projection: dict, quote_key: str, label: str, market: str,
               side: str, model_prob: float, fair_prob: float | None, cfg: dict) -> dict | None:
    quote = (((game.get("odds") or {}).get("quotes") or {}).get(quote_key))
    if not quote or not price_ok(quote.get("price")):
        return None
    price = float(quote["price"])
    breakeven = american_to_prob(price)
    # Match MLB Edge's separation of handicapping edge and price-shopping edge.
    # Qualification is based on the model versus the complete, no-vig two-way
    # market. The actual offered price is retained for EV and stake sizing.
    raw_edge = (model_prob / fair_prob - 1.0) if fair_prob and fair_prob > 0 else 0.0
    raw_realized_edge = model_prob * american_to_decimal(price) - 1.0
    edge = _compress_edge(raw_edge, cfg, market)
    realized_edge = _compress_edge(raw_realized_edge, cfg, market)
    line_gap = projection["line_gap"] if market in {"ML", "ATS"} else (
        (projection["total"] - projection["market_total"]) if projection["market_total"] is not None else None)
    tier, tier_note = _tier(edge, projection["confidence"], line_gap, price, cfg)
    reasons: list[str] = []
    filters = cfg["filters"]
    if fair_prob is None:
        tier = "AVOID"
        reasons.append("Complete two-way market required")
    if realized_edge <= 0:
        tier = "AVOID"
        reasons.append("Offered price has no positive expected value")
    if price < float(filters["min_price"]) or price > float(filters["max_price"]):
        tier = "AVOID"
        reasons.append("Price outside allowable range")
    if projection["confidence"] < float(filters["min_confidence"]):
        tier = "AVOID"
        reasons.append("Confidence below minimum")
    if edge < float(cfg["tiers"]["lean"]):
        reasons.append("Does not clear the Lean model-edge threshold")
    if game["status"] != "pre":
        tier = "AVOID"
        reasons.append("Game has already started")

    bankroll = cfg["bankroll"]
    # Size from the smaller of model and realized compressed edge. This keeps a
    # large raw probability disagreement from producing a large raw-Kelly bet.
    stake_edge = max(0.0, min(edge, realized_edge))
    effective_prob = min(0.999, max(0.001, (1.0 + stake_edge) / american_to_decimal(price)))
    raw_kelly = kelly_fraction(effective_prob, price)
    requested = min(
        float(bankroll["max_stake"]),
        float(bankroll["starting"]) * float(bankroll["max_stake_pct"]),
        float(bankroll["starting"]) * raw_kelly * float(bankroll["kelly_fraction"]),
    )
    if tier != "AVOID" and 0 < requested < float(bankroll["min_stake"]):
        requested = float(bankroll["min_stake"])
    fair_price = prob_to_american(model_prob)
    return {
        "candidate_id": f'{game["game_id"]}:{market}:{side}',
        "game_id": game["game_id"],
        "date": game["date"],
        "tipoff": game["tipoff"],
        "start_local": game["start_local"],
        "matchup": f'{game["away"]["abbr"]} @ {game["home"]["abbr"]}',
        "away": game["away"]["abbr"],
        "home": game["home"]["abbr"],
        "market": market,
        "side": side,
        "pick": label,
        "line": quote.get("line"),
        "price": int(price),
        "open_line": quote.get("open_line"),
        "open_price": quote.get("open_price"),
        "book": quote.get("book") or (game.get("odds") or {}).get("book"),
        "model_prob": round(model_prob, 4),
        "market_fair_prob": round(fair_prob, 4) if fair_prob is not None else None,
        "breakeven": round(breakeven, 4),
        "fair_price": fair_price,
        "edge_raw": round(raw_edge, 4),
        "edge": round(edge, 4),
        "edge_real_raw": round(raw_realized_edge, 4),
        "edge_real": round(realized_edge, 4),
        "edge_price": round(realized_edge - edge, 4),
        "confidence": projection["confidence"],
        "tier": tier,
        "tier_note": tier_note,
        "reasons": reasons,
        "kelly_raw": round(raw_kelly, 4),
        "stake_before_daily_cap": round(requested, 2),
        "stake": 0.0,
        "projection": projection,
    }


def price_game(game: dict, projection: dict, cfg: dict) -> list[dict]:
    quotes = ((game.get("odds") or {}).get("quotes") or {})
    if not quotes:
        return []
    ml_fair = devig(quotes["away_ml"]["price"], quotes["home_ml"]["price"]) \
        if quotes.get("away_ml") and quotes.get("home_ml") else (None, None)
    spread_fair = devig(quotes["away_spread"]["price"], quotes["home_spread"]["price"]) \
        if quotes.get("away_spread") and quotes.get("home_spread") else (None, None)
    total_fair = devig(quotes["over"]["price"], quotes["under"]["price"]) \
        if quotes.get("over") and quotes.get("under") else (None, None)

    margin, total = float(projection["margin"]), float(projection["total"])
    spread_sd, total_sd = float(cfg["model"]["spread_sigma"]), float(cfg["model"]["total_sigma"])
    home_win = normal_cdf(margin / spread_sd)
    away_win = 1.0 - home_win
    rows = [
        _candidate(game, projection, "away_ml", f'{game["away"]["abbr"]} ML', "ML", "away", away_win, ml_fair[0], cfg),
        _candidate(game, projection, "home_ml", f'{game["home"]["abbr"]} ML', "ML", "home", home_win, ml_fair[1], cfg),
    ]
    if quotes.get("away_spread"):
        line = float(quotes["away_spread"]["line"])
        prob = normal_cdf((line - margin) / spread_sd)
        rows.append(_candidate(game, projection, "away_spread", f'{game["away"]["abbr"]} {line:+g}', "ATS", "away", prob, spread_fair[0], cfg))
    if quotes.get("home_spread"):
        line = float(quotes["home_spread"]["line"])
        prob = 1.0 - normal_cdf((-line - margin) / spread_sd)
        rows.append(_candidate(game, projection, "home_spread", f'{game["home"]["abbr"]} {line:+g}', "ATS", "home", prob, spread_fair[1], cfg))
    if quotes.get("over"):
        line = float(quotes["over"]["line"])
        prob = 1.0 - normal_cdf((line - total) / total_sd)
        rows.append(_candidate(game, projection, "over", f'Over {line:g}', "TOTAL", "over", prob, total_fair[0], cfg))
    if quotes.get("under"):
        line = float(quotes["under"]["line"])
        prob = normal_cdf((line - total) / total_sd)
        rows.append(_candidate(game, projection, "under", f'Under {line:g}', "TOTAL", "under", prob, total_fair[1], cfg))
    return [row for row in rows if row is not None]


def allocate_portfolio(candidates: list[dict], cfg: dict) -> list[dict]:
    """Allocate at most one side and one total per game within the daily cap."""
    bankroll = cfg["bankroll"]
    cap = float(bankroll["starting"]) * float(bankroll["max_daily_exposure_pct"])
    increment = float(bankroll["round_stake_to"])
    order = {"BEST BET": 0, "GOOD": 1, "LEAN": 2, "AVOID": 3}
    dates = sorted({row["date"] for row in candidates})
    for date in dates:
        remaining, used_slots = cap, set()
        rows = [row for row in candidates if row["date"] == date]
        rows.sort(key=lambda row: (order[row["tier"]], -row["edge"], row["game_id"], row["market"]))
        for row in rows:
            if row["tier"] == "AVOID":
                continue
            slot = (row["game_id"], "TOTAL" if row["market"] == "TOTAL" else "SIDE")
            if slot in used_slots:
                row["tier"] = "AVOID"
                row["reasons"].append("Higher-rated market already selected for this game and market group")
                continue
            requested = float(row["stake_before_daily_cap"])
            granted = min(requested, remaining)
            granted = math.floor((granted + 1e-9) / increment) * increment
            if granted < float(bankroll["min_stake"]):
                row["tier"] = "AVOID"
                row["reasons"].append("Daily exposure cap reached")
                continue
            row["stake"] = round(granted, 2)
            remaining = max(0.0, remaining - granted)
            used_slots.add(slot)
            if remaining <= 1e-9 and requested - granted >= increment:
                row["reasons"].append("Stake reduced to fit daily exposure cap")
    candidates.sort(key=lambda row: (row["date"], order[row["tier"]], -row["edge"], row["game_id"]))
    return candidates


def rationale(game: dict, projection: dict, best: dict | None) -> str:
    away, home = game["away"]["abbr"], game["home"]["abbr"]
    pieces = [
        f'Model projects {away} {projection["away_score"]:.1f} – {home} {projection["home_score"]:.1f}.',
        f'Opponent-adjusted season scoring, schedule strength, last-ten form, venue split, rest and the current ESPN injury report are included.',
    ]
    if projection["anchored"]:
        pieces.append(f'The raw model line is {projection["raw_margin"]:+.1f} home; the market-anchored line is {projection["margin"]:+.1f}.')
    if best and best["tier"] != "AVOID":
        pieces.append(f'{best["pick"]} rates {best["tier"]} at {best["edge"]*100:.1f}% edge and {best["model_prob"]*100:.1f}% model probability.')
    elif game.get("odds"):
        pieces.append("No side clears the current price, confidence and portfolio rules.")
    else:
        pieces.append("No wager is rated until a real market price is available.")
    return " ".join(pieces)
