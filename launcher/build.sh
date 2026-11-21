#!/usr/bin/env bash
# 编译 C++ 启动器。需要本机有 g++ / clang++ / MSVC cl 之一。
set -e
cd "$(dirname "$0")"

if command -v g++ >/dev/null 2>&1; then
  g++ -std=c++17 -O2 -static -o pwlb-launcher.exe launcher.cpp
  echo '已生成 launcher/pwlb-launcher.exe'
elif command -v clang++ >/dev/null 2>&1; then
  clang++ -std=c++17 -O2 -o pwlb-launcher launcher.cpp
  echo '已生成 launcher/pwlb-launcher'
elif command -v cl >/dev/null 2>&1; then
  cl /std:c++17 /O2 /EHsc launcher.cpp
  echo '已生成 launcher.exe'
else
  echo '没有找到 C++ 编译器。'
  echo 'Windows: 安装 Visual Studio 的 C++ 桌面开发工作负载，或 MinGW-w64'
  echo 'Linux:   sudo apt install g++'
  echo 'macOS:   xcode-select --install'
  exit 1
fi
