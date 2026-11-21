// ===========================================================================
//  保卫萝卜 · 复刻版 —— 可移植启动器（C++17，零第三方依赖）
//
//  它负责把一个"裸 Python 环境"变成"能直接双击开玩"的完整游戏：
//    1. 找到可用的 Python（本机 / 随包携带的便携版 / 系统安装）
//    2. 都找不到就在线补齐：按镜像优先级自动切换源，下载 Python 便携包
//    3. 校验下载完整性（大小 + 能否解压），失败自动换下一个镜像
//    4. 起一个本地 HTTP 服务，打开浏览器
//    5. 全程中文提示，出错不闪退，给出可执行的下一步
//
//  编译（Linux/macOS）:  g++ -std=c++17 -O2 -o pwlb-launcher launcher.cpp
//  编译（Windows MSVC）: cl /std:c++17 /O2 /EHsc launcher.cpp
//  编译（Windows MinGW）: g++ -std=c++17 -O2 -o pwlb-launcher.exe launcher.cpp
//  运行: launcher.exe [--port 8000] [--no-open] [--no-install] [--check]
// ===========================================================================

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#ifdef _WIN32
#  define PWLB_WIN 1
#  include <windows.h>
#  include <direct.h>
#  include <io.h>
#else
#  include <unistd.h>
#  include <sys/stat.h>
#  include <sys/types.h>
#  include <sys/wait.h>
#  include <signal.h>
#endif

namespace pwlb {

// ---------------------------------------------------------------- 基础工具

static bool g_win = false;
static bool g_verbose = false;

/** 把多字节字符串原样写到控制台（Windows 下切 UTF-8 代码页）。 */
static void setup_console() {
#ifdef PWLB_WIN
    g_win = true;
    // 让中文不在 cmd 里变成乱码
    SetConsoleOutputCP(65001);
    SetConsoleCP(65001);
    HANDLE hOut = GetStdHandle(STD_OUTPUT_HANDLE);
    if (hOut != INVALID_HANDLE_VALUE) {
        DWORD mode = 0;
        if (GetConsoleMode(hOut, &mode)) {
            // 打开虚拟终端序列，让颜色可用（Win10+）
            SetConsoleMode(hOut, mode | 0x0004);
        }
    }
#else
    g_win = false;
#endif
}

static bool color_on = false;

static void paint(const char* code) {
    if (color_on) std::cout << code;
}
static void reset_color() {
    if (color_on) std::cout << "\033[0m";
}

static void say(const std::string& text) { std::cout << text << std::endl; }
static void say_ok(const std::string& text) {
    paint("\033[32m"); std::cout << "  [完成] " << text; reset_color(); std::cout << std::endl;
}
static void say_info(const std::string& text) {
    paint("\033[36m"); std::cout << "  [信息] " << text; reset_color(); std::cout << std::endl;
}
static void say_warn(const std::string& text) {
    paint("\033[33m"); std::cout << "  [注意] " << text; reset_color(); std::cout << std::endl;
}
static void say_err(const std::string& text) {
    paint("\033[31m"); std::cout << "  [错误] " << text; reset_color(); std::cout << std::endl;
}
static void say_step(const std::string& text) {
    paint("\033[35m"); std::cout << "==> " << text; reset_color(); std::cout << std::endl;
}

static bool file_exists(const std::string& path) {
    std::ifstream f(path.c_str(), std::ios::binary);
    return f.good();
}

static bool dir_exists(const std::string& path) {
#ifdef PWLB_WIN
    DWORD attr = GetFileAttributesA(path.c_str());
    return attr != INVALID_FILE_ATTRIBUTES && (attr & FILE_ATTRIBUTE_DIRECTORY);
#else
    struct stat st;
    return stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
#endif
}

static long long file_size(const std::string& path) {
    std::ifstream f(path.c_str(), std::ios::binary | std::ios::ate);
    if (!f.good()) return -1;
    return (long long)f.tellg();
}

static bool make_dir(const std::string& path) {
    if (dir_exists(path)) return true;
#ifdef PWLB_WIN
    return _mkdir(path.c_str()) == 0 || dir_exists(path);
#else
    return mkdir(path.c_str(), 0755) == 0 || dir_exists(path);
#endif
}

static bool make_dir_recursive(const std::string& path) {
    std::string cur;
    for (size_t i = 0; i < path.size(); ++i) {
        char c = path[i];
        bool sep = (c == '/' || c == '\\');
        if (sep && !cur.empty() && cur.back() != ':') {
            if (!make_dir(cur)) return false;
        }
        cur.push_back(c);
    }
    return make_dir(path);
}

static std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return "";
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

/** 执行一条命令，捕获 stdout（Windows 用 _popen，其它用 popen）。 */
static std::string run_capture(const std::string& cmd, int* exit_code = nullptr) {
    std::string out;
#ifdef PWLB_WIN
    // cmd.exe 有个坑：当命令以引号开头时会进入特殊解析模式，导致命令不执行。
    // 统一加 "cmd /c " 前缀（此时引号不在开头），并用 /S 保证引号内内容正确传递。
    std::string real = "cmd /S /C " + cmd;
    FILE* pipe = _popen(real.c_str(), "r");
#else
    FILE* pipe = popen(cmd.c_str(), "r");
#endif
    if (!pipe) {
        if (exit_code) *exit_code = -1;
        return out;
    }
    char buf[512];
    while (fgets(buf, sizeof(buf), pipe)) out += buf;
#ifdef PWLB_WIN
    int rc = _pclose(pipe);
#else
    int rc = pclose(pipe);
#endif
    if (exit_code) *exit_code = rc;
    return out;
}

/** 执行命令（不关心输出），返回是否成功。 */
static bool run_shell(const std::string& cmd) {
    int rc = 0;
    run_capture(cmd, &rc);
    return rc == 0;
}

static std::string quote(const std::string& s) {
    return "\"" + s + "\"";
}

static std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return (char)std::tolower(c); });
    return s;
}

