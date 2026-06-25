import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ethers } from "ethers";
// 依赖：tailwind 已内置；无需后端、无需触达 OKX API；所有计算在浏览器本地完成。
// 功能：
// 1) 用户上传 OKX 导出的 CSV（或粘贴一行JSON），选择/输入订单号；
// 2) 本地构建 Merkle 树，生成 merkleRoot 与 attest.json；
// 3) 下载 attest.json（用户自行上传到 wjz5788.com/files/ 或任意可公开访问的URL）；
// 4) 连接钱包 → Base 主网 → 调用现有合约 attest(root, uri) 上链留痕；
// 备注：合约地址为你当前已部署的 V1：ClaimAttestor（可改为 V2）。

/********************** 配置区 **********************/
const BASE_CHAIN_ID = 8453; // Base 主网
const BASE_RPC = "https://mainnet.base.org"; // 仅用于只读
// 你的已部署合约（V1）
const ATTESTOR_ADDR = "0x9552b58d323993f84d01e3744f175f47a9462f94";
const ATTESTOR_ABI = [
  "function attest(bytes32 root, string uri)",
  "function has(bytes32) view returns (bool)"
];

/********************** 工具函数 **********************/
// 简易 CSV 解析（推荐用户导出 UTF-8 CSV）。为稳妥起见，这里使用浏览器内置逻辑做一个简单解析；
// 复杂 CSV 建议在后续接入 PapaParse。
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = splitCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => (row[h.trim()] = (cols[idx] ?? "").trim()));
    rows.push(row);
  }
  return { headers, rows };
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { // 转义双引号
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// 规范化一行，抽取稳定字段（自动适配中英列名）
function canonicalizeRow(row) {
  // 兼容列名（OKX常见导出：中文“id/交易品种/交易类型/数量/交易单位/成交价/收益/时间”，或英文 exports）
  const pick = (keys) => {
    for (const k of keys) if (k in row && String(row[k]).length) return String(row[k]).trim();
    return "";
  };
  const id = pick(["id", "ID", "orderId", "订单ID", "关联订单id"]);
  const inst = pick(["交易品种", "instId", "Instrument", "Symbol"]);
  const side = pick(["交易类型", "side", "方向", "Side"]);
  const qty = pick(["数量", "size", "Qty", "FilledQty", "accFillSz"]);
  const unit = pick(["交易单位", "QtyUnit", "Unit"]);
  const px = pick(["成交价", "fillPx", "price", "Price"]);
  const pnl = pick(["收益", "pnl", "RealizedPnL", "盈亏"]);
  const ts = pick(["时间", "ts", "Time", "timestamp"]);
  const exchange = "OKX";
  return {
    exchange,
    id,
    inst,
    side,
    qty,
    unit,
    px,
    pnl,
    ts,
  };
}

// 稳定 JSON 字符串（字段顺序固定）
function stableJSONString(obj) {
  const keys = ["exchange","id","inst","side","qty","unit","px","pnl","ts"];
  const ordered = {};
  for (const k of keys) ordered[k] = obj[k] ?? "";
  return JSON.stringify(ordered);
}

// keccak256(utf8(JSON))
function keccakJson(obj) {
  const s = stableJSONString(obj);
  const bytes = ethers.toUtf8Bytes(s);
  return ethers.keccak256(bytes); // 0x...32bytes
}

// Merkle 构建（keccak，按字典序排序）
function buildMerkle(leavesHex) {
  if (leavesHex.length === 0) return { root: ethers.ZeroHash, levels: [] };
  let level = leavesHex.map(h => h.toLowerCase());
  level.sort();
  const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) {
        // 奇数个，直接提升
        next.push(level[i]);
      } else {
        const a = level[i];
        const b = level[i + 1];
        const [left, right] = a <= b ? [a, b] : [b, a];
        const concat = ethers.concat([ethers.getBytes(left), ethers.getBytes(right)]);
        next.push(ethers.keccak256(concat));
      }
    }
    level = next.sort();
    levels.push(level);
  }
  return { root: level[0], levels };
}

async function sha256HexOfFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex;
}

