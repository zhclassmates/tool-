import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, Calculator, Upload, BadgeCheck, ListChecks, CircleDot, Hash, Globe, Languages, Link as LinkIcon, FileText, CheckCircle2, ChevronRight, Activity, Rocket, Shield } from "lucide-react";

/**
 * LiqPass – Principal/Leverage Quote → Claim → Attest → Status (Single Page)
 * - No time-based SKU. Only P/L/Premium/Payout flow, matching grant review path.
 * - TailwindCSS + framer-motion + lucide-react. All client-side; demo-only.
 * - Uses WebCrypto for SHA-256 to synthesize a deterministic "root" & mock tx hash.
 *
 * How to use in preview:
 *  - Switch language at top-right (中文/EN)
 *  - Quote: enter principal & leverage to get premium/payout & a quote id
 *  - Claim: pick a sample record (or paste JSON) → see validation result
 *  - Attest: confirm summary → generate mock Merkle-Root & Tx Hash
 *  - Status: recent mock attestations
 */

const DICT = {
  zh: {
    brand: "LiqPass",
    chain: "Base Mainnet",
    tab_ux: "OKX 合约险 · UX",
    tab_quote: "报价（P/L→保费/赔付）",
    tab_claim: "申赔上传",
    tab_attest: "上链存证",
    tab_status: "链上状态",
    lang: "中",
    hero_title: "输入 P / L 出报价 → 上传样例 → 上链存证 → 查看状态",
    hero_sub: "仅围绕 本金 / 杠杆 / 保费 / 赔付额；无按时段 SKU。演示可审计的上链存证路径。",
    pill_base: "Base 主网",
    pill_okx: "OKX · 首发",

    // Quote
    quote_title: "报价计算（仅演示）",
    principal: "本金 (USDT)",
    leverage: "杠杆 (×)",
    btn_get_quote: "生成报价",
    premium: "保费",
    payout: "赔付额",
    quote_id: "报价编号",
    valid_until: "有效期",
    pricing_ver: "价格版本",

    // Claim
    claim_title: "申赔上传（样例/JSON）",
    choose_sample: "选择样例",
    sample_none: "不使用样例",
    sample_liq: "样例：强平 (OKX · LINK-USDT)",
    sample_normal: "样例：正常平仓",
    or_paste: "或粘贴 JSON 文本",
    btn_validate: "校验证据",
    validation_result: "校验结果",
    pass: "通过",
    fail: "失败",

    // Attest
    attest_title: "上链存证（生成 Root & 模拟 Tx）",
    btn_build_root: "生成 Root",
    btn_attest: "提交存证 (Mock)",
    root: "Merkle Root (演示)",
    txhash: "交易哈希 (模拟)",

    // Status
    status_title: "最近存证（演示数据）",

    // Steps
    steps_title: "用户路径（UX Flow）",
    s1: {
      title: "报价",
      body: "输入本金与杠杆，计算保费/赔付额，生成 quote_id。",
    },
    s2: {
      title: "申赔",
      body: "出现强平/ADL 时，上传样例或 JSON，自动校验关键信息。",
    },
    s3: {
      title: "存证",
      body: "对关键字段做哈希合成 Root，上链记录（本页为演示模拟）。",
    },
    s4: {
      title: "状态",
      body: "公开最近 N 笔 root/tx，评审可一键核对。",
    },

    // Footer
    disclaimer: "免责声明：本页面为演示 UX，不构成任何投资建议；样例数据与上链交易均为模拟，不涉及真实赔付。",
  },
  en: {
    brand: "LiqPass",
    chain: "Base Mainnet",
    tab_ux: "OKX Insurance · UX",
    tab_quote: "Quote (P/L → Premium/Payout)",
    tab_claim: "Claim Upload",
    tab_attest: "Attest",
    tab_status: "Status",
    lang: "EN",
    hero_title: "Enter P/L → Upload Sample → On-chain Attestation → View Status",
    hero_sub: "Only Principal / Leverage / Premium / Payout. No time-based SKUs. Auditable attestation demo.",
    pill_base: "Base Mainnet",
    pill_okx: "OKX · First Launch",

    quote_title: "Quote (Demo)",
    principal: "Principal (USDT)",
    leverage: "Leverage (×)",
    btn_get_quote: "Get Quote",
    premium: "Premium",
    payout: "Payout",
    quote_id: "Quote ID",
    valid_until: "Valid Until",
    pricing_ver: "Pricing Version",

    claim_title: "Claim Upload (Sample/JSON)",
    choose_sample: "Choose Sample",
    sample_none: "No Sample",
    sample_liq: "Sample: Liquidation (OKX · LINK-USDT)",
    sample_normal: "Sample: Normal Close",
    or_paste: "or paste JSON text",
    btn_validate: "Validate Evidence",
    validation_result: "Validation Result",
    pass: "PASS",
    fail: "FAIL",

    attest_title: "Attestation (Build Root & Mock Tx)",
    btn_build_root: "Build Root",
    btn_attest: "Submit Attestation (Mock)",
    root: "Merkle Root (Demo)",
    txhash: "Tx Hash (Mock)",

    status_title: "Recent Attestations (Demo)",

    steps_title: "User Flow",
    s1: { title: "Quote", body: "Enter principal & leverage → compute premium/payout & quote_id." },
    s2: { title: "Claim", body: "When liquidation/ADL occurs, upload sample or JSON to auto-validate." },
    s3: { title: "Attest", body: "Hash key fields to form a Root; record on-chain (mock here)." },
    s4: { title: "Status", body: "Expose latest root/tx for auditability." },

    disclaimer: "Disclaimer: Demo UX only. Not financial advice; samples & on-chain tx are mocked with no real payout.",
  },
};