static bool contains(const std::string& hay, const std::string& needle) {
    return hay.find(needle) != std::string::npos;
}

// ---------------------------------------------------------------- 路径

/** 可执行文件所在目录（末尾不带分隔符）。 */
static std::string exe_dir() {
#ifdef PWLB_WIN
    char buf[MAX_PATH * 2];
    DWORD n = GetModuleFileNameA(nullptr, buf, sizeof(buf));
    if (n == 0) return ".";
    std::string p(buf, n);
    size_t pos = p.find_last_of("\\/");
    return pos == std::string::npos ? "." : p.substr(0, pos);
#else
    char buf[4096];
    ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
    if (n <= 0) return ".";
    buf[n] = '\0';
    std::string p(buf);
    size_t pos = p.find_last_of('/');
    return pos == std::string::npos ? "." : p.substr(0, pos);
#endif
}

static std::string join_path(const std::string& a, const std::string& b) {
    if (a.empty()) return b;
    char last = a.back();
    if (last == '/' || last == '\\') return a + b;
    return a + (g_win ? "\\" : "/") + b;
}

/** 项目根目录：exe 可能放在 launcher/ 子目录里，向上找 server.py。 */
static std::string project_root() {
    std::string dir = exe_dir();
    std::string probe = dir;
    for (int depth = 0; depth < 4; ++depth) {
        if (file_exists(join_path(probe, "server.py"))) return probe;
        size_t pos = probe.find_last_of("\\/");
        if (pos == std::string::npos || probe.size() <= 2) break;
        probe = probe.substr(0, pos);
        if (probe.empty()) break;
    }
    return exe_dir();  // 找不到就用 exe 所在目录
}


// ---------------------------------------------------------------- Python 检测

struct PythonInfo {
    std::string path;      // 可执行文件
    std::string version;   // 例如 3.14.0
    bool portable = false; // 是否随包携带
    bool ok = false;
};

