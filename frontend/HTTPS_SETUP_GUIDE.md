# 📱 HTTPS 本地开发环境设置指南

## ✅ 已完成配置

### 1. SSL 证书（3年有效期）
- 📂 位置: `frontend/ssl/`
- 📜 证书: `cert.pem` (自签名证书)
- 🔑 私钥: `key.pem`
- ⏰ 有效期: **2026-01-13 至 2029-01-12** (3年)

### 2. 前端 HTTPS 配置
- ✅ `package.json` - 已添加 HTTPS 启动脚本
- ✅ `setupProxy.js` - 已配置 WebSocket 代理 (wss://)
- ✅ WebSocket 自动升级 - `wsConnect.js` 已支持 https → wss

---

## 🚀 启动服务器

### 方法 1: 使用启动脚本（推荐）

**Windows (双击运行)**:
```
start-https.bat   (HTTPS 模式 - PWA 可用)
start-http.bat    (HTTP 模式 - 备用)
```

**PowerShell**:
```powershell
.\start-https.ps1
```

### 方法 2: 命令行

**HTTPS 模式** (默认):
```bash
npm start
```

**HTTP 模式** (备用):
```bash
npm run start:http
```

---

## 🌐 访问地址

启动后访问：
- **局域网**: https://192.168.10.100:3000
- **本机**: https://localhost:3000

**注意**: 首次访问会显示"不安全连接"警告，点击"高级" > "继续访问"即可。

---

## 📱 手机安装证书（PWA 必需）

### Android 设置步骤

1. **传输证书到手机**
   ```
   - 方式 1: 通过微信/QQ 发送 frontend/ssl/cert.pem
   - 方式 2: 放到共享文件夹
   - 方式 3: 通过邮件发送
   ```

2. **安装证书**
   ```
   打开文件管理器 > 找到 cert.pem
   点击文件 > 选择"安装证书"
   系统会提示"CA 证书"
   ```

3. **验证安装**
   ```
   设置 > 安全性 > 加密与凭证 > 用户凭证
   应该能看到 "192.168.10.100" 证书
   ```

4. **访问网站**
   ```
   Chrome 浏览器访问: https://192.168.10.100:3000
   不应再显示"不安全"警告
   ```

---

### iOS 设置步骤

1. **传输证书到 iPhone**
   ```
   - 推荐: AirDrop 发送 cert.pem
   - 备选: 邮件附件发送
   ```

2. **安装配置描述文件**
   ```
   收到文件后点击
   iOS 会提示"此网站正尝试下载配置描述文件"
   点击"允许"

   打开: 设置 > 通用 > VPN 与设备管理
   找到 "192.168.10.100" 描述文件
   点击 "安装" > 输入密码 > 完成安装
   ```

3. **信任证书**（重要！）
   ```
   设置 > 通用 > 关于本机 > 证书信任设置
   找到 "192.168.10.100"
   打开开关启用完全信任
   ```

4. **验证**
   ```
   Safari 访问: https://192.168.10.100:3000
   地址栏应显示锁图标（已保护）
   ```

---

## 🔧 验证功能清单

### ✅ 基础功能
- [ ] HTTPS 访问成功 (https://192.168.10.100:3000)
- [ ] 无证书警告（桌面/手机）
- [ ] API 请求正常 (HTTPS → HTTP 代理)
- [ ] 登录功能正常

### ✅ WebSocket 功能
- [ ] Dashboard 实时更新
- [ ] PCBA Tracking 实时更新
- [ ] NG Dashboard 实时更新
- [ ] 控制台无 WebSocket 错误

### ✅ PWA 功能
- [ ] 浏览器地址栏显示"安装"图标
- [ ] 可以添加到主屏幕
- [ ] Service Worker 注册成功
- [ ] 离线访问可用

---

## ⚠️ 常见问题

### 问题 1: 浏览器显示"不安全连接"

**症状**: Chrome 显示 "您的连接不是私密连接"

**原因**: 自签名证书未被系统信任

**解决方案**:
```
方法 A (快速): 点击 "高级" > "继续前往 192.168.10.100 (不安全)"
方法 B (推荐): 导入证书到系统

Windows:
1. certmgr.msc
2. 受信任的根证书颁发机构 > 证书
3. 右键 > 所有任务 > 导入
4. 选择 frontend/ssl/cert.pem

macOS:
1. 打开"钥匙串访问"
2. 拖拽 cert.pem 到"系统"钥匙串
3. 双击证书 > 信任 > 始终信任
```

---

### 问题 2: WebSocket 连接失败

**症状**: 控制台显示 `WebSocket connection to 'wss://...' failed`

**检查清单**:
1. ✅ setupProxy.js 包含 `/ws` 代理配置
2. ✅ 后端服务器运行在 `http://192.168.10.100:8000`
3. ✅ 前端通过 HTTPS 访问

**调试**:
```javascript
// 临时修改 wsConnect.js 第 18 行，测试 ws:// 连接
return "ws://" + host;  // 强制使用 ws://
```

如果 ws:// 可用但 wss:// 不可用，说明代理配置有问题。

---

### 问题 3: 手机无法访问

**症状**: 手机浏览器显示"无法连接到服务器"

**检查清单**:
1. ✅ 电脑和手机在同一 Wi-Fi 网络
2. ✅ Windows 防火墙允许 3000 端口
   ```powershell
   # 以管理员身份运行 PowerShell
   netsh advfirewall firewall add rule name="React HTTPS Dev" dir=in action=allow protocol=TCP localport=3000
   ```
3. ✅ 前端使用 `HOST=0.0.0.0` 启动（不是 localhost）
4. ✅ 电脑 IP 是 192.168.10.100
   ```bash
   ipconfig | findstr IPv4
   ```

---

### 问题 4: PWA 无法安装

**症状**: 地址栏没有"安装"图标

**检查清单**:
1. ✅ 必须通过 HTTPS 访问（不是 HTTP）
2. ✅ 手机已信任证书（Android/iOS）
3. ✅ Service Worker 注册成功
   - 打开 DevTools > Application > Service Workers
   - 状态应为 "activated and is running"
4. ✅ manifest.json 配置正确
   - 打开 DevTools > Application > Manifest
   - 检查图标、名称等信息

---

### 问题 5: 证书过期

**症状**: 3 年后（2029-01-12）证书失效

**解决方案**:
```bash
# 重新生成证书（再延长 3 年）
cd frontend/ssl
openssl x509 -req -days 1095 -in csr.pem -signkey key.pem -out cert.pem

# 验证新证书
openssl x509 -in cert.pem -noout -dates
```

**手机需要**:
1. 卸载旧证书
2. 重新安装新证书

---

## 📊 技术架构

```
┌─────────────────────────────────────────────┐
│  手机/电脑浏览器                               │
│  https://192.168.10.100:3000                │
└───────────────┬─────────────────────────────┘
                │ HTTPS (SSL)
                │
┌───────────────▼─────────────────────────────┐
│  React Dev Server (HTTPS)                   │
│  - 证书: frontend/ssl/cert.pem               │
│  - 端口: 3000                                │
└───────────────┬─────────────────────────────┘
                │ HTTP (内部代理)
                │
┌───────────────▼─────────────────────────────┐
│  FastAPI Backend (HTTP)                     │
│  - 端口: 8000                                │
│  - 无需 SSL 配置                              │
└─────────────────────────────────────────────┘
```

**关键点**:
- ✅ 前端 HTTPS: 满足 PWA 要求
- ✅ 后端 HTTP: 简化开发，内网安全
- ✅ 代理自动转换: HTTPS → HTTP
- ✅ WebSocket 升级: wss:// → ws://

---

## 🔒 安全说明

### 自签名证书的安全性

**开发环境** ✅:
- 局域网内使用，风险极低
- 仅用于 PWA 测试
- 不对外暴露

**生产环境** ❌:
- 必须使用正式 CA 签发的证书
- 推荐: Let's Encrypt (免费)
- 或购买商业证书

---

## 📝 备份与恢复

### 备份证书
```bash
# 备份整个 SSL 目录
cp -r frontend/ssl frontend/ssl.backup

# 或只备份关键文件
cp frontend/ssl/cert.pem frontend/ssl/cert.pem.backup
cp frontend/ssl/key.pem frontend/ssl/key.pem.backup
```

### 恢复证书
```bash
# 从备份恢复
cp -r frontend/ssl.backup frontend/ssl
```

---

## 🆘 技术支持

如遇到问题：
1. 检查控制台错误信息
2. 查看网络请求是否成功（DevTools > Network）
3. 验证 WebSocket 连接状态
4. 检查防火墙设置

---

## 📅 维护计划

- **每年检查**: 证书是否即将过期
- **更新时**: 重新生成证书并分发到所有测试设备
- **生产部署**: 使用 Let's Encrypt 或商业证书

---

## ✅ 完成清单

配置完成后，应该能够：
- [x] ✅ 生成 3 年有效期的 SSL 证书
- [x] ✅ 前端支持 HTTPS 启动
- [x] ✅ WebSocket 自动升级到 wss://
- [x] ✅ API 请求通过代理正常工作
- [ ] ⏳ 手机安装证书
- [ ] ⏳ PWA 安装测试
- [ ] ⏳ 所有功能验证

祝测试顺利！🎉
