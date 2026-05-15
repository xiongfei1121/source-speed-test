/**
 * 视频源测速 Worker
 * 支持测试视频源的响应时间、下载速度和码率
 */

export interface Env {
  // 环境变量（如果需要）
}

interface VideoSource {
  url: string;
  name?: string;
  type?: string;
  [key: string]: any;
}

interface TVBoxSite {
  key?: string;
  name?: string;
  api?: string;
  url?: string;
  type?: number;
  [key: string]: any;
}

interface TVBoxConfig {
  spider?: string;
  sites?: TVBoxSite[];
  [key: string]: any;
}

interface SpeedTestResult {
  url: string;
  name: string;
  success: boolean;
  responseTime?: number; // ms
  downloadSpeed?: number; // MB/s
  bitrate?: number; // Mbps
  error?: string;
  testTime: string;
}

interface TestConfig {
  timeout: number; // 超时时间（毫秒）
  testSize: number; // 测试下载大小（字节）
}

const DEFAULT_CONFIG: TestConfig = {
  timeout: 10000, // 10秒超时
  testSize: 1024 * 1024, // 下载1MB数据测速
};

/**
 * 判断是否为 API 源
 */
function isApiSource(url: string): boolean {
  return url.includes('/api/') || url.includes('?token=') || url.includes('source/');
}

/**
 * 测试 API 源
 */
async function testApiSource(
  source: VideoSource,
  config: TestConfig
): Promise<SpeedTestResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const startTime = Date.now();
    
    // API 源使用 GET 请求测试
    const response = await fetch(source.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
      },
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // 读取响应数据
    const contentType = response.headers.get('content-type') || '';
    let downloadedBytes = 0;

    if (contentType.includes('application/json')) {
      // JSON 响应
      const data = await response.json();
      downloadedBytes = JSON.stringify(data).length;
    } else {
      // 其他响应，读取部分数据
      const reader = response.body?.getReader();
      if (reader) {
        const { value } = await reader.read();
        downloadedBytes = value?.length || 0;
        reader.releaseLock();
      }
    }

    clearTimeout(timeoutId);

    // API 源不计算下载速度，只记录响应时间
    return {
      url: source.url,
      name: source.name || source.url,
      success: true,
      responseTime,
      downloadSpeed: 0,
      bitrate: 0,
      testTime: new Date().toISOString(),
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    return {
      url: source.url,
      name: source.name || source.url,
      success: false,
      error: error.message || 'Unknown error',
      testTime: new Date().toISOString(),
    };
  }
}

/**
 * 测试视频文件源
 */
async function testVideoSource(
  source: VideoSource,
  config: TestConfig
): Promise<SpeedTestResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    // 1. 测试响应时间（HEAD请求）
    const headStart = Date.now();
    const headResponse = await fetch(source.url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const responseTime = Date.now() - headStart;

    if (!headResponse.ok) {
      throw new Error(`HTTP ${headResponse.status}: ${headResponse.statusText}`);
    }

    // 2. 测试下载速度（GET请求，下载部分数据）
    const downloadStart = Date.now();
    const getResponse = await fetch(source.url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Range: `bytes=0-${config.testSize - 1}`, // 只下载指定大小
      },
    });

    if (!getResponse.ok && getResponse.status !== 206) {
      throw new Error(`Download failed: HTTP ${getResponse.status}`);
    }

    // 读取数据
    const reader = getResponse.body?.getReader();
    let downloadedBytes = 0;

    if (reader) {
      while (downloadedBytes < config.testSize) {
        const { done, value } = await reader.read();
        if (done) break;
        downloadedBytes += value.length;
      }
      reader.releaseLock();
    }

    const downloadTime = Date.now() - downloadStart;
    clearTimeout(timeoutId);

    // 计算速度
    const downloadSpeed = downloadedBytes / (downloadTime / 1000) / (1024 * 1024); // MB/s
    const bitrate = downloadSpeed * 8; // Mbps

    return {
      url: source.url,
      name: source.name || source.url,
      success: true,
      responseTime,
      downloadSpeed: Math.round(downloadSpeed * 100) / 100,
      bitrate: Math.round(bitrate * 100) / 100,
      testTime: new Date().toISOString(),
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    return {
      url: source.url,
      name: source.name || source.url,
      success: false,
      error: error.message || 'Unknown error',
      testTime: new Date().toISOString(),
    };
  }
}

