# 视频源测速工具

一个部署在 Cloudflare Workers 上的视频源测速工具，支持测试视频源的响应时间、下载速度和码率。

## 功能特点

- **响应时间测试**：测试视频源的连接速度
- **下载速度测试**：实际下载部分数据计算真实速度
- **码率计算**：自动计算视频码率（Mbps）
- **批量测试**：支持同时测试多个视频源
- **实时进度**：使用 SSE 流式返回测试进度
- **结果排序**：按下载速度自动排序
- **数据导出**：支持导出测速结果为 JSON

## 使用方法

### 1. 在线使用

访问部署后的网址，有两种方式输入视频源：

**方式一：输入订阅地址**
```
https://tv.ztt.qzz.io/db.json
```

**方式二：直接粘贴 JSON 数据**
```json
[
  {"url": "http://example1.com/video.m3u8", "name": "示例源1"},
  {"url": "http://example2.com/video.m3u8", "name": "示例源2"}
]
```

### 2. 测速结果

测速完成后会显示：

- **总数量**：测试的视频源总数
- **成功/失败**：成功和失败的数量
- **平均速度**：所有成功源的平均下载速度
- **最高速度**：最快的下载速度
- **详细列表**：每个源的详细测速结果

## 部署到 Cloudflare Workers

### 前置要求

- Node.js 18+
- Cloudflare 账号
- Wrangler CLI

### 部署步骤

1. **安装依赖**
```bash
npm install
```

2. **登录 Cloudflare**
```bash
npx wrangler login
```

3. **部署**
```bash
npx wrangler deploy
```

部署成功后会显示 Worker 的 URL，例如：
```
https://source-speed-test.你的账号.workers.dev
```

## 本地开发

```bash
# 启动本地开发服务器
npx wrangler dev

# 访问 http://localhost:8787
```

## API 接口

### 获取订阅

```
GET /api/fetch?url=<订阅地址>
```

返回：
```json
[
  {"url": "...", "name": "..."}
]
```

### 测速

```
POST /api/test
Content-Type: application/json

{
  "sources": [
    {"url": "...", "name": "..."}
  ]
}
```

返回（SSE 流式）：
```
data: {"type": "progress", "current": 1, "total": 10, "name": "源名称"}

data: {"type": "complete", "results": [...]}
```

## 测速原理

1. **响应时间测试**
   - 发送 HEAD 请求
   - 计算从发送请求到收到响应的时间

2. **下载速度测试**
   - 发送 GET 请求，使用 Range 头只下载 1MB 数据
   - 计算下载速度 = 下载字节数 / 下载时间

3. **码率计算**
   - 码率 = 下载速度 × 8
   - 单位：Mbps

## 注意事项

- 测速会实际下载部分数据，请确保视频源允许
- 超时时间默认为 10 秒
- 部分视频源可能不支持 Range 请求，会下载完整文件
- Cloudflare Workers 有 CPU 时间限制，测试大量源时可能需要分批

## 自定义配置

可以在代码中修改 `DEFAULT_CONFIG`：

```typescript
const DEFAULT_CONFIG: TestConfig = {
  timeout: 10000,        // 超时时间（毫秒）
  testSize: 1024 * 1024, // 测试下载大小（字节）
};
```

## 许可证

MIT
