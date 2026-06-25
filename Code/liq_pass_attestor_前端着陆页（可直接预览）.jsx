import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, ShieldCheck, Link as LinkIcon, Copy, CheckCheck, Database, Network, ArrowRight, Search, RefreshCcw } from "lucide-react";
// 说明：在 ChatGPT 画布里可直接预览。本组件默认导出，可放入任意 React/Next/Vite 工程使用。
// 风格：Tailwind + 玻璃拟态 + 大圆角；交互动效用 Framer Motion；图标用 lucide-react。
// 如果你工程里没有 shadcn/ui，也能在画布正常预览；落地到仓库时建议安装 shadcn/ui 以获得一致的观感与可复用性。
// 安装参考：
//  pnpm add framer-motion lucide-react
//  （如需 shadcn/ui：按照 https://ui.shadcn.com/ 指引初始化，再把 Button/Card/Input 等替换为项目内组件）

// 轻量通用 UI（内联 Tailwind），避免强依赖第三方组件库。
const Wrap: React.FC<{children: React.ReactNode, className?: string}> = ({ children, className = "" }) => (
  <div className={"mx-auto w-full max-w-7xl px-4 " + className}>{children}</div>
);
const Card: React.FC<{children: React.ReactNode, className?: string}> = ({ children, className = "" }) => (
  <div className={"rounded-2xl bg-white/5 backdrop-blur border border-white/10 shadow-lg " + className}>{children}</div>
);
const CardHeader: React.FC<{title?: React.ReactNode, desc?: React.ReactNode, right?: React.ReactNode, className?: string}> = ({ title, desc, right, className = "" }) => (
  <div className={"flex items-start justify-between gap-4 p-6 md:p-7 " + className}>
    <div>
      <div className="text-lg md:text-xl font-semibold text-white/95">{title}</div>
      {desc ? <div className="text-sm md:text-base text-white/60 mt-1">{desc}</div> : null}
    </div>
    {right}
  </div>
);
const CardBody: React.FC<{children: React.ReactNode, className?: string}> = ({ children, className = "" }) => (
  <div className={"p-6 md:p-7 pt-0 md:pt-0 " + className}>{children}</div>
);
const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: "solid" | "ghost" | "outline"}> = ({ className = "", variant = "solid", ...props }) => (
  <button
    {...props}
    className={[
      "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
      variant === "solid" && "bg-white text-black hover:bg-white/90",
      variant === "ghost" && "bg-transparent text-white hover:bg-white/10",
      variant === "outline" && "border border-white/20 text-white hover:bg-white/5",
      className,
    ].join(" ")}
  />
);
const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = "", ...props }) => (
  <input {...props} className={["w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/20", className].join(" ")} />
);
const SelectNative: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = "", children, ...props }) => (
  <select {...props} className={["w-full rounded-xl bg-white/5 border border-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20", className].join(" ")}>{children}</select>
);
const Badge: React.FC<{children: React.ReactNode, intent?: "ok"|"warn"|"muted"}> = ({ children, intent = "muted" }) => (
  <span className={[
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
    intent === "ok" && "bg-emerald-400/15 text-emerald-200 border border-emerald-400/30",
    intent === "warn" && "bg-amber-400/15 text-amber-200 border border-amber-400/30",
    intent === "muted" && "bg-white/10 text-white/70 border border-white/15",
  ].join(" ")}>{children}</span>
);

// 业务类型
type Exchange = "Binance" | "OKX";
interface AttestationRow {
  id: string;
  orderId: string;
  exchange: Exchange;
  pair: string;
  leverage: string;
  hours: string;
  network: "Base" | "Base Sepolia";
  status: "Pending" | "On-chain" | "Paid" | "Rejected";
  txHash?: string;
  createdAt: number;
}

function shortHash(h?: string) { return h ? `${h.slice(0, 6)}…${h.slice(-4)}` : ""; }
function nowFmt(ts: number) { const d = new Date(ts); return d.toLocaleString(); }

