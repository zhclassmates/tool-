# LiqPass Contracts & Deploy (Allowance) — Base Mainnet

> 方案：Allowance（approve + transferFrom）+ 事件回填。包含 **两个合约**、**Hardhat 工程**、**部署脚本**、**校验命令**、**最小自测**。

---

## 0) 固定地址与角色映射（Base 主网）
- **USDC**：`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **TREASURY**：`0xaa1f4df6fc3ad033cc71d561689189d11ab54f4b`
- **ADMIN (Owner)**：`0x636748d29ed12762a29359ad68c481ac79ebcdc7`
- **ATTESTOR (锚定机器人)**：`0x00195ecf4ff21ab985b13fc741cdf276c71d88a1`
- **TREASURER (资金操作)**：`0xeec2b8275d36837d27f94df28110e0dd7b6763f3`

> 若后续要更换角色：`CheckoutUSDC` 的 `owner` 可转移；`LiqPassClaims` 里可增/撤角色（AccessControl）。

---

## 1) 合约：`contracts/CheckoutUSDC.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CheckoutUSDC (Allowance 路线：approve + transferFrom)
/// @dev 职责：把保费从买家直接划入 TREASURY，并发 PremiumPaid 事件用于后端回填
contract CheckoutUSDC is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable USDC; // Base USDC
    address public treasury;      // 收保费的金库地址

    /// @dev 订单支付事件，后端**只信这个事件**回填订单
    event PremiumPaid(bytes32 indexed orderId, address indexed buyer, uint256 amount, bytes32 quoteHash);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event EmergencyWithdraw(address indexed to, address indexed token, uint256 amount);

    constructor(address usdc_, address treasury_) Ownable(msg.sender) {
        require(usdc_ != address(0) && treasury_ != address(0), "zero addr");
        USDC = IERC20(usdc_);
        treasury = treasury_;
    }

    function updateTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "zero addr");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice 用户先 approve，再调用本函数
    /// @param orderId 订单 ID（建议 keccak(UUID) 传 bytes32）
    /// @param amount  微 USDC（6 位）
    /// @param quoteHash 报价快照哈希（审计用）
    function buyPolicy(bytes32 orderId, uint256 amount, bytes32 quoteHash)
        external
        nonReentrant
        whenNotPaused
    {
        require(amount > 0, "amount=0");
        // 直接打金库，减少中间账户与匹配复杂度
        USDC.safeTransferFrom(msg.sender, treasury, amount);
        emit PremiumPaid(orderId, msg.sender, amount, quoteHash);
    }

    /// @dev 理论上不会留存 USDC；仅作容错
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero to");
        IERC20(token).transfer(to, amount);
        emit EmergencyWithdraw(to, token, amount);
    }
}
```

---

## 2) 合约：`contracts/LiqPassClaims.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title LiqPassClaims
/// @notice 证据上链=Attestor 24h 固化窗口 Merkle Root；理赔=用户提交 MerkleProof 验证后从池子打款
contract LiqPassClaims is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ATTESTOR_ROLE  = keccak256("ATTESTOR_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    IERC20 public immutable USDC; // Base USDC

    struct RootInfo {
        bytes32 root;       // Merkle Root
        bytes32 metaHash;   // 证据 JSON 摘要的哈希
        uint64  attestedAt; // 上链时间
    }

    // windowId（例如 UTC 自然日 20251105） => RootInfo
    mapping(uint64 => RootInfo) public windows;
    // 防重放：已兑付的 leaf
    mapping(bytes32 => bool) public leafClaimed;

    event RootAttested(uint64 indexed windowId, bytes32 indexed root, bytes32 metaHash, address indexed attestor);
    event PayoutClaimed(uint64 indexed windowId, address indexed user, bytes32 indexed orderIdHash, uint256 payout, bytes32 leaf);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    constructor(address usdc_, address admin, address attestor, address treasurer) {
        require(usdc_ != address(0) && admin != address(0), "zero addr");
        USDC = IERC20(usdc_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (attestor != address(0))   _grantRole(ATTESTOR_ROLE, attestor);
        if (treasurer != address(0))  _grantRole(TREASURER_ROLE, treasurer);
    }

    // -------- Attestation --------
    function attestRoot(uint64 windowId, bytes32 root, bytes32 metaHash)
        external
        onlyRole(ATTESTOR_ROLE)
    {
        require(root != bytes32(0), "empty root");
        require(windows[windowId].root == bytes32(0), "root exists");
        windows[windowId] = RootInfo({root: root, metaHash: metaHash, attestedAt: uint64(block.timestamp)});
        emit RootAttested(windowId, root, metaHash, msg.sender);
    }

    // -------- Claim --------
    struct ClaimLeaf {
        address user;          // 领款地址
        bytes32 orderIdHash;   // 订单 ID 哈希
        uint256 payout;        // 微 USDC
        uint64  windowId;      // 对应窗口
        bytes32 evidenceHash;  // 证据 JSON 哈希
        uint256 deadline;      // 过期时间
        bytes32 nonce;         // 防碰撞
    }

    function leafOf(ClaimLeaf calldata c) public view returns (bytes32) {
        // 绑定 chainId/合约/USDC，防跨链/跨合约/换 token 重放
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(USDC),
                c.user,
                c.orderIdHash,
                c.payout,
                c.windowId,
                c.evidenceHash,
                c.deadline,
                c.nonce
            )
        );
    }

    function claim(ClaimLeaf calldata c, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
    {
        require(c.user == msg.sender, "not claimant");
        require(c.payout > 0, "payout=0");
        require(block.timestamp <= c.deadline, "expired");

        RootInfo memory info = windows[c.windowId];
        require(info.root != bytes32(0), "root not attested");

        bytes32 leaf = leafOf(c);
        require(!leafClaimed[leaf], "already claimed");
        require(MerkleProof.verify(proof, info.root, leaf), "invalid proof");

        leafClaimed[leaf] = true;
        USDC.safeTransfer(c.user, c.payout);
        emit PayoutClaimed(c.windowId, c.user, c.orderIdHash, c.payout, leaf);
    }

    // -------- Treasury ops --------
    function deposit(uint256 amount) external onlyRole(TREASURER_ROLE) {
        require(amount > 0, "amount=0");
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(address to, uint256 amount) external onlyRole(TREASURER_ROLE) {
        require(to != address(0), "zero to");
        USDC.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    // -------- Admin controls --------
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); emit Paused(msg.sender); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); emit Unpaused(msg.sender); }
}
```

---

## 3) Hardhat 工程（JS 版，最简）

### `package.json`
```json
{
  "name": "liqpass-contracts",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "compile": "hardhat compile",
    "deploy:base": "hardhat run scripts/deploy.js --network base",
    "verify:base": "hardhat verify --network base"
  },
  "devDependencies": {
    "@nomicfoundation/hardhat-toolbox": "^5.0.0",
    "hardhat": "^2.22.9",
    "dotenv": "^16.4.5"
  },
  "dependencies": {
    "@openzeppelin/contracts": "^5.0.2"
  }
}
```

### `hardhat.config.js`
```js
require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    base: {
      url: process.env.RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : []
    }
  },
  etherscan: {
    apiKey: {
      base: process.env.BASESCAN_API_KEY || ""
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org"
        }
      }
    ]
  }
};
```

### `scripts/deploy.js`
```js
const fs = require("fs");