static PythonInfo probe_python_cmd(const std::string& exe) {
    PythonInfo info;
    // exe 可能本身是多词命令（例如 "py -3"），此时不能再套引号
    bool multi = exe.find(' ') != std::string::npos &&
                 exe.find('\\') == std::string::npos &&
                 exe.find('/') == std::string::npos;
    std::string head = multi ? exe : quote(exe);
    std::string cmd = head +
        " -c \"import sys;print('%d.%d.%d'%sys.version_info[:3])\" 2>NUL";
    if (!g_win) cmd = head + " -c \"import sys;print('%d.%d.%d'%sys.version_info[:3])\" 2>/dev/null";
    std::string out = run_capture(cmd);
    out = trim(out);
    if (out.empty()) return info;

    // 解析 "3.14.0"
    int major = 0, minor = 0;
    if (std::sscanf(out.c_str(), "%d.%d", &major, &minor) != 2) return info;
    if (major < 3 || (major == 3 && minor < 8)) {
        if (g_verbose) say_warn("Python 版本过低（" + out + "），需要 3.8+：" + exe);
        return info;
    }
    // 关键：无论用 py -3 还是 python 探测的，最终都换成真实解释器路径。
    // py launcher 在运行脚本时会把参数误解成版本号（退出码 103），绝不能拿它直接跑 server.py。
    std::string real = trim(run_capture(
        head + " -c \"import sys;print(sys.executable)\" 2>NUL"));
    if (!g_win) real = trim(run_capture(
        head + " -c \"import sys;print(sys.executable)\" 2>/dev/null"));
    // 只取最后一行，防止 py 输出额外提示
    size_t nl = real.find_last_of("\r\n");
    if (nl != std::string::npos) real = trim(real.substr(nl + 1));

    if (!real.empty() && file_exists(real)) info.path = real;
    else info.path = exe;
    info.version = out;
    info.ok = true;
    return info;
}

/** 在 PATH 里找 python / python3 / py。 */
static PythonInfo find_python_in_path() {
    // 真实解释器优先：python/python3 直接可用；py launcher 放最后，
    // 因为它在某些环境下运行脚本会误判参数（见 probe_python_cmd 里的说明）。
    const char* candidates[] = {
        "python3", "python", "py -3", "py"
    };
    for (const char* c : candidates) {
        // 先确认命令存在
        std::string probe = g_win ? std::string("where ") + c + " >NUL 2>NUL"
                                  : std::string("command -v ") + c + " >/dev/null 2>&1";
        if (c == std::string("py -3")) probe = "py -3 --version >NUL 2>NUL";
        if (!run_shell(probe)) continue;

        PythonInfo info = probe_python_cmd(c);
        if (info.ok) return info;
    }
    return PythonInfo();
}

/** 随包携带的便携版 Python 目录。 */
static std::string portable_python_dir() {
    return join_path(project_root(), join_path("runtime", "python"));
}

static PythonInfo find_portable_python() {
    PythonInfo info;
#ifdef PWLB_WIN
    std::string c1 = join_path(portable_python_dir(), "python.exe");
    if (file_exists(c1)) {
        // 不依赖 cmd 下的版本字符串探测（可能拿不到输出），文件存在即认定可用；
        // 真正的可用性由后续能否起服务来验证。
        info.ok = true;
        info.path = c1;
        info.version = "portable";
        info.portable = true;
        return info;
    }
#else
    std::string c1 = join_path(portable_python_dir(), join_path("bin", "python3"));
    if (file_exists(c1)) {
        info = probe_python_cmd(c1);
        if (info.ok) { info.portable = true; return info; }
    }
#endif
    return PythonInfo();
}

/** 把 "py -3" 解析成真实的 python.exe 路径（失败返回空）。 */
static std::string resolve_py_launcher() {
    // py -3 -c "import sys;print(sys.executable)" 能拿到解释器真实路径
    std::string out = trim(run_capture(
        "py -3 -c \"import sys;print(sys.executable)\" 2>NUL"));
    if (out.empty()) {
        out = trim(run_capture(
            "py -3 -c \"import sys;print(sys.executable)\" 2>/dev/null"));
    }
    if (out.empty() || !file_exists(out)) return "";
    return out;
}

// ---------------------------------------------------------------- 镜像源

struct Mirror {
    std::string name;
    std::string url;     // python 便携包下载地址前缀
};

/**
 * 镜像优先级：国内源优先（python.org 在很多网络下连不上，实测 000）。
 * 每个镜像都给 python 便携 zip 的具体路径，失败自动换下一个。
 */
static std::vector<Mirror> mirrors_for(const std::string& pyver, const std::string& tag) {
    std::string file = "python-" + pyver + "-embed-amd64.zip";
    return {
        { "华为云",   "https://mirrors.huaweicloud.com/python/" + pyver + "/" + file },
        { "清华 TUNA", "https://mirrors.tuna.tsinghua.edu.cn/python/" + pyver + "/" + file },
        { "阿里云",   "https://mirrors.aliyun.com/python-release/windows/" + file },
        { "淘宝 npmmirror", "https://registry.npmmirror.com/-/binary/python/" + pyver + "/" + file },
        { "官方 python.org", "https://www.python.org/ftp/python/" + pyver + "/" + file },
    };
}