const SAMPLE_LIQ = {
  exchange: "OKX",
  pair: "LINK-USDT-SWAP",
  event: "LIQUIDATION",
  side: "LONG",
  quantity: 176,
  price: 13.516,
  timestamp: "2024-05-02T13:30:50Z",
};

const SAMPLE_NORMAL = {
  exchange: "OKX",
  pair: "LINK-USDT-SWAP",
  event: "NORMAL_CLOSE",
  side: "LONG",
  quantity: 10,
  price: 13.9,
  timestamp: "2024-05-02T13:40:10Z",
};

function classNames(...a) { return a.filter(Boolean).join(" "); }

// WebCrypto SHA-256 → hex
async function sha256Hex(text) {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function LiqPassPLFlow() {
  const [lang, setLang] = useState("zh");
  const t = DICT[lang];

  const [active, setActive] = useState("ux"); // ux | quote | claim | attest | status

  // Quote state
  const [principal, setPrincipal] = useState(500);
  const [leverage, setLeverage] = useState(10);
  const [quote, setQuote] = useState(null);

  // Claim state
  const [sample, setSample] = useState("none");
  const [jsonText, setJsonText] = useState("");
  const [claimRes, setClaimRes] = useState(null);

  // Attest state
  const [root, setRoot] = useState("");
  const [tx, setTx] = useState("");
  const [status, setStatus] = useState([]); // recent attestations

  // Pricing parameters (demo-only)
  const PRICING_VERSION = "principal-leverage-v0";
  const PAYOUT_CAP = 300; // USDT
  const LOAD = 0.2; // 20%
  function rOfL(L) {
    if (L <= 5) return 0.02;
    if (L <= 10) return 0.04;
    return 0.08;
  }

  function computeQuote(P, L) {
    const payout = Math.min(P, PAYOUT_CAP);
    const premium = +(payout * rOfL(L) * (1 + LOAD)).toFixed(2);
    const quoteId = `Q-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const valid = new Date(Date.now() + 10 * 60 * 1000).toLocaleString();
    return { payout, premium, quoteId, valid, pricingVersion: PRICING_VERSION };
  }

  function handleGetQuote() {
    const q = computeQuote(Number(principal || 0), Number(leverage || 0));
    setQuote(q);
  }

  function buildEvidenceSummary() {
    const evidence = sample === "liq" ? SAMPLE_LIQ : sample === "normal" ? SAMPLE_NORMAL : (() => {
      try { return JSON.parse(jsonText || "{}"); } catch { return {}; }
    })();
    return {
      order_id: quote?.quoteId || `DEMO-${Date.now()}`,
      principal: Number(principal || 0),
      leverage: Number(leverage || 0),
      payout: quote?.payout ?? Math.min(Number(principal||0), PAYOUT_CAP),
      premium: quote?.premium ?? 0,
      pricing_version: PRICING_VERSION,
      evidence,
    };
  }

  function validateEvidence(evd) {
    if (!evd || !evd.event) return { ok: false, reason: "MISSING_EVENT" };
    const ok_pair = !!evd.pair;
    const ok_time = !!evd.timestamp;
    const isLiq = evd.event.toUpperCase().includes("LIQUIDATION") || evd.event.toUpperCase().includes("ADL");
    return { ok: ok_pair && ok_time && isLiq, reason: isLiq ? "" : "NOT_LIQUIDATION" };
  }

  async function handleValidate() {
    const summary = buildEvidenceSummary();
    const res = validateEvidence(summary.evidence);
    setClaimRes({ summary, res });
  }

  async function handleBuildRoot() {
    const payload = claimRes?.summary || buildEvidenceSummary();
    const canon = JSON.stringify(payload);
    const h = await sha256Hex(canon);
    setRoot("0x" + h);
  }

  async function handleAttest() {
    if (!root) await handleBuildRoot();
    const txHash = "0x" + (await sha256Hex(root + Date.now())).slice(0, 64);
    setTx(txHash);
    const item = { when: new Date().toLocaleString(), root, tx: txHash, order: claimRes?.summary?.order_id };
    setStatus(s => [item, ...s].slice(0, 8));
  }

  // UI building blocks
  const Tab = ({ id, label, icon: Icon }) => (
    <button onClick={() => setActive(id)} className={classNames(
      "inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm",
      active === id ? "bg-white/90 text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
    )}>
      {Icon && <Icon size={16} />} {label}
    </button>
  );

  const Stat = ({ label, value }) => (
    <div className="flex flex-col p-4 rounded-2xl bg-white/5 border border-white/10">
      <div className="text-xs text-white/60">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );

  const StepCard = ({ idx, title, body, icon: Icon }) => (
    <div className="p-5 rounded-2xl bg-white/5 border border-white/10 h-full">
      <div className="flex items-center gap-2 text-white/80 text-xs tracking-wide"><span className="px-2 py-0.5 rounded-full bg-white/10">STEP {idx}</span></div>
      <div className="flex items-center gap-2 mt-3">
        {Icon && <Icon size={18} className="text-white/80"/>}
        <div className="font-semibold">{title}</div>
      </div>
      <div className="text-sm text-white/70 mt-2 leading-relaxed">{body}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Top gradient */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-900/40 via-slate-900 to-slate-950" />

      {/* Nav */}
      <div className="max-w-6xl mx-auto px-4 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="text-indigo-300" />
            <div className="font-semibold">{t.brand} <span className="text-white/50">({t.chain})</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full text-xs bg-emerald-400/15 text-emerald-300 border border-emerald-400/20">{t.pill_base}</span>
            <span className="px-3 py-1 rounded-full text-xs bg-violet-400/15 text-violet-300 border border-violet-400/20">{t.pill_okx}</span>
            <button onClick={() => setLang(lang === "zh" ? "en" : "zh")} className="ml-2 px-3 py-1 rounded-full text-xs bg-white/10 hover:bg-white/20">
              <Languages size={14} className="inline mr-1"/>{t.lang}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mt-5">
          <Tab id="ux" label={t.tab_ux} icon={Rocket} />
          <Tab id="quote" label={t.tab_quote} icon={Calculator} />
          <Tab id="claim" label={t.tab_claim} icon={Upload} />
          <Tab id="attest" label={t.tab_attest} icon={Hash} />
          <Tab id="status" label={t.tab_status} icon={ListChecks} />
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-4 mt-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl p-8 bg-white/5 border border-white/10">
          <div className="text-2xl md:text-3xl font-semibold tracking-wide">{t.hero_title}</div>
          <div className="text-white/70 mt-2">{t.hero_sub}</div>
        </motion.div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 mt-8 pb-20">
        {active === "ux" && (
          <div>
            <div className="text-white/80 tracking-wide font-semibold mb-3">{t.steps_title}</div>
            <div className="grid md:grid-cols-4 gap-4">
              <StepCard idx={1} title={t.s1.title} body={t.s1.body} icon={Calculator} />
              <StepCard idx={2} title={t.s2.title} body={t.s2.body} icon={Upload} />
              <StepCard idx={3} title={t.s3.title} body={t.s3.body} icon={Hash} />
              <StepCard idx={4} title={t.s4.title} body={t.s4.body} icon={ListChecks} />
            </div>
          </div>
        )}

        {active === "quote" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid md:grid-cols-2 gap-6">
            <div className="p-6 rounded-3xl bg-white/5 border border-white/10">
              <div className="text-lg font-semibold mb-4">{t.quote_title}</div>
              <label className="block text-sm text-white/70 mb-2">{t.principal}</label>
              <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 mb-4" value={principal} onChange={e=>setPrincipal(e.target.value)} min={0} />
              <label className="block text-sm text-white/70 mb-2">{t.leverage}</label>
              <input type="number" className="w-full bg-white/5 border border-white/10 rounded-xl p-3 mb-6" value={leverage} onChange={e=>setLeverage(e.target.value)} min={1} />
              <button onClick={handleGetQuote} className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 font-medium">{t.btn_get_quote}</button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Stat label={t.premium} value={quote ? `${quote.premium} USDT` : "-"} />
              <Stat label={t.payout} value={quote ? `${quote.payout} USDT` : "-"} />
              <Stat label={t.quote_id} value={quote?.quoteId || "-"} />
              <Stat label={t.pricing_ver} value={quote?.pricingVersion || "-"} />
              <Stat label={t.valid_until} value={quote?.valid || "-"} />
            </div>
          </motion.div>
        )}

        {active === "claim" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-3xl bg-white/5 border border-white/10">
            <div className="text-lg font-semibold mb-4">{t.claim_title}</div>
            <div className="grid md:grid-cols-3 gap-4 items-start">
              <div>
                <label className="block text-sm text-white/70 mb-2">{t.choose_sample}</label>
                <select className="w-full bg-white/5 border border-white/10 rounded-xl p-3" value={sample} onChange={e=>setSample(e.target.value)}>
                  <option value="none">{t.sample_none}</option>
                  <option value="liq">{t.sample_liq}</option>
                  <option value="normal">{t.sample_normal}</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-white/70 mb-2">{t.or_paste}</label>
                <textarea rows={6} className="w-full bg-white/5 border border-white/10 rounded-xl p-3 font-mono text-sm" value={jsonText} onChange={e=>setJsonText(e.target.value)} placeholder="{\n  \"exchange\": \"OKX\",\n  \"pair\": \"BTC-USDT\",\n  \"event\": \"LIQUIDATION\",\n  \"timestamp\": \"2024-05-02T13:30:50Z\"\n}"/>
                <button onClick={handleValidate} className="mt-3 px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 font-medium">{t.btn_validate}</button>
              </div>
            </div>

            {claimRes && (
              <div className="mt-6 grid md:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-sm text-white/60 mb-2">{t.validation_result}</div>
                  <div className={classNames("inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm", claimRes.res.ok ? "bg-emerald-400/20 text-emerald-300" : "bg-rose-400/20 text-rose-300")}> 
                    <CheckCircle2 size={16}/>{claimRes.res.ok ? t.pass : t.fail}
                  </div>
                  <pre className="mt-3 text-xs text-white/70 whitespace-pre-wrap">{JSON.stringify(claimRes.summary, null, 2)}</pre>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-sm text-white/60 mb-2">{t.attest_title}</div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={handleBuildRoot} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20">{t.btn_build_root}</button>
                    <button onClick={handleAttest} className="px-3 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600">{t.btn_attest}</button>
                  </div>
                  <div className="mt-3 text-xs break-all"><span className="text-white/60 mr-2">{t.root}:</span>{root || "-"}</div>
                  <div className="mt-2 text-xs break-all"><span className="text-white/60 mr-2">{t.txhash}:</span>{tx || "-"}</div>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {active === "attest" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 rounded-3xl bg-white/5 border border-white/10">
            <div className="text-lg font-semibold mb-4">{t.attest_title}</div>
            <div className="text-sm text-white/70 mb-3">{t.root}: <span className="text-white break-all">{root || "-"}</span></div>
            <div className="text-sm text-white/70 mb-6">{t.txhash}: <span className="text-white break-all">{tx || "-"}</span></div>
            <div className="flex gap-2">
              <button onClick={handleBuildRoot} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20">{t.btn_build_root}</button>
              <button onClick={handleAttest} className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600">{t.btn_attest}</button>
            </div>
          </motion.div>
        )}

        {active === "status" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-lg font-semibold mb-4">{t.status_title}</div>
            <div className="grid gap-3">
              {status.length === 0 && <div className="text-white/60 text-sm">—</div>}
              {status.map((it, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <div className="text-xs text-white/60">{it.when}</div>
                  <div className="text-sm mt-1"><span className="text-white/60 mr-2">Root:</span><span className="break-all">{it.root}</span></div>
                  <div className="text-sm"><span className="text-white/60 mr-2">Tx:</span><span className="break-all">{it.tx}</span></div>
                  <div className="text-sm text-white/70"><span className="text-white/60 mr-2">Order:</span>{it.order}</div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Footer */}
        <div className="mt-12 text-xs text-white/50">{t.disclaimer}</div>
      </div>
    </div>
  );
}
