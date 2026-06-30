
# US 服务器测试与部署最小手册

> 目标：本地与 US 服务器快速验证 JP 验证服务与 US 后端联通性。

## 0) 前提

- Python ≥ 3.9
- 服务器已放行对应端口（默认 JP `8082`，本地前端测试 `8080`）

## 1) 复制文件

```bash
# 本地下载后，自行修改 user@host 与目录
scp us_server_test.py us_api_gateway_test.py us_frontend_test.html requirements.txt US_SERVER_DEPLOYMENT.md user@your-us-server:/opt/liqpass-test/
```

## 2) 安装依赖

```bash
cd /opt/liqpass-test
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 3) JP 验证服务连通性（从 US 服务器发起）

```bash
python3 us_server_test.py --base http://103.76.85.191:8082 --paths /health --tcp 103.76.85.191:8082
```

输出 `RESULT=PASS` 即可。

## 4) US 后端连通性（如果已运行）

```bash
# 假设 US 后端监听 :8081，先跑健康检查
python3 us_api_gateway_test.py --base http://127.0.0.1:8081 --paths /health
```

## 5) 前端可视化连通性

```bash
# 在 US 服务器或本地任意目录
python3 -m http.server 8080
# 浏览器访问：
#   http://<服务器IP>:8080/us_frontend_test.html
# 在页面输入 Base URL（默认 http://103.76.85.191:8082）与 Path（默认 /health）后点击 GET
```

## 6) 常见问题

- 连接被拒：确认目标服务绑定 `0.0.0.0`，且防火墙/安全组已放行端口。
- 超时：确认公网 IP 可达，`curl -v http://IP:PORT/health` 辅助定位。
- 404：仅表明路径不存在，先用 `/health` 验证基础连通。