/** 找 curl：先按 PATH，失败再试 Windows 系统目录（Win10+ 自带 curl.exe）。 */
static std::string find_curl() {
    std::string out = run_capture(g_win ? "curl --version 2>NUL"
                                        : "curl --version 2>/dev/null");
    if (to_lower(out).find("curl") != std::string::npos) {
        // 拿到 curl 的真实路径，后面直接用绝对路径调用，避免 PATH 问题
        std::string loc = run_capture(g_win ? "where curl 2>NUL"
                                            : "command -v curl 2>/dev/null");
        if (!loc.empty()) {
            size_t nl = loc.find_first_of("\r\n");
            if (nl != std::string::npos) loc = loc.substr(0, nl);
            loc = trim(loc);
            if (!loc.empty()) return loc;
        }
        return "curl";  // 用命令名也行
    }
#ifdef PWLB_WIN
    // PATH 坏了也别放弃：System32 里几乎一定有 curl.exe
    const char* sys[] = {
        "C:\\Windows\\System32\\curl.exe",
        "C:\\Windows\\SysWOW64\\curl.exe"
    };
    for (const char* p : sys) {
        if (file_exists(p)) {
            std::string at = run_capture(quote(p) + " --version 2>NUL");
            if (to_lower(at).find("curl") != std::string::npos) return p;
        }
    }
#endif
    return "";
}

/** 测一个 URL 的响应耗时（毫秒）；连不上返回 -1。用于镜像排序。 */
static long long http_latency_ms(const std::string& url, int timeout_sec = 6) {
#ifdef PWLB_WIN
    // PowerShell 的 Invoke-WebRequest 最可靠，不受 cmd 引号解析影响
    std::string ps = "powershell -NoProfile -Command \"$sw=[Diagnostics.Stopwatch]::StartNew();"
        "try{Invoke-WebRequest -Uri '" + url + "' -Method Head -TimeoutSec " +
        std::to_string(timeout_sec) + " -UseBasicParsing | Out-Null;"
        "Write-Output ([int]$sw.Elapsed.TotalMilliseconds)}catch{Write-Output -1}\"";
    std::string out = trim(run_capture(ps));
    int ms = std::atoi(out.c_str());
    return ms > 0 ? (long long)ms : -1;
#else
    static std::string curlbin = find_curl();
    if (curlbin.empty()) return -1;
    std::string cmd = quote(curlbin) + " -s -o /dev/null -w '%{time_total}' -m " + std::to_string(timeout_sec) +
              " " + quote(url) + " 2>/dev/null";
    std::string out = trim(run_capture(cmd));
    if (out.empty()) return -1;
    double sec = std::atof(out.c_str());
    if (sec <= 0.0001) return -1;
    return (long long)(sec * 1000);
#endif
}

static bool http_ok(const std::string& url, int timeout_sec = 8) {
#ifdef PWLB_WIN
    std::string ps = "powershell -NoProfile -Command \"try{(Invoke-WebRequest -Uri '" + url +
        "' -Method Head -TimeoutSec " + std::to_string(timeout_sec) +
        " -UseBasicParsing).StatusCode}catch{Write-Output 0}\"";
    return trim(run_capture(ps)) == "200";
#else
    static std::string curlbin = find_curl();
    if (curlbin.empty()) return false;
    std::string cmd = quote(curlbin) + " -s -o /dev/null -w '%{http_code}' -m " + std::to_string(timeout_sec) +
              " " + quote(url) + " 2>/dev/null";
    return trim(run_capture(cmd)) == "200";
#endif
}

