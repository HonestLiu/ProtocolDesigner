# Protocol Designer

一款基于图形的**二进制通信协议设计工具**。通过拖拽节点可视化地定义消息结构、字段类型、枚举值等，自动生成 **C / Python / Rust** 三种语言的序列化与反序列化代码。

支持从裸格式到完整企业级协议的 5 个能力等级（Level 0~4），可按需开启 CRC、TLV、可选字段、位域等功能模块。

## 特性

- **可视化设计** — 基于 React Flow 的画布，拖拽连接节点即可设计协议
- **四类节点** — Message（消息）、Struct（结构体）、Field（字段）、Enum（枚举）
- **5 级协议能力**：
  - Level 0：裸字段打包，无头部
  - Level 1：基础头部（Magic + MsgType）+ 结构体/枚举类型
  - Level 2：CRC16 校验、可选字段位掩码、范围校验
  - Level 3：TLV 编码、版本字段、前向兼容
  - Level 4：位域、联合体、可配置字节序
- **多语言代码生成** — 一键生成 C/Python/Rust 的 pack/unpack 代码
- **模块化配置** — 每个特性可独立开关
- **工程持久化** — 保存/加载 `.json` 工程文件

## 技术栈

| 层 | 技术 |
|------|--------|
| 前端框架 | React 19 + TypeScript 6 |
| 构建工具 | Vite 8 |
| 画布引擎 | React Flow (@xyflow/react 12) |
| 样式 | Tailwind CSS 4 + shadcn/ui |
| 状态管理 | Zustand 5 |
| 桌面壳 | Tauri 2 (Rust) |
| 代码生成 | TypeScript（纯函数，无运行时依赖） |

## 前置要求

- **Node.js** >= 20
- **Rust** 工具链（`rustc` + `cargo`）
- **系统依赖**（Linux）：

```bash
# Fedora
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel \
  librsvg2-devel patchelf

# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget \
  file libxdo-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf

# Arch
sudo pacman -S webkit2gtk-4.1 base-devel curl wget file \
  openssl appmenu-gtk-module gtk3 libappindicator-gtk3 \
  librsvg patchelf
```

## 构建与运行

```bash
# 1. 克隆仓库
git clone <repo-url>
cd ProtocolCreate

# 2. 安装前端依赖
npm install

# 3. 开发模式（热重载）
npm run tauri dev

# 4. 构建发布版
npm run tauri build
```

构建产物位于 `src-tauri/target/release/bundle/`：

| 格式 | 用途 |
|------|---------|
| `.deb` | Debian/Ubuntu 安装包 |
| `.rpm` | Fedora/RHEL 安装包 |
| `.AppImage` | 便携式可执行文件 |

直接运行编译后的二进制（无需安装）：

```bash
./src-tauri/target/release/protocolcreate
```

## 使用说明

### 画布操作

| 操作 | 说明 |
|------|------|
| 添加节点 | 顶部工具栏点击 **+Message / +Struct / +Field / +Enum** |
| 连接节点 | 从节点的右侧手柄拖拽到目标节点左侧手柄 |
| 选中节点 | 点击节点，右侧属性面板显示配置项 |
| 删除节点 | 选中后按 `Delete` / `Backspace` |
| 拖拽移动 | 拖拽节点标题区域 |

### 有效连接规则

| 源节点 | 目标节点 | 效果 |
|--------|----------|--------|
| Message / Struct | Field | 字段加入消息/结构体的字段列表 ✅ |
| Field | Message / Struct | 同上，反向拖拽 ✅ |
| 其他组合 | — | 连接被忽略 ❌ |

### 协议配置

点击工具栏 **Settings** 按钮，配置协议等级和各功能模块：

- **Protocol Level**：选择 0~4 等级，自动启用对应模块
- **Modules**：手动开关各特性（可选字段、CRC、TLV 等）
- **Byte Order**（Level 4+）：Little / Big Endian

### 代码生成

工具栏点击 **Code** → 选择 C / Python / Rust → 复制或下载生成的代码。

### 工程管理

- **File → Save / Save As**：保存 `.json` 工程文件
- **File → Open**：加载已有工程
- **File → New**：新建工程

## 项目结构

```
ProtocolCreate/
├── src/                          # 前端 React 源码
│   ├── components/
│   │   ├── canvas/               # React Flow 画布
│   │   ├── nodes/                # 自定义节点组件
│   │   ├── panels/               # 属性面板
│   │   ├── toolbar/              # 工具栏 + 设置弹窗
│   │   └── ui/                   # shadcn/ui 基础组件
│   ├── lib/codegen/              # 代码生成器
│   │   ├── c-generator.ts        # C 代码生成
│   │   ├── python-generator.ts   # Python 代码生成
│   │   ├── rust-generator.ts     # Rust 代码生成
│   │   └── shared.ts             # 公用工具函数
│   ├── store/                    # Zustand 状态管理
│   └── types/                    # TypeScript 类型定义
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── commands/             # Tauri 命令
│   │   ├── file_io/              # 文件读写
│   │   ├── generator/            # Rust 端代码生成（简化版）
│   │   └── parser/               # 校验逻辑
│   ├── icons/                    # 应用图标
│   └── tauri.conf.json           # Tauri 配置
├── public/
│   ├── favicon.svg               # 浏览器标签页图标
│   └── icon-source.svg           # 图标源文件
└── package.json
```

## 开发

```bash
# 仅启动前端开发服务器（浏览器预览，无桌面窗口）
npm run dev

# TypeScript 类型检查
npx tsc --noEmit

# 代码检查
npm run lint

# 更新应用图标（将新图标放在 public/icon-source.svg 后）
npx tauri icon public/icon-source.svg -o src-tauri/icons
```

## License

MIT
