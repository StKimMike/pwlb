/** 测试脚本共用：自动找到正在运行的游戏服务器端口。 */
const PORTS = [8000, 8001, 8002, 8003, 8004, 8080, 8123];

async function detectPort(explicit) {
  if (explicit) return explicit;
  for (const port of PORTS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 700);
      const res = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const body = await res.json();
        if (body && body.ok) return port;
      }
    } catch (e) { /* 试下一个 */ }
  }
  throw new Error('没有找到运行中的服务器。先启动：python server.py 或双击 start.bat');
}

async function gameUrl(explicit) {
  const port = await detectPort(explicit);
  return 'http://127.0.0.1:' + port + '/';
}

module.exports = { detectPort, gameUrl, PORTS };