static bool download(const std::string& url, const std::string& dest) {
#ifdef PWLB_WIN
    std::string ps = "powershell -NoProfile -Command \"$ProgressPreference='SilentlyContinue';"
        "try{Invoke-WebRequest -Uri '" + url + "' -OutFile '" + dest +
        "' -TimeoutSec 300 -UseBasicParsing; Write-Output OK}catch{Write-Output FAIL}\"";
    std::string out = trim(run_capture(ps));
    return out.find("OK") != std::string::npos && file_size(dest) > 1000000;
#else
    static std::string curlbin = find_curl();
    if (curlbin.empty()) return false;
    std::string cmd = quote(curlbin) + " -L --fail --retry 2 --connect-timeout 10 -o " +
              quote(dest) + " " + quote(url) + " 2>/dev/null";
    return run_shell(cmd) && file_size(dest) > 1000000;
#endif
}

// ---------------------------------------------------------------- 安装

static int install_python(const std::string& pyver) {
    say_step("本机没有可用的 Python，开始自动补齐运行环境");
    say_info("目标版本：" + pyver + "（便携版，不污染系统）");

    if (find_curl().empty()) {
        say_err("系统缺少 curl，无法自动下载。");
        say("       请手动安装 Python 3.8+： https://www.python.org/downloads/");
        say("       安装时勾选 \"Add python.exe to PATH\"，然后重新运行本启动器。");
        return 2;
    }

    std::string dir = portable_python_dir();
    std::string tmp = join_path(project_root(), "runtime");
    make_dir(tmp);
    std::string zip = join_path(tmp, "python-embed.zip");
    std::string unpack = join_path(tmp, "python");

    std::vector<Mirror> mirrors = mirrors_for(pyver, "");

    // 先全部测一遍延迟，按最快排序，这样大多数用户第一次就命中
    say_info("正在测速，挑选最快的镜像……");
    std::vector<std::pair<long long, size_t> > ranked;
    for (size_t i = 0; i < mirrors.size(); ++i) {
        long long ms = http_latency_ms(mirrors[i].url);
        if (ms >= 0) {
            ranked.push_back(std::make_pair(ms, i));
            say_info("  " + mirrors[i].name + "  " + std::to_string(ms) + " ms");
        } else {
            say_warn("  " + mirrors[i].name + "  不可达");
        }
    }
    std::sort(ranked.begin(), ranked.end());

    bool got = false;
    for (size_t k = 0; k < ranked.size() && !got; ++k) {
        const Mirror& m = mirrors[ranked[k].second];
        say_info("使用最快镜像：" + m.name + "（" + std::to_string(ranked[k].first) + " ms）");
        say_info("下载中，请稍候……");
        if (download(m.url, zip) && file_size(zip) > 500000) {
            say_ok(m.name + " 下载完成（" + std::to_string(file_size(zip) / 1024) + " KB）");
            got = true;
            break;
        }
        say_warn(m.name + " 下载失败，自动切换下一个最快镜像");
    }

    if (!got) {
        // 兜底：按原始顺序再试一遍（防止测速阶段超时但实际可下）
        for (size_t i = 0; i < mirrors.size() && !got; ++i) {
            const Mirror& m = mirrors[i];
            if (!http_ok(m.url, 10)) continue;
            if (download(m.url, zip)) {
                say_ok(m.name + " 下载完成（重试）");
                got = true;
            }
        }
    }

    if (!got) {
        say_err("所有镜像都没能下载到 Python。");
        say("       可以手动下载 python-" + pyver + "-embed-amd64.zip");
        say("       解压到：" + dir);
        say("       然后重新运行本启动器。");
        return 3;
    }

    say_info("解压中……");
    make_dir(unpack);
    std::string unzip = "tar -xf " + quote(zip) + " -C " + quote(unpack) + " 2>NUL";
    if (!g_win) unzip = "unzip -o " + quote(zip) + " -d " + quote(unpack) + " >/dev/null 2>&1";
    if (!run_shell(unzip)) {
        say_err("解压失败，压缩包可能损坏。");
        say("       已删除损坏的包，请重新运行本启动器再试一次。");
        std::remove(zip.c_str());
        return 4;
    }
    std::remove(zip.c_str());

    // 解压后 python.exe 存在即视为成功。版本探测在 cmd 下有时拿不到输出，
    // 但文件存在 + 后续能起服务才是真正的判据。
    std::string pyexe = join_path(unpack, g_win ? "python.exe" : join_path("bin", "python3"));
    if (!file_exists(pyexe)) {
        say_err("便携版 Python 解压后找不到可执行文件：" + pyexe);
        return 5;
    }
    PythonInfo info;
    info.ok = true;
    info.path = pyexe;
    info.version = pyver;
    info.portable = true;
    say_ok("运行环境就绪：Python " + info.version + "（便携版）");
    return 0;
}