const ADDR = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  TREASURY: "0xaa1f4df6fc3ad033cc71d561689189d11ab54f4b",
  ADMIN: "0x636748d29ed12762a29359ad68c481ac79ebcdc7",
  ATTESTOR: "0x00195ecf4ff21ab985b13fc741cdf276c71d88a1",
  TREASURER: "0xeec2b8275d36837d27f94df28110e0dd7b6763f3"
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  // 1) CheckoutUSDC
  const Checkout = await ethers.getContractFactory("CheckoutUSDC");
  const checkout = await Checkout.deploy(ADDR.USDC, ADDR.TREASURY);
  await checkout.waitForDeployment();
  const checkoutAddr = await checkout.getAddress();
  console.log("CheckoutUSDC:", checkoutAddr);

  // 2) LiqPassClaims
  const Claims = await ethers.getContractFactory("LiqPassClaims");
  const claims = await Claims.deploy(ADDR.USDC, ADDR.ADMIN, ADDR.ATTESTOR, ADDR.TREASURER);
  await claims.waitForDeployment();
  const claimsAddr = await claims.getAddress();
  console.log("LiqPassClaims:", claimsAddr);

  // 保存地址
  const out = { network: "base", checkout: checkoutAddr, claims: claimsAddr, ...ADDR };
  fs.writeFileSync("addresses.json", JSON.stringify(out, null, 2));
  console.log("Saved addresses.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### `.env.example`
```
RPC_URL=https://mainnet.base.org
DEPLOYER_PK=0xYOUR_PRIVATE_KEY
BASESCAN_API_KEY=YOUR_BASESCAN_KEY
```

---

## 4) 一键命令
```bash
# 进入工程
npm i

# 编译
npm run compile

# 部署到 Base 主网（需 .env 就绪）
npm run deploy:base

# 验证（替换 <ADDR> 为输出中的地址）
# CheckoutUSDC 验证：
npx hardhat verify --network base <ADDR_CHECKOUT> \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0xaa1f4df6fc3ad033cc71d561689189d11ab54f4b

# LiqPassClaims 验证：
npx hardhat verify --network base <ADDR_CLAIMS> \
  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  0x636748d29ed12762a29359ad68c481ac79ebcdc7 \
  0x00195ecf4ff21ab985b13fc741cdf276c71d88a1 \
  0xeec2b8275d36837d27f94Df28110e0dd7b6763f3
```

---

## 5) 最小自测（链上）
1. 用 `ADMIN` 地址调用 `pause/unpause` 检查权限；
2. 用用户地址：`approve(CHECKOUT, 5_000_000)`（= 5 USDC 微单位），随后调用 `buyPolicy(orderId, 5_000_000, quoteHash)`；
3. 观察 **USDC.Transfer**（to = TREASURY）+ `PremiumPaid` 事件；
4. 给 `LiqPassClaims` 充值：让 `TREASURER` 先 `approve(USDC, claims)`，再 `deposit(amount)`；
5. 任选一个 `windowId`，由 `ATTESTOR` 调用 `attestRoot(windowId, root, metaHash)`；
6. 用匹配的 `leaf` + `proof` 执行 `claim`，收到 USDC。

---

## 6) 事件签名（后端监听用）
- `PremiumPaid(bytes32,address,uint256,bytes32)`
- `Transfer(address,address,uint256)`（USDC）
- `RootAttested(uint64,bytes32,bytes32,address)`
- `PayoutClaimed(uint64,address,bytes32,uint256,bytes32)`

> 后端只以事件为真源：实时订阅 + 区块段补偿扫描（以 `(txHash, logIndex)` 幂等）。

---

## 7) 备注
- 全链路金额单位：**微 USDC**（int）。
- 如需加入 **EIP‑712 凭证**或 **Permit2**，在此基线上增量改，不影响监听与对账。



---

## 8) Remix 部署指南（Base 主网）
> 适合“先上线再优化”。无需本地环境，直接用浏览器 + MetaMask。

### A. 准备 MetaMask 网络
1. 在 MetaMask 添加网络：
   - Network Name: `Base Mainnet`
   - RPC URL: `https://mainnet.base.org`
   - Chain ID: `8453`
   - Currency Symbol: `ETH`
   - Block Explorer: `https://basescan.org`
2. 准备少量 ETH 作为 gas。

### B. 在 Remix 导入与编译
1. 打开 https://remix.ethereum.org → `File Explorers` → `Create New File`：
   - `contracts/CheckoutUSDC.sol`
   - `contracts/LiqPassClaims.sol`
2. 将右侧画布中的两份合约代码分别粘贴进去。
3. **如果出现 `import not found`**，请把两份合约里的 OpenZeppelin `import` 改为 GitHub 固定版本（示例，v5.0.2）：
   ```solidity
   // 在 CheckoutUSDC.sol 和 LiqPassClaims.sol 顶部，用下列 URL 导入
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/token/ERC20/IERC20.sol";
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/token/ERC20/utils/SafeERC20.sol";
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/access/Ownable.sol";         // 仅 CheckoutUSDC 用
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/utils/Pausable.sol";
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/utils/ReentrancyGuard.sol";
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/access/AccessControl.sol";   // 仅 LiqPassClaims 用
   import "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.0.2/contracts/utils/cryptography/MerkleProof.sol"; // 仅 LiqPassClaims 用
   ```
4. 进入 `Solidity Compiler` 面板：
   - Compiler: `0.8.24`
   - EVM Version: `default`
   - Enable Optimizer: `true`，Runs: `200`
   - 点击 `Compile`。

### C. 部署 CheckoutUSDC（收保费合约）
1. 打开 `Deploy & Run Transactions` 面板：
   - Environment 选 `Injected Provider - MetaMask`（确保是 Base 主网）。
   - 合约选择 `CheckoutUSDC`。
2. 构造函数参数：
   - `usdc_`：`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - `treasury_`：`0xaa1f4df6fc3ad033cc71d561689189d11ab54f4b`
3. 点击 `Deploy` 并在 MetaMask 确认。
4. 记录 `CheckoutUSDC` 地址（下方 Deployed Contracts 会显示）。

### D. 部署 LiqPassClaims（锚定+理赔合约）
1. 在同面板切换合约为 `LiqPassClaims`。
2. 构造函数参数：
   - `usdc_`：`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - `admin`：`0x636748d29ed12762a29359ad68c481ac79ebcdc7`
   - `attestor`：`0x00195ecf4ff21ab985b13fc741cdf276c71d88a1`
   - `treasurer`：`0xeec2b8275d36837d27f94df28110e0dd7b6763f3`
3. `Deploy` 并记录地址。

### E. 快速自测（Remix 里直接操作）
**支付闭环**（Allowance 路线）：
1. 切换到你的用户地址（买家）。
2. 在 Remix 里 `At Address` 加载 USDC 合约：在 `Contract` 下拉选 `IERC20`，填入 USDC 地址 → `At Address`。
3. 调用 USDC 的 `approve(spender, amount)`：
   - `spender` = `CheckoutUSDC` 地址
   - `amount` = 微 USDC，如 `5000000`（= 5 USDC）
4. 切回 `CheckoutUSDC` 合约实例，调用 `buyPolicy(orderId, amount, quoteHash)`：
   - `orderId`：32字节哈希（示例：`0x0000000000000000000000000000000000000000000000000000000000000001`）
   - `amount`：与上一步一致，如 `5000000`
   - `quoteHash`：32字节哈希（可先随意占位同上）
5. 交易成功后，在 BaseScan 查看该 `buyPolicy` 交易，确认 USDC 的 `Transfer`（to=TREASURY）与 `PremiumPaid` 事件。

**理赔资金与锚定**：
1. 让 `TREASURER` 地址在 USDC 上对 `LiqPassClaims` 调 `approve(claims, amount)`；再在 `LiqPassClaims` 调 `deposit(amount)` 注入赔付池。
2. 用 `ATTESTOR` 地址在 `LiqPassClaims` 调 `attestRoot(windowId, root, metaHash)`（`windowId` 建议用 UTC 自然日，如 `20251106`）。
3. 之后可用合法的 `ClaimLeaf + proof[]` 调 `claim(...)` 领取赔付（开发期可先跑通资金流，不必立刻做真实 Merkle）。

### F. 验证合约（可选，但强烈建议）
**方法 1：Sourcify（最省心）**
- 在 `Solidity Compiler` 的 `Compilation details` → 勾选 `Auto publish to IPFS`，成功发布后，Sourcify 会自动尝试匹配与验证（需要你的源码对外可访问且设置一致）。

**方法 2：BaseScan 手工验证**
1. 在 Remix 安装 `Flattener` 插件或使用 `Flatten` 功能，将两个合约分别生成 `*-flat.sol`。
2. 打开 BaseScan 对应合约地址 → `Code` → `Verify and Publish`：
   - Compiler：`0.8.24`
   - Optimization：`Yes`，Runs=`200`
   - 粘贴 `*-flat.sol` 源码。
   - Constructor Args：按提示填入（两个地址、或四个地址）。
3. 提交后等待通过。

### G. 常见坑位 & 解决
- **import not found**：改为上面的 GitHub 固定版本 URL 导入。
- **Wrong constructor arguments**：检查 BaseScan 验证页面是否按顺序填写参数（与本指南 C/D 部署参数一致）。
- **MetaMask 不是 Base**：确认 `Injected Provider` 已切换网络至 `Base Mainnet`。

> 完成后，前端即可按 Allowance 流接入：`approve(Checkout, amount)` → `buyPolicy(...)`。后端以 `PremiumPaid`/USDC `Transfer` 事件为唯一可信源做回填与对账。

