# LiqPass – Liquidation Insurance for Leveraged Traders on BNB Chain

## 1. Problem: Retail Leverage Is a One-Strike Game

- Small-account retail traders on CEXs are afraid to use high leverage.  
- A single forced liquidation can wipe out their entire account; there is no simple, budgeted loss cap.  
- Communities, KOLs, and quant teams want to bring users into perps, but lack a reusable, verifiable protection module.  
- For exchanges and chains, this means lost volume, lost stablecoin TVL, and short-lived user cohorts.

---

## 2. Solution: LiqPass (爆仓保)

**A parametric liquidation-insurance layer for leveraged traders, designed to sit between Binance and BNB Chain.**

- Users pay a small stablecoin premium (on BNB Chain) for short-term coverage (8h / 24h / monthly).  
- If a forced liquidation happens within the coverage window, they submit the Binance order ID.  
- LiqPass passively verifies the event via Binance read-only APIs and an off-chain evidence pipeline.  
- The evidence bundle (normalized data + hash) is anchored on-chain; valid events trigger rule-based, capped payouts.  
- Everything is event-driven and auditable: no opaque risk decisions, no ad-hoc screenshots.

---

## 3. Why It Matters for Binance & BNB Chain

**For retail users**

- Gives small traders a clear, budgeted loss cap instead of unlimited downside.  
- Turns “爆仓恐惧” into a known, up-front premium they can afford.  
- Makes high-leverage strategies survivable instead of a one-shot gamble.

**For Binance & BNB Chain**

- Attracts and retains small-account leverage users who would otherwise never enter.  
- Increases perp volume and fee revenue as users trade and hold positions more confidently.  
- Keeps stablecoins (USDT / USDC and BNB-native stables) circulating on BNB Chain.  
- Creates a new fee-sharing line: insurance premiums can be shared among Binance, LiqPass, and ecosystem partners.

---

## 4. Product Snapshot (Today)

- **MVP already running on another chain**
  - Checkout contract deployed on mainnet, emitting premium payment events.  
  - Backend + verifier service integrated with CEX read-only APIs.  
  - Web app flows for: buy coverage → see active policies → submit claims.

- **Evidence-first design**
  - Each claim is backed by normalized order data + derived metrics.  
  - Evidence → Merkle/root hash → anchored on-chain for auditability.

- This grant / partnership will be used to **port and specialize LiqPass for Binance & BNB Chain**.

![image-20251123165637479](./${img}/image-20251123165637479.png)

![image-20251123165657141](./${img}/image-20251123165657141.png)

![image-20251123170114351](./${img}/image-20251123170114351.png)

---

## 5. How It Works (High Level)

1. **Buy coverage on BNB Chain**  
   User connects wallet, selects a product (e.g. 24h BTCUSDT 50x coverage), and pays a stablecoin premium.

2. **Wait & trade on Binance**  
   User trades on Binance as usual with leverage; LiqPass only listens via read-only APIs.

3. **If liquidation happens**  
   User submits the Binance order ID to LiqPass.

4. **Verification & evidence**  
   Off-chain service fetches order/trade history from Binance APIs, normalizes it, builds an evidence bundle, and signs a result.

5. **On-chain decision & payout**  
   BNB Chain contracts check coverage window + rules + evidence hash; if valid, they trigger capped payouts in stablecoins.

Everything is driven by objective events and reproducible data—no discretionary “claims handling”.

---

## 6. Business Model & Unit Economics

**Revenue streams**

- Retail premiums: users pay for 8h / 24h / monthly coverage.  
- Revenue sharing: Binance / BNB perp partners / communities receive a share of premiums.  
- (Optional) Trading fee rebates: additional upside if integrated with volume programs.

**Risk & margins (targets)**

- Target loss ratio: ~60–70% (payouts / premiums).  
- Target gross margin: ~20–30% after risk load, ops, and partner share.  
- Risk controls: per-user and per-day caps, max payout as % of notional, waiting periods, blacklists.

---

## 7. Roadmap for Binance / BNB Chain

**Phase 1 – BNB Chain integration (0–3 months)**

- Port core liquidation-insurance logic to BNB Smart Chain.  
- Deploy initial contracts for policy storage, events, and payouts.  
- Connect to Binance read-only APIs in a BNB-focused verifier service.

**Phase 2 – Public beta (3–6 months)**

- Launch a public beta dApp on BNB Chain for retail users.  
- Offer a small set of focused products (e.g. BTCUSDT 20x / 50x 24h coverage).  
- Start with conservative limits and transparent reporting.

**Phase 3 – Deep integration & scaling (6–12 months)**

- Integrate LiqPass as an embedded module with selected Binance products / partners.  
- Expand coverage to more markets and user segments.  
- Optimize pricing and risk parameters using real-world data.

---

## 8. Why Me (Founder)

- Solo founder with full-stack ownership: frontend, backend, smart contracts, and infra.  
- Prior attempts taught me to focus on **small, verifiable loops** instead of grand, vague roadmaps.  
- I already shipped a working MVP on another chain with minimal resources.  
- Committed to turning risk management into open, auditable infrastructure—not a black box.

Handles & links:

- GitHub: https://github.com/wjz5788/LiqPass  
- Demo: https://wjz5788.com/  
- X (Twitter): @CryptoNaxin  
- Telegram: https://t.me/mosheng1u  

---

## 9. What We’re Asking From Binance

- Strategic investment (equity or token-based) to scale LiqPass as a dedicated protection layer.  
- Product and technical collaboration to embed LiqPass-style protection into Binance / BNB experiences.  
- Support on risk, data, and go-to-market so we can bring more users, more stablecoins, and more sustainable volume into the BNB ecosystem.

> “Give retail a survivable way to trade leverage; give Binance and BNB Chain a new, verifiable risk primitive.”

---

## 10. Claims & Treasury Safety (24h Settlement)

- LiqPass uses a 24h settlement window for claims instead of unconstrained instant payouts.  
- Same-day accounting, next-day settlement: approved claims are recorded immediately, paid in a 24h batch.  
- Smart contracts focus on recording, limits, and emitting events; they do **not** allow unlimited withdrawals.  
- Per-day / per-user / per-policy caps plus circuit breakers bound worst-case damage to a single settlement cycle.  
- A transparency dashboard shows 7D policies sold, loss ratio, treasury balance, daily premium vs. paid, and full event logs.  
- Even if there is a contract or logic bug, the treasury cannot be drained in one shot; the system can be paused and fixed.

![image-20251123170212988](./${img}/image-20251123170212988.png)