// ---------------------------------------------------------------- 启动游戏

static bool port_busy(int port) {
#ifdef PWLB_WIN
    std::string cmd = "powershell -NoProfile -Command \"(Test-NetConnection -ComputerName 127.0.0.1 -Port " +
                      std::to_string(port) + " -InformationLevel Quiet) 2>$null\" 2>NUL";
    std::string out = to_lower(trim(run_capture(cmd)));
    if (contains(out, "true")) return true;
    // powershell 不可用时退回 curl 探测
    return http_ok("http://127.0.0.1:" + std::to_string(port) + "/api/health", 2);
#else
    std::string cmd = "curl -s -o /dev/null -w '%{http_code}' -m 2 http://127.0.0.1:" +
                      std::to_string(port) + "/api/health 2>/dev/null";
    std::string code = trim(run_capture(cmd));
    if (code == "200") return true;
    return false;
#endif
}

static int pick_port(int preferred, int tries) {
    for (int i = 0; i < tries; ++i) {
        int p = preferred + i;
        if (!port_busy(p)) return p;
    }
    return preferred;
}

static void open_browser(const std::string& url) {
#ifdef PWLB_WIN
    run_shell("start \"\" " + quote(url));
#elif defined(__APPLE__)
    run_shell("open " + quote(url) + " >/dev/null 2>&1 &");
#else
    run_shell("xdg-open " + quote(url) + " >/dev/null 2>&1 &");
#endif
}

/** 启动子进程并等待退出。Windows 用 CreateProcess 绕开 system()+空格路径的引号坑。 */
static int run_process(const std::string& cmd) {
#ifdef PWLB_WIN
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    // CreateProcess 的 lpCommandLine 必须是可写缓冲区
    std::vector<char> buf(cmd.begin(), cmd.end());
    buf.push_back('\0');
    if (!CreateProcessA(NULL, buf.data(), NULL, NULL, FALSE, 0, NULL, NULL, &si, &pi)) {
        say_err("CreateProcess 失败，错误码 " + std::to_string(GetLastError()));
        return -1;
    }
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD code = 0;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return (int)code;
#else
    return std::system(cmd.c_str());
#endif
}

static int run_game(const PythonInfo& py, int port, bool open_ui) {
    std::string server = join_path(project_root(), "server.py");
    if (!file_exists(server)) {
        say_err("找不到 server.py，目录可能不完整。");
        say("       当前目录：" + project_root());
        return 6;
    }

    int use = pick_port(port, 20);
    if (use != port) {
        say_info("端口 " + std::to_string(port) + " 被占用，改用 " + std::to_string(use));
    }

    std::string url = "http://127.0.0.1:" + std::to_string(use) + "/";
    std::string cmd = quote(py.path) + " " + quote(server) +
                      " --port " + std::to_string(use);
    if (!open_ui) cmd += " --no-open";

    say_step("启动游戏服务");
    say_info("地址：" + url);
    say_info("按 Ctrl+C 停止");
    say("");

    if (open_ui) {
        // 给服务一点启动时间再开浏览器
#ifdef PWLB_WIN
        std::string bg = "start \"pwt-wait\" /min cmd /c \"timeout /t 2 >NUL & start \"\" " + url + "\"";
        run_shell(bg);
#else
        run_shell("(sleep 2; xdg-open " + quote(url) + " >/dev/null 2>&1) &");
#endif
    }

    if (g_verbose) say_info("执行命令：" + cmd);
    int rc = run_process(cmd);
    if (rc != 0) {
        say("");
        say_warn("游戏进程退出（代码 " + std::to_string(rc) + "）。");
        say("       常见原因：web 目录不完整、端口被占、或 Python 缺少必要模块。");
    }
    return rc == 0 ? 0 : 7;
}

// ---------------------------------------------------------------- 自检