/**
 * 测试单个视频源
 */
async function testSource(
  source: VideoSource,
  config: TestConfig = DEFAULT_CONFIG
): Promise<SpeedTestResult> {
  // 判断源类型并使用不同的测试方式
  if (isApiSource(source.url)) {
    return testApiSource(source, config);
  } else {
    return testVideoSource(source, config);
  }
}

/**
 * 批量测试视频源
 */
async function testSources(
  sources: VideoSource[],
  config: TestConfig = DEFAULT_CONFIG
): Promise<SpeedTestResult[]> {
  // 并发测试所有源
  const results = await Promise.all(
    sources.map((source) => testSource(source, config))
  );

  // 按下载速度排序（成功的在前）
  return results.sort((a, b) => {
    if (a.success && !b.success) return -1;
    if (!a.success && b.success) return 1;
    if (a.success && b.success) {
      return (b.downloadSpeed || 0) - (a.downloadSpeed || 0);
    }
    return 0;
  });
}

/**
 * 解析 TVBox 配置，提取视频源
 */
function parseTVBoxConfig(data: any): VideoSource[] {
  const sources: VideoSource[] = [];

  // 如果是数组，直接返回
  if (Array.isArray(data)) {
    return data.map((item) => ({
      url: item.url || item.api || '',
      name: item.name || item.key || item.url || 'Unknown',
      type: item.type,
      ...item,
    }));
  }

  // 如果是 TVBox 配置对象
  if (data && typeof data === 'object') {
    // 提取 sites 数组
    if (Array.isArray(data.sites)) {
      data.sites.forEach((site: TVBoxSite) => {
        const url = site.api || site.url || '';
        if (url) {
          sources.push({
            url,
            name: site.name || site.key || url,
            type: site.type?.toString(),
            ...site,
          });
        }
      });
    }
  }

  return sources;
}

/**
 * HTML 页面
 */
function getHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>视频源测速工具</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }
    
    .header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
    }
    
    .header p {
      font-size: 1.1em;
      opacity: 0.9;
    }
    
    .card {
      background: white;
      border-radius: 16px;
      padding: 30px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      margin-bottom: 20px;
    }
    
    .input-group {
      margin-bottom: 20px;
    }
    
    .input-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #333;
    }
    
    .input-group input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
    }
    
    .input-group input:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .textarea-group {
      margin-bottom: 20px;
    }
    
    .textarea-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #333;
    }
    
    .textarea-group textarea {
      width: 100%;
      min-height: 200px;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      resize: vertical;
      transition: border-color 0.3s;
    }
    
    .textarea-group textarea:focus {
      outline: none;
      border-color: #667eea;
    }
    
    .btn-group {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
    }
    
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    .btn-secondary {
      background: #f5f5f5;
      color: #333;
    }
    
    .btn-secondary:hover {
      background: #e0e0e0;
    }
    
    .loading {
      display: none;
      text-align: center;
      padding: 40px;
    }
    
    .loading.active {
      display: block;
    }
    
    .spinner {
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    
    .progress {
      margin-top: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      font-size: 14px;
      color: #666;
    }
    
    .results {
      display: none;
    }
    
    .results.active {
      display: block;
    }
    
    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    
    .results-header h2 {
      color: #333;
      font-size: 1.5em;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 12px;
      text-align: center;
    }
    
    .stat-value {
      font-size: 2em;
      font-weight: 700;
      margin-bottom: 5px;
    }
    
    .stat-label {
      font-size: 0.9em;
      opacity: 0.9;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }
    
    thead {
      background: #f8f9fa;
    }
    
    th, td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    
    th {
      font-weight: 600;
      color: #333;
      cursor: pointer;
      user-select: none;
    }
    
    th:hover {
      background: #e9ecef;
    }
    
    tbody tr:hover {
      background: #f8f9fa;
    }
    
    .status-success {
      color: #28a745;
      font-weight: 600;
    }
    
    .status-failed {
      color: #dc3545;
      font-weight: 600;
    }
    
    .speed-bar {
      width: 100px;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
      display: inline-block;
      vertical-align: middle;
      margin-left: 10px;
    }
    
    .speed-fill {
      height: 100%;
      background: linear-gradient(90deg, #28a745 0%, #ffc107 50%, #dc3545 100%);
      transition: width 0.3s;
    }
    
    .error-msg {
      color: #dc3545;
      font-size: 0.9em;
      margin-top: 5px;
    }
    
    .footer {
      text-align: center;
      color: white;
      margin-top: 30px;
      opacity: 0.8;
      font-size: 0.9em;
    }
    
    @media (max-width: 768px) {
      .header h1 {
        font-size: 1.8em;
      }
      
      .card {
        padding: 20px;
      }
      
      table {
        font-size: 14px;
      }
      
      th, td {
        padding: 8px 12px;
      }
      
      .stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 视频源测速工具</h1>
      <p>快速测试视频源响应时间和下载速度</p>
    </div>
    
    <div class="card">
      <div class="input-group">
        <label>订阅地址（JSON格式）</label>
        <input type="text" id="urlInput" placeholder="https://tv.ztt.qzz.io/db.json" value="https://tv.ztt.qzz.io/db.json">
      </div>
      
      <div class="textarea-group">
        <label>或直接粘贴 JSON 数据</label>
        <textarea id="jsonInput" placeholder='[
  {"url": "http://example.com/video.m3u8", "name": "示例源1"},
  {"url": "http://example2.com/video.m3u8", "name": "示例源2"}
]'></textarea>
      </div>
      
      <div class="btn-group">
        <button class="btn btn-primary" id="testBtn" onclick="startTest()">开始测速</button>
        <button class="btn btn-secondary" onclick="loadFromUrl()">从URL加载</button>
        <button class="btn btn-secondary" onclick="clearResults()">清空结果</button>
      </div>
    </div>
    
    <div class="card loading" id="loading">
      <div class="spinner"></div>
      <p>正在测速中，请稍候...</p>
      <div class="progress" id="progress">准备开始...</div>
    </div>
    
    <div class="card results" id="results">
      <div class="results-header">
        <h2>测速结果</h2>
        <button class="btn btn-secondary" onclick="exportResults()">导出结果</button>
      </div>
      
      <div class="stats" id="stats"></div>
      
      <table id="resultsTable">
        <thead>
          <tr>
            <th onclick="sortTable(0)">排名</th>
            <th onclick="sortTable(1)">名称</th>
            <th onclick="sortTable(2)">状态</th>
            <th onclick="sortTable(3)">响应时间</th>
            <th onclick="sortTable(4)">下载速度</th>
            <th onclick="sortTable(5)">码率</th>
            <th>速度指示</th>
          </tr>
        </thead>
        <tbody id="resultsBody"></tbody>
      </table>
    </div>
    
    <div class="footer">
      <p>Powered by Cloudflare Workers | 视频源测速工具</p>
    </div>
  </div>
  
  <script>
    let testResults = [];
    
    // 解析配置（支持数组和 TVBox 配置）
    function parseConfig(data) {
      // 如果是数组，直接返回
      if (Array.isArray(data)) {
        return data.map((item) => ({
          url: item.url || item.api || '',
          name: item.name || item.key || item.url || 'Unknown',
          ...item,
        }));
      }
      
      // 如果是 TVBox 配置对象
      if (data && typeof data === 'object') {
        const sources = [];
        
        // 提取 sites 数组
        if (Array.isArray(data.sites)) {
          data.sites.forEach((site) => {
            const url = site.api || site.url || '';
            if (url) {
              sources.push({
                url,
                name: site.name || site.key || url,
                ...site,
              });
            }
          });
        }
        
        return sources;
      }
      
      return [];
    }
    
    async function loadFromUrl() {
      const url = document.getElementById('urlInput').value.trim();
      if (!url) {
        alert('请输入订阅地址');
        return;
      }
      
      try {
        const response = await fetch('/api/fetch?url=' + encodeURIComponent(url));
        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error);
        }
        
        document.getElementById('jsonInput').value = JSON.stringify(data, null, 2);
        alert('加载成功！');
      } catch (error) {
        alert('加载失败: ' + error.message);
      }
    }
    
    async function startTest() {
      const urlInput = document.getElementById('urlInput').value.trim();
      const jsonInput = document.getElementById('jsonInput').value.trim();
      
      let sources = [];
      
      // 优先使用 JSON 输入
      if (jsonInput) {
        try {
          const data = JSON.parse(jsonInput);
          // 解析数据（支持数组和 TVBox 配置）
          sources = parseConfig(data);
        } catch (error) {
          alert('JSON 格式错误: ' + error.message);
          return;
        }
      } else if (urlInput) {
        // 从 URL 加载
        try {
          const response = await fetch('/api/fetch?url=' + encodeURIComponent(urlInput));
          const data = await response.json();
          
          if (data.error) {
            throw new Error(data.error);
          }
          
          sources = data;
        } catch (error) {
          alert('加载订阅失败: ' + error.message);
          return;
        }
      } else {
        alert('请输入订阅地址或粘贴 JSON 数据');
        return;
      }
      
      // 验证数据格式
      if (!Array.isArray(sources)) {
        alert('数据格式错误：需要数组格式');
        return;
      }
      
      if (sources.length === 0) {
        alert('没有可测试的视频源');
        return;
      }
      
      // 显示加载状态
      document.getElementById('loading').classList.add('active');
      document.getElementById('results').classList.remove('active');
      document.getElementById('testBtn').disabled = true;
      
      // 开始测速
      try {
        const response = await fetch('/api/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sources }),
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          
          // 解析 SSE 数据
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.substring(6));
              
              if (data.type === 'progress') {
                document.getElementById('progress').textContent = 
                  \`正在测试: \${data.current}/\${data.total} - \${data.name}\`;
              } else if (data.type === 'complete') {
                testResults = data.results;
                displayResults(testResults);
              }
            }
          }
        }
      } catch (error) {
        alert('测速失败: ' + error.message);
      } finally {
        document.getElementById('loading').classList.remove('active');
        document.getElementById('testBtn').disabled = false;
      }
    }
    
    function displayResults(results) {
      document.getElementById('results').classList.add('active');
      
      // 统计数据
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;
      const avgSpeed = results.filter(r => r.success).reduce((sum, r) => sum + (r.downloadSpeed || 0), 0) / successCount || 0;
      const maxSpeed = Math.max(...results.filter(r => r.success).map(r => r.downloadSpeed || 0));
      
      document.getElementById('stats').innerHTML = \`
        <div class="stat-card">
          <div class="stat-value">\${results.length}</div>
          <div class="stat-label">总数量</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${successCount}</div>
          <div class="stat-label">成功</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${failedCount}</div>
          <div class="stat-label">失败</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${avgSpeed.toFixed(2)}</div>
          <div class="stat-label">平均速度 MB/s</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">\${maxSpeed.toFixed(2)}</div>
          <div class="stat-label">最高速度 MB/s</div>
        </div>
      \`;
      
      // 结果表格
      const tbody = document.getElementById('resultsBody');
      tbody.innerHTML = '';
      
      results.forEach((result, index) => {
        const row = tbody.insertRow();
        
        // 判断是否为 API 源
        const isApi = result.url.includes('/api/') || result.url.includes('?token=') || result.url.includes('source/');
        
        row.innerHTML = \`
          <td>\${index + 1}</td>
          <td title="\${result.url}">\${result.name}\${isApi ? ' <span style="color:#666;font-size:0.8em;">[API]</span>' : ''}</td>
          <td class="\${result.success ? 'status-success' : 'status-failed'}">
            \${result.success ? '✓ 成功' : '✗ 失败'}
          </td>
          <td>\${result.success ? result.responseTime + ' ms' : '-'}</td>
          <td>\${result.success ? (isApi ? 'N/A' : result.downloadSpeed + ' MB/s') : '-'}</td>
          <td>\${result.success ? (isApi ? 'N/A' : result.bitrate + ' Mbps') : '-'}</td>
          <td>
            \${result.success && !isApi ? \`
              <div class="speed-bar">
                <div class="speed-fill" style="width: \${Math.min(result.downloadSpeed / maxSpeed * 100, 100)}%"></div>
              </div>
            \` : '-'}
          </td>
        \`;
        
        if (!result.success) {
          const errorCell = row.insertCell();
          errorCell.innerHTML = \`<div class="error-msg">\${result.error}</div>\`;
        } else {
          row.insertCell().textContent = '';
        }
      });
    }
    
    function sortTable(column) {
      // 简单的表格排序功能
      const table = document.getElementById('resultsTable');
      const tbody = table.querySelector('tbody');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      
      rows.sort((a, b) => {
        const aVal = a.cells[column].textContent;
        const bVal = b.cells[column].textContent;
        
        // 数字排序
        if (!isNaN(parseFloat(aVal)) && !isNaN(parseFloat(bVal))) {
          return parseFloat(bVal) - parseFloat(aVal);
        }
        
        // 字符串排序
        return aVal.localeCompare(bVal);
      });
      
      rows.forEach((row, index) => {
        row.cells[0].textContent = index + 1;
        tbody.appendChild(row);
      });
    }
    
    function clearResults() {
      document.getElementById('results').classList.remove('active');
      document.getElementById('jsonInput').value = '';
      document.getElementById('urlInput').value = '';
      testResults = [];
    }
    
    function exportResults() {
      if (testResults.length === 0) {
        alert('没有可导出的结果');
        return;
      }
      
      const dataStr = JSON.stringify(testResults, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = \`speed-test-\${new Date().toISOString().slice(0, 10)}.json\`;
      a.click();
      
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理 OPTIONS 请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API: 获取订阅
    if (url.pathname === '/api/fetch') {
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return Response.json({ error: 'Missing URL parameter' }, { status: 400, headers: corsHeaders });
      }

      try {
        const response = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        // 解析 TVBox 配置，提取视频源
        const sources = parseTVBoxConfig(data);
        
        return Response.json(sources, { headers: corsHeaders });
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
      }
    }

    // API: 测速
    if (url.pathname === '/api/test' && request.method === 'POST') {
      try {
        const { sources } = await request.json();

        if (!Array.isArray(sources) || sources.length === 0) {
          return Response.json({ error: 'Invalid sources' }, { status: 400, headers: corsHeaders });
        }

        // 使用 SSE 流式返回结果
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();

        // 异步执行测速
        ctx.waitUntil(
          (async () => {
            const results: SpeedTestResult[] = [];

            for (let i = 0; i < sources.length; i++) {
              const source = sources[i];

              // 发送进度
              await writer.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'progress',
                    current: i + 1,
                    total: sources.length,
                    name: source.name || source.url,
                  })}\n\n`
                )
              );

              // 测试单个源
              const result = await testSource(source);
              results.push(result);
            }

            // 排序结果
            results.sort((a, b) => {
              if (a.success && !b.success) return -1;
              if (!a.success && b.success) return 1;
              if (a.success && b.success) {
                return (b.downloadSpeed || 0) - (a.downloadSpeed || 0);
              }
              return 0;
            });

            // 发送完成
            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  results,
                })}\n\n`
              )
            );

            await writer.close();
          })()
        );

        return new Response(readable, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
      }
    }

    // 返回 HTML 页面
    return new Response(getHTML(), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        ...corsHeaders,
      },
    });
  },
};