export default function AttestorLanding() {
  const [connected, setConnected] = useState(false);
  const [network, setNetwork] = useState<"Base" | "Base Sepolia">("Base");
  const [form, setForm] = useState({
    exchange: "Binance" as Exchange,
    orderId: "",
    pair: "BTC/USDT",
    leverage: "20x",
    hours: "24h",
  });
  const [rows, setRows] = useState<AttestationRow[]>([{
    id: "AT-001",
    orderId: "9238471982",
    exchange: "OKX",
    pair: "ETH/USDT",
    leverage: "10x",
    hours: "8h",
    status: "On-chain",
    network: "Base",
    txHash: "0x7fe3c2f7c2a9a3d1d9f8e1b5a3c9d1e2f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
    createdAt: Date.now() - 3600_000,
  }, {
    id: "AT-002",
    orderId: "7812399912",
    exchange: "Binance",
    pair: "BTC/USDT",
    leverage: "50x",
    hours: "24h",
    status: "Pending",
    network: "Base Sepolia",
    createdAt: Date.now() - 6_000,
  }]);
  const [copied, setCopied] = useState<string | null>(null);

  const pendingCount = useMemo(() => rows.filter(r => r.status === "Pending").length, [rows]);

  function submitAttestation(e: React.FormEvent) {
    e.preventDefault();
    const id = `AT-${String(rows.length + 1).padStart(3, "0")}`;
    const newRow: AttestationRow = {
      id,
      orderId: form.orderId || String(Math.floor(Math.random() * 1e10)),
      exchange: form.exchange,
      pair: form.pair,
      leverage: form.leverage,
      hours: form.hours,
      status: "Pending",
      network,
      createdAt: Date.now(),
    };
    setRows((prev) => [newRow, ...prev]);
  }

  function markOnChain(id: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status: "On-chain", txHash: "0x" + cryptoRandom(64) } : r));
  }
  function markPaid(id: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status: "Paid" } : r));
  }
  function cryptoRandom(len: number) { const chars = "abcdef0123456789"; return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(""); }
  function copy(text: string) { navigator.clipboard.writeText(text).then(() => { setCopied(text); setTimeout(() => setCopied(null), 1500); }); }

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(1200px_600px_at_10%_-10%,rgba(56,189,248,0.25),transparent),radial-gradient(900px_500px_at_90%_-20%,rgba(217,70,239,0.15),transparent),linear-gradient(180deg,#0b1020_0%,#0b0f1a_100%)] text-white">
      {/* 顶栏 */}
      <Wrap className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/10 grid place-items-center"><ShieldCheck size={18} /></div>
            <div className="text-lg md:text-xl font-semibold tracking-wide">LiqPass Attestor</div>
            <Badge intent="muted">Beta</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Badge intent="muted"><Network size={14} className="mr-1" />{network}</Badge>
            <SelectNative value={network} onChange={e => setNetwork(e.target.value as any)}>
              <option value="Base">Base</option>
              <option value="Base Sepolia">Base Sepolia</option>
            </SelectNative>
            <Button onClick={() => setConnected(v => !v)}>{connected ? <><CheckCheck size={16} /> 已连接</> : <><Wallet size={16} /> 连接钱包</>}</Button>
          </div>
        </div>
      </Wrap>

      {/* Hero */}
      <Wrap className="py-12 md:py-16">
        <div className="grid md:grid-cols-2 gap-6 md:gap-8 items-stretch">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <Card>
              <CardHeader title={<div className="flex items-center gap-2"><ShieldCheck size={18} />链上佐证与赔付可视化</div>} desc={<>
                在 Base 网络生成、查询并分享强平/爆仓相关 <span className="font-semibold text-white">Attestation</span>。
                支持 Binance/OKX 订单号，无需上传私钥。生成交易凭证后可上链存证。
              </>} right={<Badge intent="ok">{pendingCount} 待处理</Badge>} />
              <CardBody>
                <form onSubmit={submitAttestation} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-white/60 mb-1">交易所</div>
                    <SelectNative value={form.exchange} onChange={e => setForm(f => ({ ...f, exchange: e.target.value as Exchange }))}>
                      <option>Binance</option>
                      <option>OKX</option>
                    </SelectNative>
                  </div>
                  <div>
                    <div className="text-xs text-white/60 mb-1">订单号 / Order ID</div>
                    <Input placeholder="示例：7812399912" value={form.orderId} onChange={e => setForm(f => ({ ...f, orderId: e.target.value }))} />
                  </div>
                  <div>
                    <div className="text-xs text-white/60 mb-1">交易对</div>
                    <Input placeholder="BTC/USDT" value={form.pair} onChange={e => setForm(f => ({ ...f, pair: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-white/60 mb-1">杠杆</div>
                      <SelectNative value={form.leverage} onChange={e => setForm(f => ({ ...f, leverage: e.target.value }))}>
                        {["5x","10x","20x","50x","100x"].map(x => <option key={x}>{x}</option>)}
                      </SelectNative>
                    </div>
                    <div>
                      <div className="text-xs text-white/60 mb-1">保障时长</div>
                      <SelectNative value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}>
                        {["8h","24h","168h"].map(x => <option key={x}>{x}</option>)}
                      </SelectNative>
                    </div>
                  </div>
                  <div className="md:col-span-2 flex items-center justify-between gap-3">
                    <div className="text-white/60 text-sm">提交后生成本地凭证，审批通过再上链。不会上传任何 API Secret。</div>
                    <Button type="submit" className="whitespace-nowrap"><ArrowRight size={16} /> 生成佐证</Button>
                  </div>
                </form>
              </CardBody>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Card className="h-full">
              <CardHeader title={<div className="flex items-center gap-2"><Database size={18} />处理流程</div>} desc={<>
                透明流程，端到端可追踪：
              </>} />
              <CardBody className="pt-2">
                <ol className="space-y-4">
                  {[
                    { t: "接单与验证", d: "校验订单号、交易对、杠杆与保障时长" },
                    { t: "强平事件侦测", d: "JP Verify 服务轮询/回调，生成证据片段" },
                    { t: "生成 Merkle 证据", d: "对订单与事件进行哈希并聚合，准备上链" },
                    { t: "链上存证", d: "在 Base 发出 Attestation 交易" },
                    { t: "赔付与归档", d: "付款完成并归档，生成可审计日志" },
                  ].map((s, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-white/10 grid place-items-center border border-white/15">{i+1}</div>
                      <div>
                        <div className="font-medium text-white/90">{s.t}</div>
                        <div className="text-sm text-white/60">{s.d}</div>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 text-xs text-white/50">
                  JP Verify = 日本只读后端 · US Backend = 美国前端/赔付后端
                </div>
              </CardBody>
            </Card>
          </motion.div>
        </div>
      </Wrap>

      {/* 列表区 */}
      <Wrap className="pb-24">
        <div className="flex items-center justify-between mb-3">
          <div className="text-base md:text-lg font-semibold">最近的 Attestations</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setRows(r => [...r])}><RefreshCcw size={14} /> 刷新</Button>
            <Button variant="ghost"><Search size={14} /> 查询</Button>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/70">
              <tr>
                {"ID,交易所,订单号,交易对,杠杆,时长,网络,状态,交易".split(',').map((h, i) => (
                  <th key={i} className={["text-left px-4 py-3", i===0?"w-[100px]":"", i===8?"w-[150px]":""].join(" ")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-medium text-white/90">{r.id}</td>
                  <td className="px-4 py-3">{r.exchange}</td>
                  <td className="px-4 py-3">
                    <span className="text-white/80">{r.orderId}</span>
                    <button onClick={() => copy(r.orderId)} className="ml-2 text-white/50 hover:text-white/80"><Copy size={14} /></button>
                    {copied === r.orderId && <span className="ml-2 text-emerald-300/80">已复制</span>}
                  </td>
                  <td className="px-4 py-3">{r.pair}</td>
                  <td className="px-4 py-3">{r.leverage}</td>
                  <td className="px-4 py-3">{r.hours}</td>
                  <td className="px-4 py-3">{r.network}</td>
                  <td className="px-4 py-3">
                    {r.status === "Paid" && <Badge intent="ok">已赔付</Badge>}
                    {r.status === "On-chain" && <Badge intent="muted">已上链</Badge>}
                    {r.status === "Pending" && <Badge intent="warn">待处理</Badge>}
                    {r.status === "Rejected" && <Badge intent="muted">已拒绝</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    {r.txHash ? (
                      <a href={`https://basescan.org/tx/${r.txHash}`} target="_blank" className="inline-flex items-center gap-1 text-white/80 hover:text-white">
                        <LinkIcon size={14} /> {shortHash(r.txHash)}
                      </a>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => markOnChain(r.id)}>标记上链</Button>
                        <Button variant="outline" onClick={() => markPaid(r.id)}>标记赔付</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Wrap>

      {/* SVG 架构图 */}
      <div className="bg-white/5 border-t border-white/10">
        <Wrap className="py-12">
          <div className="text-base md:text-lg font-semibold mb-4 flex items-center gap-2"><Network size={18}/>系统架构（示意）</div>
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/20">
            <svg viewBox="0 0 1200 420" className="w-full h-[320px]">
              {/* 背景网格 */}
              <defs>
                <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid)" />
              {/* 节点 */}
              {[
                { x: 120, y: 70, w: 240, h: 90, title: "US Frontend", sub: "Vite + React" },
                { x: 120, y: 210, w: 240, h: 90, title: "US Backend", sub: "Express + SQLite" },
                { x: 480, y: 140, w: 240, h: 120, title: "JP Verify", sub: "只读验证服务" },
                { x: 840, y: 140, w: 240, h: 120, title: "Base Network", sub: "Attestation 上链" },
              ].map((n, i) => (
                <g key={i}>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="18" ry="18" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" />
                  <text x={n.x + n.w/2} y={n.y + 40} textAnchor="middle" fill="white" fontSize="16" fontWeight="600">{n.title}</text>
                  <text x={n.x + n.w/2} y={n.y + 68} textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="12">{n.sub}</text>
                </g>
              ))}
              {/* 连线 */}
              <g stroke="rgba(255,255,255,0.35)" strokeWidth="2">
                <path d="M360 115 C 400 115, 440 115, 480 170" fill="none"/>
                <path d="M360 255 C 420 255, 440 255, 480 210" fill="none"/>
                <path d="M720 200 C 760 200, 800 200, 840 200" fill="none"/>
                <path d="M720 200 C 760 230, 800 230, 840 230" fill="none"/>
              </g>
              {/* 箭头 */}
              {[[480,170, 8, -12],[480,210, 8, 12],[840,200, 10,0],[840,230, 10,0]].map((a,i)=> (
                <polygon key={i} points={`${a[0]},${a[1]} ${a[0]-a[2]},${a[1]-6} ${a[0]-a[2]},${a[1]+6}`} fill="rgba(255,255,255,0.6)" />
              ))}
              {/* 文字说明 */}
              <text x="100" y="28" fill="rgba(255,255,255,0.7)" fontSize="12">数据流：前端 → US 后端 → JP Verify → Base</text>
            </svg>
          </div>
        </Wrap>
      </div>

      {/* 页脚 */}
      <Wrap className="py-10">
        <div className="flex flex-col md:flex-row items-center gap-3 justify-between text-white/50 text-sm">
          <div>© {new Date().getFullYear()} LiqPass / LeverageGuard · Attestor UI</div>
          <div className="flex items-center gap-4">
            <a className="hover:text-white" href="https://basescan.org" target="_blank" rel="noreferrer">BaseScan</a>
            <a className="hover:text-white" href="https://github.com/wjz5788/leverageguard-attestor" target="_blank" rel="noreferrer">Repo</a>
          </div>
        </div>
      </Wrap>
    </div>
  );
}