static int self_check() {
    say_step("环境自检");
    say_info("项目目录：" + project_root());
    say_info("平台：" + std::string(g_win ? "Windows" : "类 Unix"));

    PythonInfo portable = find_portable_python();
    if (portable.ok) say_ok("便携版 Python：" + portable.version);
    else say_warn("没有便携版 Python（首次运行会自动补齐）");

    PythonInfo sys = find_python_in_path();
    if (sys.ok) say_ok("系统 Python：" + sys.version + "（" + sys.path + "）");
    else say_warn("系统里没有可用的 Python");

    say_info("server.py: " + std::string(file_exists(join_path(project_root(), "server.py")) ? "存在" : "缺失"));
    say_info("web/index.html: " + std::string(file_exists(join_path(project_root(), join_path("web", "index.html"))) ? "存在" : "缺失"));

    for (const auto& m : mirrors_for("3.11.9", "")) {
        bool ok = http_ok(m.url, 6);
        say_info("镜像 " + m.name + "：" + (ok ? "可用" : "不可用"));
    }
    return (portable.ok || sys.ok) ? 0 : 1;
}

} // namespace pwlb

// ---------------------------------------------------------------- 入口

static void pause_if_needed(bool interactive) {
    if (!interactive) return;
    std::cout << std::endl << "按回车键关闭窗口……" << std::flush;
    std::cin.get();
}

int main(int argc, char** argv) {
    using namespace pwlb;
    setup_console();
    color_on = g_win;  // 现代 Windows 终端支持 ANSI；不支持时只是少点颜色

    int port = 8000;
    bool open_ui = true;
    bool allow_install = true;
    bool check_only = false;
    bool force_portable = false;
    bool interactive = true;

    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        if (a == "--port" && i + 1 < argc) port = std::atoi(argv[++i]);
        else if (a == "--no-open") open_ui = false;
        else if (a == "--no-install") allow_install = false;
        else if (a == "--force-portable") force_portable = true;
        else if (a == "--check") check_only = true;
        else if (a == "-v" || a == "--verbose") g_verbose = true;
        else if (a == "--no-pause") interactive = false;
        else if (a == "-h" || a == "--help") {
            say("保卫萝卜 · 复刻版 启动器");
            say("  --port N       指定端口（默认 8000，被占用自动顺延）");
            say("  --no-open      不自动打开浏览器");
            say("  --no-install   缺少运行库时不自动下载");
            say("  --check        只自检环境，不启动游戏");
            say("  --no-pause     出错时不等待回车（脚本调用）");
            say("  -v             输出更多信息");
            return 0;
        }
    }

    say("============================================================");
    say("   保卫萝卜 · 复刻版");
    say("============================================================");
    say("");

    if (check_only) return self_check();

    // 1. 先找便携版（随包携带的最稳），再找系统 Python
    PythonInfo py = find_portable_python();
    // --force-portable 只强制"不找系统 Python"，已下载的便携版仍要复用
    if (!py.ok && !force_portable) py = find_python_in_path();

    // 1.5 "py -3" 只能用来查版本：真正执行脚本时要用背后的 python.exe。
    //     py launcher 在找不到"合适运行时"时会把参数误解成版本号（退出码 103）。
    if (py.ok && py.path == "py -3") {
        std::string real = resolve_py_launcher();
        if (!real.empty()) {
            PythonInfo direct = probe_python_cmd(real);
            if (direct.ok) {
                py = direct;
                if (g_verbose) say_info("py launcher 已解析为：" + py.path);
            }
        }
    }

    // 2. 都没有 → 尝试补齐
    if (!py.ok) {
        if (!allow_install) {
            say_err("没有找到可用的 Python，且已禁用自动安装。");
            say("       请安装 Python 3.8+，或去掉 --no-install 让启动器自动补齐。");
            pause_if_needed(interactive);
            return 1;
        }
        // 选一个稳定的便携版版本（3.11 兼容性最好，体积也适中）
        const char* fallback_ver = "3.11.9";
        int rc = install_python(fallback_ver);
        if (rc != 0) {
            pause_if_needed(interactive);
            return rc;
        }
        py = find_portable_python();
        if (!py.ok) {
            say_err("补齐后仍然找不到 Python，请把 runtime/python 目录完整解压后重试。");
            pause_if_needed(interactive);
            return 8;
        }
    } else {
        say_ok("找到 Python " + py.version + (py.portable ? "（便携版）" : ""));
    }

    // 3. 起游戏
    int rc = run_game(py, port, open_ui);
    if (rc != 0) pause_if_needed(interactive);
    return rc;
}