function downloadAs(name, data) {
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/********************** 组件 **********************/
function App() {
  const [csvText, setCsvText] = useState("");
  const [csvFile, setCsvFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [orderId, setOrderId] = useState("");
  const [merkleRoot, setMerkleRoot] = useState("");
  const [attestUrl, setAttestUrl] = useState("");
  const [status, setStatus] = useState("");
  const [txHash, setTxHash] = useState("");
  const [hasOnchain, setHasOnchain] = useState(null);

  const parsed = useMemo(() => {
    if (!csvText) return { headers: [], rows: [] };
    try { return parseCSV(csvText); } catch (e) { console.error(e); return { headers: [], rows: [] } }
  }, [csvText]);

  useEffect(() => {
    setHeaders(parsed.headers);
    setRows(parsed.rows);
  }, [parsed.headers, parsed.rows]);

  async function handleFile(f) {
    setCsvFile(f);
    const text = await f.text();
    setCsvText(text);
  }

  function buildRoot() {
    if (!rows.length) { setStatus("请先上传 CSV"); return; }
    // 将每一行规范化 → 生成 leaf
    const leaves = rows.map(r => keccakJson(canonicalizeRow(r)));
    const { root } = buildMerkle(leaves);
    setMerkleRoot(root);
    setStatus("Merkle root 已生成");
  }

  async function genAttestJson() {
    if (!merkleRoot) { setStatus("请先生成 Merkle root"); return; }
    const sha = csvFile ? await sha256HexOfFile(csvFile) : "";
    const exampleRow = orderId ? findRowById(rows, orderId) : rows[0];
    const payload = {
      merkleRoot,
      chainId: BASE_CHAIN_ID,
      contract: ATTESTOR_ADDR,
      dataset: {
        uri: "<请上传CSV到你的网站后粘贴URL>",
        sha256Hex: sha,
        rows: rows.length
      },
      generator: {
        name: "liqpass-web-attestor",
        version: "0.1.0",
        repo: "https://github.com/your-org/liqpass-web-attestor"
      },
      market: {
        exchange: "OKX",
        symbols: deduceSymbols(rows),
        timeWindow: { startISO: "", endISO: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
      },
      counts: { positions: rows.length, liquidations: null, adl: null },
      method: {
        treeAlgo: "keccak256",
        leafFormat: "keccak256(utf8(JSON.stringify({exchange,id,inst,side,qty,unit,px,pnl,ts})))",
        proofFormat: "array<bytes32>"
      },
      createdAt: new Date().toISOString(),
      notes: "本文件由前端本地生成；未触达 OKX API。用户需自行上传 CSV 与本 attest.json 到可公开访问的URL后，再执行上链。",
      sample: {
        selectedOrder: exampleRow ? canonicalizeRow(exampleRow) : null
      }
    };
    downloadAs(`attest_${Date.now()}.json`, JSON.stringify(payload, null, 2));
    setStatus("attest.json 已生成并下载。请将其上传到你的网站 /files/ ，然后把URL粘贴到下方。");
  }

  function findRowById(_rows, id) {
    const candidates = ["id","ID","orderId","订单ID","关联订单id"]; 
    for (const r of _rows) {
      for (const k of candidates) {
        if (r[k] && String(r[k]).trim() === String(id).trim()) return r;
      }
    }
    return null;
  }

  function deduceSymbols(_rows) {
    const set = new Set();
    for (const r of _rows) {
      const c = canonicalizeRow(r);
      if (c.inst) set.add(c.inst);
    }
    return Array.from(set);
  }

  async function connectAndAttest() {
    try {
      if (!window.ethereum) { setStatus("未检测到钱包（MetaMask等）"); return; }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const [acc] = await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== BASE_CHAIN_ID) {
        // 尝试切换/添加 Base
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ethers.toQuantity(BASE_CHAIN_ID) }]
          });
        } catch (e) {
          // 未添加则添加
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: ethers.toQuantity(BASE_CHAIN_ID),
              chainName: "Base Mainnet",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [BASE_RPC],
              blockExplorerUrls: ["https://basescan.org"]
            }]
          });
        }
      }
      const signer = await provider.getSigner();
      const c = new ethers.Contract(ATTESTOR_ADDR, ATTESTOR_ABI, signer);

      if (!merkleRoot) { setStatus("缺少 merkleRoot，请先生成"); return; }
      if (!attestUrl || !attestUrl.startsWith("http")) { setStatus("请粘贴 attest.json 的公网 URL"); return; }

      // 调用合约
      setStatus("发送交易中...");
      const tx = await c.attest(merkleRoot, attestUrl);
      const rcpt = await tx.wait();
      setTxHash(tx.hash);
      setStatus("已上链。下面可点击 Basescan 查看。");
      // 读 has(root)
      const ok = await c.has(merkleRoot);
      setHasOnchain(ok);
    } catch (e) {
      console.error(e);
      setStatus(`失败：${e?.message ?? e}`);
    }
  }

  async function checkHas() {
    try {
      const provider = new ethers.JsonRpcProvider(BASE_RPC);
      const c = new ethers.Contract(ATTESTOR_ADDR, ATTESTOR_ABI, provider);
      const ok = await c.has(merkleRoot);
      setHasOnchain(ok);
      setStatus("已查询链上 has(root)");
    } catch (e) {
      setStatus(`查询失败：${e?.message ?? e}`);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-2">LiqPass — 本地验证 & 一键上链留痕</h1>
        <p className="text-sm opacity-70 mb-6">不连 OKX API；不上传隐私；所有计算在浏览器完成。合约：{ATTESTOR_ADDR}</p>

        {/* 步骤 1：上传 CSV */}
        <div className="bg-white rounded-2xl shadow p-5 mb-6">
          <h2 className="text-xl font-semibold mb-2">步骤 1 / 上传 OKX 导出的 CSV</h2>
          <div className="flex items-center gap-3 mb-3">
            <input type="file" accept=".csv,text/csv" onChange={(e)=> e.target.files?.[0] && handleFile(e.target.files[0])} />
            <button className="px-3 py-2 rounded-xl bg-slate-800 text-white" onClick={()=>{
              if (!csvText) return;
              const { headers, rows } = parseCSV(csvText);
              setHeaders(headers); setRows(rows);
            }}>解析</button>
          </div>
          <textarea className="w-full h-28 p-3 rounded-xl border" placeholder="或直接粘贴 CSV 文本..." value={csvText} onChange={e=>setCsvText(e.target.value)} />
          <div className="text-xs mt-2 opacity-70">提示：OKX 支持在「资产 → 订单中心」导出订单/交易历史为 CSV（最多3个月/次）。</div>
        </div>

        {/* 步骤 2：选择订单 & 生成 Root */}
        <div className="bg-white rounded-2xl shadow p-5 mb-6">
          <h2 className="text-xl font-semibold mb-2">步骤 2 / 选择订单并生成 Merkle Root</h2>
          <div className="flex items-center gap-3 mb-3">
            <input className="flex-1 border rounded-xl p-2" placeholder="输入订单号（可选，用于样例展示/校验）" value={orderId} onChange={e=>setOrderId(e.target.value)} />
            <button className="px-3 py-2 rounded-xl bg-slate-800 text-white" onClick={buildRoot}>生成 Root</button>
          </div>
          {merkleRoot && (
            <div className="text-sm break-all">merkleRoot：<code className="bg-slate-100 px-2 py-1 rounded">{merkleRoot}</code></div>
          )}
        </div>

        {/* 步骤 3：生成并下载 attest.json */}
        <div className="bg-white rounded-2xl shadow p-5 mb-6">
          <h2 className="text-xl font-semibold mb-2">步骤 3 / 生成 attest.json 并下载</h2>
          <div className="flex items-center gap-3 mb-3">
            <button className="px-3 py-2 rounded-xl bg-slate-800 text-white" onClick={genAttestJson}>生成 & 下载</button>
          </div>
          <div className="text-xs opacity-70">将下载的 attest.json 与原始 CSV 一并上传到你的网站（例如 <code>/files/</code> 目录），复制它的公网 URL。</div>
        </div>

        {/* 步骤 4：上链留痕 */}
        <div className="bg-white rounded-2xl shadow p-5 mb-6">
          <h2 className="text-xl font-semibold mb-2">步骤 4 / 上链留痕（Base 主网）</h2>
          <input className="w-full border rounded-xl p-2 mb-3" placeholder="粘贴 attest.json 的公网 URL (https://...)" value={attestUrl} onChange={e=>setAttestUrl(e.target.value)} />
          <div className="flex items-center gap-3">
            <button className="px-3 py-2 rounded-xl bg-emerald-600 text-white" onClick={connectAndAttest}>连接钱包并上链</button>
            <button className="px-3 py-2 rounded-xl bg-slate-200" onClick={checkHas}>检查 has(root)</button>
          </div>
          {txHash && (
            <div className="text-sm mt-3">Tx: <a className="text-blue-600 underline" target="_blank" href={`https://basescan.org/tx/${txHash}`}>{txHash}</a></div>
          )}
          {hasOnchain !== null && (
            <div className="text-sm mt-1">合约 has(root)：{String(hasOnchain)}</div>
          )}
        </div>

        {/* 状态栏 */}
        <div className="mt-4 text-sm opacity-80">{status}</div>

        {/* 表格速览（前10行） */}
        {rows.length > 0 && (
          <div className="bg-white rounded-2xl shadow p-5 mt-6">
            <h3 className="font-semibold mb-2">CSV 预览（前 10 行）</h3>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {headers.map((h,i) => <th key={i} className="px-2 py-1 border-b text-left whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0,10).map((r,idx)=> (
                    <tr key={idx} className="odd:bg-slate-50">
                      {headers.map((h,i)=> <td key={i} className="px-2 py-1 border-b whitespace-nowrap">{r[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 使用说明 */}
        <div className="prose max-w-none mt-8">
          <h2>使用说明 / 无需服务器访问 OKX</h2>
          <ol>
            <li>登录 OKX，进入 <strong>资产 → 订单中心</strong>，导出交易/订单 CSV（OKX 限制单次最多3个月，需多次导出后合并）。</li>
            <li>将 CSV 上传到本页面，点击“生成 Root”。</li>
            <li>点击“生成 & 下载”，得到 <code>attest.json</code>（包含数据集 SHA-256、生成方法、样例订单等，便于审计复验）。</li>
            <li>把 <code>attest.json</code> 与原始 CSV 上传到你的网站（如 <code>https://wjz5788.com/files/</code>）。</li>
            <li>粘贴 <code>attest.json</code> 的公网 URL，连接钱包，签名并调用链上 <code>attest(root, uri)</code> 即完成留痕。</li>
          </ol>
          <p>（可选）OKX 在 2025 年推出了「订单分享」功能，用户也可以在 OKX 端开启分享并提供分享链接作为佐证材料。</p>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);

export default App;

---

# LiqPass 最小可用仓库（MVP 全闭环）

> 目标：今天就能跑通“连接钱包 → 选产品 → USDC 购买 → 上传爆仓证据包 → 上链留痕 → 发起理赔 → 赔付到账”，用于 Base Grants 申请演示。OKX API 自动取证留到资助后落地（UI 里先灰置）。

## 目录结构
```
liqpass-mvp/
├─ contracts/
│  ├─ PolicyManager.sol
│  └─ abi/
│     ├─ PolicyManager.json         # 编译后 ABI（示例内嵌）
│     └─ Attestor.json              # 只需 has(root)、attest(root,uri)
├─ frontend/
│  ├─ index.html                    # 纯静态，无后端
│  └─ src/
│     └─ App.tsx                    # 5 个页签：Connect/Exchange/Products/Purchase/Claim
├─ scripts/
│  └─ mkroot.js                     # 本地生成 merkleRoot（CSV → root）
├─ examples/
│  ├─ orders.sample.csv
│  └─ attest.sample.json
├─ schema/
│  └─ attest.schema.json
└─ README.md
```

---

## contracts/PolicyManager.sol
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAttestor { function has(bytes32 root) external view returns (bool); }
interface IERC20   { function transferFrom(address,address,uint256) external returns(bool);
                     function transfer(address,uint256) external returns(bool);
                     function balanceOf(address) external view returns (uint256); }

contract PolicyManager {
    struct Product {
        uint256 premium;      // USDC(6dp) 按整数存，如 10 USDC => 10_000000
        uint256 maxPayout;    // 最高赔付（USDC）
        uint64  waitSeconds;  // 等待期（反欺诈）
        uint64  coverSeconds; // 保障时长
        bool    active;
    }
    struct Policy {
        address owner;
        uint256 productId;
        uint64  startAt;
        bool    claimed;
    }

    address public immutable USDC;   // <- 部署时填 Base 主网 USDC 地址（或先用占位再替换）
    IAttestor public immutable ATTESTOR; // 你现有的 ClaimAttestor 合约
    address public owner;

    mapping(uint256=>Product) public products;   // productId => Product
    mapping(uint256=>Policy)  public policies;   // policyId  => Policy
    mapping(bytes32=>bool)    public usedRoot;   // 防重复理赔
    uint256 public nextPolicyId;

    event Purchased(uint256 indexed policyId, address indexed buyer, uint256 productId, uint256 startAt);
    event Claimed(uint256 indexed policyId, bytes32 indexed root, string uri, uint256 payout, address to);

    modifier onlyOwner(){ require(msg.sender==owner, "!owner"); _; }

    constructor(address usdc, address attestor) {
        USDC = usdc; ATTESTOR = IAttestor(attestor); owner = msg.sender;
    }

    function setProduct(uint256 id, Product calldata p) external onlyOwner {
        products[id] = p;
    }

    function buy(uint256 productId) external {
        Product memory p = products[productId];
        require(p.active, "inactive");
        require(IERC20(USDC).transferFrom(msg.sender, address(this), p.premium), "pay fail");
        policies[++nextPolicyId] = Policy(msg.sender, productId, uint64(block.timestamp), false);
        emit Purchased(nextPolicyId, msg.sender, productId, block.timestamp);
    }

    // MVP：基于 attestor.has(root) + 时间窗 做最小校验
    function submitClaim(uint256 policyId, bytes32 root, string calldata uri, uint64 eventTs) external {
        Policy storage po = policies[policyId];
        require(msg.sender == po.owner, "!owner");
        require(!po.claimed, "claimed");
        Product memory prod = products[po.productId];
        require(block.timestamp >= po.startAt + prod.waitSeconds, "in waiting");
        require(eventTs >= po.startAt && eventTs <= po.startAt + prod.coverSeconds, "out of window");
        require(ATTESTOR.has(root), "root not attested");
        require(!usedRoot[root], "root used");
        usedRoot[root] = true;
        po.claimed = true;
        require(IERC20(USDC).transfer(po.owner, prod.maxPayout), "payout fail");
        emit Claimed(policyId, root, uri, prod.maxPayout, po.owner);
    }

    // 充入理赔资金（演示可手动从 owner 转入）
    function topup(uint256 amt) external onlyOwner {
        require(IERC20(USDC).transferFrom(msg.sender, address(this), amt), "topup fail");
    }
}
```

> **部署参数**：`USDC=<BASE_USDC_ADDRESS>`（先用占位，提交前再填真地址）; `attestor=<0x9552b58d323993f84d01e3744f175f47a9462f94>`。

---

## frontend/index.html（零构建版入口）
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LiqPass MVP</title>
  <script src="https://unpkg.com/ethers@6.13.2/dist/ethers.umd.min.js"></script>
  <style>body{font-family:system-ui, -apple-system, Segoe UI, Roboto, PingFang SC, Noto Sans, sans-serif; margin:0;}
  .wrap{max-width:940px;margin:24px auto;padding:0 16px} .card{background:#fff;border-radius:16px;box-shadow:0 6px 24px rgba(0,0,0,.08);padding:16px;margin:12px 0}
  button{border:0;border-radius:12px;padding:10px 14px;background:#111;color:#fff;cursor:pointer} input,select,textarea{padding:10px;border:1px solid #ddd;border-radius:10px;width:100%}
  code{background:#f5f5f7;padding:2px 6px;border-radius:6px}
  </style>
</head>
<body>
<div class="wrap">
  <h1>LiqPass — Retail Liquidation Cover (MVP)</h1>
  <p>Flow: Connect → (Exchange) → Products → Purchase → Claim. OKX API 自动取证将在获得资助后开放；当前使用 <strong>CSV/本地取证 + 上链 attestation</strong>。</p>

  <div class="card">
    <h2>1) Connect</h2>
    <div>
      <button id="btnConnect">Connect Wallet (Base)</button>
      <div id="addr" style="margin-top:8px;color:#555"></div>
    </div>
  </div>

  <div class="card">
    <h2>2) Exchange</h2>
    <p>
      <label><input type="radio" name="ex" checked disabled /> OKX (API 只读，<em>资助后开放</em>)</label>
      <br />
      <label><input type="radio" name="ex" checked /> 上传 CSV（当前可用）</label>
    </p>
    <input type="file" id="csv" accept=".csv,text/csv" />
    <button id="btnRoot" style="margin-top:8px">本地生成 Merkle Root</button>
    <div id="rootOut" style="margin-top:6px"></div>
    <button id="btnAttJson" style="margin-top:8px">生成并下载 attest.json</button>
  </div>

  <div class="card">
    <h2>3) Products</h2>
    <p>选择一个 SKU（可在合约中由 owner 设置价格/等待期/时长）：</p>
    <select id="sku">
      <option value="1">#1 当日爆仓保 — premium=10 USDC, payout=100 USDC</option>
      <option value="2">#2 8小时时段保 — premium=6 USDC, payout=60 USDC</option>
      <option value="3">#3 月度回撤保 — premium=20 USDC, payout=200 USDC</option>
      <option value="4">#4 无爆仓返现 — premium=5 USDC, payout=8 USDC</option>
    </select>
  </div>

  <div class="card">
    <h2>4) Purchase</h2>
    <p>需要 USDC 余额。演示时可先给合约 <code>topup()</code> 注入赔付金。</p>
    <label>USDC 合约地址（Base）：<input id="usdc" placeholder="<USDC_ADDRESS_BASE>" /></label>
    <label style="margin-top:6px">PolicyManager 地址：<input id="pm" placeholder="<POLICY_MANAGER_ADDRESS>" /></label>
    <div style="display:flex; gap:8px; margin-top:8px">
      <button id="approve">Approve USDC</button>
      <button id="buy">Buy</button>
    </div>
    <div id="buyOut" style="margin-top:8px"></div>
  </div>

  <div class="card">
    <h2>5) Claim</h2>
    <label>policyId：<input id="pid" placeholder="1" /></label>
    <label style="margin-top:6px">merkleRoot：<input id="rootClaim" placeholder="0x..." /></label>
    <label style="margin-top:6px">attest.json 公网 URL：<input id="uriClaim" placeholder="https://.../attest.json" /></label>
    <label style="margin-top:6px">事件时间戳（秒）：<input id="eventTs" placeholder="1714666250" /></label>
    <div style="display:flex; gap:8px; margin-top:8px">
      <button id="doAttest">上链 attestation</button>
      <button id="doHas">检查 has(root)</button>
      <button id="doClaim">Submit Claim</button>
    </div>
    <div id="claimOut" style="margin-top:8px"></div>
  </div>
</div>

<script>
const ATTESTOR_ADDR = "0x9552b58d323993f84d01e3744f175f47a9462f94";
const ATTESTOR_ABI  = [
  "function attest(bytes32 root, string uri)",
  "function has(bytes32) view returns (bool)"
];
const PM_ABI = [
  "function buy(uint256 productId)",
  "function submitClaim(uint256 policyId, bytes32 root, string uri, uint64 eventTs)",
  "function setProduct(uint256 id, (uint256,uint256,uint64,uint64,bool))",
  "function topup(uint256 amt)",
  "function products(uint256) view returns (uint256 premium,uint256 maxPayout,uint64 waitSeconds,uint64 coverSeconds,bool active)"
];
const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

let provider, signer, account;
const BaseId = 8453;

function byId(id){ return document.getElementById(id); }

byId('btnConnect').onclick = async () => {
  if(!window.ethereum){ alert('请安装 MetaMask'); return; }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts',[]);
  const net = await provider.getNetwork();
  if(Number(net.chainId)!==BaseId){
    try{ await window.ethereum.request({method:'wallet_switchEthereumChain', params:[{chainId: ethers.toQuantity(BaseId)}]}); }
    catch(e){ await window.ethereum.request({method:'wallet_addEthereumChain', params:[{chainId: ethers.toQuantity(BaseId), chainName:'Base Mainnet', nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18}, rpcUrls:['https://mainnet.base.org'], blockExplorerUrls:['https://basescan.org']} ]}); }
  }
  signer = await provider.getSigner();
  account = await signer.getAddress();
  byId('addr').innerText = 'Connected: '+account;
};

// CSV → root（浏览器内最小实现，建议正式使用 PapaParse）
function splitCSVLine(line){ let out=[],cur="",q=false; for(let i=0;i<line.length;i++){const ch=line[i]; if(ch==='"'){ if(q&&line[i+1]==='"'){cur+='"'; i++;} else q=!q; } else if(ch===','&&!q){out.push(cur); cur="";} else cur+=ch;} out.push(cur); return out; }
function parseCSV(txt){ const L = txt.replace(/
/g,"
").replace(//g,"
").split("
").filter(Boolean); const headers=splitCSVLine(L[0]); const rows=[]; for(let i=1;i<L.length;i++){ const cols=splitCSVLine(L[i]); const r={}; headers.forEach((h,j)=> r[h.trim()] = (cols[j]??"").trim()); rows.push(r);} return {headers,rows}; }
const pick=(r,ks)=>{for(const k of ks) if(r[k]) return String(r[k]).trim(); return "";};
function canonicalizeRow(r){ return {exchange:"OKX", id:pick(r,["id","ID","orderId","订单ID","关联订单id"]), inst:pick(r,["交易品种","instId","Instrument","Symbol"]), side:pick(r,["交易类型","side","方向","Side"]), qty:pick(r,["数量","size","Qty","FilledQty","accFillSz"]), unit:pick(r,["交易单位","QtyUnit","Unit"]), px:pick(r,["成交价","fillPx","price","Price"]), pnl:pick(r,["收益","pnl","RealizedPnL","盈亏"]), ts:pick(r,["时间","ts","Time","timestamp"]) }; }
function stableJSONString(o){ const k=["exchange","id","inst","side","qty","unit","px","pnl","ts"]; const z={}; k.forEach(x=> z[x]=o[x]??""); return JSON.stringify(z); }
function keccakJson(o){ return ethers.keccak256(ethers.toUtf8Bytes(stableJSONString(o))); }
function buildMerkle(leaves){ if(!leaves.length) return ethers.ZeroHash; let lvl=leaves.map(h=>h.toLowerCase()).sort(); while(lvl.length>1){ const nxt=[]; for(let i=0;i<lvl.length;i+=2){ if(i+1===lvl.length) nxt.push(lvl[i]); else{ const a=lvl[i], b=lvl[i+1]; const L=a<=b?a:b, R=a<=b?b:a; nxt.push(ethers.keccak256(ethers.concat([ethers.getBytes(L), ethers.getBytes(R)]))); } } lvl=nxt.sort(); } return lvl[0]; }

let lastRoot="";
byId('btnRoot').onclick = async () => {
  const f = byId('csv').files?.[0]; if(!f){ alert('先选择 CSV'); return; }
  const txt = await f.text();
  const {rows}=parseCSV(txt);
  const leaves = rows.map(r=> keccakJson(canonicalizeRow(r)) );
  lastRoot = buildMerkle(leaves);
  byId('rootOut').innerHTML = 'root: <code>'+lastRoot+'</code> ('+rows.length+' rows)';
};

byId('btnAttJson').onclick = async () => {
  if(!lastRoot){ alert('请先生成 root'); return; }
  const data = {
    merkleRoot: lastRoot,
    chainId: 8453,
    contract: ATTESTOR_ADDR,
    dataset: { uri: "<UPLOAD_CSV_URL>", sha256Hex: "<SHA256_OF_CSV>", rows: -1 },
    generator: { name: "liqpass-web", version: "0.1.0" },
    market: { exchange: "OKX", symbols: [] },
    method: { treeAlgo: "keccak256", leafFormat: "keccak(JSON)" },
    createdAt: new Date().toISOString(),
    notes: "demo"
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='attest.json'; a.click(); URL.revokeObjectURL(url);
};

// Purchase
byId('approve').onclick = async () => {
  if(!signer){ alert('先连接钱包'); return; }
  const usdc = byId('usdc').value.trim(); const pm = byId('pm').value.trim();
  if(!usdc||!pm){ alert('填 USDC 与 PolicyManager 地址'); return; }
  const erc = new ethers.Contract(usdc, ERC20_ABI, signer);
  const sku = Number(byId('sku').value);
  const pmc = new ethers.Contract(pm, PM_ABI, signer);
  const p = await pmc.products(sku);
  const tx = await erc.approve(pm, p.premium);
  await tx.wait();
  byId('buyOut').innerText = 'Approve OK: '+tx.hash;
};

byId('buy').onclick = async () => {
  const pm = byId('pm').value.trim(); if(!pm){ alert('填 PolicyManager 地址'); return; }
  const sku = Number(byId('sku').value);
  const pmc = new ethers.Contract(pm, PM_ABI, signer);
  const tx = await pmc.buy(sku); const rc = await tx.wait();
  byId('buyOut').innerText = 'Buy OK: '+tx.hash+" — 事件里能看到 policyId 递增";
};

// Claim
byId('doAttest').onclick = async () => {
  const root = byId('rootClaim').value.trim(); const uri=byId('uriClaim').value.trim();
  if(!root||!uri){ alert('填 root 与 uri'); return; }
  const att = new ethers.Contract(ATTESTOR_ADDR, ATTESTOR_ABI, signer);
  const tx = await att.attest(root, uri); await tx.wait(); byId('claimOut').innerText = 'attest tx: '+tx.hash;
};
byId('doHas').onclick = async () => {
  const root = byId('rootClaim').value.trim();
  const att = new ethers.Contract(ATTESTOR_ADDR, ATTESTOR_ABI, provider||new ethers.JsonRpcProvider('https://mainnet.base.org'));
  const ok = await att.has(root); byId('claimOut').innerText = 'has(root) = '+ok;
};
byId('doClaim').onclick = async () => {
  const pm = byId('pm').value.trim(); const pid=Number(byId('pid').value); const root=byId('rootClaim').value.trim(); const uri=byId('uriClaim').value.trim(); const ts=Number(byId('eventTs').value);
  const pmc = new ethers.Contract(pm, PM_ABI, signer);
  const tx = await pmc.submitClaim(pid, root, uri, ts); await tx.wait();
  byId('claimOut').innerText = 'claim tx: '+tx.hash;
};
</script>
</body>
</html>
```

---

## scripts/mkroot.js（命令行本地生成 merkleRoot）
```js
// 用法：node mkroot.js orders.csv
const fs = require("fs");
const { keccak256, toUtf8Bytes, getBytes, concat } = require("ethers");
function splitCSVLine(line){ const out=[],cur=[""]; let q=false,curStr=""; out.length=0; let s="",res=[]; let i=0; const push=()=>{res.push(s); s=""};
  res=[]; for(i=0;i<line.length;i++){ const ch=line[i]; if(ch=='"'){ if(q && line[i+1]=='"'){ s+='"'; i++; } else q=!q; }
    else if(ch==',' && !q){ push(); } else s+=ch; } push(); return res; }
function parseCSV(txt){ const L=txt.replace(/
/g,"
").replace(//g,"
").split("
").filter(Boolean); const H=splitCSVLine(L[0]); const rows=[]; for(let i=1;i<L.length;i++){ const cols=splitCSVLine(L[i]); const r={}; H.forEach((h,j)=> r[h.trim()] = (cols[j]??"").trim()); rows.push(r);} return {headers:H,rows}; }
const pick=(r,ks)=>{for(const k of ks) if(r[k]) return String(r[k]).trim(); return "";};
function canonicalizeRow(r){ return {exchange:"OKX", id:pick(r,["id","ID","orderId","订单ID","关联订单id"]), inst:pick(r,["交易品种","instId","Instrument","Symbol"]), side:pick(r,["交易类型","side","方向","Side"]), qty:pick(r,["数量","size","Qty","FilledQty","accFillSz"]), unit:pick(r,["交易单位","QtyUnit","Unit"]), px:pick(r,["成交价","fillPx","price","Price"]), pnl:pick(r,["收益","pnl","RealizedPnL","盈亏"]), ts:pick(r,["时间","ts","Time","timestamp"]) }; }
function stableJSONString(o){ const k=["exchange","id","inst","side","qty","unit","px","pnl","ts"]; const z={}; k.forEach(x=> z[x]=o[x]??""); return JSON.stringify(z); }
function buildMerkle(leaves){ if(leaves.length===0) return "0x"+"0".repeat(64); let lvl=leaves.map(h=>h.toLowerCase()).sort(); while(lvl.length>1){ const nxt=[]; for(let i=0;i<lvl.length;i+=2){ if(i+1===lvl.length) nxt.push(lvl[i]); else{ const a=lvl[i], b=lvl[i+1]; const L=a<=b?a:b, R=a<=b?b:a; nxt.push(keccak256(concat([getBytes(L), getBytes(R)]))); } } lvl=nxt.sort(); } return lvl[0]; }
const csv = fs.readFileSync(process.argv[2]||"orders.csv","utf8");
const {rows}=parseCSV(csv);
const leaves = rows.map(r => keccak256(toUtf8Bytes(stableJSONString(canonicalizeRow(r)))));
const root = buildMerkle(leaves);
console.log("merkleRoot =", root, " (rows:", rows.length,")");
```

---

## examples/attest.sample.json（替换占位后直接可用）
```json
{
  "merkleRoot": "0x<REPLACE_WITH_YOUR_ROOT>",
  "chainId": 8453,
  "contract": "0x9552b58d323993f84d01e3744f175f47a9462f94",
  "dataset": {
    "uri": "https://wjz5788.com/files/orders.csv",
    "sha256Hex": "<SHA256_OF_CSV>",
    "rows": 123
  },
  "generator": { "name": "liqpass-local", "version": "0.1.0" },
  "market": { "exchange": "OKX", "symbols": ["LINK-USDT-SWAP"] },
  "method": { "treeAlgo": "keccak256", "leafFormat": "keccak(JSON)" },
  "createdAt": "2025-10-12T16:45:00+09:00",
  "notes": "demo"
}
```

---

## schema/attest.schema.json（审计复核用）
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "LiqPass Attestation Payload",
  "type": "object",
  "properties": {
    "merkleRoot": { "type": "string", "pattern": "^0x[0-9a-fA-F]{64}$" },
    "chainId": { "type": "integer", "enum": [8453] },
    "contract": { "type": "string", "pattern": "^0x[0-9a-fA-F]{40}$" },
    "dataset": {
      "type": "object",
      "properties": {
        "uri": { "type": "string", "format": "uri" },
        "sha256Hex": { "type": "string", "pattern": "^[0-9a-fA-F]{64}$" },
        "rows": { "type": "integer", "minimum": 0 }
      },
      "required": ["uri", "sha256Hex"]
    },
    "generator": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "version": { "type": "string" }
      },
      "required": ["name", "version"]
    },
    "market": {
      "type": "object",
      "properties": {
        "exchange": { "type": "string" },
        "symbols": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["exchange"]
    },
    "method": {
      "type": "object",
      "properties": {
        "treeAlgo": { "type": "string" },
        "leafFormat": { "type": "string" }
      },
      "required": ["treeAlgo"]
    },
    "createdAt": { "type": "string", "format": "date-time" },
    "notes": { "type": "string" }
  },
  "required": ["merkleRoot", "chainId", "contract", "dataset", "generator", "market", "method", "createdAt"]
}
```

---

## README.md（提交用最小说明）
```markdown
# LiqPass — Liquidation Attestation & Retail Cover (Base Mainnet)

**Live**: Attestor `0x9552…f94` on Base mainnet. PolicyManager (this repo) = `<DEPLOYED_ADDRESS>`.

## What it does
- Users create a local Merkle root from OKX CSV (privacy-preserving; no server needed now).
- Publish `attest.json` (dataset SHA-256, method, sample) and call onchain `attest(root, uri)`.
- Purchase a retail cover (USDC). If liquidation occurs within the window, submit a claim with the attested root → **automatic payout** from the contract balance.

## Why Base
Onchain, tamper-evident audit logs and payouts; brings a new user segment (insured leverage traders) and recurring onchain activity.

## Quickstart
1. Compile & deploy `contracts/PolicyManager.sol` with constructor `(USDC, ATTESTOR)`.
2. `setProduct(id, {premium,maxPayout,waitSeconds,coverSeconds,active=true})` for 4 SKUs.
3. Fund the contract via `topup()` with USDC for demo payouts.
4. Open `frontend/index.html` → Connect → Upload CSV → Generate root → Generate `attest.json` → paste URL → `attest(root, uri)` → Buy → SubmitClaim.

## Verify
- `Read Contract` → `has(root)` returns `true` on Attestor.
- Claim tx emits `Claimed(policyId, root, uri, payout, to)`.

## Roadmap (post-grant)
- OKX read-only API **automatic evidence** (server-side HMAC; encrypted-at-rest; no secrets in browser).
- Paymaster gasless UX; risk controls/blacklist caps; audit.

## Security
No custody of funds by backend; only contract holds USDC for payouts. Evidence is hashed+URI; users may redact CSV to minimal fields as long as the root is reproducible.
```

---

> 提交 Base Grants 时，把：合约地址、一次成功的 `attest` 交易、一次成功的 `submitClaim` 交易、以及 1 分钟演示视频链接，填进表单即可。
