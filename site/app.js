const DATA="data/";
const FILES=["board","games","summary","meta","index","ledger","performance","simulator","news"];
const state={tab:"plays",tier:"PLAYS",date:null};
let board=[],games=[],summary={},meta={},index={},ledger={bets:[]},performance={},simulator={teams:{}},news=[];
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pct=(v,d=1)=>v==null?"—":`${(Number(v)*100).toFixed(d)}%`;
const money=v=>v==null?"—":`C$${Number(v).toFixed(2)}`;
const price=v=>v==null?"—":Number(v)>0?`+${v}`:`${v}`;
const num=(v,d=1)=>v==null?"—":Number(v).toFixed(d);
const tierClass=t=>String(t||"AVOID").toLowerCase().replaceAll(" ","-");
const dateLabel=value=>{try{return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",weekday:"short",month:"short",day:"numeric"}).format(new Date(value+"T12:00:00Z"));}catch{return value;}};
function easternToday(){try{return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Toronto",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}catch{return new Date().toISOString().slice(0,10);}}

function selectedGames(){return games.filter(g=>g.date===state.date)}
function selectedRows(){return board.filter(r=>r.date===state.date)}
function selectedPlays(){return selectedRows().filter(r=>r.tier!=="AVOID"&&Number(r.stake)>0)}

function setHealth(){
  const h=$("#health"),odds=meta.odds_health||{};
  let cls="ok",text="";
  if(meta.source_status==="no-live-data"){
    cls="error";text="Live feed unavailable and no prior real-data cache exists. No projections, edges or bets are being published.";
  }else if(meta.source_status==="cached-live-data"){
    cls="partial";text="The latest refresh could not reach ESPN. The last real-data cache remains visible; no sample or fabricated bets are substituted.";
  }else if(odds.status!=="ok"){
    cls=odds.status||"partial";text=`Live schedule loaded. ${odds.priced_games||0} of ${odds.upcoming_games||0} upcoming games currently have usable prices; unpriced games stay visible and cannot qualify.`;
  }else{
    text=`Live schedule and prices healthy · ${odds.priced_games||0} upcoming games priced · no API key required`;
  }
  h.className=`health ${cls}`;h.hidden=false;h.textContent=text;
}

function renderKpis(){
  const d=(summary.day_summary||{})[state.date]||{};
  const items=[
    ["Bankroll",money(summary.bankroll),"settled results only",performance.profit>0?"pos":performance.profit<0?"neg":""],
    ["Qualified",d.plays??0,"selected slate","accent"],
    ["Exposure",money(d.staked??0),`${money(summary.daily_cap)} daily cap`,(d.staked||0)>summary.daily_cap?"neg":""],
    ["Games",d.games??0,`${d.priced??0} with prices`,d.priced?"":"warn"],
    ["Markets",d.markets??0,"moneyline · spread · total",""],
    ["Model P/L",money(performance.profit??0),performance.settled_bets?`${performance.settled_bets} settled`:`needs graded bets`,performance.profit>0?"pos":performance.profit<0?"neg":""],
  ];
  $("#kpis").innerHTML=items.map(([k,v,n,c])=>`<div class="kpi"><div class="k">${esc(k)}</div><div class="v ${c||""}">${esc(v)}</div><div class="n">${esc(n)}</div></div>`).join("");
}

function renderDateBar(){
  const dates=index.dates||[];const select=$("#dateSelect");
  select.innerHTML=dates.map(d=>`<option value="${d}" ${d===state.date?"selected":""}>${esc(dateLabel(d))}</option>`).join("");
  const i=dates.indexOf(state.date);$("#prevDate").disabled=i<=0;$("#nextDate").disabled=i<0||i>=dates.length-1;
  const d=(index.day_summary||{})[state.date]||{};
  $("#dateNote").innerHTML=`<b>${esc(state.date||"No date")}</b> · ${d.games||0} game(s) · ${d.priced||0} priced`;
}

function renderTabs(){
  const tabs=[
    ["plays","Best Bets",selectedPlays().length],["board","Full Board",selectedRows().length],
    ["schedule","Schedule",selectedGames().length],["sim","Simulator",10000],
    ["ledger","Bet Ledger",(ledger.bets||[]).length],["accuracy","Accuracy",performance.settled_bets||0],
    ["model","Model",Object.keys(simulator.teams||{}).length],["sources","Data Sources",meta.errors?.length||0],
  ];
  $("#tabs").innerHTML=tabs.map(([id,label,count])=>`<button type="button" class="${state.tab===id?"on":""}" data-tab="${id}" aria-selected="${state.tab===id}">${esc(label)}<span class="cnt">${count}</span></button>`).join("");
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;renderView();});
}

function panelHead(title,description,right=""){return `<div class="panelhead"><div><h2>${esc(title)}</h2><p>${description}</p></div>${right}</div>`}
function tier(row){return `<span class="tier ${tierClass(row.tier)}">${esc(row.tier)}</span>`}

function factors(projection){
  return (projection.factors||[]).map(f=>`<div class="factor"><span>${esc(f.name)}<small>${esc(f.note)}</small></span><b>${Number(f.points)>=0?"+":""}${num(f.points,2)}</b></div>`).join("");
}
function injuries(projection){
  const groups=[[projection.away_profile?.team,projection.away_injuries],[projection.home_profile?.team,projection.home_injuries]];
  const rows=groups.flatMap(([team,block])=>(block?.players||[]).map(p=>`<div class="injury"><b>${esc(team)}</b> · ${esc(p.name)} · ${esc(p.status)} · ${esc(p.detail||p.position)} <span class="num">${p.points?`(${p.points.toFixed(2)} pts)`:""}</span></div>`));
  return rows.length?rows.join(""):`<div class="injury">No listed injury adjustment from the current ESPN game report.</div>`;
}
function card(row){
  const p=row.projection||{};const game=games.find(g=>g.game_id===row.game_id);const notes=(row.reasons||[]).join(" · ")||row.tier_note||"Qualified at the current live price and inside the daily exposure cap.";
  return `<article class="card ${tierClass(row.tier)}"><div class="cardhead"><div><div class="match">${esc(row.matchup)}</div><div class="meta">${esc(row.start_local)} · ${esc(row.book)} · LIVE PRICE</div></div>${tier(row)}</div><div class="cardbody">
    <div class="pick">${esc(row.pick)} <small>${price(row.price)}</small></div>
    <div class="score"><span>${esc(row.away)} ${num(p.away_score)} – ${esc(row.home)} ${num(p.home_score)}</span><small>MODEL LINE ${p.margin>=0?row.home:row.away} ${Math.abs(Number(p.margin||0)).toFixed(1)} · TOTAL ${num(p.total)}</small></div>
    <div class="grid4"><div class="metric"><div class="k">Model</div><div class="v">${pct(row.model_prob)}</div></div><div class="metric"><div class="k">Break-even</div><div class="v">${pct(row.breakeven)}</div></div><div class="metric"><div class="k">Edge</div><div class="v">${pct(row.edge)}</div></div><div class="metric"><div class="k">Stake</div><div class="v">${money(row.stake)}</div></div></div>
    <div class="why"><b>${row.tier==="AVOID"?"Why avoid":"Why it rates"}:</b> ${esc(notes)}${game?.rationale?`<br>${esc(game.rationale)}`:""}</div>
    <details><summary>Projection arithmetic</summary>${factors(p)}</details><details><summary>Live injury report</summary>${injuries(p)}</details>
  </div></article>`;
}

function playsView(){
  const rows=selectedPlays();const d=(summary.day_summary||{})[state.date]||{};
  if(!rows.length){
    const why=d.priced?"The model priced the slate, but no market clears the edge, confidence and exposure rules.":d.games?"The schedule is live, but sportsbooks have not posted usable prices for this slate yet.":"No WNBA games are scheduled on this date.";
    return panelHead("Qualified plays",`Only real, currently priced markets can appear here. Nothing is added to the ledger unless it qualifies.`)+`<div class="empty"><b>No qualified plays for ${esc(dateLabel(state.date))}</b>${esc(why)} No bet is being forced.</div>`;
  }
  return panelHead("Qualified plays",`Ranked automatically from the live slate. Stakes use half Kelly and cannot exceed ${money(summary.daily_cap)} total exposure per day.`)+`<div class="cards">${rows.map(card).join("")}</div>`;
}

function boardView(){
  const choices=["PLAYS","ALL","BEST BET","GOOD","LEAN","AVOID"];
  let rows=selectedRows();if(state.tier==="PLAYS")rows=rows.filter(r=>r.tier!=="AVOID");else if(state.tier!=="ALL")rows=rows.filter(r=>r.tier===state.tier);
  const filters=`<div class="filters">${choices.map(t=>`<button class="filter ${state.tier===t?"on":""}" data-tier="${t}">${t==="PLAYS"?"Plays only":t}</button>`).join("")}</div>`;
  const table=rows.length?`<div class="tablewrap"><table><thead><tr><th>Tier</th><th>Game</th><th>Pick</th><th>Book</th><th class="num">Price</th><th class="num">Model</th><th class="num">Break-even</th><th class="num">Raw edge</th><th class="num">Edge</th><th class="num">Confidence</th><th class="num">Stake</th><th>Reason</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${tier(r)}</td><td class="mono">${esc(r.matchup)}</td><td class="mono">${esc(r.pick)}</td><td>${esc(r.book)}</td><td class="num">${price(r.price)}</td><td class="num">${pct(r.model_prob)}</td><td class="num">${pct(r.breakeven)}</td><td class="num">${pct(r.edge_raw)}</td><td class="num">${pct(r.edge)}</td><td class="num">${pct(r.confidence)}</td><td class="num">${money(r.stake)}</td><td>${esc((r.reasons||[]).join(" · ")||r.tier_note||"—")}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty"><b>No priced markets in this filter</b>Unpriced games remain on the Schedule tab and never become bets.</div>`;
  setTimeout(()=>document.querySelectorAll("[data-tier]").forEach(b=>b.onclick=()=>{state.tier=b.dataset.tier;renderView();}),0);
  return panelHead("Every priced side","AVOID rows remain visible so a quiet board is explainable instead of looking broken.")+filters+table;
}

function scheduleView(){
  const rows=selectedGames();if(!rows.length)return panelHead("Schedule","Live ESPN schedule, scores and market availability.")+`<div class="empty"><b>No games scheduled</b>Use the arrows to move to another available WNBA date.</div>`;
  return panelHead("Schedule","The complete slate stays visible even before prices post. A game without real odds cannot produce an edge or stake.")+`<div class="schedule">${rows.map(g=>{
    const q=(g.odds||{}).quotes||{},p=g.projection||{};const line=q.home_spread?.line,total=q.over?.line??q.under?.line;
    const status=g.completed?`${g.away.abbr} ${g.away.score} – ${g.home.abbr} ${g.home.score}`:g.status_detail;
    return `<article class="game"><div class="teams">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}<div class="status">${esc(g.start_local)} · ${esc(status)}${g.broadcast?` · ${esc(g.broadcast)}`:""}</div></div><div class="market">${g.odds?`${esc(g.odds.book)} ${line!=null?`${g.home.abbr} ${Number(line)>0?"+":""}${line}`:"ML posted"}`:"WAITING FOR ODDS"}<small>${total!=null?`Total ${total}`:"No total yet"}</small></div><div class="projection">${num(p.away_score)} – ${num(p.home_score)}<small>${g.markets_priced||0} markets priced</small></div></article>`;
  }).join("")}</div>`;
}

function simMatch(){return games.find(g=>g.date===state.date&&g.away.abbr===$("#simAway")?.value&&g.home.abbr===$("#simHome")?.value)}
function simDefaults(){
  const match=simMatch(),q=(match?.odds||{}).quotes||{};
  if(match){$("#simHomeLine").value=q.home_spread?.line??"";$("#simTotalLine").value=q.over?.line??q.under?.line??"";$("#simRef").textContent=`Live reference: ${match.odds?.book||"market"} · ${match.home.abbr} ${q.home_spread?.line??"no spread"} · total ${q.over?.line??q.under?.line??"not posted"}`;}else{$("#simRef").textContent="No live matchup for these two teams on the selected date; team ratings still run automatically.";}
}
function rng(seed){return()=>{seed|=0;seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296}}
function gaussian(random){let u=0,v=0;while(!u)u=random();while(!v)v=random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function runSim(){
  const teams=simulator.teams||{},a=teams[$("#simAway").value],h=teams[$("#simHome").value];if(!a||!h)return;
  const hca=Number($("#simHca").value||0),aAdj=Number($("#simAwayAdj").value||0),hAdj=Number($("#simHomeAdj").value||0);
  const awayBase=(Number(a.ppg)+Number(h.papg))/2+aAdj,homeBase=(Number(h.ppg)+Number(a.papg))/2+hAdj;
  const power=(Number(h.power_rating)-Number(a.power_rating))*.35;const margin=homeBase-awayBase+hca+power;const total=awayBase+homeBase;
  const line=Number($("#simHomeLine").value),totalLine=Number($("#simTotalLine").value);const hasLine=$("#simHomeLine").value!=="",hasTotal=$("#simTotalLine").value!=="";
  const random=rng([...$("#simAway").value+$("#simHome").value].reduce((s,c)=>s+c.charCodeAt(0),2026));let hw=0,hc=0,ov=0,as=0,hs=0;
  for(let i=0;i<10000;i++){const m=margin+gaussian(random)*Number(simulator.spread_sigma||11),t=total+gaussian(random)*Number(simulator.total_sigma||11);const home=(t+m)/2,away=(t-m)/2;as+=away;hs+=home;if(m>0)hw++;if(hasLine&&m+line>0)hc++;if(hasTotal&&t>totalLine)ov++;}
  $("#simResult").innerHTML=`<div class="simscore">${esc(a.team)} ${(as/10000).toFixed(1)} – ${esc(h.team)} ${(hs/10000).toFixed(1)}</div><div class="simprobs"><div class="simprob"><div class="k">${esc(h.team)} win</div><div class="v">${(hw/100).toFixed(1)}%</div><div class="meter"><i style="width:${hw/100}%"></i></div></div><div class="simprob"><div class="k">Home cover ${hasLine?line>0?`+${line}`:line:"—"}</div><div class="v">${hasLine?(hc/100).toFixed(1)+"%":"—"}</div><div class="meter"><i style="width:${hasLine?hc/100:0}%"></i></div></div><div class="simprob"><div class="k">Over ${hasTotal?totalLine:"—"}</div><div class="v">${hasTotal?(ov/100).toFixed(1)+"%":"—"}</div><div class="meter"><i style="width:${hasTotal?ov/100:0}%"></i></div></div></div><div class="note"><b>10,000 simulations.</b> Uses the same live season scoring, opponent defence, schedule-adjusted power rating, home court and WNBA variance as the board. Manual adjustment boxes are optional scenario controls, not required data entry.</div>`;
}
function simulatorView(){
  const teams=Object.keys(simulator.teams||{}).sort();if(teams.length<2)return panelHead("Game simulator","Runs the current automatic model with any matchup.")+`<div class="empty"><b>Ratings are not available yet</b>The simulator activates after the first live season refresh.</div>`;
  const game=selectedGames().find(g=>g.status==="pre");const away=game?.away.abbr||teams[0],home=game?.home.abbr||teams.find(t=>t!==away)||teams[1];const opts=selected=>teams.map(t=>`<option value="${t}" ${t===selected?"selected":""}>${esc(t)}</option>`).join("");
  const html=panelHead("10,000-run game simulator","Choose any teams. Live ratings are automatic; adjustments are optional what-if controls.")+`<div class="simgrid"><section class="box"><div class="fields"><div class="field"><label for="simAway">Away team</label><select id="simAway">${opts(away)}</select></div><div class="field"><label for="simHome">Home team</label><select id="simHome">${opts(home)}</select></div><div class="field"><label for="simHca">Home court points</label><input id="simHca" type="number" step="0.5" value="${simulator.home_court??2.5}"></div><div class="field"><label for="simHomeLine">Live home spread</label><input id="simHomeLine" type="number" step="0.5"></div><div class="field"><label for="simAwayAdj">Away scenario adjustment</label><input id="simAwayAdj" type="number" step="0.5" value="0"></div><div class="field"><label for="simHomeAdj">Home scenario adjustment</label><input id="simHomeAdj" type="number" step="0.5" value="0"></div><div class="field"><label for="simTotalLine">Live total</label><input id="simTotalLine" type="number" step="0.5"></div></div><button class="run" id="runSim" type="button">Run 10,000 simulations</button><div class="now" id="simRef" style="margin-top:9px"></div></section><section class="box" id="simResult"></section></div>`;
  setTimeout(()=>{$("#simAway").onchange=()=>{simDefaults();runSim()};$("#simHome").onchange=()=>{simDefaults();runSim()};$("#runSim").onclick=runSim;simDefaults();runSim();},0);return html;
}

function ledgerView(){
  const rows=(ledger.bets||[]).slice().sort((a,b)=>String(b.tipoff).localeCompare(String(a.tipoff)));const table=rows.length?`<div class="tablewrap"><table><thead><tr><th>Date</th><th>Game</th><th>Bet</th><th>Tier</th><th class="num">Price</th><th class="num">Edge</th><th class="num">Stake</th><th>Result</th><th class="num">P/L</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td class="mono">${esc(r.matchup)}</td><td class="mono">${esc(r.pick)}</td><td><span class="tier ${tierClass(r.tier)}">${esc(r.tier)}</span></td><td class="num">${price(r.price)}</td><td class="num">${pct(r.edge)}</td><td class="num">${money(r.stake)}</td><td><span class="res ${esc(r.result)}">${esc(r.result)}</span></td><td class="num ${Number(r.profit)>0?"pos":Number(r.profit)<0?"neg":""}">${money(r.profit)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty"><b>No ledger entries yet</b>The ledger fills automatically when a live, priced play qualifies. Nothing is entered from a sample slate.</div>`;
  return panelHead("Automatic bet ledger","Qualified entries are locked once, duplicate-proofed and graded from final ESPN scores. Later line moves never rewrite history.")+table;
}

function accuracyView(){
  const tierRows=performance.by_tier||{},marketRows=performance.by_market||{};const stats=[
    ["Current bankroll",money(performance.current_bankroll),`${money(performance.starting_bankroll)} start`],["Settled bets",performance.settled_bets||0,`${performance.pending_bets||0} pending`],["Net P/L",money(performance.profit||0),performance.roi!=null?`${pct(performance.roi)} ROI`:"needs results"],["Risked",money(performance.risked||0),"settled stakes"],
  ];
  const group=(title,rows)=>`<section class="box"><h3 style="margin-top:0">${esc(title)}</h3><div class="tablewrap"><table style="min-width:520px"><thead><tr><th>Group</th><th>Record</th><th class="num">Win rate</th><th class="num">P/L</th><th class="num">ROI</th></tr></thead><tbody>${Object.entries(rows).map(([k,r])=>`<tr><td>${esc(k==="AVOID"?"AVOID / shadow":k)}</td><td class="mono">${esc(r.record)}</td><td class="num">${pct(r.win_pct)}</td><td class="num">${money(r.profit)}</td><td class="num">${pct(r.roi)}</td></tr>`).join("")||`<tr><td colspan="5">Needs graded calls</td></tr>`}</tbody></table></div></section>`;
  return panelHead("Accuracy & ROI","Every priced call—including AVOID—is frozen in a shadow book so the tier labels can be tested honestly.")+`<div class="stats">${stats.map(([k,v,n])=>`<article class="stat"><h3>${esc(k)}</h3><div class="big">${esc(v)}</div><p>${esc(n)}</p></article>`).join("")}</div><div class="twocol" style="margin-top:14px">${group("Tier performance",tierRows)}${group("Bet-market performance",marketRows)}</div>`;
}

function modelView(){
  const teams=Object.values(simulator.teams||{}).sort((a,b)=>Number(b.power_rating)-Number(a.power_rating));const table=teams.length?`<div class="tablewrap"><table><thead><tr><th>Rank</th><th>Team</th><th class="num">Power</th><th class="num">Games</th><th class="num">PPG</th><th class="num">Allowed</th><th class="num">Last 10 PPG</th><th class="num">Last 10 allowed</th><th class="num">Win %</th><th class="num">Home %</th><th class="num">Road %</th></tr></thead><tbody>${teams.map((t,i)=>`<tr><td class="num">${i+1}</td><td class="mono">${esc(t.team)}</td><td class="num">${Number(t.power_rating)>=0?"+":""}${num(t.power_rating,2)}</td><td class="num">${t.games}</td><td class="num">${num(t.ppg)}</td><td class="num">${num(t.papg)}</td><td class="num">${num(t.l10_ppg)}</td><td class="num">${num(t.l10_papg)}</td><td class="num">${pct(t.win_pct)}</td><td class="num">${pct(t.home_pct)}</td><td class="num">${pct(t.road_pct)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty"><b>No live ratings yet</b>Ratings appear automatically after completed WNBA games are available.</div>`;
  return panelHead("Model & power ratings","Ratings solve schedule-adjusted margins from completed games. Projections then add opponent defence, recent form, venue splits, rest and current injuries before being anchored to the market.")+table+`<div class="note"><b>Edge safety:</b> Large model/market disagreements are compressed, a 1% selection haircut is applied, and BEST BET also requires confidence, a meaningful—but not extreme—line gap and an acceptable price. The model never upgrades a play merely to fill the page.</div>`;
}

function sourcesView(){
  const sources=[
    ["Schedule, scores and team statistics","ESPN public WNBA scoreboard · keyless · full 2026 season refreshed automatically"],
    ["Moneyline, spread and total","DraftKings prices distributed through ESPN's public game feed; only actual posted quotes are priced"],
    ["Injuries and availability","ESPN game summary injury reports for every upcoming game in the active window"],
    ["Power ratings and projections","Calculated locally from completed results; no external prediction or sample data"],
    ["Ledger and grading","Qualified bets are locked once and settled automatically from ESPN final scores"],
  ];
  const errors=(meta.errors||[]).map(e=>`<div class="source"><h3 class="neg">Refresh warning</h3><p>${esc(e)}</p></div>`).join("");
  return panelHead("Data sources & refresh health","Everything needed for the board is fetched automatically. No spreadsheet paste, API key, sample slate or manual refresh button is required.")+`<section class="box">${sources.map(([h,p])=>`<div class="source"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join("")}${errors}</section><div class="note"><b>Last successful build:</b> ${esc(new Date(meta.generated_at).toLocaleString())}. The GitHub workflow refreshes several times daily, captures line movement, grades finished games and republishes the site. If a provider is temporarily unavailable, the last real cache is labeled clearly; fabricated fallback bets do not exist.</div>${news.length?`<section class="box"><h3 style="margin-top:0">Latest WNBA news</h3>${news.slice(0,8).map(n=>`<div class="source"><h3>${n.link?`<a href="${esc(n.link)}" target="_blank" rel="noopener" style="color:inherit">${esc(n.headline)}</a>`:esc(n.headline)}</h3><p>${esc(n.description||"")}</p></div>`).join("")}</section>`:""}<div class="footer">Model output only—never a guarantee or instruction to wager. Verify the price at your sportsbook and bet only what you can afford to lose.</div>`;
}

function renderView(){renderTabs();renderKpis();const views={plays:playsView,board:boardView,schedule:scheduleView,sim:simulatorView,ledger:ledgerView,accuracy:accuracyView,model:modelView,sources:sourcesView};$("#view").innerHTML=(views[state.tab]||playsView)();}
function setDate(value){if(!(index.dates||[]).includes(value))return;state.date=value;const url=new URL(location.href);url.searchParams.set("date",value);history.replaceState({},"",url);renderDateBar();renderView();}

async function boot(){
  try{
    const payload=await Promise.all(FILES.map(name=>fetch(`${DATA}${name}.json`,{cache:"no-store"}).then(r=>{if(!r.ok)throw new Error(name);return r.json()})));
    [board,games,summary,meta,index,ledger,performance,simulator,news]=payload;
    const requested=new URL(location.href).searchParams.get("date"),today=easternToday(),dates=index.dates||[];
    state.date=dates.includes(requested)?requested:dates.includes(today)?today:index.built_for||dates[0]||today;
    $("#stamp").innerHTML=`LIVE DATA · <b>${esc(new Date(meta.generated_at).toLocaleString())}</b>`;setHealth();renderDateBar();renderView();
    $("#dateSelect").onchange=e=>setDate(e.target.value);$("#prevDate").onclick=()=>{const i=dates.indexOf(state.date);if(i>0)setDate(dates[i-1])};$("#nextDate").onclick=()=>{const i=dates.indexOf(state.date);if(i>=0&&i<dates.length-1)setDate(dates[i+1])};$("#today").onclick=()=>{const t=easternToday();if(dates.includes(t))setDate(t);else{const future=dates.find(d=>d>=t);setDate(future||dates.at(-1))}};
    $("#theme").onclick=()=>{const root=document.documentElement;root.dataset.theme=root.dataset.theme==="light"?"dark":"light";localStorage.setItem("wnba-theme",root.dataset.theme)};const theme=localStorage.getItem("wnba-theme");if(theme)document.documentElement.dataset.theme=theme;
  }catch(error){$("#health").hidden=false;$("#health").className="health error";$("#health").textContent="The automatic data files could not be loaded.";$("#view").innerHTML=`<div class="empty"><b>No live model data available</b>No sample data will be substituted. The next scheduled refresh will try again.</div>`;}
}
boot();
